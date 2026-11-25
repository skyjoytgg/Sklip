"""Où est la webcam du streamer dans l'image ? Détection automatique (réglable à la main dans Sklip).

Idée : on prend ~24 images réparties sur tout le stream. Le jeu change complètement d'une image à l'autre,
alors que la webcam montre toujours la même pièce (seul le streamer bouge un peu). Sur la carte
« ce qui change », la webcam est donc un grand rectangle calme aux bords nets. Les éléments fixes du HUD
sont calmes aussi, mais ce sont des barres fines ou de petits pictos : pas un rectangle plein.
Aucun modèle à télécharger, aucune donnée envoyée.
"""
from __future__ import annotations

import subprocess

import cv2
import numpy as np

W, H = 480, 270              # images réduites : largement assez pour trouver un rectangle
SAMPLES = 24
MIN_AREA, MAX_AREA = 0.008, 0.30
MIN_FILL = 0.72              # la zone calme remplit au moins 72 % de son rectangle
ASPECT = (0.6, 3.0)          # largeur / hauteur (webcam 4:3, 16:9, carrée…)


def pick_times(duration: float, in_game: list[float] | None = None, n: int = SAMPLES) -> list[float]:
    """Instants à regarder : de préférence pendant les parties (le HUD du jeu est lu), pour ne pas mélanger
    d'autres scènes (« Just Chatting » en plein écran, pause, écran de fin) où la webcam est ailleurs ou absente."""
    game = sorted(t for t in (in_game or []) if 0.02 * duration <= t <= 0.98 * duration)
    if len(game) >= n:
        idx = np.linspace(0, len(game) - 1, n).round().astype(int)
        return [float(game[i]) for i in idx]
    return [float(t) for t in np.linspace(0.05, 0.95, n) * duration]


def sample_frames(video: str, duration: float, n: int = SAMPLES, times: list[float] | None = None) -> np.ndarray:
    """n images en niveaux de gris, réparties entre 5 % et 95 % du stream (ou aux instants donnés)."""
    frames = []
    for t in (times if times is not None else np.linspace(0.05, 0.95, n) * duration):
        out = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1",
                              "-vf", f"scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                             capture_output=True).stdout
        if len(out) == W * H:
            frames.append(np.frombuffer(out, np.uint8).reshape(H, W))
    return np.stack(frames) if frames else np.zeros((0, H, W), np.uint8)


def change_map(frames: np.ndarray) -> np.ndarray:
    """Pour chaque pixel : de combien il change d'une image à l'autre (écart médian)."""
    g = frames.astype(np.float32)
    return np.median(np.abs(g - np.median(g, axis=0)), axis=0)


def edge_maps(frames: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Bords présents dans TOUTES les images (médiane) : le cadre de la webcam en fait partie, pas le jeu."""
    f = frames.astype(np.float32)
    gx = np.median(np.stack([np.abs(cv2.Sobel(x, cv2.CV_32F, 1, 0, ksize=3)) for x in f]), axis=0)
    gy = np.median(np.stack([np.abs(cv2.Sobel(x, cv2.CV_32F, 0, 1, ksize=3)) for x in f]), axis=0)
    return gx, gy


def _seeds(change: np.ndarray, n: int = 4) -> list[tuple[int, int, int, int]]:
    """Zones calmes (à peu près là où pourrait être la webcam), les plus grandes d'abord."""
    h, w = change.shape
    calm = (change < max(2.0, 0.35 * float(np.median(change)))).astype(np.uint8)
    k = max(5, int(0.03 * w)) | 1
    calm = cv2.morphologyEx(calm, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    calm = cv2.morphologyEx(calm, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    num, _, stats, _ = cv2.connectedComponentsWithStats(calm, connectivity=4)
    out = []
    for x, y, bw, bh, area in sorted(stats[1:].tolist(), key=lambda s: -s[4]):
        if area >= MIN_AREA * w * h * 0.5 and bw >= 0.04 * w and bh >= 0.04 * h:
            out.append((x, y, x + bw, y + bh))
    return out[:n]


def _peaks(profile: np.ndarray, lo: int, hi: int, k: int = 8) -> list[int]:
    lo, hi = max(0, lo), min(len(profile) - 1, hi)
    idx = [i for i in range(lo, hi + 1)
           if profile[i] >= profile[max(lo, i - 1)] and profile[i] >= profile[min(hi, i + 1)]]
    return sorted(sorted(idx, key=lambda i: -profile[i])[:k])


def find_cam_rect(change: np.ndarray, gx: np.ndarray, gy: np.ndarray) -> dict | None:
    """Le rectangle bordé de bords permanents, calme dedans et agité autour. {x, y, w, h, confidence} ou None."""
    h, w = change.shape
    ref_edge = float(np.percentile(np.concatenate([gx.ravel(), gy.ravel()]), 90)) + 1e-6
    agitated = float(np.median(change)) + 1e-6
    best = None
    for sx0, sy0, sx1, sy1 in _seeds(change):
        mx, my = int(0.25 * (sx1 - sx0)) + 4, int(0.25 * (sy1 - sy0)) + 4
        # Candidats : les bords permanents les plus forts autour de la zone calme, ses propres bords, ceux de l'image.
        xs = sorted(set(_peaks(gx[sy0:sy1].mean(axis=0), sx0 - mx, sx1 + mx) + [0, w - 1, sx0, sx1 - 1]))
        ys = sorted(set(_peaks(gy[:, sx0:sx1].mean(axis=1), sy0 - my, sy1 + my) + [0, h - 1, sy0, sy1 - 1]))
        for x0 in xs:
            for x1 in xs:
                bw = x1 - x0
                if bw < 0.06 * w:
                    continue
                for y0 in ys:
                    for y1 in ys:
                        bh = y1 - y0
                        if bh < 0.06 * h or not (MIN_AREA <= bw * bh / (w * h) <= MAX_AREA)                                 or not (ASPECT[0] <= bw / bh <= ASPECT[1]):
                            continue
                        sc = _rect_score(change, gx, gy, x0, y0, x1, y1, ref_edge, agitated)
                        if not sc:
                            continue
                        # La webcam couvre la zone calme presque entière (le streamer qui bouge est DEDANS) :
                        # un bord intérieur (étagère, mur) donnerait un rectangle trop petit.
                        inter = max(0, min(x1, sx1) - max(x0, sx0)) * max(0, min(y1, sy1) - max(y0, sy0))
                        cover = inter / ((sx1 - sx0) * (sy1 - sy0))
                        total = sc[0] * (0.3 + cover)
                        if best is None or total > best[0]:
                            best = (total, x0, y0, x1, y1, sc[1])
    if best is None or best[0] < 0.8:
        return None
    _, x0, y0, x1, y1, conf = best
    return {"x": round(x0 / w, 4), "y": round(y0 / h, 4), "w": round((x1 - x0) / w, 4), "h": round((y1 - y0) / h, 4),
            "confidence": conf}


def _rect_score(change, gx, gy, x0, y0, x1, y1, ref_edge, agitated):
    h, w = change.shape
    inside = change[y0 + 2:y1 - 1, x0 + 2:x1 - 1]
    if inside.size == 0:
        return None
    calm_frac = float((inside < 0.5 * agitated).mean())
    if calm_frac < 0.35:
        return None
    b = 5
    sides = []
    for at_border, edge, out_band, in_band in (
        (x0 <= 1, gx[y0:y1, x0].mean(), change[y0:y1, max(0, x0 - b):x0], change[y0:y1, x0 + 1:x0 + 1 + b]),
        (x1 >= w - 2, gx[y0:y1, x1].mean(), change[y0:y1, x1 + 1:x1 + 1 + b], change[y0:y1, max(0, x1 - b):x1]),
        (y0 <= 1, gy[y0, x0:x1].mean(), change[max(0, y0 - b):y0, x0:x1], change[y0 + 1:y0 + 1 + b, x0:x1]),
        (y1 >= h - 2, gy[y1, x0:x1].mean(), change[y1 + 1:y1 + 1 + b, x0:x1], change[max(0, y1 - b):y1, x0:x1]),
    ):
        if at_border:                                   # webcam collée au bord de l'image
            sides.append((1.0, 1.0))
            continue
        o = float(np.median(out_band)) if out_band.size else agitated
        i = float(np.median(in_band)) if in_band.size else 0.0
        sides.append((min(2.0, edge / ref_edge), max(-1.0, (o - i) / (o + i + 1e-6))))
    edge_sc = sum(e for e, _ in sides) / 4
    contrast = sorted(c for _, c in sides)
    if contrast[1] < 0.15:                              # au moins 3 côtés : agité dehors, calme dedans
        return None
    score = edge_sc * (0.5 + sum(contrast) / 4) * (0.5 + calm_frac) * (1 + 0.3 * np.sqrt((x1 - x0) * (y1 - y0) / (w * h)))
    conf = round(float(min(1.0, edge_sc) * min(1.0, 0.5 + sum(contrast) / 4) * min(1.0, calm_frac + 0.3)), 2)
    return score, conf


def detect_cam(video: str, duration: float | None = None, in_game: list[float] | None = None) -> dict | None:
    """Position de la webcam (fractions de l'image) dans `video`, ou None si pas de webcam trouvée.
    `in_game` : instants où l'on sait que le jeu est à l'écran (on regarde de préférence ceux-là)."""
    if duration is None:
        from .kill_detect import _probe
        duration = _probe(video)[2]
    if not duration or duration == float("inf") or duration < 30:
        return None
    frames = sample_frames(video, duration, times=pick_times(duration, in_game))
    if len(frames) < 8:
        return None
    gx, gy = edge_maps(frames)
    return find_cam_rect(change_map(frames), gx, gy)

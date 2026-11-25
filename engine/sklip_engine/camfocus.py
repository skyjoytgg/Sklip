"""Où est le visage du streamer dans sa webcam ? Pour centrer « Cam en grand » (Just Chatting) sur lui.

Même idée que camdetect, sans modèle à télécharger : dans la webcam, la pièce ne bouge pas, le streamer si
(il parle, bouge la tête, gesticule). On prend quelques images du clip, on regarde ce qui varie d'une image à
l'autre : c'est la personne. Le haut de cette zone, c'est la tête ; on prend son centre.
Si rien ne bouge assez (streamer immobile, image figée), on ne sait pas : recadrage au centre de la webcam.
"""
from __future__ import annotations

import subprocess

import cv2
import numpy as np

W = 160                 # largeur de travail de la webcam (assez pour trouver une tête)
FRAMES = 8              # images par clip
MIN_MOTION = 0.02       # au moins 2 % de la webcam doit bouger pour qu'on y croie
HEAD = 0.35             # la tête : le tiers haut de ce qui bouge


def focus_from_frames(frames: np.ndarray) -> tuple[float, float] | None:
    """frames : (n, h, w) en niveaux de gris, la webcam seule. → centre du visage (x, y entre 0 et 1) ou None."""
    if frames is None or len(frames) < 3:
        return None
    f = frames.astype(np.float32)
    var = cv2.GaussianBlur(f.std(axis=0), (0, 0), 2)
    thr = max(12.0, float(np.percentile(var, 75)))
    mask = var > thr
    h, w = mask.shape
    if mask.mean() < MIN_MOTION:
        return None
    # La personne : le plus gros bloc qui bouge (un bout d'écran ou de jeu qui bouge ailleurs est écarté).
    mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, labels = cv2.connectedComponents(mask)
    if n < 2:
        return None
    mass = [float(var[labels == i].sum()) for i in range(1, n)]
    person = labels == (1 + int(np.argmax(mass)))
    if person.mean() < MIN_MOTION:
        return None
    rows = np.where(person.any(axis=1))[0]
    top = int(rows[0])
    bottom = min(h, top + max(4, int(HEAD * (rows[-1] - top + 1))))
    band = (var * person)[top:bottom]
    if band.sum() <= 0:
        return None
    xs = np.arange(w, dtype=np.float32)
    fx = float((band.sum(axis=0) * xs).sum() / band.sum()) / w
    fy = (top + 0.5 * (bottom - top)) / h
    return round(fx, 3), round(fy, 3)


def cam_frames(video: str, cam: dict, start: float, end: float, n: int = FRAMES,
               size: tuple[int, int] | None = None) -> np.ndarray:
    """n images de la webcam seule (niveaux de gris, W pixels de large) réparties dans [start, end]."""
    sw, sh = size or _probe_size(video)
    x, y, cw, ch = (int(cam["x"] * sw), int(cam["y"] * sh), max(2, int(cam["w"] * sw)), max(2, int(cam["h"] * sh)))
    oh = max(2, int(round(W * ch / cw / 2)) * 2)
    out = []
    for t in np.linspace(start, end, n + 2)[1:-1]:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1",
                              "-vf", f"crop={cw}:{ch}:{x}:{y},scale={W}:{oh}", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                             capture_output=True).stdout
        if len(raw) == W * oh:
            out.append(np.frombuffer(raw, np.uint8).reshape(oh, W))
    return np.array(out)


def _probe_size(video: str) -> tuple[int, int]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", video], capture_output=True, text=True).stdout.strip()
    w, h = out.split(",")[:2]
    return int(w), int(h)


def clip_focus(video: str, cam: dict, start: float, end: float, size=None) -> dict | None:
    """Centre du visage {x, y} dans la webcam pendant [start, end], ou None."""
    try:
        f = focus_from_frames(cam_frames(video, cam, start, end, size=size))
    except Exception:
        f = None
    return {"x": f[0], "y": f[1]} if f else None


def add_focus(video: str, clips: list[dict], default_cam: dict | None = None, cache: dict | None = None) -> None:
    """Met `focus` (centre du visage dans la webcam, ou None) sur les clips « Cam en grand ».
    `cache` : partagé entre les thèmes, un même clip n'est regardé qu'une fois."""
    cache = {} if cache is None else cache
    size = None
    for c in clips:
        cam = c.get("cam") or default_cam
        if c.get("layout") != "cam_full" or not cam:
            continue
        key = (round(c["start"], 2), round(c["end"], 2), tuple(round(float(cam[k]), 4) for k in "xywh"))
        if key not in cache:
            try:
                size = size or _probe_size(video)
            except Exception:
                size = None
            cache[key] = clip_focus(video, cam, c["start"], c["end"], size) if size else None
        c["focus"] = cache[key]

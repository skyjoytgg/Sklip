"""Fin de partie Valorant : « VICTOIRE » (vert) / « DÉFAITE » (rouge) au centre de l'image, puis, en compétition,
l'écran « DÉTAILS DU RANG » avec les points gagnés ou perdus (« -25 SC » en français, « +18 RR » en anglais).

Demande de Sky (26/11) : clipper la victoire, la défaite et le gain / la perte de RR en fin de partie.
Vu sur le live du 26/11 : 23:40 « 4 DÉFAITE 5 », 1:27:00 « 5 DÉFAITE 13 » puis 1:27:35 « -25 SC » (Platine 2).

La vidéo est lue 1 image / 2 s en petit (images clés seulement : ~1 min pour 3 h). La lecture de texte de Windows
(la même que pour le chat du jeu) ne tourne que sur les images où il y a beaucoup de rouge ou de vert vif.
L'écran du rang reste parfois à peine 1 s (le streamer clique vite) : après chaque fin de partie, on relit les
3 minutes suivantes en net, 2 images / s.
"""
from __future__ import annotations

import re
import subprocess
import unicodedata

import numpy as np

FPS = 0.5
W, H = 640, 360
BANNER = (0.20, 0.30, 0.80, 0.62)      # « 5 DÉFAITE 13 » en grand au milieu. Pas la bannière de ROUND : en
                                      # français elle dit aussi « VICTOIRE » / « DÉFAITE », mais en petit, en haut
                                      # (y ≈ 0,07–0,13), avec « Équipe éliminée » / « Spike désamorcée » dessous.
RR_NUM = (0.50, 0.40, 0.66, 0.52)      # « DÉTAILS DU RANG » : le nombre « -25 SC » (en 1920×1080 : 960–1270, 432–562)
COLOR_MIN = 0.03                       # part de pixels rouge / vert vif pour lancer la lecture du texte
SAME_GAME = 150.0                      # s : bannière en jeu + écran d'après partie = une seule fin de partie
RR_AFTER = 180.0                       # s : l'écran du rang arrive dans les 3 min après la bannière

RR_RE = re.compile(r"([+*\-−–])\s?(\d{1,2})\s*(?:SC|RR|PC)\b", re.I)   # « * » : un « + » mal lu
SCORE_RE = re.compile(r"(\d{1,2})\D+(?:VICTOIRE|DEFAITE|VICTORY|DEFEAT|NUL|DRAW)\D+(\d{1,2})")


def _plain(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return " ".join(s.upper().split())


def _crop(img: np.ndarray, box) -> np.ndarray:
    h, w = img.shape[:2]
    x0, y0, x1, y1 = box
    return img[int(h * y0):int(h * y1), int(w * x0):int(w * x1)]


def vivid(img: np.ndarray) -> tuple[float, float]:
    """(part de rouge vif, part de vert vif) dans l'image : le texte de VICTOIRE / DÉFAITE / des points."""
    import cv2
    hsv = cv2.cvtColor(np.ascontiguousarray(img), cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0].astype(int), hsv[..., 1].astype(int), hsv[..., 2].astype(int)
    lit = (s >= 110) & (v >= 170)
    n = float(h.size) or 1.0
    red = float((lit & ((h <= 8) | (h >= 168))).sum()) / n
    green = float((lit & (h >= 40) & (h <= 95)).sum()) / n
    return red, green


def read_result(text: str):
    """Texte lu → ("victory" | "defeat", "5-13" ou None), sinon None."""
    t = _plain(text)
    if any(k in t for k in ("ELIMINE", "SPIKE", "EQUIPE", "ELIMINATED", "DEFUSED", "DETONATED")):
        return None                                   # bannière de round, pas de fin de partie
    if "VICTOIRE" in t or "VICTORY" in t:
        res = "victory"
    elif "DEFAITE" in t or "DEFEAT" in t:
        res = "defeat"
    else:
        return None
    m = SCORE_RE.search(t)
    return res, (f"{m.group(1)}-{m.group(2)}" if m else None)


def _text(img: np.ndarray, read) -> str:
    return " ".join(ln["text"] for ln in read(img))


def read_rr_image(part: np.ndarray, read) -> int | None:
    """Les points (« -25 SC ») sont dans une police stylisée : on ne garde que les pixels colorés (noir sur blanc)."""
    import cv2
    hsv = cv2.cvtColor(np.ascontiguousarray(part), cv2.COLOR_BGR2HSV)
    mask = ((hsv[..., 1] > 100) & (hsv[..., 2] > 150)).astype(np.uint8) * 255
    frac = float(mask.mean()) / 255
    if not 0.002 <= frac <= 0.15:                     # rien de coloré, ou tout un écran rouge (« DÉFAITE » géant)
        return None
    # Cadré au plus près du texte, avec une marge, lu à plusieurs tailles : on garde la valeur la plus lue.
    ys, xs = np.nonzero(mask)
    tight = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    votes = []
    for hgt, stretch in ((40, 1.0), (90, 1.4), (130, 1.0)):
        f = hgt / tight.shape[0]
        img = cv2.resize(tight, None, fx=f * stretch, fy=f, interpolation=cv2.INTER_CUBIC)
        img = cv2.copyMakeBorder(img, hgt, hgt, hgt, hgt, cv2.BORDER_CONSTANT, value=0)
        m = RR_RE.search(_text(cv2.cvtColor(255 - img, cv2.COLOR_GRAY2BGR), read).replace("−", "-").replace("–", "-"))
        if m:
            votes.append((-1 if m.group(1) in "-−–" else 1) * int(m.group(2)))
    if not votes:
        return None
    from collections import Counter
    return Counter(votes).most_common(1)[0][0]


def _banner_in(img: np.ndarray, read):
    part = _crop(img, BANNER)
    if max(vivid(part)) < COLOR_MIN:
        return None
    try:
        return read_result(_text(part, read))
    except Exception:
        return None


def find_banners(frames, read, around=None) -> list[dict]:
    """Passe rapide : les bannières VICTOIRE / DÉFAITE, une par fin de partie.
    Les images clés n'arrivent que toutes les ~4 s et la bannière reste 3–4 s : quand une image a beaucoup de
    couleur vive au milieu sans bannière lisible, `around(t0, t1)` relit le passage en net (2 images / s)."""
    out: list[dict] = []
    tried = -1e9
    for t, img in frames:
        if out and t - out[-1]["t"] <= SAME_GAME:
            continue
        part = _crop(img, BANNER)
        if max(vivid(part)) < COLOR_MIN:
            continue
        found, at = _banner_in(img, read), t
        if not found and around is not None and t - tried > 12:
            tried = t
            for t2, img2 in around(t - 8, t + 8):
                found = _banner_in(img2, read)
                if found:
                    at = t2
                    break
        if found and around is not None:
            # Début de l'écran : l'image clé tombe souvent au milieu (le clip « win » / « loose » ne dure que 2 s).
            for t2, img2 in around(at - 4, at + 0.01):
                if _banner_in(img2, read):
                    at = min(at, t2)
                    break
        if found:
            res, score = found
            out.append({"type": res, "t": round(float(at), 2), "meta": {"score": score} if score else {}})
    return out


def find_rr(frames, read) -> dict | None:
    """Passe fine juste après une fin de partie : l'écran du rang (souvent 1 à 2 s seulement).
    `frames` : la zone du nombre (RR_NUM) en pleine résolution."""
    for t, img in frames:
        try:
            rr = read_rr_image(img, read)
        except Exception:
            rr = None
        if rr is not None:
            return {"t": round(float(t), 2), "rr": rr}
    return None


def find_endgames(low_frames, fine_frames=None, read=None, around=None) -> list[dict]:
    """Fins de partie : [{type: "victory"|"defeat", t, meta}, {type: "rr", t, meta: {rr, result}}].
    `low_frames` : images 640×360 de toute la vidéo ; `fine_frames(t0, t1)` : la zone des points, nette, 2 images / s."""
    if read is None:
        from .gamechat import ocr_lines as read
    out: list[dict] = []
    for end in find_banners(low_frames, read, around):
        out.append(end)
        if fine_frames is None:
            continue
        rr = find_rr(fine_frames(end["t"] + 5, end["t"] + RR_AFTER), read)
        if rr:
            out.append({"type": "rr", "t": rr["t"], "meta": {"rr": rr["rr"], "result": end["type"], **end["meta"]}})
    return out


def merge_endgames(found: list[dict]) -> list[dict]:
    """Fins de partie de plusieurs lectures qui se chevauchent : une seule par fin de partie (et un seul RR)."""
    out: list[dict] = []
    for e in sorted(found, key=lambda e: e["t"]):
        if any(o["type"] == e["type"] and abs(o["t"] - e["t"]) <= SAME_GAME for o in out):
            continue
        out.append(e)
    return out


def _frames(video: str, start: float = 0.0, duration: float | None = None, fps: float = FPS,
            size: tuple[int, int] = (W, H), keyframes: bool = True, box=None):
    """Images de la vidéo en `size` ; avec `box`, seulement cette zone, lue en 1920×1080 (texte net)."""
    if box:
        x0, y0, x1, y1 = box
        w, h = int(1920 * (x1 - x0)), int(1080 * (y1 - y0))
        vf = f"fps={fps},scale=1920:1080,crop={w}:{h}:{int(1920 * x0)}:{int(1080 * y0)}"
    else:
        w, h = size
        vf = f"fps={fps},scale={w}:{h}"
    cmd = ["ffmpeg", "-v", "error", "-skip_frame", "nokey" if keyframes else "noref", "-ss", f"{max(0.0, start):.2f}",
           "-i", video, *(["-t", f"{duration:.2f}"] if duration else []), "-an",
           "-vf", vf, "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    n, i = w * h * 3, 0
    try:
        while True:
            b = p.stdout.read(n)
            if len(b) < n:
                break
            yield max(0.0, start) + i / fps, np.frombuffer(b, np.uint8).reshape(h, w, 3)
            i += 1
    finally:
        p.kill()


def scan_endgames(video: str, start: float = 0.0, duration: float | None = None) -> list[dict]:
    """Fins de partie de toute la vidéo (voir find_endgames). Rien (liste vide) si la lecture de texte manque."""
    try:
        from .gamechat import _ocr_engine
        _ocr_engine()
    except Exception:
        return []
    fine = lambda t0, t1: _frames(video, t0, t1 - t0, fps=2.0, keyframes=False, box=RR_NUM)
    near = lambda t0, t1: _frames(video, t0, t1 - t0, fps=2.0, keyframes=False)
    return find_endgames(_frames(video, start, duration), fine, around=near)

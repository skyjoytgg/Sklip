"""Fil des kills (en haut à droite) : quelle arme a servi pour un kill du streamer.

Chaque ligne du fil : tueur sur fond vert (allié), icône de l'arme, victime sur fond rouge. Les icônes sont
dessinées en blanc et ont toujours la même forme pour une arme : le couteau est bien plus fin et allongé que
toutes les armes à feu (mesuré sur 150 kills de 2 VOD : couteau 63×12 px en 1080p, armes ≥ 17 px de haut).
Vérifié avec le kill au couteau de Sky à 83:04 de la VOD du 25/11 (« deux coups de shorty puis le couteau »).
"""
from __future__ import annotations

import subprocess

import numpy as np

from .kill_detect import KillEvent

FEED_X = 0.55                 # le fil occupe la droite de l'image…
FEED_Y = (0.05, 0.32)         # … sous le score (jusqu'à 5-6 lignes)
ICON_ZONE = 0.075             # l'icône est dans les derniers 7,5 % (de la largeur) de la partie verte
KNIFE_MAX_H = 15 / 1080       # hauteur maximale de l'icône du couteau (1080p : 12 px ; armes ≥ 17 px)
KNIFE_MIN_W = 40 / 1080
KNIFE_MIN_RATIO = 4.0         # largeur / hauteur
KNIFE_MIN_FILL = 0.5          # lame pleine (les armes à feu laissent des trous : crosse, poignée)
LOOK_AFTER = (0.5, 1.2)       # le kill arrive dans le fil en même temps que l'emblème
LOOK_BEFORE = 0.4


def weapon_icons(frame: np.ndarray) -> list[dict]:
    """Icônes d'arme des lignes « allié tue ennemi » du fil : [{y, w, h, fill, blob}] (w, h en fraction de la hauteur)."""
    import cv2
    h, w = frame.shape[:2]
    x0, y0, y1 = int(w * FEED_X), int(h * FEED_Y[0]), int(h * FEED_Y[1])
    hsv = cv2.cvtColor(np.ascontiguousarray(frame[y0:y1, x0:]), cv2.COLOR_BGR2HSV)
    H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    teal = ((H >= 72) & (H <= 92) & (S >= 60) & (V >= 110)).astype(np.uint8)
    red = (((H <= 6) | (H >= 172)) & (S >= 70) & (V >= 150)).astype(np.uint8)
    white = ((S <= 70) & (V >= 205)).astype(np.uint8)
    bars = cv2.morphologyEx(teal, cv2.MORPH_CLOSE, np.ones((1, 31), np.uint8))   # relie le vert coupé par le texte
    n, _, st, _ = cv2.connectedComponentsWithStats(bars)
    out = []
    for i in range(1, n):
        x, y, bw, bh, _ = st[i]
        if bw < 0.06 * w or not (0.018 * h <= bh <= 0.05 * h):
            continue
        xe = x + bw
        after = red[y:y + bh, xe:xe + 30]
        if not after.size or after.mean() < 0.3:        # pas de victime rouge juste après : pas une ligne de kill
            continue
        a0 = max(x, xe - int(ICON_ZONE * w))
        band = white[y + 2:y + bh - 2, a0:xe]
        m, lab, s2, _ = cv2.connectedComponentsWithStats(band)
        if m < 2:
            continue
        j = 1 + int(np.argmax(s2[1:, 4]))                  # l'icône = la plus grosse tache blanche (pas les lettres)
        bx, by, iw, ih, area = s2[j]
        out.append({"y": (y0 + y) / h, "w": iw / h, "h": ih / h, "fill": area / float(iw * ih),
                    "blob": (lab[by:by + ih, bx:bx + iw] == j).astype(np.uint8)})
    return out


def is_knife(icon: dict) -> bool:
    return (icon["h"] <= KNIFE_MAX_H and icon["w"] >= KNIFE_MIN_W and icon["w"] / icon["h"] >= KNIFE_MIN_RATIO
            and icon["fill"] >= KNIFE_MIN_FILL)


def knives_in(frame: np.ndarray) -> int:
    return sum(is_knife(i) for i in weapon_icons(frame))


def _frame(video: str, t: float) -> np.ndarray | None:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(0.0, t):.2f}", "-i", video, "-frames:v", "1",
                          "-vf", "scale=1920:1080", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                         capture_output=True).stdout
    if len(raw) != 1920 * 1080 * 3:
        return None
    return np.frombuffer(raw, np.uint8).reshape(1080, 1920, 3)


def knife_kills(video: str, events: list[KillEvent]) -> list[float]:
    """Temps des kills du streamer faits au couteau : une icône de couteau de plus dans le fil juste après le kill."""
    out = []
    for e in events:
        if e.spectating:
            continue
        try:
            after = max((knives_in(f) for f in (_frame(video, e.t + d) for d in LOOK_AFTER) if f is not None), default=0)
            if not after:
                continue
            before = _frame(video, e.t - LOOK_BEFORE)
            if after > (knives_in(before) if before is not None else 0):
                out.append(round(e.t, 2))
        except Exception:
            continue                    # image illisible : le kill reste un kill normal
    return out


def confirm_kills(video: str, events: list[KillEvent], frame=None) -> list[KillEvent]:
    """Garde les emblèmes « pâles » quand une ligne « allié tue ennemi » de plus apparaît dans le fil juste après."""
    frame = frame or (lambda t: _frame(video, t))
    out = []
    for e in events:
        try:
            before = frame(e.t - LOOK_BEFORE)
            n0 = len(weapon_icons(before)) if before is not None else 0
            n1 = max((len(weapon_icons(f)) for f in (frame(e.t + d) for d in LOOK_AFTER) if f is not None), default=0)
            if n1 > n0:
                out.append(e)
        except Exception:
            continue
    return out

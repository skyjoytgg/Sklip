"""Rounds Valorant à partir du score en haut de l'écran, et regroupement des kills par round.

- Le score (équipe du joueur à gauche, adversaires à droite) ne change qu'à la fin d'un round : chaque
  changement de la somme des deux nombres marque un nouveau round, et un retour à 0-0 une nouvelle partie.
- Le score ne change qu'une fois par round : on ne lit que les « images clés » de la vidéo (une toutes les
  2 à 4 s sur une VOD Twitch), qui se décodent sans lire le reste. Toute une VOD se lit en ~1 à 2 min.
- Les chiffres sont reconnus par comparaison avec des modèles (assets/score_digits.npz), extraits des VOD de Sky.
- Kills d'un même round : 2 à 4 = multi-kill, 5 = ace.
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .moments import Moment

ASSETS = Path(__file__).parent / "assets"

# Centres des deux scores, en fraction de l'image (référence 1920x1080), et taille de la zone lue.
SCORE_LEFT = (823 / 1920, 50 / 1080)
SCORE_RIGHT = (1098 / 1920, 50 / 1080)
ZONE_W, ZONE_H = 56, 40              # en pixels 1080p
GLYPH_W, GLYPH_H = 12, 20
WHITE = 200                          # les chiffres sont blancs
MAX_DIST = 0.18                      # distance maximale à un modèle de chiffre pour l'accepter
STABLE = 2                           # lectures identiques consécutives pour valider un score


@dataclass
class Round:
    game: int            # numéro de la partie dans le stream (0, 1, …)
    number: int          # numéro du round dans la partie (1 = premier round)
    start: float         # début (s) : changement de score précédent (≈ fin du round d'avant)
    end: float           # fin (s) : changement de score suivant


_TPL: np.ndarray | None = None


def _templates() -> np.ndarray:
    global _TPL
    if _TPL is None:
        _TPL = np.load(ASSETS / "score_digits.npz")["templates"]
    return _TPL


def _glyphs(zone: np.ndarray) -> list[tuple[int, np.ndarray]]:
    m = (zone > WHITE).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    out = []
    for k in range(1, n):
        x, y, w, h, a = st[k]
        if 14 <= h <= 24 and 3 <= w <= 16 and y > 4 and y + h < zone.shape[0] - 2 and a >= 20:
            sub = (lab[y:y + h, x:x + w] == k).astype(np.float32)
            g = cv2.resize(sub, (GLYPH_W, GLYPH_H), interpolation=cv2.INTER_AREA)
            out.append((int(x), np.r_[g.ravel(), w / h * 4]))
    return sorted(out, key=lambda o: o[0])


def read_number(zone: np.ndarray) -> int | None:
    """Lit un score (0 à 99) dans une zone en gris de ZONE_H x ZONE_W. None si illisible."""
    gl = _glyphs(zone)
    if not 1 <= len(gl) <= 2:
        return None
    if len(gl) == 2 and gl[1][0] - gl[0][0] > 22:     # deux taches trop éloignées : pas un nombre
        return None
    tpl = _templates()
    digits = []
    for _, v in gl:
        d = np.abs(tpl - v).mean(axis=1)
        k = int(d.argmin())
        if d[k] > MAX_DIST:
            return None
        digits.append(k)
    return int("".join(map(str, digits)))


# ---------- Lecture de la vidéo (images clés seulement) ----------

def _probe_size(video: str) -> tuple[int, int]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", video], capture_output=True, text=True, check=True).stdout
    w, h = out.strip().split(",")[:2]
    return int(w), int(h)


def read_scores(video: str) -> tuple[np.ndarray, list[tuple[int | None, int | None]]]:
    """(temps des images clés, [(score gauche, score droite)]) sur toute la vidéo."""
    w, h = _probe_size(video)
    zw, zh = round(ZONE_W * h / 1080), round(ZONE_H * h / 1080)

    def crop(c):
        return f"crop={zw}:{zh}:{round(c[0] * w - zw / 2)}:{round(c[1] * h - zh / 2)},scale={ZONE_W}:{ZONE_H}"

    flt = f"format=gray,split[a][b];[a]{crop(SCORE_LEFT)}[l];[b]{crop(SCORE_RIGHT)}[r];[l][r]hstack"
    cmd = ["ffmpeg", "-v", "error", "-skip_frame", "nokey", "-i", video, "-an", "-filter_complex", flt,
           "-fps_mode", "passthrough", "-f", "rawvideo", "-"]
    times = ["ffprobe", "-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey",
             "-show_entries", "frame=pts_time", "-of", "csv=p=0", video]
    with subprocess.Popen(times, stdout=subprocess.PIPE, text=True) as pt:
        raw = subprocess.run(cmd, capture_output=True, check=True).stdout
        t = np.array([float(x) for x in pt.stdout.read().split() if x.strip()])
    frames = np.frombuffer(raw, np.uint8).reshape(-1, ZONE_H, 2 * ZONE_W)
    n = min(len(frames), len(t))
    return t[:n], [(read_number(f[:, :ZONE_W]), read_number(f[:, ZONE_W:])) for f in frames[:n]]


# ---------- Des scores aux rounds ----------

def rounds_from_scores(t: np.ndarray, scores: list[tuple[int | None, int | None]],
                       stable: int = STABLE) -> list[Round]:
    """Découpe le temps en rounds.

    Un score n'est validé que s'il est lu `stable` fois de suite (les lectures illisibles sont ignorées).
    Somme des scores qui augmente → round suivant ; somme qui redescend → nouvelle partie.
    """
    valid = [(float(ti), a + b) for ti, (a, b) in zip(t, scores) if a is not None and b is not None]
    # Lissage : on garde les changements confirmés par `stable` lectures consécutives.
    confirmed: list[tuple[float, int]] = []       # (temps de la 1re lecture, somme)
    run_val, run_t, run_n = None, 0.0, 0
    for ti, s in valid:
        if s == run_val:
            run_n += 1
        else:
            run_val, run_t, run_n = s, ti, 1
        if run_n == stable and (not confirmed or confirmed[-1][1] != s):
            confirmed.append((run_t, s))
    rounds: list[Round] = []
    game = -1
    for k, (ti, s) in enumerate(confirmed):
        if k == 0 or s < confirmed[k - 1][1]:
            game += 1
        end = confirmed[k + 1][0] if k + 1 < len(confirmed) else float(t[-1]) if len(t) else ti
        rounds.append(Round(game=game, number=s + 1, start=ti, end=end))
    if rounds:
        rounds[0].start = float(t[0])
    return rounds


def round_at(rounds: list[Round], time: float) -> Round | None:
    for r in rounds:
        if r.start <= time < r.end:
            return r
    return None


def group_kills(kill_times: list[float], rounds: list[Round]) -> list[Moment]:
    """Transforme les kills en moments : kill seul, multi-kill (2-4 dans le round) ou ace (5).

    Un multi-kill / ace donne un seul moment, placé au dernier kill, dont le clip commence avant le premier
    (meta.t_start). Un kill hors de tout round reconnu reste un kill simple.
    """
    by_round: dict[tuple[int, int], list[float]] = {}
    loose: list[float] = []
    for kt in sorted(kill_times):
        r = round_at(rounds, kt)
        if r is None:
            loose.append(kt)
        else:
            by_round.setdefault((r.game, r.number), []).append(kt)
    out = [Moment("kill", kt) for kt in loose]
    for (game, number), ts in by_round.items():
        meta = {"game": game, "round": number}
        if len(ts) == 1:
            out.append(Moment("kill", ts[0], meta=meta))
        else:
            mtype = "ace" if len(ts) >= 5 else "multikill"
            out.append(Moment(mtype, ts[-1], meta={**meta, "count": len(ts), "kills": ts, "t_start": ts[0]}))
    return sorted(out, key=lambda m: m.t)

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
    won: bool | None = None   # True si l'équipe du streamer gagne le round (None : inconnu, ex. dernier round)


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


# Bandeau du haut (référence 1080p) : de x=400 à 1520, y=12 à 72. Il contient les deux scores et les portraits.
BAR_X, BAR_Y, BAR_W, BAR_H = 400, 12, 1120, 60
# Centres des 5 portraits de chaque équipe (les joueurs vivants sont serrés vers le centre ; un mort disparaît).
SLOTS_LEFT = (465, 531, 597, 663, 728)
SLOTS_RIGHT = (1190, 1256, 1322, 1387, 1452)
SLOT_ON = 20.0       # netteté minimale d'une case avec portrait (portrait ≥ 40, case vide ≤ 7 sur la VOD du 01/11)


@dataclass
class Hud:
    """Ce qu'on lit en haut de l'écran, à chaque image clé."""
    t: np.ndarray
    score_left: list[int | None]
    score_right: list[int | None]
    alive_left: np.ndarray       # nombre de portraits de l'équipe du streamer (streamer compris)
    alive_right: np.ndarray      # nombre de portraits adverses

    @property
    def scores(self) -> list[tuple[int | None, int | None]]:
        return list(zip(self.score_left, self.score_right))

    def save(self, path):
        np.savez_compressed(path, t=self.t, alive_left=self.alive_left, alive_right=self.alive_right,
                            score_left=np.array([-1 if v is None else v for v in self.score_left]),
                            score_right=np.array([-1 if v is None else v for v in self.score_right]))

    @classmethod
    def load(cls, path) -> "Hud":
        d = np.load(path)
        return cls(d["t"], [None if v < 0 else int(v) for v in d["score_left"]],
                   [None if v < 0 else int(v) for v in d["score_right"]], d["alive_left"], d["alive_right"])


def count_alive(bar: np.ndarray, slots) -> int:
    """Nombre de cases contenant un portrait (bandeau en gris, coordonnées 1080p décalées de BAR_X/BAR_Y)."""
    n = 0
    for cx in slots:
        x = cx - BAR_X
        s = bar[6:46, x - 18:x + 18].astype(np.float32)
        if np.abs(cv2.Laplacian(s, cv2.CV_32F)).mean() >= SLOT_ON:
            n += 1
    return n


def read_bar(bar: np.ndarray) -> tuple[int | None, int | None, int, int]:
    """Lit scores et joueurs vivants dans le bandeau du haut (gris, BAR_H x BAR_W)."""
    def zone(c):
        x0 = round(c[0] * 1920) - BAR_X - ZONE_W // 2
        y0 = round(c[1] * 1080) - BAR_Y - ZONE_H // 2
        return bar[y0:y0 + ZONE_H, x0:x0 + ZONE_W]
    return (read_number(zone(SCORE_LEFT)), read_number(zone(SCORE_RIGHT)),
            count_alive(bar, SLOTS_LEFT), count_alive(bar, SLOTS_RIGHT))


def read_hud(video: str) -> Hud:
    """Lit le bandeau du haut sur toutes les images clés de la vidéo (~1 à 2 min pour 3-4 h de VOD)."""
    w, h = _probe_size(video)
    sx, sy = w / 1920, h / 1080
    flt = (f"crop={round(BAR_W * sx)}:{round(BAR_H * sy)}:{round(BAR_X * sx)}:{round(BAR_Y * sy)},"
           f"scale={BAR_W}:{BAR_H},format=gray")
    cmd = ["ffmpeg", "-v", "error", "-skip_frame", "nokey", "-i", video, "-an", "-vf", flt,
           "-fps_mode", "passthrough", "-f", "rawvideo", "-"]
    times = ["ffprobe", "-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey",
             "-show_entries", "frame=pts_time", "-of", "csv=p=0", video]
    rows = []
    size = BAR_W * BAR_H
    with subprocess.Popen(times, stdout=subprocess.PIPE, text=True) as pt, \
            subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as p:
        while True:
            buf = p.stdout.read(size)
            if len(buf) < size:
                break
            rows.append(read_bar(np.frombuffer(buf, np.uint8).reshape(BAR_H, BAR_W)))
        t = np.array([float(x) for x in pt.stdout.read().split() if x.strip()])
    n = min(len(rows), len(t))
    rows = rows[:n]
    return Hud(t[:n], [r[0] for r in rows], [r[1] for r in rows],
               np.array([r[2] for r in rows]), np.array([r[3] for r in rows]))


# ---------- Des scores aux rounds ----------

def rounds_from_scores(t: np.ndarray, scores: list[tuple[int | None, int | None]],
                       stable: int = STABLE) -> list[Round]:
    """Découpe le temps en rounds.

    Un score n'est validé que s'il est lu `stable` fois de suite (les lectures illisibles sont ignorées).
    Somme des scores qui augmente → round suivant ; somme qui redescend → nouvelle partie.
    """
    valid = [(float(ti), (a, b)) for ti, (a, b) in zip(t, scores) if a is not None and b is not None]
    # Lissage : on garde les changements confirmés par `stable` lectures consécutives.
    confirmed: list[tuple[float, tuple[int, int]]] = []       # (temps de la 1re lecture, (gauche, droite))
    run_val, run_t, run_n = None, 0.0, 0
    for ti, ab in valid:
        if ab == run_val:
            run_n += 1
        else:
            run_val, run_t, run_n = ab, ti, 1
        if run_n == stable and (not confirmed or sum(confirmed[-1][1]) != sum(ab)):
            confirmed.append((run_t, ab))
    rounds: list[Round] = []
    game = -1
    for k, (ti, (a, b)) in enumerate(confirmed):
        if k == 0 or a + b < sum(confirmed[k - 1][1]):
            game += 1
        end = confirmed[k + 1][0] if k + 1 < len(confirmed) else float(t[-1]) if len(t) else ti
        won = None
        if k + 1 < len(confirmed) and sum(confirmed[k + 1][1]) == a + b + 1:
            won = confirmed[k + 1][1][0] == a + 1        # notre score (à gauche) a augmenté
        rounds.append(Round(game=game, number=a + b + 1, start=ti, end=end, won=won))
    if rounds:
        rounds[0].start = float(t[0])
    return rounds


CLUTCH_MAX_SPAN = 30.0     # un clip de clutch ne remonte pas plus de 30 s avant son dernier moment
ROUND_END_PHASE = 10.0     # après un changement de score, fin du round précédent puis phase d'achat (s)


def find_clutches(hud: Hud, rounds: list[Round], kill_times: list[float], is_alive) -> list[Moment]:
    """Clutchs : le streamer est le dernier vivant de son équipe face à au moins 2 adversaires, et le round
    est gagné. `is_alive(t)` dit si le streamer est vivant (pas en spectateur) à l'instant t.
    """
    out = []
    for r in rounds:
        if not r.won:
            continue
        # Les ~10 s qui suivent un changement de score sont encore la fin du round précédent (morts affichés).
        sel = ((hud.t >= r.start + ROUND_END_PHASE) & (hud.t < r.end)
               & (hud.alive_left == 1) & (hud.alive_right >= 2))
        starts = [float(x) for x in hud.t[sel] if is_alive(float(x))]
        if not starts:
            continue
        t0 = starts[0]
        vs = int(hud.alive_right[sel].max())
        later_kills = [k for k in kill_times if t0 - 4 <= k < r.end]
        t_end = later_kills[-1] if later_kills else max(t0, r.end - 3)
        out.append(Moment("clutch", t_end, meta={"game": r.game, "round": r.number, "vs": vs,
                                                 "t_start": min(t_end, max(t0, t_end - CLUTCH_MAX_SPAN))}))
    return out


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

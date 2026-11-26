"""Détection des kills du streamer à l'image (Valorant).

Principe (calibré sur les VOD de Sky, 1080p) :
- À chaque kill du joueur, Valorant affiche un emblème en bas au centre de l'écran, pendant ~1,5 à 2 s.
  Son dessin dépend du skin de l'arme, mais c'est toujours un motif circulaire (cercle complet ou arcs)
  centré au même endroit. On mesure donc « y a-t-il des contours circulaires centrés à cet endroit ? ».
- Quand le joueur est mort et regarde un coéquipier, Valorant affiche les kills de ce coéquipier avec
  le même emblème. Mais il affiche aussi en bas à gauche la carte du joueur regardé, avec l'icône
  « < souris > CHANGER DE JOUEUR ». On repère cette icône (sans lire de texte, donc quelle que soit
  la langue du jeu) pour écarter ces kills-là.

La vidéo n'est lue qu'une fois, à quelques images par seconde, en ne décodant que deux petites zones.
Les mesures brutes sont renvoyées (et peuvent être sauvegardées) pour régler les seuils sans relire la vidéo.
"""
from __future__ import annotations

import subprocess
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

ASSETS = Path(__file__).parent / "assets"

# --- Géométrie, en fraction de l'image (référence 1920x1080) ---
BANNER_CENTER = (960 / 1920, 862 / 1080)
BANNER_SIZE = 240 / 1080            # côté du carré analysé autour de l'emblème (en fraction de la hauteur)
SPEC_BOX = (100 / 1920, 834 / 1080, 80 / 1920, 56 / 1080)  # zone de recherche de l'icône « < souris > »

REF_H = 1080
BANNER_PX = 240                     # taille de travail du carré de l'emblème
SPEC_W, SPEC_H = 80, 56             # taille de travail de la zone de l'icône

# --- Seuils (réglés sur les VOD de Sky ; voir tests/test_kill_detect.py) ---
BANNER_ON = 22.0                    # score d'emblème au-dessus duquel on considère l'emblème affiché
BANNER_PEAK_MIN = 30.0              # un vrai emblème atteint au moins ce score (le style « X rouge » monte à ~32-50)
BANNER_MIN_DUR = 1.0                # un emblème reste affiché ~1,5 à 2 s (s)
BANNER_MAX_DUR = 8.0                # au-delà, ce n'est pas un emblème (écran de choix d'agent…) (s)
NOISY_MARGIN = 15.0                 # on ignore aussi ce qui est à moins de 15 s d'un tel passage (s)
SPECTATE_ON = 0.6                   # ressemblance minimale avec l'icône « < souris > »
# Sur la VOD du 01/11 : médiane de ressemblance ≤ 0,31 pour les kills de Sky, ≥ 0,78 en spectateur.


@dataclass
class Scan:
    """Mesures brutes, image par image."""
    fps: float
    t: np.ndarray            # temps (s) depuis le début de la vidéo
    banner: np.ndarray       # score d'emblème
    spectate: np.ndarray     # ressemblance avec l'icône de spectateur (0..1)

    def save(self, path: str | Path):
        np.savez_compressed(path, fps=self.fps, t=self.t, banner=self.banner, spectate=self.spectate)

    @classmethod
    def load(cls, path: str | Path) -> "Scan":
        d = np.load(path)
        return cls(float(d["fps"]), d["t"], d["banner"], d["spectate"])

    @property
    def end(self) -> float:
        """Fin de la partie mesurée (s)."""
        return float(self.t[-1]) + 1 / self.fps if len(self.t) else 0.0

    @classmethod
    def concat(cls, scans: list["Scan"]) -> "Scan":
        """Recolle des mesures faites morceau par morceau (analyse pendant le live), sans doublons."""
        scans = [s for s in sorted(scans, key=lambda s: s.t[0] if len(s.t) else 0) if len(s.t)]
        if not scans:
            return cls(4.0, np.zeros(0), np.zeros(0, np.float32), np.zeros(0, np.float32))
        t, b, sp, last = [], [], [], -1.0
        for s in scans:
            keep = s.t > last + 1e-6
            t.append(s.t[keep]); b.append(s.banner[keep]); sp.append(s.spectate[keep])
            last = float(s.t[keep][-1]) if keep.any() else last
        return cls(scans[0].fps, np.concatenate(t), np.concatenate(b).astype(np.float32),
                   np.concatenate(sp).astype(np.float32))


@dataclass
class KillEvent:
    t: float                 # début de l'emblème (s)
    duration: float
    peak: float              # score d'emblème maximum
    spectating: bool         # True = kill d'un coéquipier regardé après la mort du streamer
    meta: dict = field(default_factory=dict)


# ---------- Mesures sur une image ----------

def banner_score(img: np.ndarray) -> float:
    """Force des contours circulaires centrés dans le carré (gris, BANNER_PX x BANNER_PX).

    On passe en coordonnées polaires autour du centre : un cercle (ou de grands arcs) devient une
    ligne verticale nette. Pour chaque rayon, on prend le 70e centile du gradient radial sur tous les
    angles : un cercle complet ou des arcs couvrant au moins ~30 % du tour donnent une valeur forte,
    alors qu'un décor de jeu (murs, traits droits) n'en donne presque jamais.
    """
    s = img.shape[0]
    f = img.astype(np.float32)
    pol = cv2.warpPolar(f, (s // 2, 360), (s / 2, s / 2), s / 2, cv2.WARP_POLAR_LINEAR)
    lo, hi = int(s / 2 * 20 / 120), int(s / 2 * 110 / 120)
    g = np.abs(np.diff(pol, axis=1))[:, lo:hi]
    return float(np.percentile(g, 70, axis=0).max())


_ICON: np.ndarray | None = None


def _icon() -> np.ndarray:
    global _ICON
    if _ICON is None:
        _ICON = cv2.imread(str(ASSETS / "spectate_icon.png"), cv2.IMREAD_GRAYSCALE)
        if _ICON is None:
            raise FileNotFoundError("assets/spectate_icon.png introuvable")
    return _ICON


def spectate_score(img: np.ndarray) -> float:
    """Ressemblance (0..1) entre la zone en bas à gauche et l'icône « < souris > » du mode spectateur."""
    icon = _icon()
    if float(img.std()) < 2.0:      # zone unie : pas d'icône (et évite une division par zéro)
        return 0.0
    res = cv2.matchTemplate(img, icon, cv2.TM_CCOEFF_NORMED)
    return float(np.nan_to_num(res).max())


# ---------- Lecture de la vidéo ----------

def _probe(video: str) -> tuple[int, int, float]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration",
         "-of", "default=nw=1", video], capture_output=True, text=True, check=True).stdout
    vals = dict(line.split("=", 1) for line in out.split() if "=" in line)
    try:
        total = float(vals["duration"])
    except (KeyError, ValueError):     # enregistrement encore en cours : durée inconnue
        total = float("inf")
    return int(vals["width"]), int(vals["height"]), total


def _filter(w: int, h: int, fps: float) -> str:
    """Filtre FFmpeg : 2 petites zones par image, remises à une taille fixe, empilées l'une sur l'autre."""
    bs = round(BANNER_SIZE * h)
    bx, by = round(BANNER_CENTER[0] * w - bs / 2), round(BANNER_CENTER[1] * h - bs / 2)
    sx, sy, sw, sh = (round(SPEC_BOX[0] * w), round(SPEC_BOX[1] * h), round(SPEC_BOX[2] * w), round(SPEC_BOX[3] * h))
    return (f"fps={fps},format=gray,split[a][b];"
            f"[a]crop={bs}:{bs}:{bx}:{by},scale={BANNER_PX}:{BANNER_PX}[ban];"
            f"[b]crop={sw}:{sh}:{sx}:{sy},scale={SPEC_W}:{SPEC_H},pad={BANNER_PX}:{SPEC_H}[spec];"
            f"[ban][spec]vstack")


# Les images « non référencées » (images B) ne sont pas décodées : on n'analyse que 4 images/s sur 60,
# et ça rend la lecture ~1,7× plus rapide (mesuré sur la VOD du 01/11 : 16× → 27× le temps réel).
FAST_DECODE = ["-skip_frame", "noref"]


def _scan_segment(video: str, w: int, h: int, start: float, dur: float, fps: float, fast: bool = True):
    cmd = ["ffmpeg", "-v", "error", *(FAST_DECODE if fast else []), "-ss", f"{start:.3f}", "-i", video, "-t", f"{dur:.3f}", "-an",
           "-filter_complex", _filter(w, h, fps), "-f", "rawvideo", "-"]
    fh = BANNER_PX + SPEC_H
    frame_bytes = BANNER_PX * fh
    banner, spec = [], []
    with subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as p:
        while True:
            buf = p.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            fr = np.frombuffer(buf, np.uint8).reshape(fh, BANNER_PX)
            banner.append(banner_score(fr[:BANNER_PX]))
            spec.append(spectate_score(fr[BANNER_PX:, :SPEC_W]))
    return banner, spec


def scan_video(video: str, fps: float = 4.0, start: float = 0.0, duration: float | None = None,
               workers: int = 1, segment: float = 600.0, progress=None) -> Scan:
    """Mesure l'emblème et l'icône de spectateur sur toute la vidéo (ou une partie).

    La vidéo est découpée en segments de `segment` secondes. Un seul FFmpeg à la fois suffit : il utilise
    déjà tous les cœurs, et plusieurs en parallèle se gênent (mesuré : 4 en parallèle = 8× au lieu de 16×).
    """
    w, h, total = _probe(video)
    end = total if duration is None else min(total, start + duration)
    if end == float("inf"):
        raise ValueError("Durée de la vidéo inconnue : précise `duration`")
    seg_starts = list(np.arange(start, end, segment))
    results: dict[float, tuple] = {}
    done = 0

    def job(s0):
        return s0, _scan_segment(video, w, h, s0, min(segment, end - s0), fps)

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        for s0, res in ex.map(job, seg_starts):
            results[s0] = res
            done += 1
            if progress:
                progress(done / len(seg_starts), f"Analyse de l'image : {done}/{len(seg_starts)}")

    t, banner, spec = [], [], []
    for s0 in seg_starts:
        b, s = results[s0]
        t.extend(s0 + i / fps for i in range(len(b)))
        banner.extend(b)
        spec.extend(s)
    return Scan(fps, np.array(t), np.array(banner, np.float32), np.array(spec, np.float32))


# ---------- Des mesures aux kills ----------

def _segments(on: np.ndarray) -> list[tuple[int, int]]:
    """Plages [i, j[ où `on` est vrai."""
    edges = np.diff(np.r_[0, on.astype(np.int8), 0])
    return list(zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)))


def find_kills(scan: Scan, banner_on: float = BANNER_ON, peak_min: float = BANNER_PEAK_MIN,
               min_dur: float = BANNER_MIN_DUR, max_dur: float = BANNER_MAX_DUR,
               noisy_margin: float = NOISY_MARGIN, spectate_on: float = SPECTATE_ON) -> list[KillEvent]:
    """Repère chaque apparition de l'emblème (= un kill) et dit si le streamer était spectateur.

    Écarte : les apparitions trop courtes ou trop faibles, celles qui durent trop longtemps (écran de
    choix d'agent, dont le décor contient des cercles), et tout ce qui est proche de ces dernières.
    """
    segs = _segments(scan.banner >= banner_on)
    noisy = [scan.t[i] for i, j in segs if (j - i) / scan.fps > max_dur]
    noisy += [scan.t[j - 1] for i, j in segs if (j - i) / scan.fps > max_dur]
    events: list[KillEvent] = []
    for i, j in segs:
        dur = (j - i) / scan.fps
        peak = float(scan.banner[i:j].max())
        t = float(scan.t[i])
        if not (min_dur <= dur <= max_dur) or peak < peak_min:
            continue
        if any(abs(t - x) <= noisy_margin for x in noisy):
            continue
        spectating = float(np.median(scan.spectate[i:j])) >= spectate_on
        # Kills enchaînés : l'emblème « redémarre » (score qui chute sous la moitié puis remonte).
        starts = [i] + [i + k for k in _retriggers(scan.banner[i:j])]
        for a, b in zip(starts, starts[1:] + [j]):
            events.append(KillEvent(t=float(scan.t[a]), duration=(b - a) / scan.fps,
                                    peak=float(scan.banner[a:b].max()), spectating=spectating))
    return events


def _retriggers(b: np.ndarray) -> list[int]:
    """Indices où un nouvel emblème commence à l'intérieur d'une même apparition.

    Vérifié sur la VOD du 01/11 avec le fil des kills (25:30, 2:10:37, 2:22:08 ×3, 3:44:18).
    """
    out, ref, k = [], float(b[0]), 1
    while k < len(b) - 1:
        if b[k] < 0.5 * ref and b[k + 1:].max() > 0.8 * ref:
            r = k + 1
            while r < len(b) and b[r] < 0.8 * ref:     # le nouveau kill commence quand le score remonte
                r += 1
            out.append(r)
            ref, k = float(b[r]), r + 1
            continue
        ref = max(ref, float(b[k]))
        k += 1
    return out


DEATH_LEAD = 2.5      # la carte du coéquipier regardé apparaît ~2,5 s après la mort (VOD du 01/11)
SPECTATE_MIN = 2.0    # durée minimale en spectateur pour compter une mort (s)
SPECTATE_GAP = 5.0    # trous plus courts ignorés (changement de joueur regardé, flash…) (s)


REFINE_FPS = 10.0     # relecture fine de chaque emblème : deux kills à 0,3 s d'écart ne laissent qu'un « trou »
REFINE_PAD = 0.3      # d'un dixième de seconde dans l'emblème, invisible à 4 images/s (VOD du 25/11, 82:44)


def _groups(events: list[KillEvent], fps: float) -> list[list[KillEvent]]:
    """Kills d'une même apparition de l'emblème (ils se suivent sans trou)."""
    out: list[list[KillEvent]] = []
    for e in sorted(events, key=lambda e: e.t):
        if out and abs(out[-1][-1].t + out[-1][-1].duration - e.t) <= 1.5 / fps:
            out[-1].append(e)
        else:
            out.append([e])
    return out


def fine_kill_spans(arr: np.ndarray, fine_fps: float, banner_on: float = BANNER_ON) -> list[tuple[int, int]]:
    """Kills lus dans le score d'emblème relu finement : (début, fin) en indices d'images."""
    if not len(arr):
        return []
    runs = [(i, j) for i, j in _segments(arr >= banner_on) if (j - i) / fine_fps >= 0.5]
    if not runs:
        return []
    starts = [i + k for i, j in runs for k in [0] + _retriggers(arr[i:j])]
    ends = starts[1:] + [runs[-1][1]]
    return list(zip(starts, ends))


def refine_kills(video: str, events: list[KillEvent], fps: float = 4.0, fine_fps: float = REFINE_FPS,
                 banner_on: float = BANNER_ON) -> list[KillEvent]:
    """Relit chaque emblème à 10 images/s (seulement ces 2-3 secondes) pour séparer les kills très rapprochés.
    Ne retire jamais un kill : si la relecture en trouve moins, on garde la première lecture."""
    if not events:
        return events
    w, h, _ = _probe(video)
    out: list[KillEvent] = []
    for g in _groups(events, fps):
        a = max(0.0, g[0].t - REFINE_PAD)
        b = g[-1].t + g[-1].duration + REFINE_PAD
        try:
            banner, _ = _scan_segment(video, w, h, a, b - a, fine_fps, fast=False)
        except Exception:
            banner = []
        arr = np.array(banner, np.float32)
        spans = fine_kill_spans(arr, fine_fps, banner_on)
        if len(spans) <= len(g):
            out.extend(g)
            continue
        for s0, s1 in spans:
            out.append(KillEvent(t=round(a + s0 / fine_fps, 3), duration=(s1 - s0) / fine_fps,
                                 peak=float(arr[s0:s1].max()) if s1 > s0 else 0.0, spectating=g[0].spectating))
    return out


def find_deaths(scan: Scan, spectate_on: float = SPECTATE_ON) -> list[float]:
    """Morts du streamer : début de chaque passage en spectateur, moins DEATH_LEAD.

    Limite : si le streamer meurt en dernier de son équipe, il n'y a personne à regarder et la mort
    n'est pas vue (le round se termine aussitôt).
    """
    segs = _segments(scan.spectate >= spectate_on)
    merged: list[list[float]] = []
    for i, j in segs:
        a, b = float(scan.t[i]), float(scan.t[j - 1])
        if merged and a - merged[-1][1] <= SPECTATE_GAP:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    return [max(0.0, a - DEATH_LEAD) for a, b in merged if b - a >= SPECTATE_MIN]


def alive_checker(scan: Scan, spectate_on: float = SPECTATE_ON):
    """Fonction t -> True si le streamer est vivant à l'instant t.

    Vivant = pas en spectateur de t-1 s à t+4 s : la carte de spectateur n'apparaît que ~2,5 s après la mort,
    alors que le portrait du joueur disparaît du bandeau du haut tout de suite (vu à 3:36:44 sur la VOD du 01/11).
    """
    spectating = scan.spectate >= spectate_on
    before, after = int(1 * scan.fps), int((DEATH_LEAD + 1.5) * scan.fps)

    def is_alive(t: float) -> bool:
        i = int(np.searchsorted(scan.t, t))
        return not spectating[max(0, i - before):i + after].any()
    return is_alive


def streamer_kills(scan: Scan, **kw) -> list[KillEvent]:
    return [e for e in find_kills(scan, **kw) if not e.spectating]

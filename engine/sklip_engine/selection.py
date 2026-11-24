"""Choix des meilleurs clips pour un thème, jusqu'à la durée cible (15–60 s)."""
from __future__ import annotations

from .moments import THEMES, Clip, Moment, moments_to_clips

MIN_TARGET, MAX_TARGET = 15.0, 60.0


def theme_types(theme: str | list[str]) -> set[str]:
    if isinstance(theme, str):
        if theme not in THEMES:
            raise ValueError(f"Thème inconnu : {theme}")
        return set(THEMES[theme]["types"])
    return set(theme)  # thème perso = liste de types cochés


def snap_to_beats(duration: float, bpm: float, min_beats: int = 2) -> float:
    """Arrondit une durée à un nombre entier de temps (pour couper sur la grille BPM)."""
    beat = 60.0 / bpm
    n = max(min_beats, round(duration / beat))
    return n * beat


def select_clips(moments: list[Moment], theme: str | list[str], target: float = 30.0,
                 bpm: float | None = None, stream_duration: float | None = None) -> list[Clip]:
    """Retourne les clips retenus, dans l'ordre chronologique.

    - garde uniquement les moments du thème ;
    - fusionne les moments proches en clips ;
    - prend les clips par score décroissant tant que la durée cible n'est pas dépassée ;
    - si un BPM est donné, chaque clip dure un nombre entier de temps (coupes sur le beat).
    """
    target = min(MAX_TARGET, max(MIN_TARGET, float(target)))
    wanted = theme_types(theme)
    clips = moments_to_clips([m for m in moments if m.type in wanted], stream_duration=stream_duration)

    if bpm:
        for c in clips:
            new_d = snap_to_beats(c.duration, bpm)
            # On garde le moment fort à la même place : on ajuste surtout le début.
            c.start = max(0.0, c.end - new_d)
            c.end = c.start + new_d

    chosen: list[Clip] = []
    total = 0.0
    for c in sorted(clips, key=lambda c: c.score, reverse=True):
        if total + c.duration <= target + 0.5:
            chosen.append(c)
            total += c.duration
        if total >= target - 1.0:
            break
    return sorted(chosen, key=lambda c: c.start)

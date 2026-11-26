"""Choix des meilleurs clips pour un thème, jusqu'à la durée cible (15 s – 5 min)."""
from __future__ import annotations

from .moments import THEMES, Clip, Moment, moments_to_clips

MIN_TARGET, MAX_TARGET = 15.0, 300.0


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


SNAP_BEFORE = 4.0    # s : on recule le début jusqu'au début de la phrase, au plus de 4 s
SNAP_AFTER = 8.0     # s : on prolonge la fin jusqu'à la fin de la phrase, au plus de 8 s (Sky : « le clip se coupe alors que je parle encore »)


def _inside(spans: list[tuple[float, float]], t: float):
    """La phrase (début, fin) en cours à l'instant t, ou None (silence). `spans` triés."""
    import bisect
    i = bisect.bisect_right([a for a, _ in spans], t) - 1
    if i >= 0 and spans[i][0] < t < spans[i][1]:
        return spans[i]
    return None


def snap_to_speech(clips: list[Clip], speech: list[tuple[float, float]] | None,
                   stream_duration: float | None = None) -> list[Clip]:
    """Ne coupe pas au milieu d'une phrase : si le début (ou la fin) d'un clip tombe pendant que le streamer parle,
    on recule au début de la phrase (ou on attend sa fin), dans la limite de quelques secondes.
    Les clips qui se touchent ensuite sont fusionnés."""
    if not speech:
        return clips
    speech = sorted((float(a), float(b)) for a, b in speech)
    for c in clips:
        s = _inside(speech, c.start)
        if s and c.start - s[0] <= SNAP_BEFORE:
            c.start = max(0.0, s[0] - 0.15)
        e = _inside(speech, c.end)
        if e and e[1] - c.end <= SNAP_AFTER:
            c.end = e[1] + 0.2
            if stream_duration is not None:
                c.end = min(c.end, stream_duration)
    out: list[Clip] = []
    for c in sorted(clips, key=lambda c: c.start):
        if out and c.start <= out[-1].end:
            out[-1].end = max(out[-1].end, c.end)
            out[-1].moments += c.moments
        else:
            out.append(c)
    return out


def select_clips(moments: list[Moment], theme: str | list[str], target: float = 30.0,
                 bpm: float | None = None, stream_duration: float | None = None,
                 speech: list[tuple[float, float]] | None = None) -> list[Clip]:
    """Retourne les clips retenus, dans l'ordre chronologique.

    - garde uniquement les moments du thème ;
    - fusionne les moments proches en clips ;
    - prend les clips par score décroissant tant que la durée cible n'est pas dépassée ;
    - si un BPM est donné, chaque clip dure un nombre entier de temps (coupes sur le beat).
    """
    spec = THEMES.get(theme, {}) if isinstance(theme, str) else {}
    # Best-of : au moins sa propre cible (60 s), plus si le streamer a choisi des montages plus longs.
    target = min(MAX_TARGET, max(MIN_TARGET, float(target), float(spec.get("target", 0))))
    wanted = theme_types(theme)
    clips = moments_to_clips([m for m in moments if m.type in wanted], stream_duration=stream_duration)
    clips = snap_to_speech(clips, speech, stream_duration)   # pas de coupe au milieu d'une phrase

    if bpm:
        for c in clips:
            new_d = snap_to_beats(c.duration, bpm)
            # On garde le moment fort à la même place : on ajuste surtout le début.
            c.start = max(0.0, c.end - new_d)
            c.end = c.start + new_d

    chosen: list[Clip] = []
    total = 0.0
    if spec.get("spread"):
        return finale_last(sorted(_spread(clips, target), key=lambda c: c.start))
    for c in sorted(clips, key=lambda c: c.score, reverse=True):
        if total + c.duration <= target + 0.5:
            chosen.append(c)
            total += c.duration
        if total >= target - 1.0:
            break
    if not chosen and clips:
        # Même le meilleur clip dépasse la cible : on le garde, raccourci par le début (le moment fort reste).
        best = max(clips, key=lambda c: c.score)
        best.start = max(best.start, best.end - target)
        chosen = [best]
    return sorted(chosen, key=lambda c: c.start)


SPREAD_PENALTY = 0.75   # chaque clip déjà pris dans la même partie divise l'intérêt des suivants par 4/3


def _game_of(c: Clip):
    for m in c.moments:
        if m.meta and m.meta.get("game") is not None:
            return m.meta["game"]
    return None


def finale_last(clips: list[Clip]) -> list[Clip]:
    """Best-of : dans l'ordre du live, mais le meilleur clip à la fin, pour finir en beauté (demande de Sky)."""
    if len(clips) < 2:
        return clips
    best = max(clips, key=lambda c: (c.score, c.start))      # à égalité : le plus tardif, l'ordre du live bouge moins
    return [c for c in clips if c is not best] + [best]


def _spread(clips: list[Clip], target: float) -> list[Clip]:
    """Best-of : les meilleurs clips, mais pas tous dans la même partie (et types variés grâce aux scores)."""
    left, chosen, total, per_game = list(clips), [], 0.0, {}
    while left and total < target - 1.0:
        best = max(left, key=lambda c: c.score * SPREAD_PENALTY ** per_game.get(_game_of(c), 0))
        left.remove(best)
        if total + best.duration > target + 0.5:
            continue
        chosen.append(best)
        total += best.duration
        g = _game_of(best)
        if g is not None:
            per_game[g] = per_game.get(g, 0) + 1
    return chosen

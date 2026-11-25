"""Classement plus malin des moments : un kill qui fait réagir le chat ou rire le streamer vaut plus
qu'un kill dans le vide. Fabrique aussi les « morts drôles » (mort suivie d'un rire ou d'un pic de chat)."""
from __future__ import annotations

from .moments import Moment

# (type du signal, fenêtre avant le moment, fenêtre après, bonus) — le chat réagit avec quelques secondes de retard.
BOOSTS = [
    ("chat_spike", 3.0, 20.0, 15.0),
    ("laugh", 3.0, 10.0, 10.0),
    ("scream", 2.0, 6.0, 10.0),          # le streamer crie juste après (« NOOON », « regarde ! »)
    ("viewer_clip", 30.0, 10.0, 15.0),   # un viewer a clippé ce passage
    ("marker", 30.0, 5.0, 20.0),         # le streamer a appuyé sur son raccourci
]
FUNNY_DEATH_WINDOW = 10.0                # rire ou pic de chat dans les 10 s après la mort
MAX_BONUS = 40.0


def rank_moments(moments: list[Moment]) -> list[Moment]:
    """Renvoie de nouveaux moments avec un score ajusté (meta.boost = raisons du bonus)."""
    out = []
    for m in moments:
        bonus, why = 0.0, []
        for kind, before, after, pts in BOOSTS:
            if kind == m.type:
                continue
            if any(o.type == kind and m.t - before <= o.t <= m.t + after for o in moments):
                bonus += pts
                why.append(kind)
        bonus = min(bonus, MAX_BONUS)
        meta = {**m.meta, "boost": why} if why else dict(m.meta)
        out.append(Moment(m.type, m.t, round(float(m.score) + bonus, 1), meta))
    return out


def funny_deaths(deaths: list[float], moments: list[Moment]) -> list[Moment]:
    """Morts suivies d'un rire, d'un cri ou d'un pic de chat → moments « mort drôle »."""
    out = []
    for d in deaths:
        react = [o for o in moments if o.type in ("laugh", "scream", "chat_spike") and d <= o.t <= d + FUNNY_DEATH_WINDOW]
        if react:
            out.append(Moment("funny_death", round(d, 2), meta={"reaction": react[0].type}))
    return out

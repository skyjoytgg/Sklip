"""Modèle des moments détectés et des thèmes de montage."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Iterable

# Découpe autour d'un moment (cahier des charges : ~4 s avant, ~2 s après).
PRE_ROLL = 4.0
POST_ROLL = 2.0

# Score de base par type (plus c'est haut, plus le moment est prioritaire).
BASE_SCORES: dict[str, float] = {
    "ace": 100,
    "multikill": 70,      # meta.count = 2..4
    "clutch": 80,
    "kill": 30,
    "funny_death": 55,
    "laugh": 45,          # rire du streamer (piste micro)
    "scream": 50,         # cri / exclamation du streamer (piste micro)
    "chat_spike": 40,
    "raid": 75,
    "viewer_peak": 50,
    "viewer_clip": 60,
    "marker": 65,         # raccourci, !clip, Stream Deck
}

KNIFE_BONUS = 55         # kill au couteau : rare et classe, prioritaire (un kill au couteau seul passe devant un 3K)

MOMENT_TYPES = tuple(BASE_SCORES)

# Thèmes fournis. Les thèmes perso sont des listes de types cochées par le streamer.
THEMES: dict[str, dict] = {
    "kills": {"label": "Kills / Aces / Clutchs", "types": ["ace", "multikill", "clutch", "kill"]},
    "drole": {"label": "Moments drôles", "types": ["funny_death", "laugh", "scream", "chat_spike", "marker"]},
    "communaute": {"label": "Moments communauté", "types": ["raid", "viewer_peak", "viewer_clip", "chat_spike"]},
    # Pendant les passages « discussion » (Just Chatting de début / fin de live) : rires, cris, chat qui s'emballe,
    # raids, marqueurs. Rien pendant les parties : la webcam en grand, c'est le streamer qui parle.
    "discussion": {"label": "Discussion (Just Chatting)", "scene": "discussion",
                   "types": ["laugh", "scream", "chat_spike", "raid", "marker", "viewer_clip", "viewer_peak"]},
    # Long live : 60 s des meilleurs moments de tous les types, répartis entre les parties (ajouté tout seul).
    "bestof": {"label": "Best-of du live", "target": 60.0, "spread": True,
               "types": ["ace", "clutch", "multikill", "kill", "funny_death", "laugh", "scream", "chat_spike", "raid",
                         "marker", "viewer_clip", "viewer_peak"]},
}

BESTOF_MIN_DURATION = 45 * 60    # le best-of est ajouté aux lives d'au moins 45 min…
BESTOF_MIN_MOMENTS = 10          # … qui ont au moins 10 moments

# Types qui n'ont de sens qu'en jeu (pas cherchés hors Valorant).
VALORANT_ONLY = {"ace", "multikill", "clutch", "kill", "funny_death"}


@dataclass
class Moment:
    type: str
    t: float                      # position dans le stream, en secondes
    score: float | None = None
    meta: dict = field(default_factory=dict)

    def __post_init__(self):
        if self.type not in BASE_SCORES:
            raise ValueError(f"Type de moment inconnu : {self.type}")
        if self.score is None:
            self.score = moment_score(self.type, self.meta)

    def to_dict(self) -> dict:
        return asdict(self)


def moment_score(mtype: str, meta: dict | None = None) -> float:
    meta = meta or {}
    s = BASE_SCORES[mtype]
    if mtype == "multikill":
        s += 10 * max(0, int(meta.get("count", 2)) - 2)  # 3K > 2K, 4K > 3K
    s += KNIFE_BONUS * len(meta.get("knives", []))
    if mtype == "raid":
        s += min(20, int(meta.get("viewers", 0)) / 10)
    if mtype == "chat_spike":
        s += min(25, float(meta.get("intensity", 0)) * 5)
    return float(s)


@dataclass
class Clip:
    """Segment de vidéo à monter (un ou plusieurs moments fusionnés)."""
    start: float
    end: float
    moments: list[Moment]
    layout: str = "cam_top"       # mise en page 9:16, modifiable clip par clip
    volumes: dict = field(default_factory=dict)  # surcharge par clip : {"game": 1.0, "mic": 1.0, ...}

    @property
    def duration(self) -> float:
        return self.end - self.start

    @property
    def score(self) -> float:
        # Le meilleur moment compte plein, les autres comptent un peu.
        scores = sorted((m.score for m in self.moments), reverse=True)
        return scores[0] + 0.25 * sum(scores[1:])

    def to_dict(self) -> dict:
        return {"start": round(self.start, 3), "end": round(self.end, 3), "layout": self.layout,
                "volumes": self.volumes, "score": round(self.score, 1),
                "moments": [m.to_dict() for m in self.moments]}


def moments_to_clips(moments: Iterable[Moment], pre: float = PRE_ROLL, post: float = POST_ROLL,
                     stream_duration: float | None = None) -> list[Clip]:
    """Transforme les moments en fenêtres [t-pre, t+post] et fusionne celles qui se chevauchent
    (ex. les kills d'un même multi-kill donnent un seul clip)."""
    ms = sorted(moments, key=lambda m: m.t)
    clips: list[Clip] = []
    for m in ms:
        # Un multi-kill / ace couvre du premier kill (meta.t_start) au dernier (m.t).
        start = max(0.0, float(m.meta.get("t_start", m.t)) - pre)
        end = m.t + post
        if stream_duration is not None:
            end = min(end, stream_duration)
        if clips and start <= clips[-1].end:
            clips[-1].end = max(clips[-1].end, end)
            clips[-1].moments.append(m)
        else:
            clips.append(Clip(start, end, [m]))
    return clips

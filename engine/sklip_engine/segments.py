"""Passages d'un live : Valorant, Just Chatting, autre jeu… et la webcam de chacun.

Pendant le live, Sklip note (en lecture seule) la scène OBS, son type (jeu / discussion / pause : choisi par le
streamer, sinon deviné), la position de la webcam dans cette scène et la catégorie Twitch. C'est la SCÈNE (ce qui
est vraiment à l'écran) qui décide de la mise en page ; la catégorie Twitch ne sert qu'aux couleurs de la frise
(beaucoup de streamers mettent « VALORANT » dès le début, pendant leur Just Chatting).
Pour une vidéo sans ces infos (VOD téléchargée), le bandeau de score de Valorant décide.

Chaque clip reçoit la mise en page de son passage :
- scène de jeu : webcam en haut, jeu en bas (« cam_top »), avec la webcam de cette scène ;
- scène de discussion : webcam en grand qui remplit l'écran 9:16 (« cam_full ») ;
- scène de pause (« Je reviens »…) : pas de clip.
"""
from __future__ import annotations

HUD_GAP = 90.0   # s sans bandeau de score avant de considérer qu'on n'est plus sur Valorant


def is_valorant(game: str | None) -> bool:
    return bool(game) and "valorant" in game.lower()


def hud_segments(hud_t, score_left, duration: float, gap: float = HUD_GAP) -> list[dict]:
    """Passages Valorant / hors jeu d'après le bandeau de score (vidéo sans infos OBS ni Twitch)."""
    seen = [float(t) for t, s in zip(hud_t, score_left) if s is not None]
    runs: list[list[float]] = []
    for t in seen:
        if runs and t - runs[-1][1] <= gap:
            runs[-1][1] = t
        else:
            runs.append([t, t])
    out, pos = [], 0.0
    for a, b in runs:
        a, b = max(0.0, a - gap / 3), min(duration, b + gap / 3)
        if a - pos > 1:
            out.append({"start": round(pos, 2), "end": round(a, 2), "game": None, "source": "hud"})
        out.append({"start": round(max(a, pos), 2), "end": round(b, 2), "game": "VALORANT", "source": "hud"})
        pos = b
    if duration - pos > 1 or not out:
        out.append({"start": round(pos, 2), "end": round(duration, 2), "game": None, "source": "hud"})
    return out


def segment_at(segments: list[dict], t: float) -> dict | None:
    for s in segments or []:
        if s["start"] <= t < s["end"]:
            return s
    return segments[-1] if segments and t >= segments[-1]["end"] else None


def scene_type(seg: dict | None, hud_seg: dict | None) -> str:
    """jeu | discussion | pause : le type de la scène OBS s'il est connu, sinon le bandeau de score de Valorant."""
    if seg and seg.get("type") in ("jeu", "discussion", "pause"):
        return seg["type"]
    return "jeu" if hud_seg and is_valorant(hud_seg.get("game")) else "discussion"


def drop_paused(moments: list, segments: list[dict] | None) -> list:
    """Retire les moments pendant une scène de pause (« Je reviens », écran de fin…)."""
    if not segments:
        return moments
    return [m for m in moments if (segment_at(segments, m.t) or {}).get("type") != "pause"]


def in_scene(moments: list, kind: str, segments: list[dict] | None, hud: list[dict]) -> list:
    """Moments pendant un type de scène (« discussion »…) : scène OBS si connue, sinon bandeau de score."""
    return [m for m in moments if scene_type(segment_at(segments or [], m.t), segment_at(hud, m.t)) == kind]


def assign_layouts(clips: list[dict], segments: list[dict] | None, hud: list[dict]) -> None:
    """Met la mise en page et la webcam de son passage sur chaque clip (dictionnaires de select_clips)."""
    for c in clips:
        mid = (c["start"] + c["end"]) / 2
        seg = segment_at(segments or [], mid)
        kind = scene_type(seg, segment_at(hud, mid))
        cam = seg.get("cam") if seg else None
        c["layout"] = "cam_top" if kind == "jeu" else "cam_full"
        if cam:
            c["cam"] = cam
        c["scene"] = (seg.get("scene") if seg and seg.get("scene") else ("Jeu" if kind == "jeu" else "Hors jeu"))

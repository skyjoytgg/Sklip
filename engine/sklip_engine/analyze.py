"""Analyse complète d'un stream : vidéo → moments → clips par thème → dossier du stream prêt pour l'éditeur.

Le fichier vidéo (enregistrement OBS ou VOD) est seulement lu : jamais déplacé ni supprimé.
Tout ce que Sklip produit va dans le dossier du stream (Sklip/Streams/AAAA-MM-JJ_titre/) :
  session.json  — ce que l'éditeur ouvre (moments, clips par thème, vidéo, pistes)
  stats.json / stats.html — le récap
  .sklip/       — mesures gardées en cache (réanalyse instantanée)
"""
from __future__ import annotations

import json
import os
from datetime import date

from .kill_detect import Scan, _probe, alive_checker, find_deaths, find_kills, scan_video
from .moments import BASE_SCORES, THEMES, Moment
from .ranking import funny_deaths, rank_moments
from .rounds import Hud, find_clutches, group_kills, read_hud, rounds_from_scores
from .selection import select_clips
from .stream_folder import create_stream_folder, write_stats_html

SESSION_VERSION = 1


def _stats(moments: list[Moment], deaths: list[float], rounds, duration: float, extra: dict) -> dict:
    count = lambda t: sum(m.type == t for m in moments)
    kills = count("kill") + sum(int(m.meta.get("count", 1)) for m in moments if m.type in ("multikill", "ace"))
    games: dict[int, list] = {}
    for r in rounds:
        games.setdefault(r.game, []).append(r)
    in_game = sum(max(r.end for r in rs) - min(r.start for r in rs) for rs in games.values())
    return {"kills": kills, "multikills": count("multikill"), "aces": count("ace"), "clutchs": count("clutch"),
            "morts": len(deaths), "pics_chat": count("chat_spike"), "clips_viewers": count("viewer_clip"),
            "marqueurs": count("marker"), "parties": len(games), "rounds": len(rounds),
            "duree_stream": round(duration), "duree_valorant": round(in_game),
            "peak_viewers": extra.get("peak_viewers"), "raids": extra.get("raids", [])}


def analyze_stream(video: str, root: str, title: str, themes: list[str] | None = None, target: float = 30.0,
                   extra_moments: list[dict] | None = None, extra_stats: dict | None = None,
                   folder: str | None = None, day: str | None = None, scan: Scan | None = None,
                   hud: Hud | None = None, capture: dict | None = None, partial_scans: list[str] | None = None,
                   record_started_at: float | None = None, progress=None) -> dict:
    """Analyse `video` et prépare le dossier du stream. Renvoie la session (aussi écrite dans session.json)."""
    report = progress or (lambda f, m: None)
    themes = [t for t in (themes or ["kills"]) if t in THEMES] or ["kills"]
    if folder is None:
        folder = create_stream_folder(root, title, date.fromisoformat(day) if day else None)["path"]
    cache = os.path.join(folder, ".sklip")
    os.makedirs(cache, exist_ok=True)
    _, _, duration = _probe(video)

    # 1. L'image : emblème de kill + mode spectateur (le plus long, gardé en cache).
    scan_file = os.path.join(cache, "scan.npz")
    if scan is None and os.path.exists(scan_file):
        scan = Scan.load(scan_file)
    if scan is None and partial_scans:
        # Analyse pendant le live : la plus grande partie est déjà mesurée, on ne lit que la fin.
        done = Scan.concat([Scan.load(p) for p in partial_scans if os.path.exists(p)])
        rest = scan_video(video, start=done.end, duration=max(0.0, duration - done.end),
                          progress=lambda f, m: report(0.02 + 0.83 * f, m)) if duration - done.end > 1 else None
        scan = Scan.concat([done] + ([rest] if rest is not None else []))
        scan.save(scan_file)
    if scan is None:
        scan = scan_video(video, progress=lambda f, m: report(0.02 + 0.83 * f, m))
        scan.save(scan_file)
    # 2. Le bandeau du haut : score (rounds, parties) et joueurs en vie (clutchs).
    report(0.86, "Lecture du score et des joueurs en vie")
    hud_file = os.path.join(cache, "hud.npz")
    if hud is None and os.path.exists(hud_file):
        hud = Hud.load(hud_file)
    if hud is None:
        hud = read_hud(video)
        hud.save(hud_file)

    # 3. Les pistes audio capturées par Sklip pendant le live, calées sur la vidéo.
    tracks = {}
    if capture and capture.get("info") and capture.get("record_started_at"):
        report(0.95, "Calage des pistes audio")
        from .audio_capture import tracks_for_video
        tracks = tracks_for_video(capture["info"], capture["record_started_at"], video)

    report(0.96, "Choix des meilleurs moments")
    events = find_kills(scan)
    kill_times = [round(e.t, 2) for e in events if not e.spectating]
    deaths = [round(d, 2) for d in find_deaths(scan)]
    rounds = rounds_from_scores(hud.t, hud.scores)
    moments = group_kills(kill_times, rounds) + find_clutches(hud, rounds, kill_times, alive_checker(scan))
    for m in extra_moments or []:     # Twitch (raids, chat, clips, peak) et marqueurs, déjà en temps de la vidéo
        if m.get("type") in BASE_SCORES and 0 <= float(m["t"]) <= duration:
            moments.append(Moment(m["type"], float(m["t"]), m.get("score"), m.get("meta", {})))
    moments += funny_deaths(deaths, moments)
    moments = sorted(rank_moments(moments), key=lambda m: m.t)

    clips = {th: [c.to_dict() for c in select_clips(moments, th, target, stream_duration=duration)] for th in themes}
    stats = _stats(moments, deaths, rounds, duration, extra_stats or {})
    session = {
        "version": SESSION_VERSION, "title": title, "folder": folder, "video": os.path.abspath(video),
        "duration": round(duration, 2), "target": target, "themes": themes,
        "moments": [m.to_dict() for m in moments], "clips": clips, "deaths": deaths, "stats": stats,
        "spectated_kills": sum(e.spectating for e in events), "tracks": tracks,
        # Heure (secondes depuis 1970) du début de l'enregistrement : sert à retrouver le même instant chez un pote.
        "record_started_at": record_started_at or (capture or {}).get("record_started_at"),
    }
    with open(os.path.join(folder, "session.json"), "w", encoding="utf-8") as f:
        json.dump(session, f, ensure_ascii=False, indent=1)
    with open(os.path.join(folder, "stats.json"), "w", encoding="utf-8") as f:
        json.dump({"title": title, "stats": stats}, f, ensure_ascii=False, indent=1)
    write_stats_html(folder, title, stats, [m.to_dict() for m in moments if m.type != "kill"])
    report(1.0, "Terminé")
    return session

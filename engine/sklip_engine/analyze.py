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

from .kill_detect import Scan, _probe, alive_checker, find_deaths, find_kills, refine_kills, scan_video
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
                   record_started_at: float | None = None, segments: list[dict] | None = None, progress=None,
                   chat: list[dict] | None = None, agents_dir: str | None = None) -> dict:
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

    # 2 bis. La webcam du streamer : trouvée toute seule (réglable à la main dans l'éditeur).
    cam_file = os.path.join(cache, "cam.json")
    if os.path.exists(cam_file):
        with open(cam_file, encoding="utf-8") as f:
            cam = json.load(f).get("cam")
    else:
        report(0.9, "Recherche de la webcam")
        from .camdetect import detect_cam
        try:
            in_game = [float(t) for t, s in zip(hud.t, hud.score_left) if s is not None]
            cam = detect_cam(video, duration, in_game)
        except Exception:
            cam = None
        with open(cam_file, "w", encoding="utf-8") as f:
            json.dump({"cam": cam}, f)

    # 3. Les pistes audio capturées par Sklip pendant le live, calées sur la vidéo.
    tracks = {}
    if capture and capture.get("info") and capture.get("record_started_at"):
        report(0.95, "Calage des pistes audio")
        from .audio_capture import tracks_for_video
        tracks = tracks_for_video(capture["info"], capture["record_started_at"], video)

    # 3 bis. La voix du streamer (piste micro, sinon le son de la vidéo) : quand il parle (pour ne pas couper
    # un clip au milieu d'une phrase), et ses rires et cris (piste micro seulement). Gardé en cache.
    voice_file = os.path.join(cache, "voice.json")
    vocal, speech = [], []
    if os.path.exists(voice_file):
        with open(voice_file, encoding="utf-8") as f:
            cached = json.load(f)
        vocal, speech = cached.get("found", []), cached.get("speech", [])
    else:
        from .voice import detect_in_track, speech_spans, track_features
        mic = tracks.get("mic")
        try:
            report(0.955, "Écoute de ta voix")
            src, off = (mic["path"], mic["offset"]) if mic else (video, 0.0)
            feats = track_features(src)
            speech = [(round(a + off, 2), round(b + off, 2)) for a, b in speech_spans(*feats)]
            if mic:
                report(0.958, "Écoute des rires et des cris")
                vocal = detect_in_track(mic["path"], offset=off, features=feats)
            with open(voice_file, "w", encoding="utf-8") as f:
                json.dump({"found": vocal, "speech": speech}, f, ensure_ascii=False)
        except Exception:
            vocal, speech = [], []             # piste illisible : on continue sans

    report(0.96, "Choix des meilleurs moments")
    events = refine_kills(video, find_kills(scan))     # kills très rapprochés : relecture fine de l'emblème
    kill_times = [round(e.t, 2) for e in events if not e.spectating]
    deaths = [round(d, 2) for d in find_deaths(scan)]
    rounds = rounds_from_scores(hud.t, hud.scores)
    report(0.965, "Recherche des kills au couteau")
    from .killfeed import knife_kills
    knives = knife_kills(video, events)
    moments = group_kills(kill_times, rounds, knives) + find_clutches(hud, rounds, kill_times, alive_checker(scan))
    for m in extra_moments or []:     # Twitch (raids, chat, clips, peak) et marqueurs, déjà en temps de la vidéo
        if m.get("type") in BASE_SCORES and 0 <= float(m["t"]) <= duration:
            moments.append(Moment(m["type"], float(m["t"]), m.get("score"), m.get("meta", {})))
    from .voice import to_moments
    for m in to_moments(vocal):
        if 0 <= m["t"] <= duration:
            moments.append(Moment(m["type"], m["t"], None, m["meta"]))
    moments += funny_deaths(deaths, moments)
    moments = sorted(rank_moments(moments), key=lambda m: m.t)
    from .segments import drop_paused
    moments = drop_paused(moments, segments)       # pas de clip pendant « Je reviens », écran de fin…

    from .segments import assign_layouts, hud_segments, in_scene, segment_at
    hud_segs = hud_segments(hud.t, hud.score_left, duration)

    # Long live avec beaucoup de moments : un « Best-of du live » de 60 s en plus des thèmes choisis.
    from .moments import BESTOF_MIN_DURATION, BESTOF_MIN_MOMENTS
    if "bestof" not in themes and duration >= BESTOF_MIN_DURATION and len(moments) >= BESTOF_MIN_MOMENTS:
        themes = themes + ["bestof"]

    def theme_moments(th):
        # Thème lié à un type de scène (« Discussion ») : seulement les moments de ces passages.
        kind = THEMES[th].get("scene")
        return in_scene(moments, kind, segments, hud_segs) if kind else moments

    clips = {th: [c.to_dict() for c in select_clips(theme_moments(th), th, target, stream_duration=duration, speech=speech)]
             for th in themes}
    # Passages (Valorant, Just Chatting…) : chaque clip prend la mise en page et la webcam de son passage.
    for th in clips:
        assign_layouts(clips[th], segments, hud_segs, cam)
    # Messages du chat que le streamer lit à voix haute : une bulle façon Twitch pendant qu'il les lit.
    chat = [m for m in (chat or []) if 0 <= float(m.get("t", -1)) <= duration]
    if chat:
        from .chatread import attach_chat
        from .overlays import transcribe
        mic_track = tracks.get("mic")

        def words_of(a, b):
            src, off = (mic_track["path"], float(mic_track.get("offset", 0.0))) if mic_track else (video, 0.0)
            s0 = max(0.0, a - off)
            return [{"start": s0 + off + w.start, "end": s0 + off + w.end, "text": w.text}
                    for w in transcribe(src, s0, b - off)]
        attach_chat([c for th in clips for c in clips[th]], chat, words_of,
                    progress=lambda f: report(0.97 + 0.01 * f, "Messages du chat lus à voix haute"))
    # Vocal du jeu : quel coéquipier parle (icône de son agent en bas à gauche) et ce qu'il dit (piste du jeu).
    # Répliques proposées dans l'éditeur (agent en grand + texte façon BD), pas affichées d'office.
    if agents_dir:
        from .overlays import transcribe as _tr
        from .voicechat import attach_voices
        game_track = tracks.get("game")

        def game_words(a, b):
            src, off = (game_track["path"], float(game_track.get("offset", 0.0))) if game_track else (video, 0.0)
            s0 = max(0.0, a - off)
            return [{"start": s0 + off + w.start, "end": s0 + off + w.end, "text": w.text}
                    for w in _tr(src, s0, b - off)]
        game_clips = [c for th in clips for c in clips[th]]
        attach_voices(game_clips, video, agents_dir, game_words, speech=speech if tracks.get("mic") else None,
                      progress=lambda f: report(0.98, "Vocal du jeu : qui parle"))
    # Discord : les phrases des potes sont proposées, le streamer choisit l'agent qui les dit (pas d'icône à lire).
    discord_track = tracks.get("discord")
    if discord_track:
        from .overlays import transcribe as _trd
        from .voicechat import attach_discord

        def discord_words(a, b):
            off = float(discord_track.get("offset", 0.0))
            s0 = max(0.0, a - off)
            return [{"start": s0 + off + w.start, "end": s0 + off + w.end, "text": w.text}
                    for w in _trd(discord_track["path"], s0, b - off)]
        attach_discord([c for th in clips for c in clips[th]], discord_words,
                       progress=lambda f: report(0.98, "Discord : ce que disent tes potes"))
    # « Cam en grand » : centrée sur le visage du streamer (ce qui bouge dans la webcam).
    from .camfocus import add_focus
    report(0.98, "Cadrage des clips webcam")
    focus_cache: dict = {}                         # un clip présent dans deux thèmes n'est regardé qu'une fois
    for th in clips:
        add_focus(video, clips[th], cam, focus_cache)
    if segments:
        for s in segments:
            if not s.get("game"):
                h = segment_at(hud_segs, (s["start"] + s["end"]) / 2)
                # Pas de catégorie Twitch : une scène de discussion garde son nom (« Just Chatting »), sinon le
                # bandeau de score dit si c'est Valorant.
                if s.get("type") in ("discussion", "pause") and s.get("scene"):
                    s["game_guess"] = s["scene"]
                else:
                    s["game_guess"] = (h or {}).get("game") or "Hors jeu"
    segs_out = segments or hud_segs
    stats = _stats(moments, deaths, rounds, duration, extra_stats or {})
    session = {
        "version": SESSION_VERSION, "title": title, "folder": folder, "video": os.path.abspath(video),
        "duration": round(duration, 2), "target": target, "themes": themes,
        "moments": [m.to_dict() for m in moments], "clips": clips, "deaths": deaths, "stats": stats,
        "spectated_kills": sum(e.spectating for e in events), "tracks": tracks, "cam_detected": cam,
        "chat": chat,                         # messages du chat (temps de la vidéo), pour les bulles
        "speech": speech,                     # quand le streamer parle : l'éditeur s'en sert pour ajuster les bords
        "segments": segs_out,                 # passages : jeu / catégorie, scène OBS, webcam
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

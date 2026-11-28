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

from .kill_detect import Scan, _probe, alive_checker, find_deaths, find_kills, refine_kills, scan_video, weak_kill_candidates
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


def target_for(target, theme: str, default: float = 60.0) -> float:
    """Durée visée pour un thème : un nombre (la même pour tous) ou {thème: secondes} (réglage par thème)."""
    if isinstance(target, dict):
        return float(target.get(theme) or default)
    return float(target if target is not None else default)


def _endgames(video: str, cache: str, duration: float, partial_scans) -> list[dict]:
    """Fins de partie : VICTOIRE / DÉFAITE et points de rang (« +16 RR »). Gardé en cache."""
    end_file = os.path.join(cache, "endgame.json")
    if os.path.exists(end_file):
        with open(end_file, encoding="utf-8") as f:
            return json.load(f)
    from .endgame import merge_endgames, scan_endgames
    try:
        # Analyse pendant le live : les morceaux déjà lus ont leurs fins de partie ; on ne lit que la suite
        # (en reprenant 3 min avant, l'écran du rang peut tomber juste après un morceau).
        parts = []
        for sp in partial_scans or []:
            try:
                with open(sp + ".endgame.json", encoding="utf-8") as f:
                    parts.append(json.load(f))
            except OSError:
                pass
        done_until = max([x["end"] for x in parts], default=0.0)
        first = [e for x in parts for e in x["found"]]
        rest = scan_endgames(video, start=max(0.0, done_until - 200.0)) if done_until < duration - 1 else []
        endgames = merge_endgames(first + rest)
    except Exception:
        endgames = []
    with open(end_file, "w", encoding="utf-8") as f:
        json.dump(endgames, f, ensure_ascii=False)
    return endgames


def _rescue_endgames(video: str, cache: str, hud, rounds, endgames: list[dict]) -> list[dict]:
    """Bannières VICTOIRE / DÉFAITE trop courtes pour la passe rapide : relues à chaque fin de partie. Gardé en cache."""
    rescue_file = os.path.join(cache, "endgame-rescue.json")
    try:
        if os.path.exists(rescue_file):
            with open(rescue_file, encoding="utf-8") as f:
                extra = json.load(f)
        else:
            from .endgame import last_scores, rescue_in_video
            extra = rescue_in_video(video, last_scores(hud.t, hud.scores, rounds), endgames)
            with open(rescue_file, "w", encoding="utf-8") as f:
                json.dump(extra, f, ensure_ascii=False)
    except Exception:
        return endgames
    from .endgame import merge_endgames
    return merge_endgames(endgames + extra)


def analyze_stream(video: str, root: str, title: str, themes: list[str] | None = None, target: float | dict = 30.0,
                   extra_moments: list[dict] | None = None, extra_stats: dict | None = None,
                   folder: str | None = None, day: str | None = None, scan: Scan | None = None,
                   hud: Hud | None = None, capture: dict | None = None, partial_scans: list[str] | None = None,
                   record_started_at: float | None = None, segments: list[dict] | None = None, progress=None,
                   chat: list[dict] | None = None, agents_dir: str | None = None,
                   known_tracks: dict | None = None) -> dict:
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
    # Fins de partie (VICTOIRE / DÉFAITE / RR) lues en parallèle des étapes suivantes : elles ne lisent que
    # quelques images et la lecture de texte, le processeur a de la place (gain ~2 min sur un live de 3 h).
    from concurrent.futures import ThreadPoolExecutor
    pool = ThreadPoolExecutor(max_workers=1)
    endgame_job = pool.submit(_endgames, video, cache, duration, partial_scans)

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
    # Réanalyse : les pistes déjà calées la première fois (session.json) sont reprises telles quelles.
    tracks = {k: v for k, v in (known_tracks or {}).items() if v and os.path.exists(v.get("path", ""))}
    if not tracks and capture and capture.get("info") and capture.get("record_started_at"):
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

    # 3 ter. Fins de partie : lancées en même temps que le score / la webcam / la voix (voir plus haut), attendues ici.
    report(0.958, "Recherche des victoires, défaites et RR")
    try:
        endgames = endgame_job.result()
    except Exception:
        endgames = []
    pool.shutdown(wait=False)

    report(0.96, "Choix des meilleurs moments")
    events = refine_kills(video, find_kills(scan))     # kills très rapprochés : relecture fine de l'emblème
    from .killfeed import confirm_kills
    try:                                                 # emblèmes pâles confirmés par le fil des kills
        events = sorted(events + confirm_kills(video, weak_kill_candidates(scan, events)), key=lambda e: e.t)
    except Exception:
        pass
    kill_times = [round(e.t, 2) for e in events if not e.spectating]
    deaths = [round(d, 2) for d in find_deaths(scan)]
    rounds = rounds_from_scores(hud.t, hud.scores)
    endgames = _rescue_endgames(video, cache, hud, rounds, endgames)
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
    for e in endgames:
        if 0 <= float(e["t"]) <= duration:
            moments.append(Moment(e["type"], float(e["t"]), None, e.get("meta", {})))
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
    if "youtube" not in themes and duration >= BESTOF_MIN_DURATION and len(moments) >= BESTOF_MIN_MOMENTS:
        themes = themes + ["youtube"]          # vidéo YouTube 8–15 min (Sky 28/11 : exportée toute seule elle aussi)
    if "youtube_partie" not in themes and "youtube" in themes and rounds:
        themes = themes + ["youtube_partie"]   # … et « une partie » racontée round par round (Sky 28/11)

    def theme_moments(th):
        # Thème lié à un type de scène (« Discussion ») : seulement les moments de ces passages.
        kind = THEMES[th].get("scene")
        return in_scene(moments, kind, segments, hud_segs) if kind else moments

    targets = {th: target_for(target, th) for th in themes}      # durée par thème (Kills 1 min, Best-of 5 min…)
    def pick(th):
        if THEMES[th].get("long"):                 # vidéo YouTube 8–15 min
            from .youtube import pick_theme
            return pick_theme(th, moments, rounds, deaths, segments, hud_segs, duration, speech)
        return select_clips(theme_moments(th), th, targets[th], stream_duration=duration, speech=speech)

    clips = {th: [c.to_dict() for c in pick(th)] for th in themes}
    # Chat écrit du jeu (alliés / ennemis) : lu maintenant pour tous les clips proposés, l'éditeur n'attend plus.
    game_chat = {"spans": [], "messages": []}
    chat_file = os.path.join(cache, "gamechat.json")
    try:
        from .gamechat import chat_for_clips
        cached = None
        if os.path.exists(chat_file):
            with open(chat_file, encoding="utf-8") as f:
                cached = json.load(f)
        in_game = [c for th in clips for c in clips[th]]       # hors jeu : rien à lire, vite passé
        report(0.966, "Lecture du chat du jeu")
        game_chat = chat_for_clips(video, in_game, cached, progress=lambda f: report(0.966 + 0.004 * f, "Lecture du chat du jeu"))
        with open(chat_file, "w", encoding="utf-8") as f:
            json.dump(game_chat, f, ensure_ascii=False)
    except Exception:
        pass                                   # sans lecture de texte (autre Windows) : l'éditeur fera sans
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
        "duration": round(duration, 2), "target": max(targets.values()), "targets": targets, "themes": themes,
        "moments": [m.to_dict() for m in moments], "clips": clips, "deaths": deaths, "stats": stats,
        "spectated_kills": sum(e.spectating for e in events), "tracks": tracks, "cam_detected": cam,
        "chat": chat,                         # messages du chat (temps de la vidéo), pour les bulles
        "game_chat": game_chat,               # chat écrit du jeu déjà lu : {spans (passages lus), messages}
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


def retarget(folder: str, theme: str, target: float, progress=None) -> dict:
    """Refait les clips d'un thème pour une autre durée (menu « Durée » de l'éditeur, Sky 26/11 : 30 s, 1 min,
    3 min, 5 min), sans relancer l'analyse : mêmes moments, mise en page par passage, chat du jeu (seuls les
    passages pas encore lus), cadrage « Cam en grand ». Les bulles du chat lu à voix haute et les répliques des
    coéquipiers déjà trouvées sont reprises quand elles tombent dans un nouveau clip. Renvoie la session à jour."""
    report = progress or (lambda f, m: None)
    with open(os.path.join(folder, "session.json"), encoding="utf-8") as f:
        session = json.load(f)
    if theme not in THEMES:
        raise ValueError(f"Thème inconnu : {theme}")
    cache = os.path.join(folder, ".sklip")
    video, duration = session["video"], float(session["duration"])
    moments = [Moment(m["type"], float(m["t"]), m.get("score"), m.get("meta", {})) for m in session.get("moments", [])]
    from .segments import assign_layouts, hud_segments, in_scene
    hud_segs, rounds = [], []
    hud_file = os.path.join(cache, "hud.npz")
    if os.path.exists(hud_file):
        hud = Hud.load(hud_file)
        hud_segs = hud_segments(hud.t, hud.score_left, duration)
        rounds = rounds_from_scores(hud.t, hud.scores)
    segs = session.get("segments") or []
    segments = segs if segs and any(sg.get("source") != "hud" for sg in segs) else None   # scènes OBS connues
    kind = THEMES[theme].get("scene")
    hud_segs = hud_segs or [sg for sg in segs if sg.get("source") == "hud"]
    pool = in_scene(moments, kind, segments, hud_segs) if kind else moments
    speech = [tuple(s) for s in session.get("speech") or []]
    report(0.1, "Choix des clips")
    if THEMES[theme].get("long"):
        from .youtube import pick_theme
        chosen = pick_theme(theme, moments, rounds, session.get("deaths") or [], segments, hud_segs, duration, speech)
    else:
        chosen = select_clips(pool, theme, float(target), stream_duration=duration, speech=speech)
    clips = [c.to_dict() for c in chosen]
    assign_layouts(clips, segments, hud_segs, session.get("cam_detected"))
    # Bulles et répliques déjà trouvées (tous thèmes) : reprises si elles tombent dans un nouveau clip.
    old = [c for th in session.get("clips", {}) for c in session["clips"][th]]
    for c in clips:
        for field, at in (("chat", "start"), ("voices", "start")):
            seen, items = set(), []
            for o in old:
                for it in o.get(field) or []:
                    k = (round(float(it.get(at, 0)), 2), it.get("text"))
                    if c["start"] <= float(it.get(at, -1)) < c["end"] and k not in seen:
                        seen.add(k)
                        items.append({**it, "end": min(float(it.get("end", it[at])), c["end"])} if "end" in it else dict(it))
            if items:
                c[field] = sorted(items, key=lambda x: x[at])
    report(0.3, "Lecture du chat du jeu")
    try:
        from .gamechat import chat_for_clips
        session["game_chat"] = chat_for_clips(video, clips, session.get("game_chat"),
                                              progress=lambda f: report(0.3 + 0.5 * f, "Lecture du chat du jeu"))
        with open(os.path.join(cache, "gamechat.json"), "w", encoding="utf-8") as f:
            json.dump(session["game_chat"], f, ensure_ascii=False)
    except Exception:
        pass
    report(0.85, "Cadrage des clips webcam")
    try:
        from .camfocus import add_focus
        add_focus(video, clips, session.get("cam_detected"), {})
    except Exception:
        pass
    session["clips"][theme] = clips
    if theme not in session.get("themes", []):          # ex. vidéo YouTube demandée sur un live déjà analysé
        session["themes"] = [*session.get("themes", []), theme]
    session["targets"] = {**(session.get("targets") or {}), theme: float(target)}
    session["target"] = max(v for k, v in session["targets"].items() if not THEMES.get(k, {}).get("long"))
    with open(os.path.join(folder, "session.json"), "w", encoding="utf-8") as f:
        json.dump(session, f, ensure_ascii=False, indent=1)
    report(1.0, "Terminé")
    return session

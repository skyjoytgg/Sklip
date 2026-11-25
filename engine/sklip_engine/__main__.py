"""Point d'entrée du moteur, appelé par l'appli Electron.

Usage : python -m sklip_engine <commande>   (paramètres JSON sur l'entrée standard)
Sortie : une ligne JSON par message — {"type": "progress"|"result"|"error", ...}
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path

from . import __version__
from .moments import Moment, THEMES
from .selection import select_clips
from .audio_sync import sync_track
from .beat import detect_bpm_file
from .render import MontageSpec, RenderClip, Rect, TrackFile, render_montage, detect_encoder
from .stream_folder import create_stream_folder, write_stats_html


def emit(kind: str, **data):
    sys.stdout.write(json.dumps({"type": kind, **data}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def cmd_select(p):
    moments = [Moment(m["type"], m["t"], m.get("score"), m.get("meta", {})) for m in p["moments"]]
    clips = select_clips(moments, p["theme"], p.get("target", 30), p.get("bpm"), p.get("stream_duration"),
                         p.get("speech"))
    return {"clips": [c.to_dict() for c in clips]}


def cmd_render(p):
    spec = MontageSpec(
        video=p["video"], output=p["output"], fmt=p.get("fmt", "9x16"),
        clips=[RenderClip(c["start"], c["end"], c.get("layout", "cam_top"), c.get("volumes", {}),
                          c.get("moments", []), c.get("words"), c.get("friend"),
                          Rect(*(float(c["cam"][k]) for k in "xywh")) if c.get("cam") else None,
                          (float(c["focus"]["x"]), float(c["focus"]["y"])) if c.get("focus") else None)
               for c in p["clips"]],
        cam=Rect(*(float(p["cam"][k]) for k in "xywh")) if p.get("cam") and p["cam"].get("enabled", True) else None,
        tracks={k: TrackFile(v["path"], v.get("offset", 0.0)) for k, v in p.get("tracks", {}).items()},
        volumes={**MontageSpec.__dataclass_fields__["volumes"].default_factory(), **p.get("volumes", {})},
        texts=p.get("texts") or {}, subtitles=bool(p.get("subtitles")), auto_mix=p.get("auto_mix", True),
        music_file=p.get("music_file"), music_start=p.get("music_start", 0.0),
        music_volume=p.get("music_volume", 0.8), encoder=p.get("encoder"),
    )
    out = render_montage(spec, progress=lambda f, msg: emit("progress", fraction=round(f, 3), message=msg))
    if p.get("post"):
        # Fiche de publication à côté de la vidéo : prête pour une future publication automatique.
        with open(Path(out).with_suffix(".json"), "w", encoding="utf-8") as f:
            json.dump({"video": str(Path(out).resolve()), **p["post"], "published": {}}, f, ensure_ascii=False, indent=1)
    return {"output": out}


def cmd_transcribe(p):
    """Sous-titres des clips, pour les afficher et les corriger dans l'éditeur.
    Renvoie les mots en temps du stream : {"clips": {id: [{"start", "end", "text"}]}}."""
    from .overlays import transcribe
    mic = (p.get("tracks") or {}).get("mic")
    out = {}
    clips = p["clips"]
    for i, c in enumerate(clips):
        emit("progress", fraction=round(i / len(clips), 3), message=f"Sous-titres : clip {i + 1}/{len(clips)}")
        if mic:   # piste micro séparée : bien meilleure reconnaissance
            off = float(mic.get("offset", 0.0))
            start = max(0.0, c["start"] - off)
            words = transcribe(mic["path"], start, c["end"] - off)
            base = start + off
        else:
            words = transcribe(p["video"], c["start"], c["end"])
            base = c["start"]
        out[str(c["id"])] = [{"start": round(base + w.start, 3), "end": round(base + w.end, 3), "text": w.text}
                             for w in words]
    emit("progress", fraction=1.0, message="Sous-titres prêts")
    return {"clips": out}


def cmd_friend_extract(p):
    """Côté pote : sa webcam sur les secondes demandées (jamais toute la VOD)."""
    from .friends import extract_reaction
    return extract_reaction(p["video"], float(p["start"]), float(p["duration"]), p["out"], p.get("cam"))


def cmd_friend_sync(p):
    """Côté streamer : cale l'extrait du pote sur la piste Discord (ou le son de la vidéo)."""
    from .friends import sync_reaction
    return sync_reaction(p["extract"], p["reference"], float(p["guess"]), float(p.get("ref_offset", 0.0)))


def cmd_detect_kills(p):
    """Kills du streamer à l'image. Les kills des coéquipiers regardés après la mort sont écartés."""
    from .kill_detect import scan_video, find_kills, find_deaths, alive_checker, Scan
    if p.get("scan_file") and Path(p["scan_file"]).exists():
        scan = Scan.load(p["scan_file"])
    else:
        scan = scan_video(p["video"], fps=p.get("fps", 4.0), start=p.get("start", 0.0), duration=p.get("duration"),
                          workers=p.get("workers", 1),
                          progress=lambda f, msg: emit("progress", fraction=round(f, 3), message=msg))
        if p.get("scan_file"):
            scan.save(p["scan_file"])
    from .rounds import Hud, read_hud, rounds_from_scores, group_kills, find_clutches
    events = find_kills(scan)
    kill_times = [round(e.t, 2) for e in events if not e.spectating]
    rounds, clutches = [], []
    if p.get("rounds", True) and p.get("video"):
        if p.get("hud_file") and Path(p["hud_file"]).exists():
            hud = Hud.load(p["hud_file"])
        else:
            emit("progress", fraction=1.0, message="Lecture du score et des joueurs en vie")
            hud = read_hud(p["video"])
            if p.get("hud_file"):
                hud.save(p["hud_file"])
        rounds = rounds_from_scores(hud.t, hud.scores)
        clutches = find_clutches(hud, rounds, kill_times, alive_checker(scan))
    moments = sorted(group_kills(kill_times, rounds) + clutches, key=lambda m: m.t)
    return {"moments": [m.to_dict() for m in moments],
            "spectated_kills": sum(e.spectating for e in events),
            "deaths": [round(d, 2) for d in find_deaths(scan)],
            "rounds": len(rounds), "games": len({r.game for r in rounds})}


def cmd_analyze(p):
    """Analyse complète d'un stream et préparation de son dossier (voir analyze.py)."""
    from .analyze import analyze_stream
    return analyze_stream(p["video"], p["root"], p.get("title") or Path(p["video"]).stem, p.get("themes"),
                          p.get("target", 30.0), p.get("extra_moments"), p.get("extra_stats"), p.get("folder"),
                          p.get("day"), capture=p.get("capture"), record_started_at=p.get("record_started_at"),
                          partial_scans=p.get("partial_scans"), segments=p.get("segments"), progress=lambda f, msg: emit("progress", fraction=round(f, 3), message=msg))


def cmd_scan_chunk(p):
    """Analyse pendant le live : mesure un morceau de l'enregistrement en cours et le garde dans `out`."""
    from .kill_detect import scan_video
    scan = scan_video(p["video"], start=p["start"], duration=p["duration"])
    scan.save(p["out"])
    return {"out": p["out"], "end": round(scan.end, 3), "frames": len(scan.t)}


def cmd_capture(p):
    """Capture des pistes audio jusqu'à l'apparition du fichier « stop » dans le dossier."""
    from .audio_capture import DEFAULT_TRACKS, capture
    tracks = {k: dict(v) for k, v in DEFAULT_TRACKS.items()}
    if p.get("game_exe"):
        tracks["game"] = {"exe": p["game_exe"] if isinstance(p["game_exe"], list) else [p["game_exe"]]}
    if p.get("music_exe"):
        tracks["music"] = {"exe": p["music_exe"] if isinstance(p["music_exe"], list) else [p["music_exe"]]}
    for name in p.get("disabled", []):
        tracks.pop(name, None)
    return capture(p["folder"], tracks, p.get("max_seconds"),
                   progress=lambda f, msg: emit("progress", fraction=f, message=msg))


def cmd_benchmark(p):
    from .benchmark import run_benchmark
    return run_benchmark(p.get("seconds", 15.0),
                         progress=lambda f, msg: emit("progress", fraction=round(f, 3), message=msg))


def cmd_focus(p):
    """Éditeur : le streamer passe un clip en « Cam en grand » → où est son visage dans la webcam ?"""
    from .camfocus import clip_focus
    return {"focus": clip_focus(p["video"], p["cam"], float(p["start"]), float(p["end"]))}


def cmd_thumb(p):
    """Miniature d'un live (une image de la vidéo, 320 px de large). La vidéo est seulement lue."""
    import subprocess
    out = p["out"]
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{float(p.get('t', 0)):.2f}", "-i", p["video"],
                        "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "4", out],
                       capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out):
        raise RuntimeError(f"Miniature impossible : {r.stderr.strip()[-200:]}")
    return {"out": out}


def cmd_stream_folder(p):
    folder = create_stream_folder(p["root"], p["title"])
    write_stats_html(folder["path"], p["title"], p.get("stats", {}), p.get("moments", []))
    return folder


COMMANDS = {
    "version": lambda p: {"version": __version__},
    "themes": lambda p: {"themes": THEMES},
    "encoder": lambda p: {"encoder": detect_encoder()},
    "select": cmd_select,
    "render": cmd_render,
    "sync": lambda p: sync_track(p["video"], p["track"]),
    "bpm": lambda p: detect_bpm_file(p["path"]),
    "stream-folder": cmd_stream_folder,
    "detect-kills": cmd_detect_kills,
    "transcribe": cmd_transcribe,
    "friend-extract": cmd_friend_extract,
    "friend-sync": cmd_friend_sync,
    "benchmark": cmd_benchmark,
    "analyze": cmd_analyze,
    "capture": cmd_capture,
    "scan-chunk": cmd_scan_chunk,
    "thumb": cmd_thumb,
    "focus": cmd_focus,
}


def main(argv=None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    if not argv or argv[0] not in COMMANDS:
        emit("error", message=f"Commande inconnue. Disponibles : {', '.join(COMMANDS)}")
        return 2
    try:
        raw = sys.stdin.read() if not sys.stdin.isatty() else ""
        raw = raw.lstrip("﻿")    # PowerShell ajoute parfois un BOM en tête
        params = json.loads(raw) if raw.strip() else {}
        emit("result", data=COMMANDS[argv[0]](params))
        return 0
    except Exception as e:  # remonté proprement à l'interface
        emit("error", message=str(e), detail=traceback.format_exc())
        return 1


if __name__ == "__main__":
    sys.exit(main())

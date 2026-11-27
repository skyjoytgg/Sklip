"""Musiques libres de droits ajoutées aux montages (pack fourni avec Sklip + dossier « Mes musiques »).

Ici : la lecture des fichiers (durée, titre, artiste). Le choix des morceaux selon la durée du montage est fait par
l'appli (editor-model.js, planMusic) ; l'enchaînement avec fondu est fait à l'export (render.music_inputs).
"""
from __future__ import annotations

import json
import os
import subprocess

AUDIO_EXT = (".mp3", ".ogg", ".wav", ".flac", ".m4a", ".opus")


def probe_track(path: str) -> dict | None:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:format_tags=title,artist",
                        "-of", "json", path], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    try:
        fmt = json.loads(r.stdout).get("format", {})
        dur = float(fmt["duration"])
    except (ValueError, KeyError, TypeError):
        return None
    tags = {k.lower(): v for k, v in (fmt.get("tags") or {}).items()}
    return {"duration": round(dur, 2), "title": tags.get("title"), "artist": tags.get("artist")}


def scan(files: list[str], cache: str | None = None) -> list[dict]:
    """[{file, duration, title, artist}] pour les fichiers audio lisibles. `cache` : fichier JSON (chemin + date)."""
    known = {}
    if cache and os.path.exists(cache):
        try:
            with open(cache, encoding="utf-8") as f:
                known = json.load(f)
        except (OSError, ValueError):
            known = {}
    out, fresh = [], {}
    for path in files:
        if not path.lower().endswith(AUDIO_EXT) or not os.path.isfile(path):
            continue
        key = f"{os.path.abspath(path)}|{os.path.getmtime(path):.0f}|{os.path.getsize(path)}"
        info = known.get(key) or probe_track(path)
        if not info or info["duration"] < 5:
            continue
        fresh[key] = info
        out.append({"file": path, **info})
    if cache:
        try:
            with open(cache, "w", encoding="utf-8") as f:
                json.dump(fresh, f, ensure_ascii=False)
        except OSError:
            pass
    return out

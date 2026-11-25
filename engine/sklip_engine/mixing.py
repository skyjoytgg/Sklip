"""Mixage automatique : des pistes au bon niveau les unes par rapport aux autres.

1. Chaque piste est ramenée à un niveau cible (mesuré seulement quand elle fait du bruit) :
   la voix devant, Discord juste derrière, le jeu en dessous, la musique bien en dessous.
   Le curseur du streamer (100 % = niveau cible) s'applique ensuite.
2. Quand le streamer parle, la musique baisse fortement et le jeu un peu (« ducking »).
3. Le montage final est mis au volume conseillé par TikTok / YouTube (-14 LUFS, crêtes à -1,5 dB).
"""
from __future__ import annotations

import json
import math
import re
import subprocess

import numpy as np

# Niveau visé par piste, en dB (moyenne des passages où la piste fait du bruit).
TARGET_DB = {"mic": -18.0, "discord": -20.0, "game": -24.0, "music": -29.0}
SILENCE_DB = -55.0           # en dessous : on considère que la piste se tait
GAIN_MIN_DB, GAIN_MAX_DB = -24.0, 20.0
BLOCK = 0.4                  # s, comme la mesure de loudness des plateformes

# Baisse de la musique / du jeu quand la voix est là (filtre sidechaincompress de FFmpeg).
DUCK = {
    "music": "threshold=0.015:ratio=10:attack=15:release=400",   # la musique s'efface sous la voix
    "game": "threshold=0.03:ratio=3:attack=20:release=300",      # le jeu baisse un peu
}

LOUDNESS = {"I": -14.0, "TP": -1.5, "LRA": 11.0}


def active_level_db(x: np.ndarray, rate: int) -> float | None:
    """Niveau moyen (dB) des blocs où il y a du son, ou None si la piste se tait."""
    n = int(BLOCK * rate)
    if len(x) < n:
        return None
    blocks = x[: len(x) // n * n].reshape(-1, n).astype(np.float64)
    power = (blocks ** 2).mean(axis=1)
    db = 10 * np.log10(power + 1e-12)
    loud = power[db > SILENCE_DB]
    if loud.size == 0:
        return None
    return float(10 * math.log10(loud.mean()))


def auto_gain(track: str, level_db: float | None) -> float:
    """Gain (linéaire) pour amener la piste à son niveau cible."""
    if level_db is None or track not in TARGET_DB:
        return 1.0
    g = min(GAIN_MAX_DB, max(GAIN_MIN_DB, TARGET_DB[track] - level_db))
    return round(10 ** (g / 20), 4)


def measure_track(path: str, start: float, duration: float) -> float | None:
    from .audio_sync import load_audio
    try:
        x = load_audio(path, rate=16000, start=max(0.0, start), duration=duration)
    except subprocess.CalledProcessError:
        return None
    return active_level_db(x, 16000)


def ducking_graph(labels: dict[str, str], key: str | None) -> tuple[list[str], dict[str, str]]:
    """Filtres qui baissent musique/jeu sous la voix. `labels` : piste → étiquette FFmpeg.
    Renvoie (filtres à ajouter, nouvelles étiquettes)."""
    targets = [n for n in DUCK if n in labels and key and n != key]
    if not key or key not in labels or not targets:
        return [], labels
    out = dict(labels)
    keys = [f"[key{i}]" for i in range(len(targets))]
    parts = [f"{labels[key]}asplit={len(targets) + 1}[voice]{''.join(keys)}"]
    out[key] = "[voice]"
    for k, n in zip(keys, targets):
        parts.append(f"{labels[n]}{k}sidechaincompress={DUCK[n]}[{n}_d]")
        out[n] = f"[{n}_d]"
    return parts, out


def _loudnorm_measure(path: str) -> dict | None:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-vn", "-af",
                        f"loudnorm=I={LOUDNESS['I']}:TP={LOUDNESS['TP']}:LRA={LOUDNESS['LRA']}:print_format=json",
                        "-f", "null", "-"], capture_output=True, text=True)
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr)
    return json.loads(m.group(0)) if m else None


def normalize_loudness(src: str, dst: str) -> dict | None:
    """Volume final du montage (deux passes de loudnorm, la vidéo est recopiée telle quelle)."""
    m = _loudnorm_measure(src)
    if not m or m.get("input_i") in (None, "-inf") or float(m["input_i"]) < -70:
        return None   # montage silencieux : rien à faire
    af = (f"loudnorm=I={LOUDNESS['I']}:TP={LOUDNESS['TP']}:LRA={LOUDNESS['LRA']}"
          f":measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
          f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,aresample=48000")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-map", "0:v", "-map", "0:a", "-c:v", "copy", "-af", af,
                    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", dst],
                   check=True, capture_output=True)
    return m

"""Synchronisation des pistes audio capturées par Sklip avec la vidéo OBS.

Sklip ne touche pas aux pistes OBS : il enregistre lui-même Jeu / Micro / Discord / Musique.
Pour les caler sur la vidéo, on cherche le décalage qui maximise la corrélation entre
la piste capturée (ex. le son du jeu) et le son mixé de l'enregistrement OBS, qui la contient.
"""
from __future__ import annotations

import subprocess

import numpy as np
from scipy.signal import fftconvolve

SYNC_RATE = 4000  # Hz : suffisant pour se caler à ~0,25 ms près, et rapide.


def load_audio(path: str, rate: int = SYNC_RATE, start: float = 0.0, duration: float | None = None,
               stream_index: int = 0) -> np.ndarray:
    """Décode une piste audio en mono float32 via FFmpeg."""
    cmd = ["ffmpeg", "-v", "error", "-ss", str(start)]
    if duration:
        cmd += ["-t", str(duration)]
    cmd += ["-i", path, "-map", f"0:a:{stream_index}", "-ac", "1", "-ar", str(rate), "-f", "f32le", "-"]
    out = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32).copy()


def _normalize(x: np.ndarray) -> np.ndarray:
    x = x - x.mean()
    n = np.linalg.norm(x)
    return x / n if n > 0 else x


def find_offset(reference: np.ndarray, track: np.ndarray, rate: int = SYNC_RATE,
                max_offset: float = 120.0) -> tuple[float, float]:
    """Retourne (décalage en secondes, confiance 0..1).

    Décalage > 0 : la piste a commencé APRÈS la vidéo (le son de la piste à t=0
    correspond à la vidéo à t=décalage).
    """
    ref = _normalize(reference.astype(np.float64))
    trk = _normalize(track.astype(np.float64))
    corr = fftconvolve(ref, trk[::-1], mode="full")
    lags = np.arange(-len(trk) + 1, len(ref))
    max_lag = int(max_offset * rate)
    keep = np.abs(lags) <= max_lag
    corr, lags = corr[keep], lags[keep]
    i = int(np.argmax(corr))
    peak = corr[i]
    # Confiance : pic par rapport au bruit de corrélation.
    noise = np.median(np.abs(corr)) + 1e-12
    confidence = float(min(1.0, (peak / noise) / 50.0))
    return lags[i] / rate, confidence


def sync_track(video_path: str, track_path: str, probe_start: float = 60.0, probe_len: float = 60.0,
               max_offset: float = 120.0) -> dict:
    """Calcule le décalage d'une piste Sklip par rapport à l'enregistrement OBS.

    On compare un extrait de la vidéo (après le début, pour éviter le silence d'intro)
    à un extrait plus large de la piste.
    """
    ref = load_audio(video_path, start=probe_start, duration=probe_len)
    trk_start = max(0.0, probe_start - max_offset)
    trk = load_audio(track_path, start=trk_start, duration=probe_len + 2 * max_offset)
    lag, conf = find_offset(ref, trk, max_offset=probe_len + 2 * max_offset)
    # ref[i] ≈ trk[i - lag]  →  vidéo(probe_start + i/r) = piste(trk_start + i/r - lag)
    offset = probe_start - (trk_start - lag)
    return {"offset": round(float(offset), 4), "confidence": round(conf, 3)}

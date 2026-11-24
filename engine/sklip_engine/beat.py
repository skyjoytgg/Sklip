"""Détection de BPM et grille rythmique.

Deux usages (cahier des charges) :
1. musique de la bibliothèque du streamer → on détecte BPM + premier temps, on coupe sur les beats ;
2. sans musique, BPM choisi → grille fixe, première coupe sur le temps 1.
"""
from __future__ import annotations

import numpy as np
from scipy.signal import stft

from .audio_sync import load_audio

BEAT_RATE = 11025


def onset_envelope(audio: np.ndarray, rate: int = BEAT_RATE, hop: int = 256) -> tuple[np.ndarray, float]:
    """Flux spectral (montées d'énergie) : pics aux attaques des notes / percussions."""
    _, _, z = stft(audio, fs=rate, nperseg=1024, noverlap=1024 - hop, boundary=None)
    mag = np.log1p(np.abs(z) * 100)
    flux = np.maximum(0.0, np.diff(mag, axis=1)).sum(axis=0)
    flux = flux - np.convolve(flux, np.ones(16) / 16, mode="same")  # retire la tendance
    flux = np.maximum(flux, 0.0)
    return flux, rate / hop  # enveloppe, images/s


def estimate_bpm(audio: np.ndarray, rate: int = BEAT_RATE, bpm_min: float = 70, bpm_max: float = 180) -> dict:
    env, fps = onset_envelope(audio, rate)
    env = env - env.mean()
    ac = np.correlate(env, env, mode="full")[len(env) - 1:]
    lag_min = int(fps * 60 / bpm_max)
    lag_max = int(fps * 60 / bpm_min)
    lags = np.arange(lag_min, min(lag_max, len(ac) - 1) + 1)
    # Favorise légèrement les tempos autour de 120 (évite de choisir le double/la moitié).
    weights = np.exp(-0.5 * (np.log2((60 * fps / lags) / 120.0) / 0.9) ** 2)
    best = lags[int(np.argmax(ac[lags] * weights))]
    # Affinage parabolique pour une précision sous l'image.
    y0, y1, y2 = ac[best - 1], ac[best], ac[best + 1]
    denom = y0 - 2 * y1 + y2
    frac = 0.5 * (y0 - y2) / denom if denom != 0 else 0.0
    period = best + frac
    bpm = 60.0 * fps / period

    # Phase : décalage qui aligne le mieux une grille de ce tempo sur les attaques.
    period_frames = period
    phases = np.linspace(0, period_frames, 64, endpoint=False)
    idx = np.arange(len(env))
    scores = []
    for ph in phases:
        grid = np.arange(ph, len(env), period_frames).astype(int)
        scores.append(env[grid[grid < len(env)]].sum())
    # Le flux réagit dès que l'attaque entre dans la fenêtre STFT (1024 échantillons) :
    # on compense ce retard d'analyse.
    first_beat = (phases[int(np.argmax(scores))] / fps + 1024 / rate) % (period / fps)
    del idx
    return {"bpm": round(float(bpm), 2), "first_beat": round(float(first_beat), 3)}


def detect_bpm_file(path: str, max_seconds: float = 90.0) -> dict:
    audio = load_audio(path, rate=BEAT_RATE, duration=max_seconds)
    return estimate_bpm(audio, BEAT_RATE)


def beat_grid(bpm: float, duration: float, first_beat: float = 0.0) -> list[float]:
    """Instants des temps entre 0 et `duration`."""
    step = 60.0 / bpm
    t0 = first_beat % step
    return [round(t0 + i * step, 4) for i in range(int((duration - t0) / step) + 1)]


def metronome_wav(bpm: float, duration: float, rate: int = 44100) -> np.ndarray:
    """Clics de métronome (aperçu dans Sklip), temps 1 accentué toutes les 4 mesures."""
    out = np.zeros(int(duration * rate), dtype=np.float32)
    click_len = int(0.03 * rate)
    t = np.arange(click_len) / rate
    for i, b in enumerate(beat_grid(bpm, duration)):
        f = 1500.0 if i % 4 == 0 else 1000.0
        click = (np.sin(2 * np.pi * f * t) * np.exp(-t * 120)).astype(np.float32)
        s = int(b * rate)
        out[s:s + click_len] += click[: max(0, min(click_len, len(out) - s))]
    return out

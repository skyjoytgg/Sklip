"""Réactions des amis de confiance.

Côté pote : son Sklip découpe SEULEMENT sa webcam, sur les quelques secondes demandées, dans son
enregistrement OBS (lu, jamais modifié). Le son de l'extrait sert uniquement à le caler.
Côté streamer : l'extrait est calé à la fraction de seconde sur la piste Discord (où l'on entend le pote),
puis incrusté au montage (incrustation dans un coin, ou plan de coupe plein écran).
"""
from __future__ import annotations

import os
import subprocess

from .audio_sync import SYNC_RATE, find_offset, load_audio

EXTRACT_HEIGHT = 480          # assez pour une incrustation ou un plan de coupe court, léger à envoyer
MIN_CONFIDENCE = 0.25         # en dessous : on garde le calage par l'horloge


def _even(v: float) -> int:
    return max(2, int(round(v / 2)) * 2)


def extract_reaction(video: str, start: float, duration: float, out: str, cam: dict | None = None) -> dict:
    """Découpe la webcam (ou toute l'image si pas de webcam réglée) de `video` entre start et start+duration."""
    from .render import probe
    src = probe(video)
    start = max(0.0, start)
    duration = max(0.5, min(duration, src["duration"] - start))
    if cam and cam.get("enabled", True) and cam.get("w") and cam.get("h"):
        w, h = src["width"], src["height"]
        crop = f"crop={_even(cam['w'] * w)}:{_even(cam['h'] * h)}:{_even(cam['x'] * w)}:{_even(cam['y'] * h)},"
    else:
        crop = ""
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    tmp = out + ".part.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", video,
                    "-map", "0:v:0", "-map", "0:a:0?", "-vf", f"{crop}scale=-2:{EXTRACT_HEIGHT},fps=30,setsar=1",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", "900k", "-bufsize", "1800k",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "96k", "-ac", "1", "-movflags", "+faststart", tmp],
                   check=True, capture_output=True)
    os.replace(tmp, out)
    return {"out": out, "duration": round(duration, 3), "size": os.path.getsize(out)}


def sync_reaction(extract: str, reference: str, guess: float, ref_offset: float = 0.0,
                  margin: float = 10.0) -> dict:
    """Calage de l'extrait du pote sur le stream.

    `guess` : décalage donné par les horloges des deux PC (extrait(u) = stream(u + guess)).
    `reference` : piste Discord du streamer (ou sa vidéo), avec stream(T) = référence(T - ref_offset).
    Renvoie {"offset", "confidence", "method"} avec extrait(u) = stream(u + offset).
    """
    trk = load_audio(extract)
    dur = len(trk) / SYNC_RATE
    if dur < 1:
        return {"offset": round(guess, 3), "confidence": 0.0, "method": "horloge"}
    t0 = guess - margin                              # fenêtre du stream autour de l'extrait
    ref_start = t0 - ref_offset
    pad = max(0.0, -ref_start)
    try:
        ref = load_audio(reference, start=max(0.0, ref_start), duration=dur + 2 * margin - pad)
    except subprocess.CalledProcessError:
        return {"offset": round(guess, 3), "confidence": 0.0, "method": "horloge"}
    if pad:
        import numpy as np
        ref = np.concatenate([np.zeros(int(pad * SYNC_RATE), np.float32), ref])
    lag, conf = find_offset(ref, trk, max_offset=dur + 2 * margin)
    # ref[i] ≈ trk[i - lag] : stream(t0 + i/r) = extrait((i - lag)/r)  →  offset = t0 + lag
    offset = t0 + lag
    if conf < MIN_CONFIDENCE or abs(offset - guess) > margin:
        return {"offset": round(guess, 3), "confidence": round(conf, 3), "method": "horloge"}
    return {"offset": round(float(offset), 3), "confidence": round(conf, 3), "method": "son"}

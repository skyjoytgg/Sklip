"""Test du PC : mesure la vitesse d'analyse de Sklip sur une vidéo de test fabriquée à la volée.

Sert à conseiller le streamer : analyser pendant le live (PC assez puissant) ou après le live.
La vidéo de test (1080p60, avec du bruit pour qu'elle soit aussi lourde à décoder qu'un vrai
enregistrement) est créée dans un dossier temporaire puis supprimée.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time

from .kill_detect import scan_video
from .render import detect_encoder


def make_test_video(path: str, seconds: float = 15.0) -> None:
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi",
           "-i", f"testsrc2=size=1920x1080:rate=60:duration={seconds}",
           "-vf", "noise=alls=20:allf=t", "-c:v", "libx264", "-preset", "ultrafast",
           "-b:v", "8M", "-g", "120", "-pix_fmt", "yuv420p", path]
    subprocess.run(cmd, check=True, capture_output=True,
                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def run_benchmark(seconds: float = 15.0, progress=None) -> dict:
    """Renvoie la vitesse d'analyse (en « fois le temps réel ») avec un seul processus d'analyse,
    c'est-à-dire ce que Sklip utiliserait pendant un live."""
    report = progress or (lambda f, m: None)
    tmp = tempfile.mkdtemp(prefix="sklip-test-")
    try:
        video = os.path.join(tmp, "test.mp4")
        report(0.05, "Préparation de la vidéo de test")
        make_test_video(video, seconds)
        report(0.35, "Mesure de la vitesse d'analyse")
        t0 = time.perf_counter()
        scan_video(video, fps=4.0, workers=1, segment=seconds + 1)
        elapsed = time.perf_counter() - t0
        report(0.85, "Recherche de l'encodeur vidéo de la carte graphique")
        encoder = detect_encoder()
        report(1.0, "Terminé")
        return {"speed": round(seconds / max(elapsed, 1e-3), 2), "video_seconds": seconds,
                "scan_seconds": round(elapsed, 2), "encoder": encoder}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

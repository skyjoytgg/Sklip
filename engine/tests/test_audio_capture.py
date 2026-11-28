import os
import subprocess
import sys

import numpy as np
import pytest

from sklip_engine.audio_capture import root_pid, tracks_for_video
from sklip_engine.audio_sync import load_audio

win = pytest.mark.skipif(sys.platform != "win32", reason="Capture Windows uniquement")


def test_processus_racine():
    procs = [(10, 1, "Discord.exe"), (11, 10, "Discord.exe"), (12, 10, "Discord.exe"), (20, 1, "explorer.exe")]
    assert root_pid(["discord.exe"], procs) == 10
    assert root_pid(["Spotify.exe"], procs) is None


def test_decalage_des_pistes(tmp_path):
    for n in ("game", "mic"):
        (tmp_path / f"{n}.ogg").write_bytes(b"x")
    info = {"started_at": 1000.75, "tracks": {
        "game": {"path": str(tmp_path / "game.ogg"), "source": "VALORANT (pid 1)"},
        "mic": {"path": str(tmp_path / "mic.ogg"), "source": "micro"},
        "music": {"path": str(tmp_path / "music.ogg"), "source": None}}}      # Spotify jamais ouvert
    t = tracks_for_video(info, 1000.0)
    assert t == {"game": {"path": str(tmp_path / "game.ogg"), "offset": 0.75},
                 "mic": {"path": str(tmp_path / "mic.ogg"), "offset": 0.75}}
    # Le calage sur le son du jeu affine le décalage (s'il est fiable et proche de l'horloge).
    good = tracks_for_video(info, 1000.0, "v.mkv", sync=lambda v, p: {"offset": 0.81, "confidence": 0.9})
    assert good["mic"]["offset"] == 0.81
    bad = tracks_for_video(info, 1000.0, "v.mkv", sync=lambda v, p: {"offset": 30.0, "confidence": 0.9})
    assert bad["mic"]["offset"] == 0.75


@win
@pytest.mark.skipif(bool(os.environ.get("GITHUB_ACTIONS")), reason="Pas de carte son sur les serveurs de GitHub")
def test_capture_d_un_seul_logiciel(tmp_path):
    """Un processus joue un son de 1000 Hz : sa piste l'entend, la piste d'un autre processus reste muette."""
    from sklip_engine.audio_capture import capture
    tone = tmp_path / "tone.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=1000:d=4", "-ac", "2", "-ar", "48000",
                    str(tone)], check=True)
    player = subprocess.Popen([sys.executable, "-c",
                               f"import winsound,time; time.sleep(1); winsound.PlaySound(r'{tone}', winsound.SND_FILENAME)"])
    try:
        info = capture(str(tmp_path / "cap"), {"player": {"pid": player.pid}, "other": {"pid": os.getpid()}},
                       max_seconds=6)
    finally:
        player.wait(10)
    if info["tracks"]["player"]["error"]:
        pytest.skip(f"Capture indisponible sur ce PC : {info['tracks']['player']['error']}")
    p = load_audio(info["tracks"]["player"]["path"], rate=8000, start=2, duration=2)
    o = load_audio(info["tracks"]["other"]["path"], rate=8000, start=2, duration=2)
    spec = np.abs(np.fft.rfft(p))
    f = np.fft.rfftfreq(len(p), 1 / 8000)
    assert spec[(f > 990) & (f < 1010)].sum() / spec.sum() > 0.5
    assert np.abs(o).max() < 0.01
    assert abs(len(p) - len(o)) < 800


def test_calage_d_une_piste_captee_en_retard(tmp_path):
    """Sklip ouvert 200 s après le début de l'enregistrement : le calage cherche au bon endroit."""
    import subprocess

    from sklip_engine.audio_sync import sync_track
    video, track = tmp_path / "v.wav", tmp_path / "t.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anoisesrc=d=330:c=pink:r=16000:seed=7",
                    str(video)], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "200.4", "-i", str(video), str(track)], check=True)
    r = sync_track(str(video), str(track), guess=201.0)            # horloges : à une seconde près
    assert abs(r["offset"] - 200.4) < 0.05 and r["confidence"] >= 0.3

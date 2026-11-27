"""Musiques libres ajoutées au montage : plusieurs morceaux enchaînés avec un fondu, fondu de fin."""
import subprocess

from sklip_engine.render import MontageSpec, RenderClip, render_montage, music_inputs, music_playlist, probe
from sklip_engine.music import scan


def _sine(path, freq, dur):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=f={freq}:d={dur}", "-ac", "2",
                    str(path)], check=True)
    return str(path)


def _energy(path, freq, start, dur):
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(dur), "-i", path, "-ac", "1",
                          "-ar", "8000", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32)
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / 8000)
    return spec[(f > freq - 20) & (f < freq + 20)].sum()


def test_scan_lit_la_duree_et_ignore_le_reste(tmp_path):
    a = _sine(tmp_path / "a.wav", 400, 12)
    (tmp_path / "notes.txt").write_text("pas une musique")
    court = _sine(tmp_path / "court.wav", 400, 2)
    cache = tmp_path / "cache.json"
    out = scan([a, str(tmp_path / "notes.txt"), court, str(tmp_path / "absent.mp3")], str(cache))
    assert [t["file"] for t in out] == [a] and abs(out[0]["duration"] - 12) < 0.1
    assert cache.exists() and scan([a], str(cache))[0]["duration"] == out[0]["duration"]


def test_ancienne_musique_unique_toujours_acceptee():
    spec = MontageSpec(video="v", output="o", clips=[], music_file="m.mp3", music_start=1.5)
    assert music_playlist(spec) == [{"file": "m.mp3", "start": 1.5}]
    args, filt = music_inputs(spec, 10)
    assert args == ["-ss", "1.500", "-i", "m.mp3"] and "acrossfade" not in filt and filt.endswith("[mus]")


def test_deux_musiques_enchainees_avec_fondu(tmp_path):
    video = tmp_path / "v.mkv"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=12",
                    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "12", "-c:v", "libx264",
                    "-preset", "ultrafast", "-c:a", "aac", str(video)], check=True)
    m1, m2 = _sine(tmp_path / "m1.wav", 400, 30), _sine(tmp_path / "m2.wav", 1000, 30)
    out = tmp_path / "musique.mp4"
    render_montage(MontageSpec(video=str(video), output=str(out), fmt="16x9", encoder="libx264",
                               clips=[RenderClip(0, 5), RenderClip(6, 11)], auto_mix=False, music_volume=1.0,
                               music=[{"file": m1, "start": 0, "dur": 5}, {"file": m2, "start": 0}]))
    assert abs(probe(str(out))["duration"] - 10) < 0.3
    assert _energy(str(out), 400, 1, 1) > 10 * _energy(str(out), 1000, 1, 1)      # début : 1re musique
    assert _energy(str(out), 1000, 6, 1) > 10 * _energy(str(out), 400, 6, 1)      # ensuite : 2e musique
    assert _energy(str(out), 1000, 9.7, 0.3) < _energy(str(out), 1000, 6, 1) / 4  # fondu de fin

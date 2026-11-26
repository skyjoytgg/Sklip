import json
import os
import subprocess
from datetime import date

import pytest

from sklip_engine.render import (MontageSpec, RenderClip, Rect, TrackFile, render_montage, probe,
                                 montage_filename, export_moment, video_filter)
from sklip_engine.stream_folder import create_stream_folder, write_stats_html, moment_filename, slugify


@pytest.fixture(scope="module")
def fake_stream(tmp_path_factory):
    """Faux enregistrement OBS 1920x1080 de 30 s + pistes Sklip séparées."""
    d = tmp_path_factory.mktemp("stream")
    video = d / "rec.mkv"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=30",
                    "-f", "lavfi", "-i", "sine=f=440:d=30", "-c:v", "libx264", "-preset", "ultrafast",
                    "-c:a", "aac", str(video)], check=True)
    tracks = {}
    for name, f in [("game", 300), ("mic", 500), ("discord", 700), ("music", 900)]:
        p = d / f"{name}.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=f={f}:d=29",
                        str(p)], check=True)
        tracks[name] = TrackFile(str(p), offset=1.0)  # capture démarrée 1 s après OBS
    return {"video": str(video), "tracks": tracks, "dir": d}


def _streams(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def test_montage_9x16_cam_en_haut_avec_pistes(fake_stream, tmp_path):
    out = tmp_path / "kills_9x16.mp4"
    spec = MontageSpec(video=fake_stream["video"], output=str(out), fmt="9x16",
                       clips=[RenderClip(0.5, 3.5), RenderClip(10, 14, layout="game_only"),
                              RenderClip(20, 23, volumes={"discord": 0})],
                       cam=Rect(0.75, 0.70, 0.22, 0.27), tracks=fake_stream["tracks"], encoder="libx264")
    render_montage(spec)
    info = _streams(str(out))
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert (v["width"], v["height"]) == (1080, 1920)
    assert any(s["codec_type"] == "audio" for s in info["streams"])
    assert float(info["format"]["duration"]) == pytest.approx(10.0, abs=0.3)


def test_montage_16x9_sans_pistes_separees(fake_stream, tmp_path):
    out = tmp_path / "m.mp4"
    render_montage(MontageSpec(video=fake_stream["video"], output=str(out), fmt="16x9",
                               clips=[RenderClip(2, 6)], encoder="libx264"))
    v = probe(str(out))
    assert (v["width"], v["height"]) == (1920, 1080)
    assert v["duration"] == pytest.approx(4.0, abs=0.2)


def test_resolution_4_3_etiree(tmp_path):
    src = tmp_path / "43.mkv"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1440x1080:r=30:d=4",
                    "-f", "lavfi", "-i", "sine=d=4", "-c:v", "libx264", "-preset", "ultrafast", str(src)], check=True)
    out = tmp_path / "o.mp4"
    render_montage(MontageSpec(video=str(src), output=str(out), clips=[RenderClip(0, 3)],
                               cam=Rect(0, 0, 0.25, 0.25), encoder="libx264"))
    v = probe(str(out))
    assert (v["width"], v["height"]) == (1080, 1920)


def test_musique_coupee_par_defaut():
    from sklip_engine.render import DEFAULT_VOLUMES
    assert DEFAULT_VOLUMES["music"] == 0.0 and DEFAULT_VOLUMES["discord"] == 1.0


def test_nom_fichier_bpm():
    assert montage_filename("kills", "9x16", 120) == "sklip_kills_9x16_120bpm.mp4"


def test_filtre_cam_en_bas():
    f = video_filter("9x16", "cam_bottom", 1920, 1080, Rect(0, 0, .2, .2), 60, 5, 0.1)
    assert "[game][cam]vstack" in f


def test_dossier_de_stream(fake_stream, tmp_path):
    folder = create_stream_folder(str(tmp_path / "Sklip"), "Ranked avec les potes ! 🔥", date(2026, 11, 24))
    assert folder["path"].endswith(os.path.join("Streams", "2026-11-24_ranked-avec-les-potes"))
    again = create_stream_folder(str(tmp_path / "Sklip"), "Ranked avec les potes ! 🔥", date(2026, 11, 24))
    assert again["path"].endswith("-2")
    name = moment_filename(754, "ace")
    assert name == "00-12-34_ace.mp4"
    export_moment(fake_stream["video"], 5, 9, os.path.join(folder["moments"], name), encoder="libx264")
    assert os.path.getsize(os.path.join(folder["moments"], name)) > 0
    page = write_stats_html(folder["path"], "Ranked <avec> les potes",
                            {"kills": 23, "aces": 1, "raids": [{"channel": "Kamel", "viewers": 42}],
                             "duree_stream": 3 * 3600 + 600, "duree_valorant": 2 * 3600},
                            [{"t": 754, "type": "ace"}])
    content = open(page, encoding="utf-8").read()
    assert "Kamel" in content and "&lt;avec&gt;" in content and "00-12-34_ace.mp4" in content


def test_slugify():
    assert slugify("Éèà ÇA marche !!") == "eea-ca-marche"
    assert slugify("🔥🔥") == "stream"


def _energy_at(path, freq, start, dur):
    """Énergie relative d'une fréquence dans un passage du son du fichier."""
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(dur), "-i", path, "-ac", "1",
                          "-ar", "8000", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32)
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    f = np.fft.rfftfreq(len(x), 1 / 8000)
    return spec[(f > freq - 15) & (f < freq + 15)].sum() / (spec.sum() + 1e-9)


def test_garder_la_musique_du_live_sur_un_clip(fake_stream, tmp_path):
    """Clip 1 : le streamer garde la musique du live (900 Hz). Clip 2 : musique coupée (par défaut)."""
    out = tmp_path / "live_music.mp4"
    render_montage(MontageSpec(video=fake_stream["video"], output=str(out), fmt="16x9", encoder="libx264",
                               tracks=fake_stream["tracks"],
                               clips=[RenderClip(5, 8, volumes={"music": 1.0}), RenderClip(12, 15)],
                               auto_mix=False))   # le micro de test parle sans arrêt : pas de ducking ici
    assert _energy_at(str(out), 900, 0.5, 2) > 0.1
    assert _energy_at(str(out), 900, 3.5, 2) < 0.01
    assert _energy_at(str(out), 500, 3.5, 2) > 0.1      # le micro reste là


def test_musique_ajoutee_coupee_pendant_la_musique_du_live(fake_stream):
    from sklip_engine.render import added_music_volume, live_music_ranges
    spec = MontageSpec(video="v", output="o", tracks=fake_stream["tracks"],
                       clips=[RenderClip(0, 4), RenderClip(10, 13, volumes={"music": 1.0}), RenderClip(20, 22)])
    assert live_music_ranges(spec) == [(4.0, 7.0)]
    assert added_music_volume(spec) == "volume='if(between(t,4.000,7.000),0,0.800)':eval=frame"
    spec.clips[1].volumes = {}
    assert added_music_volume(spec) == "volume=0.800"
    spec.tracks = {}          # pas de piste musique séparée : rien à couper
    spec.clips[1].volumes = {"music": 1.0}
    assert live_music_ranges(spec) == []


def _tone(path, freq, dur, vol, bursts=False):
    """Son de test : continu (musique, jeu) ou par bouts de 1 s toutes les 2 s (voix)."""
    expr = f"{vol}*sin(2*PI*{freq}*t)" + ("*lt(mod(t,2),1)" if bursts else "")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"aevalsrc='{expr}':s=48000:d={dur}",
                    "-ac", "2", str(path)], check=True)
    return TrackFile(str(path), 0.0)


def _band_db(path, freq, start, dur):
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(dur), "-i", path, "-ac", "1",
                          "-ar", "8000", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32)
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / 8000)
    return 10 * np.log10(spec[(f > freq - 20) & (f < freq + 20)].sum() + 1e-12)


def test_mixage_automatique_voix_devant(tmp_path):
    """Voix très faible (-37 dB), musique et jeu très forts (-6 dB) : après le mixage auto,
    la voix passe devant le jeu et largement devant la musique, et le montage est autour de -14 LUFS."""
    from sklip_engine.mixing import _loudnorm_measure
    video = tmp_path / "v.mkv"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=8",
                    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "8", "-c:v", "libx264",
                    "-preset", "ultrafast", "-c:a", "aac", str(video)], check=True)
    tracks = {"mic": _tone(tmp_path / "mic.wav", 500, 8, 0.02, bursts=True),
              "game": _tone(tmp_path / "game.wav", 300, 8, 0.5),
              "music": _tone(tmp_path / "music.wav", 900, 8, 0.5)}
    out = tmp_path / "mix.mp4"
    render_montage(MontageSpec(video=str(video), output=str(out), fmt="16x9", encoder="libx264", tracks=tracks,
                               volumes={"game": 1, "mic": 1, "discord": 1, "music": 1}, clips=[RenderClip(0, 8)]))
    # Pendant que la voix parle (0,2–0,8 s) :
    voice, game, music = (_band_db(str(out), f, 2.2, 0.6) for f in (500, 300, 900))
    assert voice > game + 3
    assert voice > music + 12
    # Quand la voix se tait (1,2–1,8 s), la musique remonte (elle n'est baissée que sous la voix).
    assert _band_db(str(out), 900, 3.3, 0.5) > music + 4
    m = _loudnorm_measure(str(out))
    assert abs(float(m["input_i"]) - (-14)) < 1.5


def test_coupe_franche_sans_fondu_au_noir():
    """Teaser (Sky, 26/11) : pas de fondu au noir entre les coupes, le son garde un fondu à peine audible."""
    from sklip_engine.render import _clip_cmd
    spec = MontageSpec(video="v.mkv", clips=[], output="o.mp4")
    src = {"width": 1920, "height": 1080}
    franc = " ".join(_clip_cmd(spec, RenderClip(10, 11, "game_only", fade=0), src, "p.mp4", "libx264"))
    import re
    assert not re.search(r"(?<!a)fade=t=in", franc) and "afade=t=in:st=0:d=0.015" in franc
    normal = " ".join(_clip_cmd(spec, RenderClip(10, 15, "game_only"), src, "p.mp4", "libx264"))
    assert "fade=t=in:st=0:d=0.12" in normal and "afade=t=in:st=0:d=0.12" in normal

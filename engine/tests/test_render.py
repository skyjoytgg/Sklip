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

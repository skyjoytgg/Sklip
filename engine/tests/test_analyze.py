import json
import os
import subprocess

import numpy as np
import pytest

from sklip_engine.analyze import analyze_stream
from sklip_engine.kill_detect import Scan
from sklip_engine.moments import Moment
from sklip_engine.ranking import funny_deaths, rank_moments
from sklip_engine.rounds import Hud


def test_bonus_quand_le_chat_reagit():
    ms = [Moment("kill", 100), Moment("chat_spike", 108, meta={"intensity": 2}), Moment("kill", 500)]
    r = rank_moments(ms)
    assert r[0].score == 30 + 15 and r[0].meta["boost"] == ["chat_spike"]
    assert r[2].score == 30 and "boost" not in r[2].meta
    assert ms[0].score == 30          # les moments d'origine ne sont pas modifiés


def test_bonus_plafonne():
    ms = [Moment("kill", 100), Moment("chat_spike", 101), Moment("laugh", 102), Moment("viewer_clip", 103),
          Moment("marker", 104)]
    assert rank_moments(ms)[0].score == 30 + 40


def test_mort_drole():
    ms = [Moment("laugh", 205), Moment("chat_spike", 900)]
    fd = funny_deaths([200.0, 500.0, 895.0], ms)
    assert [(m.type, m.t, m.meta["reaction"]) for m in fd] == [("funny_death", 200.0, "laugh"),
                                                               ("funny_death", 895.0, "chat_spike")]


def _fake_scan(duration=120.0, fps=4.0, kills=(30.0, 33.0)):
    t = np.arange(0, duration, 1 / fps)
    banner = np.zeros_like(t, np.float32)
    for k in kills:
        banner[(t >= k) & (t < k + 2)] = 40
    return Scan(fps, t, banner, np.zeros_like(t, np.float32))


def test_analyse_complete(tmp_path):
    video = tmp_path / "rec.mkv"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=10:d=120",
                    "-c:v", "libx264", "-preset", "ultrafast", str(video)], check=True)
    t = np.arange(0, 120, 4.0)
    hud = Hud(t, [0] * len(t), [0] * len(t), np.full(len(t), 5), np.full(len(t), 5))
    s = analyze_stream(str(video), str(tmp_path), "Ranked avec les potes", ["kills", "communaute"], 30,
                       extra_moments=[{"type": "raid", "t": 60, "meta": {"channel": "Kamel", "viewers": 42}},
                                      {"type": "chat_spike", "t": 40}, {"type": "marker", "t": 999}],
                       extra_stats={"peak_viewers": 134}, day="2026-11-24",
                       scan=_fake_scan(), hud=hud)
    folder = s["folder"]
    assert folder.endswith(os.path.join("Streams", "2026-11-24_ranked-avec-les-potes"))
    types = [m["type"] for m in s["moments"]]
    assert types == ["multikill", "chat_spike", "raid"]          # marqueur hors de la vidéo ignoré
    mk = s["moments"][0]
    assert mk["meta"]["count"] == 2 and mk["meta"]["boost"] == ["chat_spike"]
    assert len(s["clips"]["kills"]) == 1 and s["clips"]["kills"][0]["start"] == 26.0
    assert [m["type"] for c in s["clips"]["communaute"] for m in c["moments"]] == ["chat_spike", "raid"]
    assert s["stats"]["kills"] == 2 and s["stats"]["peak_viewers"] == 134
    saved = json.load(open(os.path.join(folder, "session.json"), encoding="utf-8"))
    assert saved["moments"] == s["moments"]
    assert os.path.exists(os.path.join(folder, "stats.html")) and os.path.exists(os.path.join(folder, "stats.json"))
    assert video.exists()                                      # l'enregistrement d'origine n'est pas touché


def test_mesures_recollees_morceau_par_morceau():
    full = _fake_scan(120.0)
    a = Scan(full.fps, full.t[:200], full.banner[:200], full.spectate[:200])
    b = Scan(full.fps, full.t[190:], full.banner[190:], full.spectate[190:])    # chevauchement : pas de doublon
    c = Scan.concat([b, a])
    assert np.array_equal(c.t, full.t) and np.array_equal(c.banner, full.banner)
    assert c.end == 120.0


def test_analyse_apres_live_reprend_les_morceaux(tmp_path):
    video = tmp_path / "rec.mkv"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=10:d=60",
                    "-c:v", "libx264", "-preset", "ultrafast", str(video)], check=True)
    part = tmp_path / "chunk0.npz"
    _fake_scan(50.0, kills=(30.0,)).save(part)
    t = np.arange(0, 60, 4.0)
    hud = Hud(t, [0] * len(t), [0] * len(t), np.full(len(t), 5), np.full(len(t), 5))
    s = analyze_stream(str(video), str(tmp_path), "Live", partial_scans=[str(part)], hud=hud)
    saved = Scan.load(os.path.join(s["folder"], ".sklip", "scan.npz"))
    assert saved.end == pytest.approx(60.0, abs=0.3)          # seuls les 10 dernières secondes ont été lues
    assert [m["type"] for m in s["moments"]] == ["kill"]

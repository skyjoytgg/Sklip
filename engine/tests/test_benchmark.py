import shutil

import pytest

from sklip_engine.benchmark import run_benchmark


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg absent")
def test_test_du_pc_mesure_une_vitesse():
    steps = []
    r = run_benchmark(2.0, progress=lambda f, m: steps.append(f))
    assert r["speed"] > 0 and r["video_seconds"] == 2.0
    assert r["encoder"]
    assert steps[-1] == 1.0

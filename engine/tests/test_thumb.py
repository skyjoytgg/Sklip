import json
import subprocess
import sys


def test_miniature_d_un_live(tmp_path):
    video = tmp_path / "live.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=10:duration=3",
                    "-pix_fmt", "yuv420p", str(video)], check=True)
    out = tmp_path / "thumb.jpg"
    r = subprocess.run([sys.executable, "-m", "sklip_engine", "thumb"], input=json.dumps({"video": str(video), "t": 1.5, "out": str(out)}),
                       capture_output=True, text=True)
    assert '"result"' in r.stdout
    assert out.exists() and out.stat().st_size > 1000
    assert video.exists()  # la vidéo est seulement lue

import subprocess

import numpy as np
import pytest

from sklip_engine.friends import extract_reaction, sync_reaction
from sklip_engine.render import MontageSpec, RenderClip, Rect, render_montage, probe


def _video(path, color="blue", dur=20, size="1280x720", audio="anullsrc=r=48000:cl=mono"):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c={color}:s={size}:r=30:d={dur}",
                    "-f", "lavfi", "-t", str(dur), "-i", audio,
                    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(path)], check=True)


def _pixel(path, t, x, y):
    out = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(path), "-frames:v", "1",
                          "-vf", f"crop=2:2:{x // 2 * 2}:{y // 2 * 2}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True, check=True).stdout
    return tuple(out[:3])


def test_extrait_webcam_seulement(tmp_path):
    src = tmp_path / "pote.mkv"
    # Image bleue, webcam rouge en haut à gauche.
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=1280x720:r=30:d=30",
                    "-f", "lavfi", "-i", "sine=f=440:d=30", "-vf", "drawbox=x=0:y=0:w=320:h=180:c=red:t=fill",
                    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", str(src)], check=True)
    r = extract_reaction(str(src), 10, 8, str(tmp_path / "out" / "r.mp4"), {"x": 0, "y": 0, "w": 0.25, "h": 0.25})
    info = probe(r["out"])
    assert info["height"] == 480 and abs(info["duration"] - 8) < 0.2
    red = _pixel(r["out"], 2, info["width"] // 2, 240)
    assert red[0] > 180 and red[2] < 80                    # seulement la webcam, pas le jeu (bleu)
    assert src.exists()                                    # l'enregistrement du pote n'est pas touché


def _write_wav(path, x, rate=48000):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(rate), "-ac", "1", "-i", "-", str(path)],
                   input=x.astype(np.float32).tobytes(), check=True)


def test_calage_sur_la_piste_discord(tmp_path):
    rate = 48000
    rng = np.random.default_rng(3)
    voice = np.zeros(rate * 60, np.float32)
    for s in range(5, 55, 4):          # le pote parle par moments
        voice[s * rate:(s + 2) * rate] = rng.normal(0, 0.2, 2 * rate)
    discord = voice + rng.normal(0, 0.01, len(voice)).astype(np.float32)
    _write_wav(tmp_path / "discord.wav", discord)
    # L'extrait commence à 20,0 s du stream (et sa piste Discord a commencé 1,5 s après la vidéo).
    true_offset, ref_offset = 20.0, 1.5
    seg = voice[int((true_offset - ref_offset) * rate):int((true_offset - ref_offset + 15) * rate)]
    ext = tmp_path / "ext.mp4"
    _write_wav(tmp_path / "ext.wav", seg * 0.7)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:r=30:d=15",
                    "-i", str(tmp_path / "ext.wav"), "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
                    "-shortest", str(ext)], check=True)
    # Horloges des deux PC décalées de 2,4 s : le son corrige.
    r = sync_reaction(str(ext), str(tmp_path / "discord.wav"), guess=true_offset + 2.4, ref_offset=ref_offset)
    assert r["method"] == "son" and r["offset"] == pytest.approx(true_offset, abs=0.05)
    # Sans rien d'audible en commun : on garde l'horloge.
    _write_wav(tmp_path / "silence.wav", np.zeros(rate * 60))
    r2 = sync_reaction(str(ext), str(tmp_path / "silence.wav"), guess=22.0)
    assert r2["method"] == "horloge" and r2["offset"] == 22.0


@pytest.mark.parametrize("mode", ["pip", "cut"])
def test_reaction_incrustee_au_rendu(tmp_path, mode):
    stream, friend = tmp_path / "stream.mkv", tmp_path / "pote.mp4"
    _video(stream, "blue", 30)
    _video(friend, "lime", 20, "640x480")
    # extrait(u) = stream(u + 5) : le clip 10–16 s du stream utilise 5–11 s de l'extrait.
    f = {"file": str(friend), "offset": 5.0, "mode": mode, "cut_at": 2.0, "cut_dur": 2.0}
    spec = MontageSpec(str(stream), [RenderClip(10, 16, "cam_top", friend=f)], str(tmp_path / "out.mp4"),
                       cam=Rect(0, 0, 0.25, 0.25), fps=30, auto_mix=False)
    render_montage(spec)
    out = spec.output
    if mode == "pip":
        g = _pixel(out, 1, 1080 - 30 - 150, 640 + 30 + 100)    # coin haut-droit de la zone de jeu
        assert g[1] > 180 and g[2] < 100
        b = _pixel(out, 1, 300, 1500)                            # le reste : le jeu
        assert b[2] > 180
    else:
        assert _pixel(out, 1, 540, 1500)[2] > 180               # avant le plan de coupe : le jeu
        g = _pixel(out, 3, 540, 1500)                            # pendant : le pote en plein écran
        assert g[1] > 180 and g[2] < 100
        assert _pixel(out, 5, 540, 1500)[2] > 180               # après : retour au jeu

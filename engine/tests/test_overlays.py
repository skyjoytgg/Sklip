import subprocess

from sklip_engine.overlays import Word, group_words, subtitle_events, overlay_events, build_ass, ffmpeg_path, ass_time
from sklip_engine.render import MontageSpec, RenderClip, render_montage, probe


def W(*items):
    return [Word(s, e, t) for s, e, t in items]


def test_temps_ass():
    assert ass_time(3725.456) == "1:02:05.46"


def test_groupes_de_mots():
    words = W((0, .3, "oh"), (.3, .6, "non"), (.6, 1, "regarde"), (1.1, 1.4, "il"), (3, 3.3, "après"))
    groups = group_words(words)
    assert [[w.text for w in g] for g in groups] == [["oh", "non", "regarde"], ["il"], ["après"]]


def test_mot_prononce_en_couleur():
    ev = subtitle_events(W((0, .3, "oh"), (.3, .6, "non")), 5)
    assert len(ev) == 2
    assert ev[0].index("OH") < ev[0].index("NON")
    assert "\\c&H0000D7FF" in ev[0].split("NON")[0]          # « OH » surligné dans le 1er événement
    assert "\\c&H0000D7FF" in ev[1].split("OH")[1]            # « NON » surligné dans le 2e


def test_textes_desactives_par_defaut():
    assert overlay_events([{"type": "ace", "t": 10}], 8, 6, {}) == []


def test_textes_ace_kills_pseudo():
    texts = {"enabled": True, "ace": True, "killCounter": True, "pseudo": "SkyTV"}
    ev = overlay_events([{"type": "kill", "t": 9}, {"type": "kill", "t": 10}, {"type": "ace", "t": 11},
                         {"type": "multikill", "t": 12, "meta": {"count": 3}}], 8, 6, texts)
    joined = "\n".join(ev)
    assert "1 KILL" in joined and "2 KILLS" in joined and "ACE" in joined and "3 KILLS" in joined and "SkyTV" in joined


def test_rien_a_afficher():
    assert build_ass("9x16", 5) is None


def test_chemin_windows_echappe():
    assert ffmpeg_path("C:\\Users\\cleme\\a'b.ass").endswith("Users/cleme/a\\'b.ass")


def test_incrustation_ffmpeg(tmp_path):
    src = tmp_path / "s.mkv"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=3",
                    "-f", "lavfi", "-i", "sine=d=3", "-c:v", "libx264", "-preset", "ultrafast", str(src)], check=True)
    out = tmp_path / "o.mp4"
    clip = RenderClip(0, 2.5, moments=[{"type": "ace", "t": 1}],
                      words=[{"start": .2, "end": .6, "text": "trop"}, {"start": .6, "end": 1, "text": "fort"}])
    render_montage(MontageSpec(video=str(src), output=str(out), clips=[clip], encoder="libx264",
                               texts={"enabled": True, "pseudo": "Sky"}))
    assert probe(str(out))["height"] == 1920

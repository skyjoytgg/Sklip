"""Vidéo YouTube 8–15 min (choix de Sky 26/11 : 1A 2C 3C 4AB 5 ; 28/11 : commence par du Just Chatting)."""
import json
import subprocess

import pytest

from sklip_engine import youtube as yt
from sklip_engine.moments import THEMES, Clip, Moment
from sklip_engine.render import MontageSpec, Rect, RenderClip, montage_duration, render_montage


def M(t, typ="kill", **meta):
    return Moment(typ, float(t), None, meta)


def test_theme_youtube():
    assert THEMES["youtube"]["long"] and {"ace", "victory", "rr", "laugh"} <= set(THEMES["youtube"]["types"])
    assert Clip(0, 10, []).score == 0.0                     # passage sans moment (Just Chatting d'ouverture)


def test_dans_l_ordre_du_live_entre_8_et_15_min():
    ms = [M(600 + 100 * i, "ace" if i % 3 == 0 else "multikill", count=3, game=i // 10, round=i % 10 + 1)
          for i in range(80)]
    clips = yt.select_long(ms, lambda m: False, stream_duration=10000)
    total = sum(c.duration for c in clips)
    assert yt.LONG_MIN <= total <= yt.LONG_MAX
    assert [c.start for c in clips] == sorted(c.start for c in clips)


def test_commence_par_du_just_chatting():
    game = [M(1000 + 60 * i, "multikill", count=3) for i in range(30)]
    # Un rire pendant la discussion du début : il ouvre la vidéo.
    laugh = M(200, "laugh")
    clips = yt.select_long(game + [laugh], lambda m: m is laugh, stream_duration=5000)
    assert clips[0].moments[0] is laugh
    # Aucun moment pendant la discussion : les 45 s où le streamer parle le plus.
    speech = [(30, 40), (300, 320), (322, 340), (342, 350), (800, 805)]
    clips = yt.select_long(game, lambda m: False, stream_duration=5000, speech=speech, intro_span=(0, 900))
    first = clips[0]
    assert first.moments == [] and 295 <= first.start <= 310 and first.end <= 900
    # Pas de discussion avant la partie : on commence directement par le jeu.
    assert yt.select_long(game, lambda m: False, stream_duration=5000, speech=speech, intro_span=None)[0].moments


def test_discussion_avant_la_premiere_partie():
    hud = [{"start": 0, "end": 640, "game": None}, {"start": 640, "end": 3000, "game": "VALORANT"}]
    assert yt.intro_span(None, hud) == (0.0, 640.0)
    obs = [{"start": 0, "end": 120, "type": "pause"}, {"start": 120, "end": 600, "type": "discussion"},
           {"start": 600, "end": 3000, "type": "jeu"}]
    assert yt.intro_span(obs, hud) == (120.0, 600.0)
    assert yt.intro_span(None, [{"start": 0, "end": 50, "game": None}]) is None


def test_ecrans_de_transition_et_chapitres():
    assert yt.card_text([M(10, "multikill", count=4, round=7)]) == ("ROUND 7", "4K")
    assert yt.card_text([M(10, "rr", rr=-18)])[1] == "-18 RR"
    assert yt.card_text([M(10, "defeat", score="7-13")])[1] == "DÉFAITE 7-13"
    clips = [Clip(0, 40, []), Clip(100, 130, [M(110, "ace", game=0, round=3)]),
             Clip(400, 430, [M(410, "clutch", game=1, vs=3)]), Clip(900, 930, [M(905, "laugh")])]
    C = yt.CARD_DUR
    # Un écran à chaque changement de partie (Just Chatting → partie 1 → partie 2 → mot de la fin).
    assert yt.timeline(clips, True) == [0.0, round(40 + C, 2), round(70 + 2 * C, 2), round(100 + 3 * C, 2)]
    assert [yt.part_card(clips, i)[1] for i in (1, 2, 3)] == ["PARTIE 1", "PARTIE 2", "LE MOT DE LA FIN"]
    ch = yt.chapters(clips, True)
    assert ch[0] == (0.0, "Début du live avec le chat")
    assert [n for _, n in ch][1:] == ["Partie 1 : ACE", "Partie 2 : CLUTCH 1V3", "Le mot de la fin"]
    assert ch[1][0] == 40.0                       # le chapitre commence avec l'écran « PARTIE 1 »
    desc = yt.description_text({"title": "Best-of", "hashtags": ["#valorant", "#shorts"]}, ch, "skyjoytgg")
    assert "0:40 Partie 1 : ACE" in desc and "#valorant" in desc and "#shorts" not in desc
    assert "twitch.tv/skyjoytgg" in desc


def test_coupes_seches_dans_une_meme_partie():
    clips = [Clip(0, 40, [], part="talk"), Clip(100, 130, [M(110, "ace", game=0)]),
             Clip(200, 220, [M(210, "kill", game=0)]), Clip(300, 320, [M(310, "victory")])]   # bannière : même partie
    assert [yt.has_card(clips, i, True) for i in range(4)] == [False, True, False, False]
    assert yt.part_card(clips, 1)[1] == "LA PARTIE"   # une seule partie dans la vidéo
    assert not any(yt.has_card(clips, i, False) for i in range(4))


@pytest.fixture(scope="module")
def stream(tmp_path_factory):
    d = tmp_path_factory.mktemp("yt")
    video = d / "rec.mkv"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=20",
                    "-f", "lavfi", "-i", "sine=f=440:d=20", "-c:v", "libx264", "-preset", "ultrafast",
                    "-c:a", "aac", str(video)], check=True)
    return str(video)


def test_rendu_avec_transitions_et_abonne_toi(stream, tmp_path):
    out = tmp_path / "youtube.mp4"
    spec = MontageSpec(video=stream, output=str(out), fmt="16x9", encoder="libx264", cards=True, outro=True,
                       outro_channel="skyjoytgg", cam_zoom=True, cam=Rect(0.0, 0.0, 0.22, 0.25),
                       clips=[RenderClip(1, 4, part="talk"),
                              RenderClip(8, 11, moments=[{"type": "laugh", "t": 9, "meta": {}},
                                                         {"type": "ace", "t": 10, "meta": {"round": 4}}], part="game:0")])
    assert montage_duration(spec) == pytest.approx(6 + yt.CARD_DUR + yt.OUTRO_DUR)
    render_montage(spec)
    info = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_format", "-of", "json", str(out)],
                                     capture_output=True, text=True, check=True).stdout)
    assert float(info["format"]["duration"]) == pytest.approx(montage_duration(spec), abs=0.35)
    thumb = yt.thumbnail(spec, str(tmp_path / "mini.jpg"), str(tmp_path))       # sans tête : la webcam
    assert thumb and (tmp_path / "mini.jpg").stat().st_size > 1000
    face = tmp_path / "choc.png"                                                # avec une tête détourée
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red@0.0:s=400x500,format=rgba",
                    "-vf", "drawbox=x=100:y=80:w=200:h=300:color=yellow@1:t=fill", "-frames:v", "1", str(face)],
                   check=True)
    assert yt.thumbnail(spec, str(tmp_path / "mini2.jpg"), str(tmp_path), face=str(face))


def test_victoire_et_rr_dans_le_meme_passage():
    clips = yt.select_long([M(13218, "victory"), M(13239, "rr", rr=20)], lambda m: False, stream_duration=20000)
    assert len(clips) == 1 and {m.type for m in clips[0].moments} == {"victory", "rr"}


def test_une_partie_round_par_round():
    from sklip_engine.rounds import Round
    rounds = [Round(0, i + 1, 1000 + 100 * i, 1090 + 100 * i, i % 2 == 0) for i in range(13)]
    rounds += [Round(1, i + 1, 3000 + 100 * i, 3090 + 100 * i, False) for i in range(5)]
    ms = [M(1030 + 100 * i, "kill", game=0, round=i + 1) for i in range(13)]
    ms[4] = M(1430, "multikill", count=3, kills=[1430, 1433, 1470], game=0, round=5)   # 3 kills, 34 s de marche
    ms += [M(3050, "ace", kills=[3050], game=1, round=1), M(2310, "victory"), M(2330, "rr", rr=21)]
    assert yt.best_game(ms, rounds) == 0               # la partie gagnée et complète
    deaths = [1080.0]
    talk = [(20, 200), (2600, 2660)]
    clips = yt.select_game(ms, rounds, deaths, speech=talk, intro=(0, 900), outro=(2500, 2900))
    assert all(c.start < d for c, d in zip(clips, [c.end for c in clips]))
    game = [c for c in clips if c.part == "game:0"]
    assert game and all(c.part in ("talk", "game:0") for c in clips)
    r1 = next(c for c in game if c.start <= 1030 <= c.end)
    P, Q = yt.ROUND_PRE, yt.ROUND_POST
    assert (r1.start, r1.end) == (1030 - P, 1030 + Q)          # un peu avant le kill, un peu après
    assert any((c.start, c.end) == (1080 - P, 1080 + Q) for c in game)   # la mort 50 s plus tard : un autre passage
    # Le round 5 : les deux premiers kills puis le dernier, sans les 34 s de marche entre.
    r5 = [c for c in game if 1400 <= c.start <= 1490]
    assert len(r5) == 2 and r5[0].end < 1450 and r5[1].start > 1460
    assert any({"victory", "rr"} <= {m.type for m in c.moments} for c in game)          # VICTOIRE + RR
    assert clips[0].part == "talk" and clips[0].end <= 1000                             # Just Chatting du début…
    assert clips[-1].part == "talk" and clips[-1].start >= 2600                         # … et celui de la fin


def test_fin_du_live_en_conclusion():
    game = [M(1000 + 60 * i, "multikill", count=3, game=0) for i in range(30)]
    speech = [(4000, 4010), (4100, 4150)]
    clips = yt.select_long(game, lambda m: False, stream_duration=5000, speech=speech, outro_span=(2900, 4800))
    assert clips[-1].moments == [] and clips[-1].start >= 4090 and clips[-1].part == "talk"
    assert yt.outro_span(None, [{"start": 0, "end": 2900, "game": "VALORANT"}], 4800) == (2900.0, 4800.0)


def test_zoom_webcam_sur_les_reactions():
    ms = [{"type": "laugh", "t": 105, "meta": {}}, {"type": "ace", "t": 110, "meta": {"kills": [110, 113, 118]}},
          {"type": "kill", "t": 125, "meta": {}}]
    z = yt.reaction_zooms(ms, 100, 130)
    assert z == [(4.6, 7.6), (18.4, 20.8)]              # le rire, puis la réaction après le dernier kill de l'ace
    assert yt.reaction_zooms(ms, 100, 119) == [(4.6, 7.6)]   # réaction coupée par la fin du clip : trop courte
    assert yt.reaction_zooms([], 0, 10) == []


def test_bibliotheque_de_tetes(tmp_path):
    for n in ("choc.png", "Rire-2.png", "content.png", "note.txt"):
        (tmp_path / n).write_bytes(b"x")
    assert [p.split("\\")[-1].split("/")[-1] for p in yt.list_faces(str(tmp_path))] == ["Rire-2.png", "choc.png", "content.png"]
    assert yt.pick_face(str(tmp_path), "rire").endswith("Rire-2.png")
    assert yt.pick_face(str(tmp_path), "rire", 1).endswith("choc.png")      # « Autre tête »
    assert yt.pick_face(str(tmp_path / "vide"), "rire") is None
    assert yt.mood_of(M(1, "rr", rr=-15)) == "rage" and yt.mood_of(M(1, "laugh")) == "rire"
    assert yt.thumb_lines([Clip(0, 5, [M(1, "ace")])]) == ("J'AI FAIT", "UN ACE ?!")
    assert yt.thumb_lines([Clip(0, 5, [M(1, "kill")])], partie=True) == ("LA PARTIE", "LA PLUS FOLLE ?!")


def test_outro_quinze_secondes():
    ass = yt.outro_ass("16x9", channel="skyjoytgg")
    assert yt.OUTRO_DUR == 15 and "ABONNE-TOI" in ass and "twitch.tv/skyjoytgg" in ass and "0:00:15.00" in ass

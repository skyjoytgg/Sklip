from sklip_engine.render import Rect, _layout
from sklip_engine.moments import Moment
from sklip_engine.segments import assign_layouts, drop_paused, hud_segments, is_valorant


def test_passages_d_apres_le_bandeau_de_score():
    # Just Chatting (0-600 s), Valorant (600-3000 s, bandeau toutes les 2 s), fin de live hors jeu.
    t = [float(x) for x in range(0, 3600, 2)]
    score = [1 if 600 <= x <= 3000 else None for x in t]
    segs = hud_segments(t, score, 3600.0)
    assert [s["game"] for s in segs] == [None, "VALORANT", None]
    assert 560 <= segs[1]["start"] <= 600 and 3000 <= segs[1]["end"] <= 3040


def test_une_pause_courte_dans_valorant_reste_valorant():
    t = [float(x) for x in range(0, 1000, 2)]
    score = [None if 400 <= x <= 460 else 1 for x in t]   # 1 min sans bandeau (écran de fin de partie…)
    assert [s["game"] for s in hud_segments(t, score, 1000.0)] == ["VALORANT"]


def test_mise_en_page_selon_le_passage():
    cam_val = {"x": 0, "y": 0, "w": 0.22, "h": 0.3}
    cam_jc = {"x": 0.125, "y": 0, "w": 0.75, "h": 1}
    # Catégorie Twitch déjà sur VALORANT pendant le Just Chatting : c'est la scène qui décide.
    segments = [
        {"start": 0, "end": 900, "game": "VALORANT", "scene": "JC", "type": "discussion", "cam": cam_jc, "full": True},
        {"start": 900, "end": 5000, "game": "VALORANT", "scene": "Valo", "type": "jeu", "cam": cam_val, "full": False},
        {"start": 5000, "end": 6000, "game": None, "scene": "Fin", "type": None, "cam": cam_jc, "full": True},
    ]
    hud = [{"start": 0, "end": 5000, "game": "VALORANT"}, {"start": 5000, "end": 6000, "game": None}]
    clips = [{"start": 100, "end": 120}, {"start": 2000, "end": 2020}, {"start": 5500, "end": 5520}]
    assign_layouts(clips, segments, hud)
    assert [c["layout"] for c in clips] == ["cam_full", "cam_top", "cam_full"]
    assert clips[0]["cam"] == cam_jc and clips[1]["cam"] == cam_val
    assert [c["scene"] for c in clips] == ["JC", "Valo", "Fin"]
    # Sans infos du live (VOD) : le bandeau de score décide.
    vod = [{"start": 100, "end": 120}, {"start": 5500, "end": 5520}]
    assign_layouts(vod, None, hud)
    assert [c["layout"] for c in vod] == ["cam_top", "cam_full"] and "cam" not in vod[0]
    # VOD avec la petite webcam de jeu : hors jeu, pas de « Cam en grand » (serait floue), webcam en haut.
    small = [{"start": 100, "end": 120}, {"start": 5500, "end": 5520}]
    assign_layouts(small, None, hud, {"x": 0, "y": 0, "w": 0.22, "h": 0.3})
    assert [c["layout"] for c in small] == ["cam_top", "cam_top"]
    # Scène de discussion OBS avec une petite webcam : pareil.
    tiny = [{"start": 100, "end": 120}]
    assign_layouts(tiny, [{"start": 0, "end": 900, "type": "discussion", "cam": cam_val}], hud)
    assert tiny[0]["layout"] == "cam_top"
    assert is_valorant("VALORANT") and not is_valorant("Just Chatting") and not is_valorant(None)


def test_cam_en_grand_recadree_en_9_16():
    f = _layout("9x16", "cam_full", 1920, 1080, Rect(0.125, 0, 0.75, 1), 60)
    assert f.startswith("[0:v]crop=608:1080:656:0,scale=1080:1920")   # 1080 × 9/16 = 607,5 → 608, centré dans la cam
    # Sans webcam connue : recadrage central de l'image.
    assert "crop=608:1080:(iw-608)/2:0" in _layout("9x16", "cam_full", 1920, 1080, None, 60)


def test_pas_de_clip_pendant_une_pause():
    segs = [{"start": 0, "end": 100, "type": "jeu"}, {"start": 100, "end": 400, "type": "pause"}, {"start": 400, "end": 900, "type": "jeu"}]
    ms = [Moment("kill", 50.0), Moment("marker", 200.0), Moment("ace", 500.0)]
    assert [m.t for m in drop_paused(ms, segs)] == [50.0, 500.0]
    assert drop_paused(ms, None) == ms


def test_theme_discussion_seulement_pendant_les_passages_discussion():
    from sklip_engine.moments import THEMES
    from sklip_engine.segments import in_scene
    from sklip_engine.selection import select_clips
    segs = [{"start": 0, "end": 600, "type": "discussion"}, {"start": 600, "end": 3000, "type": "jeu"},
            {"start": 3000, "end": 3600, "type": "discussion"}]
    ms = [Moment("laugh", 100.0, 70), Moment("scream", 1200.0, 80), Moment("raid", 3100.0, 90),
          Moment("ace", 1500.0, 100), Moment("chat_spike", 2000.0, 60)]
    inside = in_scene(ms, "discussion", segs, [])
    assert [m.t for m in inside] == [100.0, 3100.0]
    clips = select_clips(inside, "discussion", 30)
    assert clips and all(m.type in THEMES["discussion"]["types"] for c in clips for m in c.moments)
    # VOD sans infos OBS : hors du bandeau de score Valorant = discussion.
    hud = [{"start": 0, "end": 600, "game": None}, {"start": 600, "end": 3600, "game": "VALORANT"}]
    assert [m.t for m in in_scene(ms, "discussion", None, hud)] == [100.0]

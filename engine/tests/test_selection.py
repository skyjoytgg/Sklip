

def test_duree_par_theme():
    from sklip_engine.analyze import target_for
    assert target_for(180, "kills") == 180.0
    assert target_for({"kills": 60, "bestof": 300}, "kills") == 60.0
    assert target_for({"kills": 60, "bestof": 300}, "bestof") == 300.0
    assert target_for({"kills": 60}, "drole") == 60.0          # thème sans réglage : 1 min


def test_retarget_refait_un_theme_a_une_autre_duree(tmp_path):
    """Menu « Durée » de l'éditeur : mêmes moments, plus ou moins de clips selon la durée choisie."""
    import json
    from sklip_engine.analyze import retarget
    moments = [{"type": "kill", "t": 100.0 + 90 * i, "score": 40, "meta": {}} for i in range(40)]
    session = {"video": str(tmp_path / "absente.mkv"), "duration": 4000.0, "moments": moments,
               "clips": {"kills": []}, "targets": {"kills": 60.0}, "target": 60.0, "speech": [], "segments": []}
    (tmp_path / ".sklip").mkdir()
    (tmp_path / "session.json").write_text(json.dumps(session), encoding="utf-8")
    durees = {}
    for tg in (30, 60, 180, 300):
        s = retarget(str(tmp_path), "kills", tg)
        durees[tg] = sum(c["end"] - c["start"] for c in s["clips"]["kills"])
        assert s["targets"]["kills"] == tg
        assert durees[tg] <= tg + 15
    assert durees[30] < durees[60] < durees[180] < durees[300]
    assert json.loads((tmp_path / "session.json").read_text(encoding="utf-8"))["targets"]["kills"] == 300


def test_fins_de_partie_classee_ajoutees_dans_l_ordre():
    """Sky 26/11 : chaque partie classée = « win »/« loose » (2 s) puis « rr+16 » (~5 s), en plus de la durée
    visée, à leur place dans l'ordre du live. Pas dans les thèmes Drôle / Discussion."""
    from sklip_engine.moments import Moment
    from sklip_engine.selection import select_clips
    ms = [Moment("multikill", 1200.0, None, {"count": 3}), Moment("multikill", 9000.0, None, {"count": 4}),
          Moment("defeat", 5226.0), Moment("rr", 5255.0, None, {"rr": -25, "result": "defeat"}),
          Moment("victory", 7627.0), Moment("rr", 7646.0, None, {"rr": 16, "result": "victory"}),
          Moment("defeat", 1424.0)]                       # partie non classée : pas d'écran du rang
    clips = select_clips(ms, "kills", 60, stream_duration=12000)
    seq = [(c.moments[0].type, round(c.start, 1), round(c.end, 1)) for c in clips]
    assert [s[0] for s in seq] == ["multikill", "defeat", "rr", "victory", "rr", "multikill"]
    assert seq[1][1:] == (5225.8, 5227.8) and seq[2][1:] == (5253.5, 5258.5)
    assert [c.start for c in clips] == sorted(c.start for c in clips)
    assert not any(m.type in ("rr", "victory") for c in select_clips(ms, "drole", 60) for m in c.moments)

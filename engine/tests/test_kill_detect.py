import cv2
import numpy as np
import pytest

from sklip_engine.kill_detect import (
    BANNER_ON, BANNER_PX, SPEC_H, SPEC_W, Scan, _icon, banner_score, find_deaths, find_kills, spectate_score,
    streamer_kills,
)

rng = np.random.default_rng(0)


def _decor():
    """Fond « jeu » : texture douce + quelques traits droits (murs, arêtes)."""
    img = cv2.GaussianBlur(rng.integers(60, 160, (BANNER_PX, BANNER_PX)).astype(np.uint8), (9, 9), 3)
    for _ in range(4):
        p1, p2 = tuple(int(v) for v in rng.integers(0, BANNER_PX, 2)), tuple(int(v) for v in rng.integers(0, BANNER_PX, 2))
        cv2.line(img, p1, p2, 230, 2)
    return img


def test_embleme_cercle_complet_detecte():
    img = _decor()
    c = BANNER_PX // 2
    cv2.circle(img, (c, c), 55, 250, 3)
    cv2.circle(img, (c, c), 80, 240, 2)
    assert banner_score(img) > BANNER_ON * 2


def test_embleme_en_arcs_detecte():
    # Style vu à 49:51 sur la VOD du 01/11 : seulement deux arcs, en haut et en bas.
    img = _decor()
    c = BANNER_PX // 2
    cv2.ellipse(img, (c, c), (75, 75), 0, 200, 340, 240, 2)
    cv2.ellipse(img, (c, c), (75, 75), 0, 20, 160, 240, 2)
    assert banner_score(img) > BANNER_ON


def test_decor_sans_embleme_ignore():
    scores = [banner_score(_decor()) for _ in range(20)]
    assert max(scores) < BANNER_ON


def test_cercle_decentre_ignore():
    img = _decor()
    cv2.circle(img, (60, 70), 40, 250, 3)   # un cercle du décor, pas au centre de l'emblème
    assert banner_score(img) < BANNER_ON


def test_icone_spectateur():
    zone = cv2.GaussianBlur(rng.integers(40, 120, (SPEC_H, SPEC_W)).astype(np.uint8), (5, 5), 2)
    assert spectate_score(zone) < 0.5
    icon = _icon()
    zone[12:12 + icon.shape[0], 16:16 + icon.shape[1]] = icon
    assert spectate_score(zone) > 0.9
    assert spectate_score(np.full((SPEC_H, SPEC_W), 80, np.uint8)) == 0.0


def _scan(banner, spectate, fps=4.0):
    return Scan(fps, np.arange(len(banner)) / fps, np.array(banner, np.float32), np.array(spectate, np.float32))


def test_find_kills_separe_streamer_et_spectateur():
    b = [1, 1, 60, 70, 65, 60, 1, 1, 30, 30, 1, 80, 90, 85, 80, 1, 50, 55, 50, 45, 1]
    s = [0.1] * 11 + [0.95] * 10
    sc = _scan(b, s)
    ev = find_kills(sc)
    assert [e.t for e in ev] == [0.5, 2.75, 4.0]          # l'apparition trop brève (index 8-9) est ignorée
    assert [e.spectating for e in ev] == [False, True, True]
    assert [e.t for e in streamer_kills(sc)] == [0.5]


def test_kills_enchaines_separes():
    # Scores réels de la VOD du 01/11 à 2:22:08 : 3 kills d'affilée (confirmés par le fil des kills).
    b = [1, 77, 75, 34, 78, 28, 58, 84, 92, 82, 70, 103, 96, 1]
    ev = find_kills(_scan(b, [0.1] * len(b)))
    assert len(ev) == 3
    # 2:10:37 : 2 kills.
    b = [1, 39, 37, 118, 116, 119, 119, 115, 35, 44, 122, 129, 128, 119, 115, 65, 1]
    assert len(find_kills(_scan(b, [0.1] * len(b)))) == 2
    # Un emblème qui ondule sans vraie chute reste un seul kill.
    b = [1, 100, 102, 98, 70, 96, 108, 106, 1]
    assert len(find_kills(_scan(b, [0.1] * len(b)))) == 1


def test_embleme_faible_ignore():
    sc = _scan([1, 25, 28, 27, 26, 1], [0.1] * 6)
    assert find_kills(sc) == []


def test_ecran_choix_agent_ignore():
    # 20 s de « cercles » (écran de choix d'agent), puis un fragment 5 s après : tout est ignoré.
    b = [1] * 4 + [40] * 80 + [1] * 20 + [45] * 6 + [1] * 200 + [100] * 8 + [1] * 4
    sc = _scan(b, [0.1] * len(b))
    ev = find_kills(sc)
    assert len(ev) == 1 and ev[0].t == pytest.approx((4 + 80 + 20 + 6 + 200) / 4)


def test_morts_depuis_le_mode_spectateur():
    # spectateur de 10 s à 20 s (avec un trou de 2 s), puis un passage trop court (0,5 s) à 40 s
    s = [0.1] * 40 + [0.95] * 16 + [0.1] * 8 + [0.95] * 16 + [0.1] * 80 + [0.95] * 2 + [0.1] * 10
    sc = _scan([1] * len(s), s)
    assert find_deaths(sc) == [pytest.approx(10.0 - 2.5)]


def test_scan_sauvegarde_et_relecture(tmp_path):
    sc = _scan([1, 50, 60, 1], [0.1, 0.2, 0.2, 0.1])
    sc.save(tmp_path / "s.npz")
    back = Scan.load(tmp_path / "s.npz")
    assert back.fps == 4.0 and np.allclose(back.banner, sc.banner)


def test_kills_tres_rapproches_separes_par_la_relecture_fine():
    # Score d'emblème relu à 10 images/s à 82:44 (VOD du 25/11) : le 2e kill ne laisse qu'un creux d'1/10 s.
    import numpy as np
    from sklip_engine.kill_detect import _groups, fine_kill_spans, KillEvent
    arr = np.array([5, 20, 42, 60, 23, 67, 86, 80, 78, 75, 70, 66, 60, 55, 50, 40, 30, 10, 5], np.float32)
    spans = fine_kill_spans(arr, 10.0)
    assert [s for s, _ in spans] == [2, 5]
    assert fine_kill_spans(np.array([5, 5, 5], np.float32), 10.0) == []
    # deux kills qui se suivent dans la même apparition de l'emblème = un seul groupe à relire
    ev = [KillEvent(10.0, 1.0, 50, False), KillEvent(11.0, 2.0, 60, False), KillEvent(30.0, 2.0, 60, False)]
    assert [len(g) for g in _groups(ev, 4.0)] == [2, 1]

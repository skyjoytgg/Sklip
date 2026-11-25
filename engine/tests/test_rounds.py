import cv2
import numpy as np

from sklip_engine.moments import moments_to_clips
from sklip_engine.rounds import (
    BAR_H, BAR_W, BAR_X, GLYPH_H, GLYPH_W, SLOTS_LEFT, SLOTS_RIGHT, ZONE_H, ZONE_W, Hud, Round, _templates,
    count_alive, find_clutches, group_kills, read_number, rounds_from_scores,
)


def _zone(text: str, bg: int = 110) -> np.ndarray:
    """Fabrique une zone de score avec les modèles de chiffres (taille réelle ~10x19 px)."""
    z = np.full((ZONE_H, ZONE_W), bg, np.uint8)
    tpl = _templates()
    x = ZONE_W // 2 - 6 * len(text)
    for ch in text:
        g = tpl[int(ch)][:GLYPH_W * GLYPH_H].reshape(GLYPH_H, GLYPH_W)
        ar = tpl[int(ch)][-1] / 4
        h = 19
        w = max(3, round(h * ar))
        big = cv2.resize(g, (w, h), interpolation=cv2.INTER_LINEAR) > 0.5
        z[10:10 + h, x:x + w][big] = 245
        x += w + 3
    return z


def test_lecture_des_scores():
    for v in ["0", "1", "4", "7", "9", "10", "12", "13"]:
        assert read_number(_zone(v)) == int(v)


def test_zone_vide_ou_illisible():
    assert read_number(np.full((ZONE_H, ZONE_W), 90, np.uint8)) is None
    blob = np.full((ZONE_H, ZONE_W), 90, np.uint8)
    cv2.circle(blob, (28, 20), 12, 255, -1)
    assert read_number(blob) is None


def test_rounds_et_parties():
    t = np.arange(0, 40) * 4.0
    s = ([(0, 0)] * 5 + [(None, 0)] + [(1, 0)] * 5 + [(1, 7)] + [(1, 1)] * 5   # un « 1-7 » isolé = erreur de lecture
         + [(2, 1)] * 6 + [(0, 0)] * 6 + [(0, 1)] * 12)
    rs = rounds_from_scores(t, s)
    assert [(r.game, r.number) for r in rs] == [(0, 1), (0, 2), (0, 3), (0, 4), (1, 1), (1, 2)]
    assert rs[0].start == 0.0 and rs[1].start == 24.0 and rs[0].end == rs[1].start


def test_regroupement_des_kills():
    rs = [Round(0, 1, 0, 100), Round(0, 2, 100, 200), Round(0, 3, 200, 300)]
    ms = group_kills([10, 50, 120, 130, 140, 150, 160, 250, 400], rs)
    types = [(m.type, m.meta.get("count")) for m in ms]
    assert types == [("multikill", 2), ("ace", 5), ("kill", None), ("kill", None)]
    ace = ms[1]
    assert ace.t == 160 and ace.meta["t_start"] == 120 and ace.meta["round"] == 2


def _bar(left: int, right: int) -> np.ndarray:
    """Bandeau du haut avec `left` portraits serrés à droite de la moitié gauche, `right` à gauche de la droite."""
    rng = np.random.default_rng(1)
    bar = np.full((BAR_H, BAR_W), 120, np.uint8)
    for cx in list(SLOTS_LEFT[5 - left:]) + list(SLOTS_RIGHT[:right]):
        x = cx - BAR_X
        bar[6:46, x - 18:x + 18] = rng.integers(0, 255, (40, 36))
    return bar


def test_comptage_des_vivants():
    for l, r in [(5, 5), (1, 3), (0, 2), (2, 0)]:
        bar = _bar(l, r)
        assert (count_alive(bar, SLOTS_LEFT), count_alive(bar, SLOTS_RIGHT)) == (l, r)


def test_rounds_gagnes_et_perdus():
    t = np.arange(0, 12) * 4.0
    s = [(0, 0)] * 3 + [(1, 0)] * 3 + [(1, 1)] * 3 + [(2, 1)] * 3
    rs = rounds_from_scores(t, s)
    assert [r.won for r in rs] == [True, False, True, None]


def _hud(t, alive):
    return Hud(np.array(t, float), [None] * len(t), [None] * len(t),
               np.array([a for a, _ in alive]), np.array([b for _, b in alive]))


def test_clutch_1v2_gagne():
    rs = [Round(0, 1, 0, 100, won=True), Round(0, 2, 100, 200, won=True), Round(0, 3, 200, 300, won=False)]
    t = [10, 50, 60, 70, 104, 150, 160, 210, 250, 260]
    alive = [(5, 5), (2, 3), (1, 2), (1, 1),        # round 1 : 1v2 gagné → clutch
             (1, 4),                                 # juste après le changement de score : fin du round 1
             (1, 2),                                 # round 2 : 1v2 mais le streamer est mort (spectateur)
             (3, 3), (5, 5), (1, 3), (1, 2)]         # round 3 : 1v3 perdu → pas de clutch
    dead = {150}
    ms = find_clutches(_hud(t, alive), rs, kill_times=[65, 80], is_alive=lambda x: x not in dead)
    assert len(ms) == 1
    c = ms[0]
    assert c.type == "clutch" and c.meta["vs"] == 2 and c.meta["round"] == 1
    assert c.t == 80 and c.meta["t_start"] == 60


def test_clip_couvre_tout_le_multikill():
    rs = [Round(0, 1, 0, 100)]
    [m] = group_kills([20, 31], rs)
    [c] = moments_to_clips([m])
    assert (c.start, c.end) == (16.0, 33.0)

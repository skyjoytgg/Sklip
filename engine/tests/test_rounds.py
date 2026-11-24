import cv2
import numpy as np

from sklip_engine.moments import moments_to_clips
from sklip_engine.rounds import (
    GLYPH_H, GLYPH_W, ZONE_H, ZONE_W, Round, _templates, group_kills, read_number, rounds_from_scores,
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


def test_clip_couvre_tout_le_multikill():
    rs = [Round(0, 1, 0, 100)]
    [m] = group_kills([20, 31], rs)
    [c] = moments_to_clips([m])
    assert (c.start, c.end) == (16.0, 33.0)

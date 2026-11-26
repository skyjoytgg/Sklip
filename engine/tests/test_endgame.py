"""Fins de partie : VICTOIRE / DÉFAITE et points de rang (live de Sky du 26/11)."""
import numpy as np

from sklip_engine import endgame as eg
from sklip_engine.moments import Moment, THEMES, moments_to_clips


def test_lecture_du_resultat():
    assert eg.read_result("5 DÉFAITE 13") == ("defeat", "5-13")
    assert eg.read_result("13 VICTOIRE 11") == ("victory", "13-11")
    assert eg.read_result("DÉFAITE") == ("defeat", None)
    # Bannières de ROUND (en français aussi « VICTOIRE » / « DÉFAITE ») : pas une fin de partie.
    assert eg.read_result("VICTOIRE ÉQUIPE ENNEMIE ÉLIMINÉE") is None
    assert eg.read_result("DÉFAITE SPIKE DÉSAMORCÉE") is None


def _img(color=None, frac=0.1, size=(360, 640)):
    img = np.zeros((*size, 3), np.uint8)
    if color is not None:
        h, w = size
        n = int(h * w * frac)
        img.reshape(-1, 3)[:n] = color
    return img


def test_bannieres_puis_rr():
    red = _img((60, 70, 255), 0.6)            # BGR : rouge vif (le crop du milieu en est plein)
    dark = _img()
    frames = [(100.0, dark), (102.0, red), (104.0, red), (300.0, dark)]
    read = lambda img: [{"text": "5 DÉFAITE 13"}] if img.mean() > 20 else []
    rr_img = _img((90, 230, 40), 0.05, (130, 300))          # « -25 SC » en vert vif sur fond sombre

    def fine(t0, t1):
        assert t0 == 107.0
        yield 110.0, dark[:130, :300]
        yield 110.5, rr_img

    def read_any(img):
        if (img[..., 0] == img[..., 2]).all() and img.max() == 255:   # image du nombre (noir sur blanc)
            return [{"text": "-25 sc"}]
        return read(img)
    out = eg.find_endgames(iter(frames), fine, read=read_any)
    assert [o["type"] for o in out] == ["defeat", "rr"]
    assert out[0]["t"] == 102.0 and out[0]["meta"] == {"score": "5-13"}
    assert out[1]["meta"]["rr"] == -25 and out[1]["meta"]["result"] == "defeat"


def test_moments_et_themes():
    assert "victory" in THEMES["kills"]["types"]
    assert {"victory", "defeat", "rr"} <= set(THEMES["bestof"]["types"])
    big = Moment("rr", 100.0, meta={"rr": -25})
    small = Moment("rr", 100.0, meta={"rr": 8})
    assert big.score > small.score
    c = moments_to_clips([Moment("rr", 5255.0, meta={"rr": -25})])[0]
    assert (c.start, c.end) == (5252.0, 5261.0)


def test_fusion_des_lectures_pendant_le_live():
    a = [{"type": "defeat", "t": 1424.0, "meta": {}}]
    b = [{"type": "defeat", "t": 1426.0, "meta": {}}, {"type": "rr", "t": 1450.0, "meta": {"rr": -20}},
         {"type": "victory", "t": 7627.0, "meta": {}}]
    assert [(e["type"], e["t"]) for e in eg.merge_endgames(a + b)] == [("defeat", 1424.0), ("rr", 1450.0), ("victory", 7627.0)]

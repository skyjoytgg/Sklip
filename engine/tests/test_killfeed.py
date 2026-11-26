"""Kills au couteau lus dans le fil des kills (en haut à droite)."""
import cv2
import numpy as np

from sklip_engine.killfeed import is_knife, knives_in, weapon_icons
from sklip_engine.moments import BASE_SCORES, KNIFE_BONUS
from sklip_engine.overlays import overlay_events
from sklip_engine.rounds import group_kills

TEAL, RED, WHITE = (160, 180, 90), (118, 116, 226), (250, 252, 255)    # BGR, mesurés sur la VOD du 25/11


def feed(icons):
    """Image 1080p avec une ligne du fil par icône : vert (tueur), icône blanche, rouge (victime)."""
    f = np.full((1080, 1920, 3), 60, np.uint8)
    for k, draw in enumerate(icons):
        y = 90 + 45 * k
        cv2.rectangle(f, (1470, y), (1775, y + 38), TEAL, -1)
        cv2.rectangle(f, (1776, y), (1900, y + 38), RED, -1)
        cv2.putText(f, "SkyjoyTGG", (1490, y + 27), cv2.FONT_HERSHEY_SIMPLEX, 0.7, WHITE, 2)
        draw(f, y)
    return f


def knife(f, y):          # lame pleine : 63 × 12 px comme dans le jeu
    cv2.rectangle(f, (1665, y + 13), (1727, y + 24), WHITE, -1)


def shorty(f, y):         # canon + poignée qui descend : plus haut, avec des trous
    cv2.rectangle(f, (1665, y + 10), (1728, y + 16), WHITE, -1)
    cv2.rectangle(f, (1665, y + 16), (1676, y + 29), WHITE, -1)


def test_couteau_reconnu_dans_le_fil_des_kills():
    icons = weapon_icons(feed([shorty, knife]))
    assert len(icons) == 2
    assert [is_knife(i) for i in icons] == [False, True]
    assert knives_in(feed([shorty, shorty])) == 0
    assert knives_in(feed([knife])) == 1


def test_ligne_sans_victime_rouge_ignoree():
    f = feed([knife])
    f[:, 1776:] = 60                       # plus de rouge : ce n'est pas une ligne de kill
    assert knives_in(f) == 0


def test_kill_au_couteau_prioritaire_et_affiche():
    ms = group_kills([10.0, 20.0, 30.0], [], knives=[20.0])
    assert [m.meta.get("knives") for m in ms] == [None, [20.0], None]
    assert ms[1].score == BASE_SCORES["kill"] + KNIFE_BONUS > BASE_SCORES["multikill"] + 10   # devant un 3K
    m = {"type": "multikill", "t": 4984.5, "meta": {"count": 3, "knives": [4984.5]}}
    ev = overlay_events([m], 4960.5, 27, {"enabled": True})
    assert any(r"3 KILLS\NAU COUTEAU" in e for e in ev)
    m = {"type": "multikill", "t": 4984.5, "meta": {"count": 3, "knives": [4970.0]}}
    ev = overlay_events([m], 4960.5, 27, {"enabled": True})
    assert any(e.endswith("AU COUTEAU") and "0:00:09" in e for e in ev)

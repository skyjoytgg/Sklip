import numpy as np

from sklip_engine.camfocus import focus_from_frames
from sklip_engine.render import Rect, _layout


def _frames(head_x: float, n: int = 8, seed: int = 1) -> np.ndarray:
    """Pièce fixe (texture) + une personne qui bouge un peu, tête centrée en head_x."""
    rng = np.random.default_rng(seed)
    room = rng.integers(40, 120, (90, 160)).astype(np.uint8)
    out = []
    for i in range(n):
        f = room.copy()
        cx = int(head_x * 160 + rng.integers(-4, 5))
        yy, xx = np.ogrid[:90, :160]
        f[((xx - cx) ** 2 / 14 ** 2 + (yy - 30 - i % 3) ** 2 / 18 ** 2) <= 1] = 200 + 6 * (i % 4)   # tête
        f[60:, max(0, cx - 30):cx + 30] = 170 + 8 * (i % 3)                                      # épaules
        out.append(f)
    return np.array(out)


def test_visage_trouve_la_ou_ca_bouge():
    fx, fy = focus_from_frames(_frames(0.7))
    assert abs(fx - 0.7) < 0.06 and fy < 0.5
    fx, _ = focus_from_frames(_frames(0.3, seed=2))
    assert abs(fx - 0.3) < 0.06


def test_rien_ne_bouge_pas_de_visage():
    still = np.repeat(_frames(0.5)[:1], 8, axis=0)
    assert focus_from_frames(still) is None
    assert focus_from_frames(None) is None


def test_cam_en_grand_centree_sur_le_visage():
    cam = Rect(0.125, 0, 0.75, 1)      # 1440×1080 : recadrage 608 de large dans la webcam (x de 240 à 1680)
    assert "crop=608:1080:656:0" in _layout("9x16", "cam_full", 1920, 1080, cam, 60)            # sans visage : centre
    assert "crop=608:1080:1072:0" in _layout("9x16", "cam_full", 1920, 1080, cam, 60, (0.8, 0.3))  # visage à droite
    assert "crop=608:1080:240:0" in _layout("9x16", "cam_full", 1920, 1080, cam, 60, (0.0, 0.3))   # bord : on reste dans la cam

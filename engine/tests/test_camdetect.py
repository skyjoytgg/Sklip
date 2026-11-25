import numpy as np
import pytest

from sklip_engine.camdetect import H, W, change_map, edge_maps, find_cam_rect


def _frames(cam=None, n=24, seed=1, hud=True):
    """Images factices : jeu qui change complètement à chaque image, HUD fixe, webcam (pièce fixe + streamer qui bouge)."""
    rng = np.random.default_rng(seed)
    room = rng.integers(40, 200, (H, W)).astype(np.uint8)
    room = np.repeat(np.repeat(room[::6, ::6], 6, 0), 6, 1)[:H, :W]        # pièce : gros motifs fixes
    out = []
    for i in range(n):
        g = rng.integers(0, 255, (H // 9 + 2, W // 9 + 2)).astype(np.uint8)
        f = np.repeat(np.repeat(g, 9, 0), 9, 1)
        dy, dx = (int(v) for v in rng.integers(0, 9, 2))
        f = f[dy:dy + H, dx:dx + W].copy()                                # le jeu : change tout le temps
        if hud:
            f[2:10, 150:330] = 230                                       # bandeau du score (fixe)
            f[250:262, 180:300] = 200                                     # barre de sorts (fixe)
        if cam:
            x, y, w, h = (int(v) for v in (cam[0] * W, cam[1] * H, cam[2] * W, cam[3] * H))
            f[y:y + h, x:x + w] = room[y:y + h, x:x + w]
            f[y:y + h, x + w // 3] = 255                                  # bord d'étagère DANS la webcam
            px = x + w // 2 + int(rng.integers(-w // 6, w // 6))          # le streamer bouge
            f[y + h // 4:y + h, px - w // 6:px + w // 6] = rng.integers(60, 120)
        out.append(f)
    return np.stack(out)


@pytest.mark.parametrize("cam", [(0.026, 0.056, 0.224, 0.222), (0.75, 0.70, 0.22, 0.28), (0.70, 0.05, 0.28, 0.30),
                                 (0.0, 0.62, 0.25, 0.38)])
def test_webcam_trouvee(cam):
    fr = _frames(cam)
    gx, gy = edge_maps(fr)
    r = find_cam_rect(change_map(fr), gx, gy)
    assert r is not None
    for k, v in zip("xywh", cam):
        assert r[k] == pytest.approx(v, abs=0.02), (k, r)


def test_pas_de_webcam():
    fr = _frames(None)
    gx, gy = edge_maps(fr)
    assert find_cam_rect(change_map(fr), gx, gy) is None


def test_autres_scenes_ignorees():
    from sklip_engine.camdetect import pick_times
    # 1 h de stream, partie entre 20 et 50 min : on ne regarde que la partie
    times = pick_times(3600, in_game=list(range(1200, 3000, 2)))
    assert len(times) == 24 and min(times) >= 1200 and max(times) <= 3000
    # trop peu de temps de jeu connu (autre jeu que Valorant) : tout le stream
    times = pick_times(3600, in_game=[100, 200])
    assert min(times) == pytest.approx(180) and max(times) == pytest.approx(3420)


import subprocess

import numpy as np
import pytest

from sklip_engine.moments import Moment, moments_to_clips
from sklip_engine.selection import select_clips, snap_to_beats
from sklip_engine.audio_sync import find_offset, sync_track
from sklip_engine.beat import estimate_bpm, beat_grid, BEAT_RATE


# ---------- Moments et sélection ----------

def test_fenetre_large_12s_avant_5s_apres():
    # Sky (26/11) : 6 s c'est trop court, on ne voit pas l'action -> on prend large, le streamer rogne.
    [c] = moments_to_clips([Moment("kill", 100.0)])
    assert (c.start, c.end) == (88.0, 105.0)
    # un clip viewer est créé après l'action : on remonte ~25 s avant
    [v] = moments_to_clips([Moment("viewer_clip", 1318.0)])
    assert (v.start, v.end) == (1233.0, 1328.0)          # le viewer choisit son extrait jusqu'à ~90 s avant
    [x] = moments_to_clips([Moment("viewer_clip", 1021.0, meta={"before": 21, "after": 9})])
    assert (x.start, x.end) == (995.0, 1033.0)           # position exacte connue (vod_offset)


def test_meilleur_clip_garde_meme_si_plus_long_que_la_cible():
    [c] = select_clips([Moment("ace", 300, meta={"count": 5, "t_start": 270})], "kills", target=15)
    assert c.end == 305 and c.duration == pytest.approx(15)


def test_kills_proches_fusionnes_en_un_clip():
    ms = [Moment("kill", 100), Moment("kill", 101.5), Moment("kill", 103), Moment("kill", 200)]
    clips = moments_to_clips(ms)
    assert len(clips) == 2
    assert (clips[0].start, clips[0].end) == (88.0, 108.0)
    assert len(clips[0].moments) == 3


def test_selection_respecte_le_theme_et_la_duree():
    ms = [Moment("kill", 50), Moment("ace", 300), Moment("raid", 400, meta={"viewers": 80}),
          Moment("multikill", 600, meta={"count": 3}), Moment("kill", 900), Moment("clutch", 1200),
          Moment("kill", 1500), Moment("kill", 1800), Moment("kill", 2100)]
    clips = select_clips(ms, "kills", target=60)
    types = {m.type for c in clips for m in c.moments}
    assert "raid" not in types
    assert sum(c.duration for c in clips) <= 60.5
    assert {"ace", "clutch", "multikill"} <= types  # les plus forts d'abord
    assert [c.start for c in clips] == sorted(c.start for c in clips)


def test_duree_bornee_15_60():
    ms = [Moment("kill", 100 * i) for i in range(1, 30)]
    assert sum(c.duration for c in select_clips(ms, "kills", target=900)) <= 300.5   # 5 min max


def test_theme_perso():
    ms = [Moment("raid", 10), Moment("ace", 100), Moment("laugh", 200)]
    clips = select_clips(ms, ["ace", "laugh"], target=40)
    assert {m.type for c in clips for m in c.moments} == {"ace", "laugh"}


def test_clips_cales_sur_le_bpm():
    ms = [Moment("kill", 100), Moment("ace", 300)]
    beat = 60 / 120
    for c in select_clips(ms, "kills", target=15, bpm=120):
        assert abs(c.duration / beat - round(c.duration / beat)) < 1e-9
    assert snap_to_beats(6.0, 128) == pytest.approx(13 * 60 / 128)


def test_type_inconnu_refuse():
    with pytest.raises(ValueError):
        Moment("headshot_magique", 1)


# ---------- Synchronisation audio ----------

def test_find_offset_signal_synthetique():
    rng = np.random.default_rng(0)
    rate = 4000
    game = rng.standard_normal(rate * 30).astype(np.float32)
    voice = rng.standard_normal(rate * 30).astype(np.float32)
    # La vidéo contient le jeu + la voix ; la piste jeu Sklip a démarré 1,25 s plus tard.
    lag = int(1.25 * rate)
    mix = game + voice
    track = game[lag:]
    off, conf = find_offset(mix, track, rate, max_offset=5)
    assert off == pytest.approx(1.25, abs=1 / rate)
    assert conf > 0.3


def _make_wav(path, samples, rate):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(rate), "-ac", "1",
                    "-i", "-", str(path)], input=samples.astype(np.float32).tobytes(), check=True)


def test_sync_track_fichiers(tmp_path):
    rng = np.random.default_rng(1)
    rate = 16000
    total = 200
    game = rng.standard_normal(rate * total).astype(np.float32) * 0.3
    mic = rng.standard_normal(rate * total).astype(np.float32) * 0.3
    # Sklip a démarré la capture 3,5 s APRÈS le début de l'enregistrement OBS.
    start = int(3.5 * rate)
    _make_wav(tmp_path / "video_mix.wav", game + mic, rate)
    _make_wav(tmp_path / "game_track.wav", game[start:], rate)
    res = sync_track(str(tmp_path / "video_mix.wav"), str(tmp_path / "game_track.wav"),
                     probe_start=60, probe_len=20, max_offset=30)
    assert res["offset"] == pytest.approx(3.5, abs=0.002)


# ---------- BPM ----------

def _click_track(bpm, seconds, first=0.2, rate=BEAT_RATE):
    out = np.zeros(int(seconds * rate), dtype=np.float32)
    t = np.arange(int(0.05 * rate)) / rate
    hit = np.sin(2 * np.pi * 200 * t) * np.exp(-t * 60)
    rng = np.random.default_rng(2)
    for b in beat_grid(bpm, seconds - 0.1, first):
        s = int(b * rate)
        out[s:s + len(hit)] += hit
    return out + rng.standard_normal(len(out)).astype(np.float32) * 0.01


@pytest.mark.parametrize("bpm", [90, 120, 128, 150])
def test_estimation_bpm(bpm):
    res = estimate_bpm(_click_track(bpm, 30))
    assert res["bpm"] == pytest.approx(bpm, rel=0.02)


def test_premier_temps():
    res = estimate_bpm(_click_track(120, 30, first=0.2))
    step = 0.5
    d = (res["first_beat"] - 0.2) % step
    assert min(d, step - d) < 0.04


def test_grille():
    assert beat_grid(120, 2.0) == [0.0, 0.5, 1.0, 1.5, 2.0]


def test_pas_de_coupe_au_milieu_d_une_phrase():
    from sklip_engine.moments import Clip, Moment
    from sklip_engine.selection import snap_to_speech
    m = Moment("kill", 100.0)
    clips = [Clip(96.0, 102.0, [m]), Clip(200.0, 206.0, [Moment("kill", 204.0)])]
    speech = [(94.5, 97.0), (101.0, 103.5), (150.0, 180.0), (205.0, 215.0)]
    out = snap_to_speech(clips, speech, stream_duration=1000)
    assert out[0].start == pytest.approx(94.35) and out[0].end == pytest.approx(103.7)
    assert out[1].start == 200.0 and out[1].end == 206.0          # phrase trop longue : on ne prolonge pas de 9 s
    # deux clips qui se rejoignent après ajustement → un seul
    two = snap_to_speech([Clip(10, 16, [m]), Clip(18, 24, [m])], [(15, 18.5)])
    assert len(two) == 1 and two[0].start == 10 and two[0].end == 24

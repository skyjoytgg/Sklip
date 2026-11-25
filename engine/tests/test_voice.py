import numpy as np
import pytest

from sklip_engine.voice import RATE, classify, is_laugh_text, to_moments, vocal_moments, voicing

rng = np.random.default_rng(3)


def _voice(dur, amp, f0=180.0):
    """Une voix factice : son harmonique (fondamentale + harmoniques), légèrement vibrée."""
    t = np.arange(int(dur * RATE)) / RATE
    f = f0 * (1 + 0.03 * np.sin(2 * np.pi * 5 * t))
    ph = 2 * np.pi * np.cumsum(f) / RATE
    return amp * sum(np.sin(k * ph) / k for k in range(1, 6)) / 2


def _speech(dur, amp):
    """Parole normale : syllabes de longueurs irrégulières, petits silences."""
    out = []
    while sum(len(s) for s in out) < dur * RATE:
        out.append(_voice(rng.uniform(0.12, 0.6), amp * rng.uniform(0.7, 1.2), rng.uniform(140, 220)))
        out.append(np.zeros(int(rng.uniform(0.05, 0.35) * RATE)))
    return np.concatenate(out)[:int(dur * RATE)]


def _laugh(dur, amp):
    """« Ha-ha-ha » : rafales voisées très régulières (5 par seconde)."""
    one = np.concatenate([_voice(0.09, amp, 260), np.zeros(int(0.11 * RATE))])
    return np.tile(one, int(dur / 0.2))


def _gunfire(dur, amp):
    """Rafale de tirs : bruit fort et rythmé, mais pas une voix."""
    one = np.concatenate([rng.normal(0, amp, int(0.05 * RATE)), np.zeros(int(0.1 * RATE))])
    return np.tile(one, int(dur / 0.15))


def _track():
    parts, marks = [], {}
    def add(name, x):
        marks[name] = (sum(len(p) for p in parts) / RATE, len(x) / RATE)
        parts.append(x)
    noise = lambda d: rng.normal(0, 0.002, int(d * RATE))
    add("parole1", _speech(40, 0.05))
    add("cri", _voice(0.9, 0.35, 320))           # ~ +17 dB
    add("parole2", _speech(20, 0.05))
    add("tirs", _gunfire(2.0, 0.4))
    add("parole3", _speech(20, 0.05))
    add("rire", _laugh(2.4, 0.06))
    add("parole4", _speech(20, 0.05))
    x = np.concatenate(parts)
    return x + noise(len(x) / RATE), marks


def _hit(found, kind, span):
    a, d = span
    return [m for m in found if m["type"] == kind and m["start"] < a + d + 0.5 and m["end"] > a - 0.5]


def test_voix_contre_bruit():
    v_voice = voicing(_voice(1.0, 0.1).astype(np.float32))
    v_noise = voicing(rng.normal(0, 0.1, RATE).astype(np.float32))
    assert np.median(v_voice) > 0.8
    assert np.median(v_noise) < 0.3


def test_cri_et_rire_sans_transcription():
    x, marks = _track()
    found = vocal_moments(x.astype(np.float32))
    assert _hit(found, "scream", marks["cri"]), found
    assert _hit(found, "laugh", marks["rire"]), found
    assert not _hit(found, "scream", marks["tirs"]) and not _hit(found, "laugh", marks["tirs"]), found


def test_transcription_decide():
    x, marks = _track()
    asked = []

    def confirm(sig, rate, spans):
        asked.extend(spans)
        out = []
        for a, b in spans:
            if abs(a - marks["cri"][0]) < 1:
                out.append(["NOOOON", "!"])
            elif abs(a - marks["rire"][0]) < 1.5:
                out.append(["Hahaha", "!"])
            else:
                out.append(["je", "pense", "qu'on", "devrait", "aller", "en", "B", "maintenant"])
        return out
    found = vocal_moments(x.astype(np.float32), confirm=confirm)
    assert asked                                                # une seule transcription groupée
    kinds = sorted(m["type"] for m in found)
    assert kinds == ["laugh", "scream"], found
    assert _hit(found, "scream", marks["cri"])[0]["text"] == "NOOOON"


@pytest.mark.parametrize("words,dur,rhythmic,expected", [
    (["Hahaha", "!"], 1.5, 0.5, "laugh"),
    (["mdr"], 1.0, 0.5, "laugh"),
    ([], 1.5, 0.8, "laugh"),
    ([], 1.5, 0.5, None),
    (["Sous-titres", "réalisés", "par", "la", "communauté", "d'Amara", ".org"], 2.0, 0.8, "laugh"),  # Whisper invente
    (["NOOON", "!"], 0.8, 0, "scream"),
    (["Regarde,", "regarde", "!"], 1.0, 0, "scream"),
    (["Oh", "oh", "stop", "please"], 1.7, 0, "scream"),
    (["Merci."], 0.4, 0, None),                                 # poli, pas une exclamation
    (["Bonne", "soirée", "!"], 0.4, 0, None),
    (["Je", "comprends", "pas", "pourquoi", "il", "ferme", "pas", "le", "magasin"], 0.8, 0, None),
])
def test_classify(words, dur, rhythmic, expected):
    assert classify(words, dur, rhythmic) == expected


def test_texte_de_rire():
    assert is_laugh_text(["Ha", "ha", "ha", "ha"])
    assert not is_laugh_text(["Sous-titres", "réalisés", "par", "la", "communauté"])


def test_moment_commence_avant():
    m = to_moments([{"type": "laugh", "start": 100.0, "end": 106.0, "regularity": 0.8}])[0]
    assert m["t"] == 103.0 and m["meta"]["t_start"] == 100.0 and m["meta"]["regularity"] == 0.8


def test_phrases():
    from sklip_engine.voice import HOP, frame_db, speech_spans
    x = np.concatenate([rng.normal(0, 0.002, RATE * 2), _voice(1.5, 0.05), rng.normal(0, 0.002, RATE),
                        rng.normal(0, 0.05, RATE), _voice(0.8, 0.05), rng.normal(0, 0.002, RATE)]).astype(np.float32)
    sp = speech_spans(frame_db(x), voicing(x))
    assert len(sp) == 2, sp                                   # le bruit fort (tir) n'est pas de la parole
    assert sp[0][0] == pytest.approx(2.0, abs=0.1) and sp[0][1] == pytest.approx(3.5, abs=0.15)
    assert sp[1][0] == pytest.approx(5.5, abs=0.1)


def test_track_features_par_morceaux(tmp_path):
    import subprocess
    from sklip_engine.voice import frame_db
    x = _speech(25, 0.05).astype(np.float32)
    raw = tmp_path / "mic.f32"
    raw.write_bytes(x.tobytes())
    wav = tmp_path / "mic.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(RATE), "-ac", "1", "-i", str(raw), str(wav)],
                   check=True)
    from sklip_engine.voice import track_features
    db, v = track_features(str(wav), chunk=7.0)              # morceaux de 7 s : mêmes mesures que d'un bloc
    ref = frame_db(x)
    assert abs(len(db) - len(ref)) <= 2
    n = min(len(db), len(ref))
    assert np.abs(db[:n] - ref[:n]).max() < 0.5
    assert np.abs(v[:n] - voicing(x)[:n]).max() < 0.05

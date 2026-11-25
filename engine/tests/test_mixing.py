import numpy as np

from sklip_engine.mixing import TARGET_DB, active_level_db, auto_gain, ducking_graph


def test_niveau_mesure_seulement_quand_ca_parle():
    rate = 16000
    t = np.arange(rate * 4) / rate
    voice = 0.1 * np.sin(2 * np.pi * 300 * t) * (t % 2 < 1)        # parle 1 s sur 2
    lvl = active_level_db(voice, rate)
    assert abs(lvl - 20 * np.log10(0.1 / np.sqrt(2))) < 1.0           # le silence ne fait pas baisser la mesure
    assert active_level_db(np.zeros(rate * 2), rate) is None


def test_gain_vers_le_niveau_cible():
    assert auto_gain("mic", TARGET_DB["mic"] - 6) == round(10 ** (6 / 20), 4)
    assert auto_gain("music", -3.0) < 0.1                            # musique trop forte : fortement baissée
    assert auto_gain("mic", -90.0) == round(10 ** (20 / 20), 4)      # gain plafonné à +20 dB
    assert auto_gain("mic", None) == 1.0


def test_musique_et_jeu_baissent_sous_la_voix():
    parts, labels = ducking_graph({"mic": "[t1]", "game": "[t2]", "music": "[t3]"}, "mic")
    assert parts[0] == "[t1]asplit=3[voice][key0][key1]"
    assert labels == {"mic": "[voice]", "game": "[game_d]", "music": "[music_d]"}
    assert ducking_graph({"game": "[t1]"}, None) == ([], {"game": "[t1]"})

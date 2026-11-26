"""Vocal du jeu : qui parle (icône de l'agent en bas à gauche) et ce qu'il dit."""
import json

import cv2
import numpy as np

from sklip_engine.voicechat import (drop_streamer, load_agents, speakers_in, speaking_spans, templates, voice_lines)


def fake_agents(tmp_path):
    rng = np.random.default_rng(3)
    data = []
    for i, name in enumerate(["Viper", "Reyna", "Neon"]):
        uuid = f"u{i}"
        icon = np.zeros((128, 128, 4), np.uint8)
        icon[..., :3] = cv2.resize(rng.integers(0, 255, (8, 8, 3), dtype=np.uint8), (128, 128), interpolation=cv2.INTER_NEAREST)
        cv2.circle(icon, (64, 64), 60, (0, 0, 0, 255), -1)
        icon[..., :3] = cv2.resize(rng.integers(0, 255, (8, 8, 3), dtype=np.uint8), (128, 128), interpolation=cv2.INTER_NEAREST)
        cv2.imwrite(str(tmp_path / f"icon_{uuid}.png"), icon)
        data.append({"uuid": uuid, "displayName": name})
    (tmp_path / "agents.json").write_text(json.dumps({"data": data}), encoding="utf-8")
    return load_agents(str(tmp_path))


def test_icone_de_l_agent_qui_parle_reconnue(tmp_path):
    agents = fake_agents(tmp_path)
    assert [a["name"] for a in agents] == ["Viper", "Reyna", "Neon"]
    tpls = templates(agents, 34)
    zone = np.full((340, 90, 3), 70, np.uint8)
    for (a, t, m), y in ((tpls[0], 127), (tpls[1], 165)):          # deux lignes : Viper au-dessus de Reyna
        patch = zone[y:y + 34, 20:54]
        zone[y:y + 34, 20:54] = np.where(m > 0, t, patch).astype(np.uint8)
    found = speakers_in(zone, tpls)
    assert sorted((u, y) for u, _, y in found) == [("u0", 127), ("u1", 165)]
    zone2 = np.full((340, 90, 3), 70, np.uint8)                     # rien en bas à gauche : personne ne parle
    assert speakers_in(zone2, tpls) == []
    zone3 = np.full((340, 90, 3), 70, np.uint8)                     # la même icône ailleurs (décor) : ignorée
    a, t, m = tpls[0]
    zone3[100:134, 50:84] = np.where(m > 0, t, zone3[100:134, 50:84]).astype(np.uint8)
    assert speakers_in(zone3, tpls) == []


def test_prises_de_parole_et_repliques():
    dets = [(10.0, "v"), (10.5, "v"), (11.0, "v"), (14.0, "v"), (10.5, "r")]
    spans = speaking_spans(dets)
    assert [(s["agent"], s["start"], s["end"]) for s in spans] == [("v", 10.0, 11.5), ("r", 10.5, 11.0), ("v", 14.0, 14.5)]
    words = [{"start": 10.1, "end": 10.3, "text": "happy"}, {"start": 10.35, "end": 10.6, "text": "birthday"},
             {"start": 14.0, "end": 14.2, "text": "merci"}, {"start": 14.25, "end": 14.4, "text": "bien"},
             {"start": 20.0, "end": 20.3, "text": "personne"}, {"start": 20.3, "end": 20.5, "text": "parle"}]
    lines = voice_lines(words, [s for s in spans if s["agent"] == "v"])
    assert [(ln["agent"], ln["text"]) for ln in lines] == [("v", "happy birthday"), ("v", "merci bien")]


def test_le_streamer_n_est_pas_un_coequipier():
    spans = [{"agent": "neon", "start": 5, "end": 7}, {"agent": "viper", "start": 10, "end": 12}]
    assert [s["agent"] for s in drop_streamer(spans, [(4.8, 7.2), (30, 31)])] == ["viper"]
    assert drop_streamer(spans, []) == spans


def test_discord_lines_and_attach():
    from sklip_engine.voicechat import attach_discord, discord_lines
    words = [{"start": 10.0, "end": 10.3, "text": "vas-y"}, {"start": 10.4, "end": 10.8, "text": "go"},
             {"start": 10.9, "end": 11.2, "text": "go"}, {"start": 14.0, "end": 14.3, "text": "ok"}]
    lines = discord_lines(words)
    assert lines == [{"start": 10.0, "end": 11.2, "text": "vas-y go go"}]     # « ok » seul : trop court
    clips = [{"start": 5.0, "end": 20.0, "voices": [{"agent": "a", "start": 12.0, "end": 13.0, "text": "x y"}]}]
    attach_discord(clips, lambda a, b: words)
    v = clips[0]["voices"]
    assert [x["start"] for x in v] == [10.0, 12.0]                            # mêlées aux répliques du jeu, dans l'ordre
    assert v[0]["agent"] is None and v[0]["src"] == "discord" and v[0]["on"] is False

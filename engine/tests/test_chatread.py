"""Messages du chat lus à voix haute → bulles sur la vidéo."""
from sklip_engine.chatread import attach_chat, bubble_times, find_read_messages, tokens


def said(start, text, step=0.3):
    return [{"start": round(start + i * step, 2), "end": round(start + i * step + 0.25, 2), "text": w}
            for i, w in enumerate(text.split())]


MSG = {"t": 100.0, "user": "Lilacassette", "text": "J'envoie des pieds, j'envoie tout mais que au top frag",
       "color": "#FF69B4", "badges": ["subscriber"]}


def test_tokens_sans_accents_ni_ponctuation():
    assert tokens("Évidemment, c'est WIN !") == ["evidemment", "c", "est", "win"]


def test_message_lu_retrouve_meme_avec_fautes_et_mots_en_plus():
    words = said(95, "bon alors") + said(104, "attends Lila dit j'envoie des pied j'envoie tout mais qu'au top frague ah ouais")
    r = find_read_messages(words, [MSG])
    assert len(r) == 1
    assert 104 <= r[0]["read_start"] <= 106 and r[0]["read_end"] > r[0]["read_start"]


def test_message_pas_lu_ou_lu_avant_d_etre_poste():
    assert find_read_messages(said(104, "on push B les gars allez allez"), [MSG]) == []
    assert find_read_messages(said(80, "j'envoie des pieds j'envoie tout mais que au top frag"), [MSG]) == []
    assert find_read_messages(said(400, "j'envoie des pieds j'envoie tout mais que au top frag"), [MSG]) == []   # 5 min après


def test_messages_trop_courts_ignores():
    assert find_read_messages(said(101, "gg wp"), [{**MSG, "text": "gg wp"}]) == []


def test_bulle_dans_le_clip():
    a, b = bubble_times(104.0, 104.5)
    assert a == 103.7 and b == 106.2                 # au moins 2,5 s à l'écran
    clips = [{"start": 98.0, "end": 120.0}, {"start": 300.0, "end": 320.0}]
    calls = []

    def tr(a, b):
        calls.append((a, b))
        return said(104, "j'envoie des pieds j'envoie tout mais que au top frag")
    attach_chat(clips, [MSG], tr)
    assert calls == [(98.0, 120.0)]                  # le clip sans message récent n'est pas transcrit
    bub = clips[0]["chat"][0]
    assert bub["user"] == "Lilacassette" and bub["auto"] and 98 <= bub["start"] < bub["end"] <= 120
    assert "chat" not in clips[1]

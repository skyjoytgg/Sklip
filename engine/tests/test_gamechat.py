"""Chat du jeu : lignes « (Tout) pseudo : message », couleur du pseudo = équipe (live du 26/11)."""
import numpy as np

from sklip_engine.gamechat import chat_between, merge_lines, messages_in, parse_line, team_of


def test_lecture_des_lignes():
    assert parse_line("(Tout) tuffboy : pd") == ("Tout", "tuffboy", "pd")
    assert parse_line("(Équipe) MaxTesLa : go B") == ("Équipe", "MaxTesLa", "go B")
    assert parse_line("(Tout) Sage :  WELL PLAYED MY AGENTS") == ("Tout", "Sage", "WELL PLAYED MY AGENTS")
    assert parse_line("(Émission) MaxTesLa (Waylay) a repéré un ENNEMI ici : B") is None     # ping
    assert parse_line("100") is None


def _patch(color):
    img = np.zeros((20, 60, 3), np.uint8)
    img[5:15, 5:55] = color
    return img


def test_couleur_du_pseudo():
    assert team_of(_patch((90, 90, 255))) == "enemy"          # rouge (BGR)
    assert team_of(_patch((255, 200, 80))) == "ally"          # bleu clair
    assert team_of(_patch((230, 230, 230))) is None           # blanc : système


def _line(text, x=0):
    words, out = text.split(), []
    for i, w in enumerate(words):
        out.append({"text": w, "x": x + 40 * i, "y": 2, "w": 35, "h": 14})
    return {"text": text, "words": out}


def test_morceaux_d_une_meme_ligne_recolles():
    [ln] = merge_lines([_line("WELL PLAYED", x=120), _line("(Tout) Sage :", x=0)])
    assert ln["text"] == "(Tout) Sage : WELL PLAYED"


def test_messages_dedoublonnes_et_pings_ignores():
    img = np.zeros((40, 400, 3), np.uint8)
    img[2:16, 0:75] = (90, 90, 255)                           # « (Tout) tuffboy » en rouge
    lines = [_line("(Tout) tuffboy : pd"), _line("(Émission) Moi (Neon) a repéré un ENNEMI ici : B")]
    lines[1]["words"] = [dict(w, y=22) for w in lines[1]["words"]]
    assert messages_in(img, read=lambda _: lines) == [{"user": "tuffboy", "text": "pd", "team": "enemy", "scope": "Tout"}]
    moved = img.copy(); moved[20:40, 100:400] = 200                       # autre chose bouge dans la zone
    frames = [(10.0, img), (11.0, moved), (12.0, img)]                     # le message reste affiché 3 s
    msgs = chat_between("v", 0, 20, read=lambda _: lines, frames=frames)
    assert [(m["t"], m["user"]) for m in msgs] == [(10.0, "tuffboy")]


def test_pseudos_mal_lus_et_doublons_de_fin_de_partie():
    from sklip_engine.gamechat import fix_names, same_message
    a = {"user": "Reacher", "text": "GGWPPPP", "team": "enemy"}
    assert same_message(a, {"user": "Reacher", "text": "GGwpppp", "team": "enemy"})
    assert not same_message(a, {"user": "Pacha", "text": "ggs", "team": "enemy"})
    msgs = fix_names([{"user": "Waylay", "text": "yeah bro"}, {"user": "Waylay", "text": "ez"}, {"user": "Wa9(ay", "text": "lmao"},
                      {"user": "Pacha", "text": "ggs"}])
    assert [m["user"] for m in msgs] == ["Waylay", "Waylay", "Waylay", "Pacha"]


def test_chat_lu_pendant_l_analyse_et_cache():
    from sklip_engine.gamechat import chat_for_clips, spans_for
    clips = [{"start": 100, "end": 130}, {"start": 135, "end": 150}, {"start": 400, "end": 420}]
    assert spans_for(clips) == [[90.0, 150.0], [390.0, 420.0]]
    calls = []

    def between(a, b):
        calls.append((a, b))
        return [{"t": a + 1, "user": "tuffboy", "text": "pd", "team": "enemy", "scope": "Tout"}]
    first = chat_for_clips("v", clips, between=between)
    assert calls == [(90.0, 150.0), (390.0, 420.0)] and len(first["messages"]) == 2
    calls.clear()
    # Réanalyse : un clip rallongé → seule la partie nouvelle est relue.
    again = chat_for_clips("v", clips + [{"start": 420, "end": 440}], cached=first, between=between)
    assert calls == [(420.0, 440.0)]
    assert len(again["messages"]) == 3

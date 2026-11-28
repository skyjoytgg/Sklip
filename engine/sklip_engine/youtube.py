"""Vidéo YouTube longue (16:9). Deux façons (thèmes) :
- « youtube » : best-of de tout le live, 8 à 15 min, dans l'ordre du live ;
- « youtube_partie » : la meilleure partie du live racontée round par round, sans les temps morts.
Les deux commencent par le Just Chatting du début du live et finissent par celui de la fin (conclusion), avec un
écran de transition « PARTIE 2 » seulement quand on change de partie (coupes sèches sinon), un zoom sur la webcam
quand le streamer réagit (option), 15 s de fin « Abonne-toi et rejoins-moi sur Twitch » (place des écrans de fin
YouTube), la description avec chapitres et une miniature avec la tête du streamer.
Choix de Sky : 26/11 1A 2C 3C 4AB 5 ; 28/11 pas de teaser, sous-titres coupés, export auto ; puis, inspiré d'une
vidéo de Goomsii (monteur pro) : A B (activable) C D E (bibliothèque de têtes) F."""
from __future__ import annotations

import os

from .moments import Clip, Moment, moments_to_clips

# ---------- Choix des moments ----------
LONG_PRE, LONG_POST = 7.0, 4.0     # plus de contexte que dans un short : on voit l'action arriver
LONG_MERGE = 5.0                    # deux moments à moins de 5 s : un seul passage (pas de hachage)
LONG_MIN, LONG_MAX = 480.0, 900.0   # 8 à 15 min
GOOD_SCORE = 45.0                   # « ce qui est bien » : au-dessus d'un simple kill
TALK_START_MAX = 90.0               # Just Chatting du début : au plus 1 min 30
TALK_END_MAX = 60.0                 # … et de la fin : au plus 1 min
TALK_DUR = 45.0                     # Just Chatting sans moment détecté : 45 s où le streamer parle le plus
TALK_STEP = 5.0
RR_JOIN = 30.0                      # s : l'écran du rang suit la victoire / défaite : un seul passage
TALK_TYPES = {"laugh", "scream", "chat_spike", "raid", "viewer_peak", "viewer_clip", "marker"}


def _endgame_then_rr(a: Clip, b: Clip) -> bool:
    return (any(m.type in ("victory", "defeat") for m in a.moments) and any(m.type == "rr" for m in b.moments)
            and b.start - a.end <= RR_JOIN)


def _merge_close(clips: list[Clip], gap: float = LONG_MERGE) -> list[Clip]:
    out: list[Clip] = []
    for c in sorted(clips, key=lambda c: c.start):
        if out and (c.start - out[-1].end <= gap or _endgame_then_rr(out[-1], c)):
            out[-1].end = max(out[-1].end, c.end)
            out[-1].moments += [m for m in c.moments if m not in out[-1].moments]
        else:
            out.append(c)
    return out


def talk_window(span: tuple[float, float] | None, speech: list | None, dur: float = TALK_DUR) -> Clip | None:
    """Passage Just Chatting quand aucun moment n'y a été trouvé : dans `span` (discussion avant la première
    partie, ou après la dernière), les `dur` secondes où le streamer parle le plus (au moins un tiers du temps)."""
    if not span or not speech:
        return None
    a, b = float(span[0]), float(span[1])
    if b - a < dur:
        return None
    best, best_talk = None, 0.0
    t = a
    while t + dur <= b:
        talk = sum(max(0.0, min(y, t + dur) - max(x, t)) for x, y in speech)
        if talk > best_talk:
            best, best_talk = t, talk
        t += TALK_STEP
    if best is None or best_talk < dur / 3:
        return None
    start, end = best, best + dur
    for x, y in speech:                      # sans couper une phrase aux bords
        if x < start < y:
            start = max(a, x - 0.15)
        if x < end < y:
            end = min(b, y + 0.2)
    return Clip(round(start, 2), round(end, 2), [], part="talk")


def _game_bounds(segments, hud_segs) -> tuple[float, float] | None:
    from .segments import is_valorant
    games = [s for s in hud_segs or [] if is_valorant(s.get("game"))]
    obs = [s for s in segments or [] if s.get("type") == "jeu"]
    if obs:                                  # scènes OBS connues : plus précis que le bandeau
        return float(obs[0]["start"]), float(obs[-1]["end"])
    if not games:
        return None
    return float(games[0]["start"]), float(games[-1]["end"])


def intro_span(segments: list[dict] | None, hud_segs: list[dict]) -> tuple[float, float] | None:
    """Discussion avant la première partie : du début du live (après une scène de pause « Ça commence ») au premier
    bandeau de score de Valorant."""
    b = _game_bounds(segments, hud_segs)
    if b is None:
        return None
    g0, a = b[0], 0.0
    for s in segments or []:
        if s.get("type") == "pause" and s["start"] < g0:
            a = max(a, min(float(s["end"]), g0))
    return (a, g0) if g0 - a > 1 else None


def outro_span(segments: list[dict] | None, hud_segs: list[dict], duration: float) -> tuple[float, float] | None:
    """Discussion après la dernière partie, jusqu'à la fin du live (avant une scène de pause « À bientôt »)."""
    b = _game_bounds(segments, hud_segs)
    if b is None:
        return None
    g1, e = b[1], float(duration)
    for s in segments or []:
        if s.get("type") == "pause" and s["end"] > g1:
            e = min(e, max(float(s["start"]), g1))
    return (g1, e) if e - g1 > 1 else None


def _get(m, k, default=None):
    return m.get(k, default) if isinstance(m, dict) else getattr(m, k, default)


def part_of(c) -> str | None:
    """« game:3 » (partie n° 3 du live), « talk » (Just Chatting) ou None (inconnu) : un écran de transition est
    mis quand on change de partie."""
    p = _get(c, "part")
    if p:
        return p
    ms = _get(c, "moments") or []
    for m in ms:
        g = (_get(m, "meta") or {}).get("game")
        if g is not None:
            return f"game:{g}"
    if all(_get(m, "type") in TALK_TYPES for m in ms):     # sans moment : passage Just Chatting
        return "talk"
    return None


def _with_parts(clips: list[Clip]) -> list[Clip]:
    """Chaque clip sait à quelle partie il appartient (une fin de partie sans n° prend celui d'avant)."""
    prev = None
    for c in clips:
        c.part = part_of(c) or (prev if prev and prev.startswith("game:") else None)
        prev = c.part or prev
    return clips


def _talk_ends(chosen: list[Clip], first_game: float | None, last_game: float | None, speech, intro, outro) -> None:
    """F (Sky 28/11) : Just Chatting du début en ouverture, celui de la fin en conclusion, même sans moment détecté."""
    if first_game is not None and not any(c.end <= first_game for c in chosen):
        c = talk_window(intro, speech)
        if c and c.end <= first_game:
            chosen.append(c)
    if last_game is not None and not any(c.start >= last_game for c in chosen):
        c = talk_window(outro, speech)
        if c and c.start >= last_game:
            chosen.append(c)


def pick_long(moments: list[Moment], segments, hud_segs, duration: float, speech) -> list[Clip]:
    """Les clips de la vidéo YouTube « best-of du live » pour une analyse (thème « youtube »)."""
    from .moments import THEMES
    from .segments import in_scene
    talk = {id(m) for m in in_scene(moments, "discussion", segments, hud_segs)}
    wanted = set(THEMES["youtube"]["types"])
    return select_long([m for m in moments if m.type in wanted], lambda m: id(m) in talk,
                       stream_duration=duration, speech=speech, intro_span=intro_span(segments, hud_segs),
                       outro_span=outro_span(segments, hud_segs, duration))


def select_long(moments: list[Moment], is_talk, stream_duration: float | None = None,
                speech: list | None = None, intro_span: tuple[float, float] | None = None,
                outro_span: tuple[float, float] | None = None) -> list[Clip]:
    """Clips de la vidéo longue, dans l'ordre du live. `is_talk(moment)` : moment pendant un passage discussion.
    `intro_span` / `outro_span` : discussion avant la première partie / après la dernière (si aucun moment n'y
    tombe, on en prend un bout où le streamer parle)."""
    from .selection import snap_to_speech
    clips = moments_to_clips(moments, pre=LONG_PRE, post=LONG_POST, stream_duration=stream_duration)
    clips = _merge_close(snap_to_speech(clips, speech, stream_duration))
    talk = lambda c: sum(1 for m in c.moments if is_talk(m)) * 2 > len(c.moments)
    for c in clips:
        if talk(c):
            c.part = "talk"
    game = [c for c in clips if not talk(c)]
    chosen: list[Clip] = []
    rest = list(clips)
    if game:
        g0, g1 = game[0].start, game[-1].end
        for side, cap in (([c for c in clips if talk(c) and c.end <= g0], TALK_START_MAX),
                          ([c for c in clips if talk(c) and c.start >= g1], TALK_END_MAX)):
            used = 0.0
            for c in sorted(side, key=lambda c: c.score, reverse=True):
                if used + c.duration <= cap or not used:
                    chosen.append(c)
                    used += c.duration
            rest = [c for c in rest if c not in side]
        _talk_ends(chosen, g0, g1, speech, intro_span, outro_span)
    total = sum(c.duration for c in chosen)
    rest.sort(key=lambda c: c.score, reverse=True)
    for c in rest:                                  # tout ce qui est bien…
        if c.score >= GOOD_SCORE and total + c.duration <= LONG_MAX:
            chosen.append(c)
            total += c.duration
    for c in rest:                                  # … et de quoi atteindre 8 min si le live est calme
        if total >= LONG_MIN:
            break
        if c not in chosen and total + c.duration <= LONG_MAX:
            chosen.append(c)
            total += c.duration
    return _with_parts(sorted(chosen, key=lambda c: c.start))


# ---------- A : une partie racontée round par round (Sky 28/11, comme la vidéo de Goomsii) ----------
ROUND_PRE, ROUND_POST = 6.0, 3.0     # avant la première action d'un passage, après la dernière
ROUND_GAP = 15.0                     # deux actions à plus de 15 s : le temps mort entre elles est coupé
SPEECH_MIN = 0.6                     # le streamer qui parle pendant le round compte comme action (il commente)
ENDGAME_AFTER = 240.0                # dernière partie du live : bannière au plus 4 min après le dernier changement de score
VICTORY_BONUS = 60.0
ENDGAME_TYPES = ("victory", "defeat", "rr")


def _action_times(m) -> list[float]:
    """Instants d'action d'un moment : chaque kill d'un multi-kill / ace, le clutch, un rire, une mort drôle…"""
    if m.type in ("multikill", "ace"):
        ks = [float(k) for k in (m.meta.get("kills") or [])]
        return ks or [float(m.t)]
    if m.type in ("kill", "clutch", "laugh", "scream", "funny_death"):
        return [float(m.t)]
    return []


def _games(rounds) -> dict:
    """{partie: (rounds triés, fenêtre de la bannière de fin (début, fin))}. La bannière VICTOIRE / DÉFAITE
    tombe pendant le dernier round lu (le score ne change plus), avant le premier round de la partie suivante."""
    games = sorted({r.game for r in rounds})
    out = {}
    for k, g in enumerate(games):
        rs = sorted((r for r in rounds if r.game == g), key=lambda r: r.start)
        nxt = min((r.start for r in rounds if r.game == games[k + 1]), default=None) if k + 1 < len(games) else None
        out[g] = (rs, (rs[-1].start, nxt + 5 if nxt is not None else max(r.end for r in rs) + ENDGAME_AFTER))
    return out


def best_game(moments: list[Moment], rounds) -> int | None:
    """La partie à raconter : la plus riche en action, une victoire compte beaucoup."""
    games = _games(rounds)
    if not games:
        return None
    score = {}
    for g, (rs, (a, b)) in games.items():
        s = sum(m.score for m in moments if (m.meta or {}).get("game") == g)
        if any(m.type == "victory" and a <= m.t <= b for m in moments):
            s += VICTORY_BONUS
        score[g] = s + 2 * len(rs)               # une partie complète plutôt qu'un bout
    return max(games, key=lambda g: score[g])


PARTIE_MAX = 720.0                   # une partie racontée : 12 min au plus si possible (15 min dans tous les cas)


def _round_pieces(moments, rs, ea, deaths, speech, part, speech_min, gap) -> list[Clip]:
    pieces: list[Clip] = []
    for r in rs:
        lo, hi = r.start, min(r.end, ea) if r is rs[-1] else r.end   # dernier round : jusqu'à la bannière
        hi = max(hi, lo + 1)
        spans = [(t, t) for m in moments for t in _action_times(m) if lo <= t <= hi + 2]
        spans += [(float(d), float(d)) for d in deaths or [] if lo <= d <= hi + 2]
        if speech_min is not None:
            spans += [(max(lo, float(x)), min(hi, float(y))) for x, y in speech or []
                      if y - x >= speech_min and x < hi and y > lo]
        spans.sort()
        if not spans:
            continue
        groups = [list(spans[0])]
        for a, b in spans[1:]:
            if a - groups[-1][1] > gap:
                groups.append([a, b])
            else:
                groups[-1][1] = max(groups[-1][1], b)
        for a, b in groups:
            start, end = max(lo - 1, a - ROUND_PRE), min(hi + 3, b + ROUND_POST)
            ms = [m for m in moments if start <= m.t <= end and m.type not in ENDGAME_TYPES]
            pieces.append(Clip(round(start, 2), round(end, 2), ms, part=part))
    return pieces


def select_game(moments: list[Moment], rounds, deaths: list[float] | None, game: int | None = None,
                speech: list | None = None, intro: tuple | None = None, outro: tuple | None = None) -> list[Clip]:
    """Une partie, round par round : dans chaque round, de 6 s avant la première action (kill, mort, clutch, le
    streamer qui parle…) à 3 s après la dernière ; un trou de plus de 15 s entre deux actions est coupé. Puis la
    fin de partie (VICTOIRE / DÉFAITE + RR), et le Just Chatting du début et de la fin du live. 15 min au plus."""
    games = _games(rounds)
    if game is None:
        game = best_game(moments, rounds)
    if game not in games:
        return []
    rs, (ea, eb) = games[game]
    part = f"game:{game}"
    g_start = rs[0].start
    # Du plus raconté au plus serré, jusqu'à tenir en 12 min : avec ce que dit le streamer, avec seulement ses
    # longues phrases, puis seulement les actions.
    for speech_min, gap in ((SPEECH_MIN, ROUND_GAP), (3.0, 10.0), (None, 10.0)):
        pieces = _round_pieces(moments, rs, ea, deaths, speech, part, speech_min, gap)
        if sum(c.duration for c in pieces) <= PARTIE_MAX:
            break
    # Fin de partie : la bannière et les points de rang (un seul passage).
    ends = [m for m in moments if m.type in ENDGAME_TYPES and ea <= m.t <= eb]
    if ends:
        first = min(m.t for m in ends)
        for c in _merge_close(moments_to_clips([m for m in ends if m.t - first <= RR_JOIN + 10])):
            c.part = part
            pieces.append(c)
    pieces = _merge_close(pieces, gap=1.0)
    # Trop long : les passages les moins riches partent d'abord (jamais la fin de partie).
    while sum(c.duration for c in pieces) > LONG_MAX and len(pieces) > 1:
        weakest = min((c for c in pieces if not any(m.type in ENDGAME_TYPES for m in c.moments)),
                      key=lambda c: (c.score, -c.duration), default=None)
        if weakest is None:
            break
        pieces.remove(weakest)
    if pieces:                               # la conclusion vient après la bannière de fin et les RR
        _talk_ends(pieces, g_start, max(c.end for c in pieces), speech, intro, outro)
    return sorted(pieces, key=lambda c: c.start)


def pick_game(moments: list[Moment], rounds, deaths, segments, hud_segs, duration: float, speech) -> list[Clip]:
    """Les clips de la vidéo YouTube « une partie » pour une analyse (thème « youtube_partie »).
    Le Just Chatting d'ouverture / de conclusion : celui du début et de la fin du live."""
    return select_game(moments, rounds, deaths, speech=speech, intro=intro_span(segments, hud_segs),
                       outro=outro_span(segments, hud_segs, duration))


def pick_theme(theme: str, moments, rounds, deaths, segments, hud_segs, duration: float, speech) -> list[Clip]:
    """Clips d'un thème long : « youtube_partie » (une partie, si les rounds sont connus) ou « youtube »."""
    if theme == "youtube_partie" and rounds:
        clips = pick_game(moments, rounds, deaths, segments, hud_segs, duration, speech)
        if clips:
            return clips
    return pick_long(moments, segments, hud_segs, duration, speech)


# ---------- Écrans de transition (C : seulement quand on change de partie) ----------
CARD_DUR = 1.2
OUTRO_DUR = 15.0                     # D : la place des écrans de fin YouTube (5 à 20 s)

LABELS = {"ace": "ACE", "kill": "KILL", "funny_death": "OUPS…", "laugh": "MDR", "scream": "AAAAH",
          "chat_spike": "LE CHAT S'EMBALLE", "raid": "RAID !", "viewer_peak": "LES VIEWERS DÉBARQUENT",
          "viewer_clip": "CLIPPÉ PAR LE CHAT", "marker": "MOMENT FORT", "victory": "VICTOIRE", "defeat": "DÉFAITE"}


def _score(m) -> float:
    from .moments import moment_score
    s = _get(m, "score")
    return float(s) if s is not None else moment_score(_get(m, "type"), _get(m, "meta") or {})


def card_text(moments: list) -> tuple[str, str]:
    """(petite ligne, grand texte) : « ROUND 7 », « ACE ». Le meilleur moment du passage donne le texte."""
    if not moments:
        return "", "À SUIVRE"
    best = max(moments, key=_score)
    t, meta = _get(best, "type"), _get(best, "meta") or {}
    if meta.get("knives"):
        main = "AU COUTEAU"
    elif t == "multikill":
        main = f"{int(meta.get('count', 2))}K"
    elif t == "rr" and meta.get("rr") is not None:
        main = f"{int(meta['rr']):+d} RR"
    elif t in ("victory", "defeat") and meta.get("score"):
        main = f"{LABELS[t]} {meta['score']}"
    elif t == "clutch":
        main = f"CLUTCH 1V{meta['vs']}" if meta.get("vs") else "CLUTCH"
    else:
        main = LABELS.get(t, "MOMENT FORT")
    rnd = next((_get(m, "meta", {}).get("round") for m in moments if (_get(m, "meta") or {}).get("round")), None)
    top = f"ROUND {rnd}" if rnd else ("EN DIRECT" if t in ("laugh", "scream", "chat_spike", "raid", "viewer_peak") else "")
    return top, main


def parts(clips: list) -> list[str | None]:
    """La partie de chaque clip ; un clip sans info prend celle du clip d'avant."""
    out, prev = [], None
    for c in clips:
        p = part_of(c) or prev
        out.append(p)
        prev = p
    return out


def has_card(clips: list, i: int, cards: bool) -> bool:
    """Écran de transition avant le clip i : seulement quand on change de partie (Just Chatting → partie 1,
    partie 1 → partie 2, dernière partie → mot de la fin). Coupes sèches sinon, jamais avant le premier clip."""
    if not cards or i <= 0 or i >= len(clips):
        return False
    ps = parts(clips[:i + 1])
    return ps[i] is not None and ps[i - 1] is not None and ps[i] != ps[i - 1]


def part_card(clips: list, i: int) -> tuple[str, str]:
    """Texte de l'écran avant le clip i : « PARTIE 2 », « LA PARTIE » (une seule), « LE MOT DE LA FIN »."""
    ps = parts(clips)
    games = list(dict.fromkeys(p for p in ps if p and p.startswith("game:")))
    p = ps[i]
    if p and p.startswith("game:"):
        return ("", "LA PARTIE") if len(games) == 1 else ("", f"PARTIE {games.index(p) + 1}")
    if not any(q and q.startswith("game:") for q in ps[i:]):
        return ("", "LE MOT DE LA FIN")
    return ("", "PAUSE AVEC LE CHAT")


def swoosh_audio(dur: float) -> str:
    """Bruit filtré qui monte puis retombe : un « swoosh » maison (pas de son sous droits)."""
    rise = min(0.45, dur * 0.65)
    return (f"aevalsrc='0.55*(random(0)*2-1)*pow(sin(PI/2*min(t/{rise:.3f},1)),2)*exp(-5*max(t-{rise:.3f},0))'"
            f":s=48000:d={dur:.3f},highpass=f=350,lowpass=f=5200,aformat=sample_fmts=fltp:channel_layouts=stereo")


def _ass_head(W: int, H: int, styles: list[str]) -> list[str]:
    return ["[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 2", "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
            "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
            "MarginR, MarginV, Encoding", *styles,
            "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]


def card_ass(fmt: str, top: str, main: str, dur: float = CARD_DUR) -> str:
    """Bande violette qui traverse l'écran + le texte qui glisse depuis la gauche."""
    from .overlays import BLACK, FONT, GOLD, VIOLET, WHITE, _esc, ass_time
    W, H = (1920, 1080) if fmt == "16x9" else (1080, 1920)
    big = 150 if fmt == "16x9" else 130
    small = 64 if fmt == "16x9" else 58
    cy = H // 2
    end = ass_time(dur)
    band_h = big + (small + 40 if top else 70)
    band = f"m 0 0 l {W + 300} 0 l {W + 200} {band_h} l -100 {band_h}"
    ev = [
        f"Dialogue: 0,0:00:00.00,{end},Band,,0,0,0,,{{\\p1\\an7\\move({-W - 400},{cy - band_h // 2},-150,{cy - band_h // 2},0,180)"
        f"\\1c{VIOLET}\\alpha&H20&}}{band}",
        f"Dialogue: 1,0:00:00.00,{end},Main,,0,0,0,,{{\\an5\\move({-W // 2},{cy + (small // 2 if top else 0)},{W // 2},"
        f"{cy + (small // 2 if top else 0)},40,220)\\fad(0,150)}}{_esc(main)}",
    ]
    if top:
        ev.append(f"Dialogue: 1,0:00:00.00,{end},Top,,0,0,0,,{{\\an5\\move({W + W // 2},{cy - big // 2 - 10},{W // 2},"
                  f"{cy - big // 2 - 10},60,240)\\fad(0,150)}}{_esc(top)}")
    return "\n".join(_ass_head(W, H, [
        f"Style: Band,{FONT},10,{VIOLET},{VIOLET},{VIOLET},{BLACK},0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
        f"Style: Main,{FONT},{big},{WHITE},{WHITE},{BLACK},&H80000000,-1,1,0,0,100,100,4,0,1,8,5,5,40,40,0,1",
        f"Style: Top,{FONT},{small},{GOLD},{GOLD},{BLACK},&H80000000,-1,1,0,0,100,100,6,0,1,5,3,5,40,40,0,1",
    ]) + ev + [""])


def outro_ass(fmt: str, dur: float = OUTRO_DUR, channel: str | None = None) -> str:
    """D : « ABONNE-TOI » en haut, « et rejoins-moi sur Twitch » + l'adresse de la chaîne en bas ; le milieu reste
    libre pour les écrans de fin YouTube (vidéo suivante, bouton d'abonnement), ajoutés dans YouTube Studio."""
    from .overlays import BLACK, FONT, VIOLET, WHITE, _esc, ass_time
    W, H = (1920, 1080) if fmt == "16x9" else (1080, 1920)
    size = 110 if fmt == "16x9" else 100
    bw, bh = (900, 190) if fmt == "16x9" else (900, 180)
    x0, y0 = (W - bw) // 2, (60 if fmt == "16x9" else 140)
    end = ass_time(dur)
    box = (f"m 0 30 b 0 0 0 0 30 0 l {bw - 30} 0 b {bw} 0 {bw} 0 {bw} 30 l {bw} {bh - 30} b {bw} {bh} {bw} {bh} "
           f"{bw - 30} {bh} l 30 {bh} b 0 {bh} 0 {bh} 0 {bh - 30}")
    pop = "\\fscx40\\fscy40\\t(0,220,\\fscx108\\fscy108)\\t(220,340,\\fscx100\\fscy100)"
    cx, cy = W // 2, y0 + bh // 2
    ev = [
        f"Dialogue: 0,0:00:00.00,{end},Box,,0,0,0,,{{\\p1\\an7\\pos({x0},{y0})\\org({cx},{cy}){pop}\\fad(0,400)}}{box}",
        f"Dialogue: 1,0:00:00.00,{end},Sub,,0,0,0,,{{\\an5\\pos({cx},{cy})\\org({cx},{cy}){pop}\\fad(0,400)}}ABONNE-TOI",
        f"Dialogue: 1,0:00:00.40,{end},Small,,0,0,0,,{{\\an5\\pos({cx},{H - (190 if channel else 120)})\\fad(250,400)}}"
        "et rejoins-moi en live sur Twitch",
    ]
    if channel:
        ev.append(f"Dialogue: 1,0:00:00.70,{end},Chan,,0,0,0,,{{\\an5\\pos({cx},{H - 95})\\fad(250,400)}}"
                  f"twitch.tv/{_esc(channel)}")
    return "\n".join(_ass_head(W, H, [
        f"Style: Box,{FONT},10,{VIOLET},{VIOLET},{BLACK},{BLACK},0,0,0,0,100,100,0,0,1,6,0,7,0,0,0,1",
        f"Style: Sub,{FONT},{size},{WHITE},{WHITE},{BLACK},&H80000000,-1,0,0,0,100,100,3,0,1,0,4,5,40,40,0,1",
        f"Style: Small,{FONT},{size // 2},{WHITE},{WHITE},{BLACK},&H80000000,-1,0,0,0,100,100,1,0,1,4,2,5,40,40,0,1",
        f"Style: Chan,{FONT},{size * 6 // 10},{WHITE},{WHITE},{VIOLET},&H80000000,-1,0,0,0,100,100,1,0,3,14,0,5,40,40,0,1",
    ]) + ev + [""])


def still_cmd(spec, clip, src: dict, at: float, out: str, enc: str, ass_file: str, dur: float) -> list[str]:
    """Image figée du stream (floutée, assombrie) + texte animé + swoosh : segment au même format que les clips."""
    from .overlays import ass_filter
    from .render import _layout, encoder_args
    fps = spec.fps
    nf = max(1, int(round(dur * fps)))
    dark = -0.14 if dur < 5 else -0.3                # l'écran de fin : plus sombre (textes et écrans de fin lisibles)
    lay = _layout(spec.fmt, clip.layout, src["width"], src["height"], clip.cam or spec.cam, fps, focus=clip.focus)
    vf = (f"{lay};[lay]trim=end_frame=1,setpts=PTS-STARTPTS,gblur=sigma=22,eq=brightness={dark}:saturation=1.25,"
          f"loop=loop={nf - 1}:size=1:start=0,setpts=N/{fps}/TB,{ass_filter(ass_file)},format=yuv420p[v]")
    return ["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0.0, at):.3f}", "-t", "1", "-i", spec.video,
            "-f", "lavfi", "-i", swoosh_audio(min(dur, 0.8)),
            "-filter_complex", vf + ";[1:a]apad,atrim=0:" + f"{dur:.3f}[a]", "-map", "[v]", "-map", "[a]",
            "-r", str(fps), *encoder_args(enc), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", f"{dur:.3f}", out]


# ---------- B : zoom sur la webcam quand le streamer réagit (option) ----------
ZOOM_SCALE = 2.4                     # la webcam grossit 2,4 fois…
ZOOM_MAX_W = 820                     # … sans dépasser 820 px de large (sur 1920)
ZOOM_MIN = 1.0
REACT = {"laugh": (-0.4, 2.6), "scream": (-0.3, 2.4), "funny_death": (0.2, 2.6)}
AFTER_BIG = (0.4, 2.8)               # après le dernier kill d'un ace / clutch / triple kill : la réaction


def reaction_zooms(moments: list, start: float, end: float) -> list[tuple[float, float]]:
    """Instants (temps du clip) où la webcam passe en grand : rires, cris, morts drôles, et juste après un gros
    moment (ace, clutch, 3 kills ou plus, victoire)."""
    spans = []
    for m in moments or []:
        t, typ, meta = float(_get(m, "t")), _get(m, "type"), _get(m, "meta") or {}
        if typ in REACT:
            a, b = REACT[typ]
            spans.append((t + a, t + b))
        elif typ in ("ace", "clutch", "victory") or (typ == "multikill" and int(meta.get("count", 2)) >= 3):
            k = max([float(x) for x in meta.get("kills") or []] or [t])
            spans.append((k + AFTER_BIG[0], k + AFTER_BIG[1]))
    dur = end - start
    out: list[list[float]] = []
    for a, b in sorted(spans):
        a, b = max(0.3, a - start), min(dur - 0.3, b - start)
        if b - a < ZOOM_MIN:
            continue
        if out and a <= out[-1][1] + 0.5:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(round(a, 2), round(b, 2)) for a, b in out]


def cam_zoom_filter(cam, src_w: int, src_h: int, zooms: list, inp: str, last: str) -> tuple[str, str]:
    """Webcam recadrée et agrandie (bord violet), posée sur [last] dans son coin pendant les `zooms` (16:9)."""
    from .render import FRIEND_BORDER, _even
    cw, ch = _even(cam.w * src_w), _even(cam.h * src_h)
    cx, cy = _even(cam.x * src_w), _even(cam.y * src_h)
    zw = _even(min(cam.w * 1920 * ZOOM_SCALE, ZOOM_MAX_W))
    x = "24" if cam.x + cam.w / 2 < 0.5 else "W-w-24"
    y = "24" if cam.y + cam.h / 2 < 0.5 else "H-h-24"
    on = "+".join(f"between(t,{a:.2f},{b:.2f})" for a, b in zooms)
    chain = (f"{inp}crop={cw}:{ch}:{cx}:{cy},scale={zw - 16}:-2,pad=iw+16:ih+16:8:8:color={FRIEND_BORDER},setsar=1[cz];"
             f"{last}[cz]overlay={x}:{y}:enable='{on}'[czo]")
    return chain, "[czo]"


# ---------- Chapitres, description ----------
def timeline(clips: list, cards: bool) -> list[float]:
    """Instant où commence chaque passage dans la vidéo finale (écran de transition compris)."""
    out, t = [], 0.0
    for i, c in enumerate(clips):
        t += CARD_DUR if has_card(clips, i, cards) else 0.0
        out.append(round(t, 2))
        t += c.end - c.start
    return out


def chapters(clips: list, cards: bool) -> list[tuple[float, str]]:
    """Chapitres YouTube : Just Chatting du début, chaque partie, mot de la fin. Au moins 3, de 10 s minimum."""
    if not clips:
        return []
    starts = timeline(clips, cards)
    ps = parts(clips)
    gi = [i for i, p in enumerate(ps) if p and p.startswith("game:")]
    groups: list[list] = []                       # [clé, début, [textes], n° de partie]
    n_game = 0
    for i, c in enumerate(clips):
        p = ps[i]
        if p and p.startswith("game:"):
            key = ("partie", p)
        elif not gi or i < gi[0]:
            key = "debut"
        elif i > gi[-1]:
            key = "fin"
        else:
            key = groups[-1][0] if groups else "debut"
        if not groups or groups[-1][0] != key:
            if isinstance(key, tuple):
                n_game += 1
            # Le chapitre commence avec l'écran de transition.
            groups.append([key, starts[i] - (CARD_DUR if has_card(clips, i, cards) else 0.0), [], n_game])
        groups[-1][2].append(card_text(c.moments)[1])
    out = []
    for key, t, labels, n in groups:
        if key == "debut":
            name = "Début du live avec le chat"
        elif key == "fin":
            name = "Le mot de la fin"
        else:
            top = [x for x in dict.fromkeys(labels) if x not in ("KILL", "À SUIVRE")][:3]
            name = f"Partie {n}" + (f" : {', '.join(top)}" if top else "")
        out.append((round(t, 2), name))
    out[0] = (0.0, out[0][1])
    total = starts[-1] + clips[-1].end - clips[-1].start
    if len(out) < 3:                               # une seule partie : un chapitre par gros moment
        head = out[0]
        tail = out[-1] if len(out) > 1 and groups[-1][0] == "fin" else None
        out = [head]
        for i, c in enumerate(clips):
            if ps[i] and ps[i].startswith("game:"):
                lab = card_text(c.moments)[1]
                rnd = card_text(c.moments)[0]
                if lab not in ("KILL", "À SUIVRE") and starts[i] - out[-1][0] >= 10:
                    out.append((starts[i], f"{rnd.capitalize()} : {lab}" if rnd else lab.capitalize()))
        if tail:
            out.append(tail)
    clean = [out[0]]
    for t, name in out[1:]:
        if t - clean[-1][0] >= 10 and total - t >= 10:
            clean.append((t, name))
    return clean if len(clean) >= 3 else []


def fmt_ts(t: float) -> str:
    t = int(t)
    h, m, s = t // 3600, (t % 3600) // 60, t % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def description_text(post: dict | None, chaps: list[tuple[float, str]], channel: str | None = None) -> str:
    post = post or {}
    lines = [post.get("title") or "Best-of du live", ""]
    if post.get("description"):
        lines += [post["description"], ""]
    if channel:
        lines += [f"Rejoins-moi en live sur Twitch : https://www.twitch.tv/{channel}", ""]
    if chaps:
        lines += ["Chapitres :", *[f"{fmt_ts(t)} {name}" for t, name in chaps], ""]
    tags = [t for t in post.get("hashtags") or [] if t not in ("#shorts", "#fyp")]
    if tags:
        lines.append(" ".join(tags))
    return "\n".join(lines).strip() + "\n"


# ---------- E : miniature avec la tête du streamer ----------
# Bibliothèque « Têtes » (Documents/Sklip/Têtes, créée par l'appli avec sa note : app/src/main/faces.js).
MOODS = {"rire": ("laugh", "funny_death", "scream"), "choc": ("ace", "clutch", "multikill"),
         "content": ("victory",), "rage": ("defeat",)}
FACE_EXT = (".png", ".webp", ".jpg", ".jpeg")


def _plain(s: str) -> str:
    import unicodedata
    return "".join(ch for ch in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(ch) != "Mn")


def best_moment(clips: list):
    ms = [m for c in clips for m in (_get(c, "moments") or [])]
    return max(ms, key=_score) if ms else None


def mood_of(m) -> str:
    if m is None:
        return "content"
    t, meta = _get(m, "type"), _get(m, "meta") or {}
    if t == "rr":
        return "content" if (meta.get("rr") or 0) >= 0 else "rage"
    return next((k for k, types in MOODS.items() if t in types), "choc")


def list_faces(folder: str | None) -> list[str]:
    if not folder or not os.path.isdir(folder):
        return []
    return sorted(os.path.join(folder, f) for f in os.listdir(folder) if f.lower().endswith(FACE_EXT))


def pick_face(folder: str | None, mood: str, index: int = 0) -> str | None:
    """Une tête de la bibliothèque : d'abord celles de la bonne expression, puis les autres ; `index` fait défiler."""
    faces = list_faces(folder)
    if not faces:
        return None
    good = [f for f in faces if mood in _plain(os.path.basename(f))]
    order = good + [f for f in faces if f not in good]
    return order[index % len(order)]


def thumb_lines(clips: list, partie: bool = False) -> tuple[str, str]:
    """Deux lignes de miniature (blanc puis jaune), comme les vidéos Valorant qui marchent."""
    m = best_moment(clips)
    t, meta = (_get(m, "type"), _get(m, "meta") or {}) if m else (None, {})
    if meta.get("knives"):
        return "AU COUTEAU", "SÉRIEUX ?!"
    if t == "ace":
        return "J'AI FAIT", "UN ACE ?!"
    if t == "clutch" and meta.get("vs"):
        return f"CLUTCH 1V{meta['vs']}", "IMPOSSIBLE ?!"
    if t == "multikill" and int(meta.get("count", 2)) >= 3:
        return f"{int(meta['count'])} KILLS", "EN UN ROUND ?!"
    if t in ("laugh", "funny_death"):
        return "J'AI PAS", "TENU…"
    return ("LA PARTIE", "LA PLUS FOLLE ?!") if partie else ("LE BEST-OF", "DU LIVE ?!")


def thumbnail(spec, out: str, ass_dir: str, face: str | None = None, lines: tuple[str, str] | None = None,
              at: float | None = None) -> str | None:
    """Miniature 1280×720 : l'image du meilleur moment (couleurs boostées), la tête du streamer à droite (une photo
    détourée de la bibliothèque, sinon sa webcam agrandie) et deux grosses lignes blanc / jaune à gauche."""
    import subprocess

    from .overlays import BLACK, FONT, GOLD, WHITE, _esc, ass_filter
    if not spec.clips:
        return None
    m = best_moment(spec.clips)
    if at is None:
        if m is not None:
            best = next(c for c in spec.clips if any(x is m for x in (_get(c, "moments") or [])))
            at = min(max(best.start, float(_get(m, "t")) - 0.25), best.end - 0.1)
        else:
            at = (spec.clips[0].start + spec.clips[0].end) / 2
    l1, l2 = lines or thumb_lines(spec.clips)
    fs = lambda s: 150 if len(s) <= 8 else (118 if len(s) <= 11 else 92)
    ass = "\n".join(_ass_head(1280, 720, [
        f"Style: L1,{FONT},150,{WHITE},{WHITE},{BLACK},&HA0000000,-1,0,0,0,100,100,2,-3,1,12,7,7,46,40,40,1",
        f"Style: L2,{FONT},150,{GOLD},{GOLD},{BLACK},&HA0000000,-1,0,0,0,100,100,2,-3,1,12,7,7,46,40,40,1",
    ]) + [f"Dialogue: 1,0:00:00.00,0:00:05.00,L1,,0,0,0,,{{\\pos(46,40)\\fs{fs(l1)}}}{_esc(l1)}",
          f"Dialogue: 1,0:00:00.00,0:00:05.00,L2,,0,0,0,,{{\\pos(46,{48 + fs(l1)})\\fs{fs(l2)}}}{_esc(l2)}", ""])
    ass_file = os.path.join(ass_dir, "thumb.ass")
    with open(ass_file, "w", encoding="utf-8") as f:
        f.write(ass)
    bg = ("scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,eq=contrast=1.12:saturation=1.35,"
          "unsharp=5:5:0.8,vignette=PI/5")
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{at:.3f}", "-i", spec.video]
    if face and os.path.exists(face):
        # Photo détourée : grande, en bas à droite, avec un halo violet derrière.
        cmd += ["-i", face]
        fc = (f"[0:v]{bg}[bg];[1:v]format=rgba,scale=-2:680[f];[f]split[f1][f2];"
              "[f2]lutrgb=r=145:g=70:b=255,boxblur=18:2[glow];"
              "[bg][glow]overlay=W-w-10:H-h+20[b1];[b1][f1]overlay=W-w-20:H-h[c]")
    elif spec.cam is not None:
        c = spec.cam
        fc = (f"[0:v]split[a][b];[a]{bg}[bg];[b]crop=iw*{c.w:.4f}:ih*{c.h:.4f}:iw*{c.x:.4f}:ih*{c.y:.4f},"
              "scale=-2:430,eq=saturation=1.2,pad=iw+16:ih+16:8:8:color=0x9146FF[f];"
              "[bg][f]overlay=W-w-30:H-h-30[c]")
    else:
        fc = f"[0:v]{bg}[c]"
    fc += f";[c]{ass_filter(ass_file)}[v]"
    r = subprocess.run(cmd + ["-frames:v", "1", "-filter_complex", fc, "-map", "[v]", "-q:v", "2", out],
                       capture_output=True, text=True)
    return out if r.returncode == 0 and os.path.exists(out) else None

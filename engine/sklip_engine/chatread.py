"""Messages du chat lus à voix haute par le streamer → bulle façon Twitch sur la vidéo.

Pendant le live, Sklip garde chaque message (pseudo, texte, couleur, badges). Dans les clips choisis, on transcrit
la voix du streamer (piste micro) et on cherche les messages qu'il lit : les mots du message prononcés dans le même
ordre, peu après que le message a été posté. La bulle s'affiche pendant qu'il le lit ; l'éditeur permet de
l'enlever ou d'en mettre une autre à la main.
"""
from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

MAX_DELAY = 180.0       # un message est lu au plus 3 min après avoir été posté
MIN_TOKENS = 3          # « gg », « mdr » : trop courts pour être sûrs que c'est une lecture
MIN_MATCH = 0.6         # part des mots du message retrouvés dans ce que dit le streamer
SHOW_BEFORE = 0.3       # la bulle apparaît un peu avant qu'il commence à lire…
SHOW_MIN = 2.5          # … reste au moins 2,5 s …
SHOW_AFTER = 1.0        # … et 1 s après la fin de la lecture


def tokens(text: str) -> list[str]:
    """Mots comparables : minuscules, sans accents ni ponctuation (« J'envoie » → « j », « envoie »)."""
    t = unicodedata.normalize("NFKD", text.lower())
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    return re.findall(r"[a-z0-9]+", t)


def _same(a: str, b: str) -> bool:
    if a == b:
        return True
    return len(a) >= 4 and len(b) >= 4 and SequenceMatcher(None, a, b).ratio() >= 0.8   # fautes de transcription


def _best_read(msg: list[str], spoken: list[tuple[float, float, str]]) -> tuple[float, int, int] | None:
    """Meilleur passage où les mots du message sont prononcés dans l'ordre : (part retrouvée, i premier, i dernier)."""
    best = None
    span = len(msg) * 2 + 3                       # le streamer ajoute des mots, la transcription en saute
    for i0 in range(len(spoken)):
        if not any(_same(spoken[i0][2], m) for m in msg[:3]):
            continue                              # une lecture commence par un des premiers mots
        j, found, first, last = 0, 0, None, None
        for k in range(i0, min(len(spoken), i0 + span)):
            for jj in range(j, min(len(msg), j + 3)):          # suit le message, en tolérant des mots sautés
                if _same(spoken[k][2], msg[jj]):
                    found += 1
                    first = k if first is None else first
                    last, j = k, jj + 1
                    break
            if j >= len(msg):
                break
        score = found / len(msg)
        if first is not None and (best is None or score > best[0]):
            best = (score, first, last)
    return best


def find_read_messages(words: list[dict], messages: list[dict]) -> list[dict]:
    """words : [{start, end, text}] (temps du stream) ; messages : [{t, user, text, color, badges}].
    Renvoie les messages lus : {**message, read_start, read_end}."""
    spoken = []
    for w in sorted(words, key=lambda w: w["start"]):
        for tok in tokens(w["text"]):
            spoken.append((float(w["start"]), float(w["end"]), tok))
    out = []
    for m in messages:
        msg = tokens(m.get("text", ""))
        if len(msg) < MIN_TOKENS:
            continue
        after = [s for s in spoken if m["t"] - 0.5 <= s[0] <= m["t"] + MAX_DELAY]
        best = _best_read(msg, after)
        if best and best[0] >= MIN_MATCH and best[2] > best[1]:
            out.append({**m, "read_start": round(after[best[1]][0], 2), "read_end": round(after[best[2]][1], 2)})
    # Deux messages pour la même lecture : on garde celui qui colle le mieux (le plus long retrouvé).
    out.sort(key=lambda r: r["read_start"])
    kept: list[dict] = []
    for r in out:
        if kept and r["read_start"] < kept[-1]["read_end"]:
            if len(tokens(r["text"])) > len(tokens(kept[-1]["text"])):
                kept[-1] = r
            continue
        kept.append(r)
    return kept


def bubble_times(read_start: float, read_end: float) -> tuple[float, float]:
    """Quand afficher la bulle (temps du stream)."""
    a = read_start - SHOW_BEFORE
    return round(a, 2), round(max(read_end + SHOW_AFTER, a + SHOW_MIN), 2)


def attach_chat(clips: list[dict], messages: list[dict], transcribe_clip, progress=None) -> None:
    """Ajoute clip["chat"] (bulles des messages lus) aux clips. transcribe_clip(start, end) → mots (temps du stream).
    Seuls les clips avec des messages récents sont transcrits ; un même clip n'est transcrit qu'une fois."""
    if not messages:
        return
    cache: dict = {}
    todo = [c for c in clips if any(c["start"] - MAX_DELAY <= m["t"] <= c["end"] for m in messages)]
    for n, c in enumerate(todo):
        if progress:
            progress(n / max(1, len(todo)))
        key = (round(c["start"], 2), round(c["end"], 2))
        if key not in cache:
            try:
                words = transcribe_clip(c["start"], c["end"])
            except Exception:
                words = []                       # pas de transcription possible : pas de bulle automatique
            near = [m for m in messages if c["start"] - MAX_DELAY <= m["t"] <= c["end"]]
            cache[key] = find_read_messages(words, near)
        bubbles = []
        for r in cache[key]:
            a, b = bubble_times(r["read_start"], r["read_end"])
            if c["start"] <= r["read_start"] < c["end"]:
                bubbles.append({"t": r["t"], "user": r["user"], "text": r["text"], "color": r.get("color"),
                                "badges": r.get("badges", []), "start": max(a, c["start"]), "end": min(b, c["end"]),
                                "auto": True})
        if bubbles:
            c["chat"] = bubbles

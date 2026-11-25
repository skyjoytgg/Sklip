"""Sous-titres style TikTok (mot par mot) et textes à l'écran (« ACE », compteur de kills, pseudo).

Tout est écrit dans un fichier ASS par clip, puis incrusté par FFmpeg (filtre `ass`, police fournie).
"""
from __future__ import annotations

import os
from dataclasses import dataclass

FONTS_DIR = os.path.join(os.path.dirname(__file__), "fonts")
FONT = "Montserrat"

# Couleurs ASS : &HAABBGGRR
WHITE = "&H00FFFFFF"
HIGHLIGHT = "&H0000D7FF"    # jaune doré (mot prononcé)
VIOLET = "&H00FF4691"       # #9146FF
BLACK = "&H00000000"
GOLD = "&H0000C4FF"         # #FFC400


@dataclass
class Word:
    start: float   # secondes, relatives au début du clip
    end: float
    text: str


def ass_time(t: float) -> str:
    t = max(0.0, t)
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", " ")


def group_words(words: list[Word], max_words: int = 3, max_gap: float = 0.6, max_chars: int = 22) -> list[list[Word]]:
    """Regroupe les mots en petites phrases affichées ensemble (2–3 mots, comme sur TikTok)."""
    groups: list[list[Word]] = []
    for w in words:
        if not w.text.strip():
            continue
        g = groups[-1] if groups else None
        if (g and len(g) < max_words and w.start - g[-1].end <= max_gap
                and sum(len(x.text) + 1 for x in g) + len(w.text) <= max_chars
                and not g[-1].text.rstrip().endswith((".", "!", "?"))):
            g.append(w)
        else:
            groups.append([w])
    return groups


def subtitle_events(words: list[Word], duration: float) -> list[str]:
    """Une ligne de dialogue par mot : la phrase entière, le mot prononcé en couleur."""
    events = []
    groups = group_words(merge_punctuation(words))   # « ça » + « ! » tapés à la main → « ça! »
    for gi, g in enumerate(groups):
        nxt = groups[gi + 1][0].start if gi + 1 < len(groups) else duration
        for i, w in enumerate(g):
            start = w.start
            end = g[i + 1].start if i + 1 < len(g) else w.end + 0.15
            end = min(end, nxt, duration)            # jamais deux phrases à l'écran en même temps
            if end <= start:
                continue
            parts = []
            for j, x in enumerate(g):
                txt = _esc(x.text.strip().upper())
                parts.append(f"{{\\c{HIGHLIGHT}\\fscx108\\fscy108}}{txt}{{\\c{WHITE}\\fscx100\\fscy100}}" if j == i else txt)
            events.append(f"Dialogue: 1,{ass_time(start)},{ass_time(end)},Sub,,0,0,0,,{' '.join(parts)}")
    return events


def overlay_events(moments: list[dict], clip_start: float, duration: float, texts: dict, kill_count_before: int = 0) -> list[str]:
    """Textes à l'écran pour un clip. `moments` : moments du clip (temps du stream)."""
    if not texts or not texts.get("enabled"):
        return []
    ev = []
    pop = "{\\fscx40\\fscy40\\t(0,180,\\fscx115\\fscy115)\\t(180,300,\\fscx100\\fscy100)\\fad(0,250)}"
    kills = kill_count_before
    for m in sorted(moments, key=lambda m: m["t"]):
        t = m["t"] - clip_start
        if t < 0 or t > duration:
            continue
        if m["type"] == "ace" and texts.get("ace", True):
            ev.append(f"Dialogue: 2,{ass_time(t - 0.2)},{ass_time(min(duration, t + 1.6))},Ace,,0,0,0,,{pop}ACE")
        elif m["type"] in ("kill", "multikill") and texts.get("killCounter", True):
            n = int(m.get("meta", {}).get("count", 1)) if m["type"] == "multikill" else 1
            kills = n if m["type"] == "multikill" else kills + 1
            label = f"{kills} KILL" + ("S" if kills > 1 else "")
            ev.append(f"Dialogue: 2,{ass_time(t - 0.1)},{ass_time(min(duration, t + 1.3))},Kills,,0,0,0,,{pop}{label}")
        elif m["type"] == "clutch" and texts.get("killCounter", True):
            sit = m.get("meta", {}).get("situation", "")
            ev.append(f"Dialogue: 2,{ass_time(t - 0.2)},{ass_time(min(duration, t + 1.6))},Kills,,0,0,0,,{pop}CLUTCH {_esc(sit).upper()}".rstrip())
    pseudo = (texts.get("pseudo") or "").strip()
    if pseudo:
        ev.append(f"Dialogue: 0,{ass_time(0)},{ass_time(duration)},Pseudo,,0,0,0,,{_esc(pseudo)}")
    return ev


def build_ass(fmt: str, duration: float, words: list[Word] | None = None, moments: list[dict] | None = None,
              clip_start: float = 0.0, texts: dict | None = None) -> str | None:
    """Retourne le contenu ASS du clip, ou None s'il n'y a rien à afficher."""
    events = subtitle_events(words or [], duration) + overlay_events(moments or [], clip_start, duration, texts or {})
    if not events:
        return None
    vertical = fmt == "9x16"
    W, H = (1080, 1920) if vertical else (1920, 1080)
    sub_size, sub_margin = (88, 620) if vertical else (64, 90)       # 9:16 : sous la cam, dans le jeu
    styles = [
        f"Style: Sub,{FONT},{sub_size},{WHITE},{WHITE},{BLACK},&H80000000,-1,0,0,0,100,100,0,0,1,6,2,2,60,60,{sub_margin},1",
        f"Style: Ace,{FONT},{190 if vertical else 170},{GOLD},{GOLD},{BLACK},&H80000000,-1,0,0,0,100,100,4,0,1,9,4,5,40,40,0,1",
        f"Style: Kills,{FONT},{110 if vertical else 96},{WHITE},{WHITE},{VIOLET},&H80000000,-1,0,0,0,100,100,2,0,1,8,3,5,40,40,0,1",
        f"Style: Pseudo,{FONT},{44 if vertical else 36},{WHITE},{WHITE},{VIOLET},&H00000000,-1,0,0,0,100,100,1,0,3,12,0,1,40,40,40,1",
    ]
    # Les textes « ACE » / kills : un peu au-dessus du centre de la zone de jeu.
    pos = "{\\pos(%d,%d)}" % (W // 2, int(H * (0.52 if vertical else 0.42)))
    events = [e.replace(",Ace,,0,0,0,,", ",Ace,,0,0,0,," + pos).replace(",Kills,,0,0,0,,", ",Kills,,0,0,0,," + pos)
              for e in events]
    return "\n".join([
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 0",
        "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding",
        *styles, "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        *events, "",
    ])


def ffmpeg_path(p: str) -> str:
    """Échappe un chemin pour un filtre FFmpeg (Windows : C\\:/dossier/fichier.ass)."""
    p = os.path.abspath(p).replace("\\", "/")
    return p.replace(":", "\\:").replace("'", "\\'")


def ass_filter(ass_file: str) -> str:
    return f"ass='{ffmpeg_path(ass_file)}':fontsdir='{ffmpeg_path(FONTS_DIR)}'"


# ---------- Transcription (sous-titres en français) ----------

_model = None


def transcribe(audio_path: str, start: float, end: float, language: str = "fr", model_size: str = "small") -> list[Word]:
    """Mots prononcés entre `start` et `end` (temps relatifs au clip). Utilise faster-whisper.
    Source conseillée : la piste micro séparée (sinon le son mixé)."""
    global _model
    try:
        from faster_whisper import WhisperModel  # import tardif : modèle lourd, optionnel
    except ImportError as e:
        raise RuntimeError("Sous-titres : faster-whisper n'est pas installé") from e
    import numpy as np
    from .audio_sync import load_audio
    if _model is None:
        _model = WhisperModel(model_size, device="auto", compute_type="int8")
    audio = load_audio(audio_path, rate=16000, start=start, duration=end - start).astype(np.float32)
    segments, _ = _model.transcribe(audio, language=language, word_timestamps=True, vad_filter=True)
    return merge_punctuation([Word(w.start, w.end, w.word.strip()) for s in segments for w in (s.words or [])
                              if w.word.strip()])


def merge_punctuation(words: list[Word]) -> list[Word]:
    """Recolle la ponctuation seule (« ! ») et les élisions (« T » + « 'es ») au mot d'avant : « Oulah! », « T'es »."""
    out: list[Word] = []
    for w in words:
        t = w.text.strip()
        if out and (all(not ch.isalnum() for ch in t) or t[:1] in ("'", "’", "-")):
            prev = out[-1]
            sep = "" if t[:1] in ("'", "’", "-") or t[:1] in ".,!?…" else " "
            out[-1] = Word(prev.start, max(prev.end, w.end), prev.text + sep + t)
        else:
            out.append(Word(w.start, w.end, t))
    return out

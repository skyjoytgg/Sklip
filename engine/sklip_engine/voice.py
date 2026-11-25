"""Rires et cris du streamer, repérés dans SA piste micro (capturée à part par Sklip).

- Cri : la voix est nettement plus forte que d'habitude (≥ 10 dB au-dessus de son niveau de parole) pendant au moins 0,3 s.
- Rire : des petites rafales très régulières (« ha-ha-ha », 3 à 8 par seconde) pendant au moins 0,8 s,
  confirmées par la transcription (« hahaha », « mdr »…) quand elle est disponible : la parole rapide a aussi un rythme,
  mais elle donne de vrais mots.
Tout est relatif à la voix du streamer : un streamer qui parle fort ou doucement est traité pareil.
"""
from __future__ import annotations

import re

import numpy as np

RATE = 16000
HOP = 0.025                  # s entre deux mesures de volume
WIN = 0.05
SCREAM_DB = 10.0             # au-dessus du niveau de parole habituel
SCREAM_MIN = 0.3             # s
LAUGH_WIN = 1.6              # s de fenêtre pour mesurer le rythme
LAUGH_MIN = 0.8
LAUGH_PERIOD = (0.12, 0.32)  # s entre deux « ha » (3 à 8 par seconde)
LAUGH_REGULARITY = 0.45      # force du rythme (autocorrélation) minimale
VOICED = 0.45               # « harmonicité » minimale d'une trame de voix (un tir ou une explosion : du bruit)
SCREAM_VOICED = 0.5         # part de trames voisées dans un cri
LAUGH_VOICED = 0.25         # un rire mélange « h » soufflés et voyelles
PER_HOUR = 8                # on garde au plus les 8 meilleurs rires et 8 meilleurs cris par heure
LAUGH_WORDS = re.compile(r"^(?:[haeiouy]*h[aeiouy]+h*[aeiouy]*h?|a+h+|h+a+|mdr+|ptdr+|xd+|lol+|rires?|\W+)$", re.I)


def frame_db(x: np.ndarray, rate: int = RATE) -> np.ndarray:
    """Volume (dB) toutes les 25 ms."""
    hop, win = int(HOP * rate), int(WIN * rate)
    if len(x) < win:
        return np.zeros(0)
    n = 1 + (len(x) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    p = (x[idx].astype(np.float64) ** 2).mean(axis=1)
    return 10 * np.log10(p + 1e-10)


def voicing(x: np.ndarray, rate: int = RATE) -> np.ndarray:
    """Pour chaque trame (même découpage que frame_db) : 0..1, à quel point c'est une voix (son harmonique,
    hauteur entre 80 et 700 Hz). Les tirs, pas et explosions du jeu sont du bruit : proche de 0."""
    hop, win = int(HOP * rate), int(WIN * rate)
    if len(x) < win:
        return np.zeros(0)
    n = 1 + (len(x) - win) // hop
    lo, hi = int(rate / 700), int(rate / 80)
    out = np.zeros(n, np.float32)
    for a in range(0, n, 4096):                         # par paquets : peu de mémoire même pour 4 h
        b = min(n, a + 4096)
        idx = np.arange(win)[None, :] + hop * np.arange(a, b)[:, None]
        f = x[idx].astype(np.float32)
        f = f - f.mean(axis=1, keepdims=True)
        spec = np.fft.rfft(f, 2 * win, axis=1)
        ac = np.fft.irfft(np.abs(spec) ** 2, axis=1)[:, :win]
        out[a:b] = np.clip(ac[:, lo:hi].max(axis=1) / (ac[:, 0] + 1e-9), 0, 1)
    return out


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Suites de True : [(début, fin exclue)]."""
    out, start = [], None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i)); start = None
    if start is not None:
        out.append((start, len(mask)))
    return out


def _merge(spans: list[tuple[float, float]], gap: float) -> list[tuple[float, float]]:
    out: list[list[float]] = []
    for a, b in sorted(spans):
        if out and a - out[-1][1] <= gap:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


def speech_level(db: np.ndarray) -> tuple[float, float]:
    """(bruit de fond, niveau de parole habituel) en dB."""
    floor = float(np.percentile(db, 10))
    active = db[db > floor + 15]
    if active.size < 40:                     # moins d'une seconde de voix : rien à mesurer
        return floor, floor + 30
    return floor, float(np.median(active))


def find_screams(db: np.ndarray, level: float, voiced: np.ndarray | None = None) -> list[dict]:
    out = []
    loud = db > level + SCREAM_DB
    spans = [(a * HOP, b * HOP) for a, b in _runs(loud)]
    for a, b in _merge(spans, 0.4):
        if b - a >= SCREAM_MIN:
            i, j = int(a / HOP), int(b / HOP)
            if voiced is not None and (voiced[i:j] > VOICED).mean() < SCREAM_VOICED:
                continue                                 # fort mais pas une voix : tir, explosion…
            out.append({"start": round(a, 2), "end": round(b, 2), "excess": round(float(db[i:j].max() - level), 1)})
    return out


def rhythm(env: np.ndarray) -> tuple[float, float]:
    """Force (0..1) et période (s) du rythme le plus marqué de l'enveloppe, dans la plage d'un rire."""
    e = env - env.mean()
    n = np.dot(e, e)
    if n <= 0:
        return 0.0, 0.0
    lo, hi = int(LAUGH_PERIOD[0] / HOP), int(LAUGH_PERIOD[1] / HOP) + 1
    ac = np.array([np.dot(e[:-k], e[k:]) / n for k in range(lo, min(hi, len(e) - 1))])
    if ac.size == 0:
        return 0.0, 0.0
    k = int(np.argmax(ac))
    return float(ac[k]), (lo + k) * HOP


def find_laugh_candidates(db: np.ndarray, floor: float, level: float, voiced: np.ndarray | None = None) -> list[dict]:
    """Passages au rythme régulier de « ha-ha-ha » (avant confirmation)."""
    voiced_frames = voiced
    w = int(LAUGH_WIN / HOP)
    step = max(1, w // 4)
    env = np.clip(db, floor, None)
    if voiced_frames is not None:                        # le rythme ne se mesure que sur la voix : une rafale de
        env = np.where(voiced_frames > VOICED, env, floor)   # tirs à côté de la parole ne compte pas
    spans = []
    for i in range(0, max(0, len(db) - w) + 1, step):
        seg = env[i:i + w]
        voiced = seg > floor + 15
        if voiced.mean() < 0.35 or np.median(seg[voiced]) < level - 8:
            continue
        bursts = len(_runs(voiced))
        if voiced_frames is not None and (voiced_frames[i:i + w][voiced] > VOICED).mean() < LAUGH_VOICED:
            continue                                     # rafales sans voix : rafale de tirs, pas un rire
        strength, period = rhythm(seg)
        if strength >= LAUGH_REGULARITY and bursts >= 3:
            spans.append((i * HOP, (i + w) * HOP, strength, period))
    out = []
    for a, b in _merge([(s[0], s[1]) for s in spans], 0.3):
        inside = [s for s in spans if s[0] >= a and s[1] <= b]
        if b - a >= LAUGH_MIN:
            out.append({"start": round(a, 2), "end": round(b, 2),
                        "regularity": round(max(s[2] for s in inside), 2), "period": round(inside[0][3], 3)})
    return out


def is_laugh_text(words: list[str]) -> bool:
    """La transcription ressemble-t-elle à un rire ? (« Hahaha ! », « mdr », ou rien de reconnu)"""
    words = [w.strip(" .,!?…'\"-") for w in words if w.strip(" .,!?…'\"-")]
    if not words:
        return True                                   # voix forte et rythmée, mais aucun mot : c'est un rire
    laughy = sum(bool(LAUGH_WORDS.match(w)) for w in words)
    return laughy / len(words) >= 0.6


EXCLAIM = re.compile(r"^(?:o+h+|a+h+|e+h+|no+n+|na+n+|no+|quoi+|wa?e?sh|putain+|ptn|merde+|bordel|regarde[sz]?|attend[sz]?|"
                     r"go+|gg|stop|allez|vas|oui+|ouais+|ouah+|waouh+|wow+|what|a[iï]e+|oskour|jamais|nice|"
                     r"incroyable|dingue|fou|ace|clutch|let'?s|mais|hein|tue|tuez|bouge|recule|cours)$", re.I)


# Phrases que Whisper invente quand il n'entend pas de parole (rire, bruit) : comme s'il n'avait rien entendu.
HALLUCINATION = re.compile(r"sous-titr|amara|abonnez-vous|merci d'avoir regard", re.I)


def _clean(words: list[str]) -> list[str]:
    if HALLUCINATION.search(" ".join(words)):
        return []
    return [w.strip(" .,!?…'\"-") for w in words if w.strip(" .,!?…'\"-")]


def classify(words: list[str], duration: float, rhythmic: float = 0.0) -> str | None:
    """Ce qu'on a entendu, d'après la transcription : « laugh », « scream » (exclamation courte) ou None (on parle)."""
    w = _clean(words)
    if not w:
        return "laugh" if rhythmic >= 0.7 else None      # rien de reconnu : rire seulement si très rythmé
    if is_laugh_text(w):
        return "laugh"
    if len(w) <= 7 and len(w) / max(duration, 0.5) <= 4.5 and any(EXCLAIM.match(x) for x in w):
        return "scream"                                  # « NOOON », « Oh oh stop ! », « Regarde, regarde ! »
    return None                                          # une phrase dite fort : pas un moment


CANDIDATES_PER_HOUR = 15     # passages écoutés (transcrits) par heure et par sorte : garde l'analyse rapide


def vocal_moments(x: np.ndarray, rate: int = RATE, confirm=None) -> list[dict]:
    """Rires et cris dans un signal de micro. `confirm(x, rate, [(début, fin)…])` → mots entendus dans chaque passage
    (transcription), optionnel.
    Renvoie [{"type": "laugh"|"scream", "start", "end", ...}] en secondes depuis le début du signal."""
    db = frame_db(x, rate)
    if db.size == 0:
        return []
    return vocal_moments_from(db, voicing(x, rate), len(x) / rate,
                              (lambda spans: confirm(x, rate, spans)) if confirm else None)


def vocal_moments_from(db: np.ndarray, v: np.ndarray, seconds: float, confirm=None) -> list[dict]:
    """Comme vocal_moments, à partir des mesures déjà faites (volume + voix, une trame toutes les 25 ms).
    `confirm([(début, fin)…])` → mots entendus dans chaque passage."""
    if db.size == 0:
        return []
    floor = float(np.percentile(db, 10))
    active = db[(v > VOICED) & (db > floor + 15)]               # trames de voix (pas les tirs, pas le silence)
    level = float(np.median(active)) if active.size >= 40 else speech_level(db)[1]
    hours = max(1.0, seconds / 3600)
    keep, listen = int(PER_HOUR * hours), int(CANDIDATES_PER_HOUR * hours)
    loud = sorted(find_screams(db, level, v), key=lambda m: -m["excess"])
    env = np.where(v > VOICED, np.clip(db, floor, None), floor)
    for m in loud:                                       # un éclat de rire est fort ET rythmé : on mesure aussi le rythme
        i = int(m["start"] / HOP)
        seg = env[max(0, i - int(0.4 / HOP)):i + max(int(LAUGH_WIN / HOP), int((m["end"] - m["start"]) / HOP))]
        m["regularity"] = round(rhythm(seg)[0], 2) if len(seg) > 10 else 0.0
    rhythmic = sorted(find_laugh_candidates(db, floor, level, v), key=lambda m: -m["regularity"])
    if confirm is None:                                  # sans transcription : seulement les plus nets
        out = [{"type": "scream", **m} for m in loud if m["excess"] >= 14][:keep]
        out += [{"type": "laugh", **m} for m in rhythmic if m["regularity"] >= 0.75][:keep]
        return sorted(out, key=lambda m: m["start"])
    found: dict[str, list[dict]] = {"laugh": [], "scream": []}
    todo: list[tuple[str, dict]] = []
    for kind, cands in (("loud", loud[:listen]), ("rhythm", rhythmic[:listen])):
        for c in cands:
            if any(a["start"] < c["end"] and c["start"] < a["end"] for _, a in todo):
                continue                                 # déjà prévu (un rire peut être fort ET rythmé)
            todo.append((kind, c))
    heard = confirm([(c["start"], c["end"]) for _, c in todo])   # une seule transcription pour tout
    for (kind, c), words in zip(todo, heard):
        t = classify(words, c["end"] - c["start"], c.get("regularity", 0.0))
        if t == "scream" and kind == "rhythm":
            t = None                                     # parler vite n'est pas crier
        if t and len(found[t]) < keep:
            found[t].append({"type": t, **c, "text": " ".join(_clean(words))[:60]})
    return sorted(found["laugh"] + found["scream"], key=lambda m: m["start"])


GAP = 1.0                    # s de silence entre deux passages mis bout à bout


def whisper_spans(fetch, spans: list[tuple[float, float]]) -> list[list[str]]:
    """Mots entendus dans chaque passage. `fetch(début, fin)` → son (16 kHz mono).
    Les passages sont mis bout à bout (séparés par du silence) mais transcrits chacun à part en un seul appel
    (option clip_timestamps de Whisper) : rapide, et un passage ne déteint pas sur le suivant."""
    if not spans:
        return []
    from .overlays import transcribe_audio
    parts, bounds, t = [], [], 0.0
    gap = np.zeros(int(GAP * RATE), np.float32)
    for a, b in spans:
        seg = np.asarray(fetch(max(0.0, a - 0.3), b + 0.3), np.float32)
        parts += [seg, gap]
        bounds.append((t, t + len(seg) / RATE))
        t += (len(seg) + len(gap)) / RATE
    audio = np.concatenate(parts)
    try:
        words = transcribe_audio(audio, vad=False, clips=[x for ab in bounds for x in ab])
    except Exception:
        return [[] for _ in spans]
    out: list[list[str]] = [[] for _ in spans]
    for w in words:                                  # chaque mot va au passage le plus proche
        mid = (w.start + w.end) / 2
        i = min(range(len(bounds)), key=lambda k: max(bounds[k][0] - mid, mid - bounds[k][1], 0.0))
        if max(bounds[i][0] - mid, mid - bounds[i][1]) <= 0.5:
            out[i].append(w.text)
    return out


def whisper_batch(x: np.ndarray, rate: int, spans: list[tuple[float, float]]) -> list[list[str]]:
    """whisper_spans sur un signal déjà chargé."""
    return whisper_spans(lambda a, b: x[int(a * rate):int(b * rate)], spans)


CHUNK = 600.0                # s : la piste est lue par morceaux de 10 min (peu de mémoire même pour 8 h de live)


def track_features(path: str, start: float = 0.0, duration: float | None = None, chunk: float = CHUNK,
                   progress=None) -> tuple[np.ndarray, np.ndarray]:
    """Volume (dB) et « voix » (0..1) toutes les 25 ms, sur toute la piste, lue par morceaux."""
    from .audio_sync import load_audio
    per = int(round(chunk / HOP))
    dbs, vs, t = [], [], 0.0
    while duration is None or t < duration - 1e-6:
        length = chunk if duration is None else min(chunk, duration - t)
        try:
            x = load_audio(path, rate=RATE, start=start + t, duration=length + WIN)
        except Exception:
            break
        n = min(int(round(length / HOP)), max(0, 1 + (len(x) - int(WIN * RATE)) // int(HOP * RATE)))
        if n <= 0:
            break
        dbs.append(frame_db(x)[:n]); vs.append(voicing(x)[:n])
        t += n * HOP
        if progress and duration:
            progress(min(1.0, t / duration))
        if n < per:                                  # fin de la piste
            break
    if not dbs:
        return np.zeros(0), np.zeros(0, np.float32)
    return np.concatenate(dbs), np.concatenate(vs)


def speech_spans(db: np.ndarray, v: np.ndarray, min_len: float = 0.25, gap: float = 0.4) -> list[tuple[float, float]]:
    """Quand on parle (ou rit) : [(début, fin)] en secondes. Sert à ne pas couper un clip au milieu d'une phrase."""
    if db.size == 0:
        return []
    floor = float(np.percentile(db, 10))
    talk = (v > VOICED) & (db > floor + 15)
    spans = _merge([(a * HOP, b * HOP) for a, b in _runs(talk)], gap)
    return [(round(a, 2), round(b + WIN, 2)) for a, b in spans if b - a >= min_len]


def detect_in_track(path: str, offset: float = 0.0, start: float = 0.0, duration: float | None = None,
                    use_transcription: bool = True, progress=None, features=None) -> list[dict]:
    """Rires et cris d'une piste micro Sklip. Temps renvoyés dans le temps de la VIDÉO
    (vidéo(t) = piste(t - offset), voir audio_sync). `features` = (db, voix) déjà mesurés (track_features)."""
    from .audio_sync import load_audio
    report = progress or (lambda f, m: None)
    report(0.0, "Écoute de la piste micro")
    db, v = features if features is not None else track_features(path, start, duration)
    fetch = lambda a, b: load_audio(path, rate=RATE, start=start + a, duration=b - a)
    found = vocal_moments_from(db, v, len(db) * HOP, (lambda spans: whisper_spans(fetch, spans))
                               if use_transcription else None)
    for m in found:
        m["start"] = round(m["start"] + start + offset, 2)
        m["end"] = round(m["end"] + start + offset, 2)
    report(1.0, f"{sum(m['type'] == 'laugh' for m in found)} rires, {sum(m['type'] == 'scream' for m in found)} cris")
    return found


def to_moments(found: list[dict]) -> list[dict]:
    """Moments pour l'analyse : le clip commence ~4 s avant le rire (ce qui l'a provoqué) et en montre le début."""
    out = []
    for m in found:
        dur = m["end"] - m["start"]
        t = m["start"] + min(dur, 3.0)
        out.append({"type": m["type"], "t": round(t, 2),
                    "meta": {"t_start": m["start"], "t_end": m["end"], **{k: v for k, v in m.items()
                                                                          if k not in ("type", "start", "end")}}})
    return out

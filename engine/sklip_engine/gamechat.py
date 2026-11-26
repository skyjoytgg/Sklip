"""Chat écrit du jeu (Valorant), en bas à gauche de l'image : « (Tout) tuffboy : pd ».

Lu avec la reconnaissance de texte de Windows (Windows.Media.Ocr, intégrée à Windows 10/11, rien à installer).
Le pseudo (et son préfixe) est en couleur : bleu = allié, rouge = ennemi. Le message est en blanc.
On ignore les « (Émission) … a repéré un ENNEMI ici » (pings) et tout ce qui n'a pas de couleur (messages du système).
Vu sur le live du 26/11 : 19:48 « (Tout) tuffboy : pd » (Omen ennemi), 20:12 « (Tout) Sage : WELL PLAYED MY AGENTS ».

Les messages ne créent pas de clip : l'éditeur les propose, comme ceux du chat Twitch, pour un clip donné.
"""
from __future__ import annotations

import re
import subprocess

import numpy as np

# Zone du chat (fractions de l'image) : en bas à gauche, au-dessus du bord de l'écran, jusqu'à ~8 lignes.
BOX = (0.008, 0.70, 0.27, 0.975)      # x0, y0, x1, y1 (la boîte du chat s'arrête avant la vie « 100 »)
FPS = 1.0                              # un message reste affiché plusieurs secondes : 1 image/s suffit
CHANGE = 4.0                           # écart moyen (niveaux de gris) au-delà duquel la zone a changé → on relit
SAME_MSG = 120.0                       # même message revu dans les 2 min (le chat se réaffiche en fin de partie) : un seul
SCALE = 2                              # agrandi avant la lecture (texte de ~14 px en 1080p)

LINE = re.compile(r"^\(\s*(tout|équipe|equipe|groupe|all|team|party)\s*\)\s*(.+?)\s*:\s*(.+)$", re.I)
ALLY, ENEMY = "ally", "enemy"


def parse_line(text: str):
    """« (Tout) tuffboy : pd » → ("Tout", "tuffboy", "pd"), sinon None (ping « (Émission) », système…)."""
    m = LINE.match(" ".join(str(text).split()))
    if not m:
        return None
    user, msg = m.group(2).strip(), m.group(3).strip()
    user = re.sub(r"\s*\([^)]*\)$", "", user)           # « Pseudo (Agent) » → « Pseudo »
    return (m.group(1), user, msg) if user and msg else None


def team_of(bgr: np.ndarray) -> str | None:
    """Équipe d'après la couleur du pseudo (zone de l'image où il est écrit) : bleu → allié, rouge → ennemi."""
    import cv2
    if bgr is None or not bgr.size:
        return None
    hsv = cv2.cvtColor(np.ascontiguousarray(bgr), cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0].astype(int), hsv[..., 1].astype(int), hsv[..., 2].astype(int)
    lit = (s >= 70) & (v >= 120)                         # pixels du texte coloré
    red = int((lit & ((h <= 10) | (h >= 165))).sum())
    blue = int((lit & (h >= 85) & (h <= 115)).sum())
    if max(red, blue) < 6:
        return None
    if red >= 2 * blue:
        return ENEMY
    if blue >= 2 * red:
        return ALLY
    return None


# ---------- Reconnaissance de texte (Windows) ----------

_ENGINE = None


_ENGINE_LOCK = __import__("threading").Lock()


def _ocr_engine():
    global _ENGINE
    with _ENGINE_LOCK:
        return _ENGINE or _make_engine()


def _make_engine():
    global _ENGINE
    if _ENGINE is None:
        from winrt.windows.globalization import Language
        from winrt.windows.media.ocr import OcrEngine
        _ENGINE = (OcrEngine.try_create_from_language(Language("fr-FR"))
                   or OcrEngine.try_create_from_user_profile_languages())
        if _ENGINE is None:
            raise RuntimeError("Lecture de texte de Windows indisponible")
    return _ENGINE


def ocr_lines(bgr: np.ndarray) -> list[dict]:
    """Lignes lues dans l'image : [{text, words: [{text, x, y, w, h}]}] (coordonnées dans `bgr`)."""
    import asyncio

    import cv2
    from winrt.windows.graphics.imaging import BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap
    from winrt.windows.storage.streams import DataWriter
    big = cv2.resize(bgr, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_CUBIC)
    bgra = cv2.cvtColor(big, cv2.COLOR_BGR2BGRA)
    h, w = bgra.shape[:2]

    async def run():
        wr = DataWriter()
        wr.write_bytes(bgra.tobytes())
        bmp = SoftwareBitmap.create_copy_from_buffer(wr.detach_buffer(), BitmapPixelFormat.BGRA8, w, h,
                                                     BitmapAlphaMode.PREMULTIPLIED)
        return await _ocr_engine().recognize_async(bmp)

    res = asyncio.run(run())
    out = []
    for ln in res.lines:
        words = [{"text": wd.text, "x": wd.bounding_rect.x / SCALE, "y": wd.bounding_rect.y / SCALE,
                  "w": wd.bounding_rect.width / SCALE, "h": wd.bounding_rect.height / SCALE} for wd in ln.words]
        if words:
            out.append({"text": ln.text, "words": words})
    return merge_lines(out)


def merge_lines(lines: list[dict]) -> list[dict]:
    """Recolle les morceaux d'une même ligne (Windows coupe parfois « (Tout) Sage : » | « WELL PLAYED… »)."""
    def mid(ln):
        return sum(w["y"] + w["h"] / 2 for w in ln["words"]) / len(ln["words"])

    def height(ln):
        return max(w["h"] for w in ln["words"])
    out: list[dict] = []
    for ln in sorted(lines, key=mid):
        hgt = max(height(ln), height(out[-1])) if out else 0
        gap = (min(w["x"] for w in ln["words"]) - max(w["x"] + w["w"] for w in out[-1]["words"])) if out else 0
        if out and abs(mid(ln) - mid(out[-1])) < 0.6 * hgt and gap < 4 * hgt:
            words = sorted(out[-1]["words"] + ln["words"], key=lambda w: w["x"])
            out[-1] = {"text": " ".join(w["text"] for w in words), "words": words}
        else:
            out.append(ln)
    return out


def messages_in(bgr: np.ndarray, read=ocr_lines) -> list[dict]:
    """Messages de joueurs dans une image de la zone du chat : [{user, text, team, scope}]."""
    out = []
    for ln in read(bgr):
        p = parse_line(ln["text"])
        if not p:
            continue
        scope, user, text = p
        # Couleur : les mots avant « : » (préfixe + pseudo).
        head = []
        for wd in ln["words"]:
            if ":" in wd["text"]:
                break
            head.append(wd)
        if not head:
            continue
        x0 = int(min(w["x"] for w in head)); x1 = int(max(w["x"] + w["w"] for w in head))
        y0 = int(min(w["y"] for w in head)); y1 = int(max(w["y"] + w["h"] for w in head))
        team = team_of(bgr[max(0, y0 - 1):y1 + 2, max(0, x0 - 1):x1 + 2])
        if team:
            out.append({"user": user, "text": text, "team": team, "scope": scope})
    return out


# ---------- Vidéo ----------

def _frames(video: str, start: float, end: float, fps: float = FPS):
    """Images de la zone du chat entre start et end (s), en 1920x1080 : (t, image BGR)."""
    x0, y0, x1, y1 = BOX
    W, H = 1920, 1080
    cw, ch = int(W * (x1 - x0)), int(H * (y1 - y0))
    cx, cy = int(W * x0), int(H * y0)
    # « -skip_frame noref » : FFmpeg ne décode pas les images dont aucune autre ne dépend (on n'en garde qu'une par
    # seconde de toute façon) : lecture ~2× plus rapide.
    cmd = ["ffmpeg", "-v", "error", "-skip_frame", "noref", "-ss", f"{max(0.0, start):.2f}", "-i", video,
           "-t", f"{max(0.5, end - start):.2f}", "-vf", f"fps={fps},scale={W}:{H},crop={cw}:{ch}:{cx}:{cy}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    i, n = 0, cw * ch * 3
    try:
        while True:
            b = p.stdout.read(n)
            if len(b) < n:
                break
            yield max(0.0, start) + i / fps, np.frombuffer(b, np.uint8).reshape(ch, cw, 3)
            i += 1
    finally:
        p.kill()


def chat_between(video: str, start: float, end: float, read=ocr_lines, frames=None) -> list[dict]:
    """Messages écrits dans le chat du jeu entre start et end (temps de la vidéo) : [{t, user, text, team, scope}]."""
    seen: list[dict] = []
    last = None
    for t, img in (frames if frames is not None else _frames(video, start, end)):
        gray = img.mean(axis=2)
        if last is not None and float(np.abs(gray - last).mean()) < CHANGE:
            continue                                   # rien n'a bougé dans la zone : pas besoin de relire
        last = gray
        try:
            found = messages_in(img, read)
        except Exception:
            continue
        for m in found:
            if any(t - o["t"] < SAME_MSG and same_message(o, m) for o in seen):
                continue
            seen.append({"t": round(t, 2), **m})
    return fix_names(seen)


def _norm(s: str) -> str:
    return re.sub(r"[^0-9a-zà-ÿ]+", "", str(s).lower())


def _close(a: str, b: str, ratio: float) -> bool:
    from difflib import SequenceMatcher
    return SequenceMatcher(None, _norm(a), _norm(b)).ratio() >= ratio


def same_message(a: dict, b: dict) -> bool:
    """Même message lu deux fois, malgré les petites erreurs de lecture (« GGWPPPP » / « GGwpppp », « Wayley » / « Waylay »)."""
    return a["team"] == b["team"] and _close(a["text"], b["text"], 0.85) and _close(a["user"], b["user"], 0.6)


def fix_names(msgs: list[dict]) -> list[dict]:
    """Pseudo mal lu une fois (« Wa9(ay ») → le pseudo proche le plus souvent lu (« Waylay »)."""
    from collections import Counter
    count = Counter(m["user"] for m in msgs)
    for m in msgs:
        best = max((u for u in count if u != m["user"] and count[u] > count[m["user"]] and _close(u, m["user"], 0.6)),
                   key=lambda u: count[u], default=None)
        if best:
            m["user"] = best
    return msgs


# ---------- Pendant l'analyse ----------
# Lu une fois pour tous les clips proposés (fin de live : le PC ne streame plus), pour que l'éditeur n'attende pas.
LOOKBACK = 10.0          # s avant le clip : un message écrit juste avant est encore affiché


def spans_for(clips: list[dict], before: float = LOOKBACK, gap: float = 5.0) -> list[list[float]]:
    """Passages à lire pour une liste de clips ({start, end}) : fusionnés quand ils se touchent."""
    out: list[list[float]] = []
    for a, b in sorted((max(0.0, float(c["start"]) - before), float(c["end"])) for c in clips):
        if out and a <= out[-1][1] + gap:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [[round(a, 2), round(b, 2)] for a, b in out]


def _missing(span, done):
    """Parties de `span` qui ne sont dans aucun passage déjà lu."""
    parts = [list(span)]
    for a, b in done:
        nxt = []
        for x, y in parts:
            if b <= x or a >= y:
                nxt.append([x, y])
                continue
            if a > x:
                nxt.append([x, a])
            if b < y:
                nxt.append([b, y])
        parts = nxt
    return [p for p in parts if p[1] - p[0] >= 1.0]


def chat_for_clips(video: str, clips: list[dict], cached: dict | None = None, between=None, progress=None) -> dict:
    """{spans, messages} : le chat du jeu de tous les passages des clips. `cached` (même forme) : déjà lu, on ne
    relit que ce qui manque (réanalyse). Un passage à la fois : mesuré le 26/11, la lecture de texte de Windows
    lancée sur plusieurs passages en même temps perd des messages (3 à 5 lus au lieu de 5)."""
    between = between or (lambda a, b: chat_between(video, a, b))
    done = [list(s) for s in (cached or {}).get("spans", [])]
    msgs = list((cached or {}).get("messages", []))
    todo = [p for s in spans_for(clips) for p in _missing(s, done)]
    total = sum(b - a for a, b in todo) or 1.0
    read = 0.0
    for a, b in todo:
        if progress:
            progress(read / total)
        try:
            msgs += between(a, b)
        except Exception:
            continue                       # passage illisible : l'éditeur le relira à la demande
        done.append([a, b])
        read += b - a
    msgs.sort(key=lambda m: m["t"])
    return {"spans": sorted(done), "messages": msgs}

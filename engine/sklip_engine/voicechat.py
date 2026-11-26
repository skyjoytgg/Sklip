"""Vocal du jeu : quel agent parle, et ce qu'il dit → réplique affichée en grand sur la vidéo (agent + texte BD).

Quand un joueur parle dans le vocal de Valorant, le jeu affiche en bas à gauche une ligne par personne qui parle :
l'icône de son agent, son pseudo et « Dans <endroit> - Équipe ». Les lignes s'empilent vers le haut (en 1080p :
icône de 34 px à x = 20, lignes à y = 685, 647, 609…). Sklip reconnaît l'icône (comparaison avec les icônes
officielles des agents), ce qui donne qui parle et quand ; la transcription de la piste du jeu donne ce qu'il dit.
Vérifié sur la VOD du 01/11 (20:06 → 20:42 : bom en Viper, Reyna, Sky en Neon).
"""
from __future__ import annotations

import json
import os
import subprocess

import numpy as np

ICON = 34 / 1080            # taille de l'icône de l'agent (fraction de la hauteur de l'image)
ZONE_X = (0, 90 / 1080)     # zone lue (fractions de la hauteur : l'interface est ancrée à gauche)
ZONE_Y = (520 / 1080, 860 / 1080)
ICON_X = (14 / 1080, 26 / 1080)   # l'icône est toujours à x ≈ 20 px : ailleurs, c'est le décor
MIN_SCORE = 0.72            # ressemblance minimale (les mauvais agents restent sous 0,71)
SCAN_FPS = 2.0
GAP = 1.0                   # deux détections à moins d'1 s : la même prise de parole
WORD_MARGIN = 0.4           # un mot est attribué à l'agent qui parle à ce moment (± 0,4 s)
PHRASE_GAP = 0.9            # silence qui coupe deux répliques
MIN_WORDS = 2


def load_agents(agents_dir: str) -> list[dict]:
    """Agents téléchargés par l'appli : agents.json + icon_<uuid>.png. [] si absent."""
    try:
        with open(os.path.join(agents_dir, "agents.json"), encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    data = data.get("data", data) if isinstance(data, dict) else data
    return [{"uuid": a["uuid"], "name": a["displayName"], "icon": os.path.join(agents_dir, f"icon_{a['uuid']}.png")}
            for a in data if os.path.exists(os.path.join(agents_dir, f"icon_{a['uuid']}.png"))]


def templates(agents: list[dict], size: int) -> list[tuple[dict, np.ndarray, np.ndarray]]:
    import cv2
    out = []
    for a in agents:
        im = cv2.imread(a["icon"], cv2.IMREAD_UNCHANGED)
        if im is None or im.ndim != 3 or im.shape[2] != 4:
            continue
        im = cv2.resize(im, (size, size), interpolation=cv2.INTER_AREA)
        m = (im[..., 3] > 128).astype(np.float32)
        out.append((a, im[..., :3].astype(np.float32), np.dstack([m] * 3)))
    return out


def speakers_in(roi: np.ndarray, tpls, scale: float = 1.0) -> list[tuple[str, float, float]]:
    """Agents qui parlent dans la zone lue (image BGR, en 1080p) : [(uuid, score, y)]."""
    import cv2
    zone = roi.astype(np.float32)
    found = []
    for a, t, m in tpls:
        r = np.nan_to_num(cv2.matchTemplate(zone, t, cv2.TM_CCOEFF_NORMED, mask=m), nan=0.0, posinf=0.0, neginf=0.0)
        x0, x1 = int(ICON_X[0] * 1080 * scale), int(ICON_X[1] * 1080 * scale) + 1
        col = r[:, x0:x1]
        if not col.size:
            continue
        y, x = np.unravel_index(np.argmax(col), col.shape)
        if col[y, x] >= MIN_SCORE:
            found.append((a["uuid"], float(col[y, x]), float(y)))
    # Une ligne = un seul agent (le plus ressemblant).
    found.sort(key=lambda f: -f[1])
    kept: list[tuple[str, float, float]] = []
    for f in found:
        if all(abs(f[2] - k[2]) > 15 * scale for k in kept):
            kept.append(f)
    return kept


def scan_speakers(video: str, start: float, end: float, tpls, fps: float = SCAN_FPS) -> list[tuple[float, str]]:
    """[(temps, uuid)] : qui parle dans le vocal du jeu entre start et end (temps de la vidéo)."""
    H = 1080
    x0, x1 = int(ZONE_X[0] * H), int(ZONE_X[1] * H)
    y0, y1 = int(ZONE_Y[0] * H), int(ZONE_Y[1] * H)
    w, h = x1 - x0, y1 - y0
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{max(0.0, start):.3f}", "-i", video, "-t", f"{end - start:.3f}", "-an",
           "-vf", f"fps={fps},scale=-2:{H},crop={w}:{h}:{x0}:{y0}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    n = len(raw) // (w * h * 3)
    frames = np.frombuffer(raw[:n * w * h * 3], np.uint8).reshape(n, h, w, 3)
    out = []
    for i in range(n):
        for uuid, _, _ in speakers_in(frames[i], tpls):
            out.append((round(start + i / fps, 2), uuid))
    return out


def speaking_spans(dets: list[tuple[float, str]], fps: float = SCAN_FPS) -> list[dict]:
    """Détections → prises de parole [{agent, start, end}] (une détection couvre 1/fps seconde)."""
    spans: dict[str, list[list[float]]] = {}
    for t, a in sorted(dets):
        s = spans.setdefault(a, [])
        if s and t - s[-1][1] <= GAP:
            s[-1][1] = t + 1 / fps
        else:
            s.append([t, t + 1 / fps])
    return sorted(({"agent": a, "start": round(x, 2), "end": round(y, 2)} for a, ss in spans.items() for x, y in ss),
                  key=lambda s: s["start"])


def drop_streamer(spans: list[dict], speech: list[tuple[float, float]], share: float = 0.6) -> list[dict]:
    """Le streamer apparaît aussi dans la liste quand il parle : son agent est celui dont les prises de parole
    tombent surtout pendant sa voix (piste micro). On l'enlève : on ne fait parler que les coéquipiers."""
    if not speech:
        return spans
    def overlap(s):
        return sum(max(0.0, min(s["end"], b) - max(s["start"], a)) for a, b in speech)
    by_agent: dict[str, list[float]] = {}
    for s in spans:
        v = by_agent.setdefault(s["agent"], [0.0, 0.0])
        v[0] += overlap(s)
        v[1] += s["end"] - s["start"]
    me = {a for a, (o, d) in by_agent.items() if d > 0 and o / d >= share}
    return [s for s in spans if s["agent"] not in me]


def voice_lines(words: list[dict], spans: list[dict]) -> list[dict]:
    """Mots (temps de la vidéo) + prises de parole → répliques [{agent, start, end, text}]."""
    lines: list[dict] = []
    for w in sorted(words, key=lambda w: w["start"]):
        mid = (w["start"] + w["end"]) / 2
        cands = [s for s in spans if s["start"] - WORD_MARGIN <= mid <= s["end"] + WORD_MARGIN]
        if not cands:
            continue
        agent = max(cands, key=lambda s: s["start"])["agent"]     # plusieurs à la fois : le dernier à avoir parlé
        last = lines[-1] if lines else None
        if last and last["agent"] == agent and w["start"] - last["end"] <= PHRASE_GAP:
            last["end"] = round(w["end"], 2)
            last["text"] += " " + w["text"].strip()
        else:
            lines.append({"agent": agent, "start": round(w["start"], 2), "end": round(w["end"], 2), "text": w["text"].strip()})
    return [ln for ln in lines if len(ln["text"].split()) >= MIN_WORDS]


def attach_voices(clips: list[dict], video: str, agents_dir: str | None, transcribe_clip,
                  speech: list | None = None, progress=None) -> None:
    """Ajoute clip["voices"] (répliques proposées, pas affichées par défaut) aux clips de jeu.
    transcribe_clip(start, end) → mots de la piste du jeu (temps de la vidéo)."""
    agents = load_agents(agents_dir) if agents_dir else []
    if not agents:
        return
    tpls = templates(agents, round(ICON * 1080))
    names = {a["uuid"]: a["name"] for a in agents}
    done: dict = {}
    for n, c in enumerate(clips):
        if progress:
            progress(n / max(1, len(clips)))
        if c.get("layout") == "cam_full":
            continue                                   # passage discussion : pas de vocal du jeu
        key = (round(c["start"], 2), round(c["end"], 2))
        if key not in done:
            try:
                spans = drop_streamer(speaking_spans(scan_speakers(video, c["start"], c["end"], tpls)), speech or [])
                lines = voice_lines(transcribe_clip(c["start"], c["end"]), spans) if spans else []
            except Exception:
                lines = []
            done[key] = [{**ln, "name": names.get(ln["agent"], "?"), "on": False, "auto": True} for ln in lines]
        if done[key]:
            c["voices"] = [dict(v) for v in done[key]]

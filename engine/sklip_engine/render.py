"""Rendu des montages avec FFmpeg : découpe, mise en page 16:9 / 9:16, mix des pistes, export."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from .overlays import Word, build_ass, ass_filter, transcribe
from . import mixing

TRACKS = ("game", "mic", "discord", "music")
# Discord actif par défaut ; musique coupée par défaut à l'export (droits d'auteur).
DEFAULT_VOLUMES = {"game": 1.0, "mic": 1.0, "discord": 1.0, "music": 0.0}

HW_ENCODERS = ("h264_nvenc", "h264_amf", "h264_qsv")
_encoder_cache: str | None = None


def detect_encoder(force: str | None = None) -> str:
    """Choisit l'encodeur : NVIDIA (NVENC) > AMD (AMF) > Intel (QSV) > CPU (x264).
    Chaque encodeur matériel est testé pour de vrai (il peut être listé sans GPU compatible)."""
    global _encoder_cache
    if force:
        return force
    if _encoder_cache:
        return _encoder_cache
    listed = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    for enc in HW_ENCODERS:
        if enc not in listed:
            continue
        ok = subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=black:s=256x256:d=0.2",
                             "-c:v", enc, "-f", "null", "-"], capture_output=True).returncode == 0
        if ok:
            _encoder_cache = enc
            return enc
    _encoder_cache = "libx264"
    return _encoder_cache


# Débit vidéo : ce que TikTok / YouTube Shorts gardent de toute façon (ils réencodent). Sans plafond, la carte AMD
# en « qualité fixe » sortait ~15 Mbit/s (112 Mo pour 58 s) sans différence visible une fois en ligne.
VIDEO_RATE, VIDEO_MAX, VIDEO_BUF = "8M", "12M", "16M"


def encoder_args(enc: str) -> list[str]:
    cap = ["-maxrate", VIDEO_MAX, "-bufsize", VIDEO_BUF]
    if enc == "h264_nvenc":
        return ["-c:v", enc, "-preset", "p5", "-rc", "vbr", "-cq", "21", "-b:v", VIDEO_RATE, *cap, "-pix_fmt", "yuv420p"]
    if enc == "h264_amf":
        return ["-c:v", enc, "-quality", "quality", "-rc", "vbr_peak", "-b:v", VIDEO_RATE, *cap, "-pix_fmt", "yuv420p"]
    if enc == "h264_qsv":
        return ["-c:v", enc, "-b:v", VIDEO_RATE, *cap, "-pix_fmt", "nv12"]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", *cap, "-pix_fmt", "yuv420p"]


@dataclass
class Rect:
    """Zone normalisée (0..1) dans l'image source. Ex. la webcam du streamer."""
    x: float
    y: float
    w: float
    h: float


@dataclass
class RenderClip:
    start: float
    end: float
    layout: str = "cam_top"                       # cam_top | cam_bottom | game_only | cam_full
    volumes: dict = field(default_factory=dict)   # surcharge par clip
    moments: list = field(default_factory=list)   # moments du clip (pour les textes à l'écran)
    words: list | None = None                     # sous-titres déjà connus (sinon transcription)
    friend: dict | None = None                    # réaction d'un pote : {file, offset, mode, pos, cut_at, cut_dur}
    cam: Rect | None = None                       # webcam de la scène de ce clip (sinon celle du montage)
    focus: tuple | None = None                    # « Cam en grand » : centre du visage dans la webcam (x, y de 0 à 1)
    stickers: list = field(default_factory=list)  # images posées sur la vidéo (bulle du chat, agent…), voir sticker_filter
    fade: float | None = None                     # fondu de ce clip (None = celui du montage). 0 : coupe franche
                                                  # (coupes du teaser : un fondu au noir ferait une pause entre les kills)
    part: str | None = None                       # vidéo YouTube : « game:3 » / « talk » (écran entre deux parties)


@dataclass
class TrackFile:
    path: str
    offset: float = 0.0   # vidéo(t) = piste(t - offset) — voir audio_sync


@dataclass
class MontageSpec:
    video: str
    clips: list[RenderClip]
    output: str
    fmt: str = "9x16"                              # 9x16 | 16x9
    cam: Rect | None = None                        # position webcam (réglable par streamer)
    tracks: dict[str, TrackFile] = field(default_factory=dict)  # pistes Sklip ; vide = mix seul
    volumes: dict = field(default_factory=lambda: dict(DEFAULT_VOLUMES))
    fade: float = 0.12                              # transition courte entre les clips
    fps: int = 60
    music_file: str | None = None                  # musique de la bibliothèque (optionnelle)
    music_start: float = 0.0                       # premier temps de la musique
    music_volume: float = 0.8                      # volume de cette musique ajoutée
    music: list = field(default_factory=list)      # musiques libres enchaînées : [{file, start, dur}] (voir music_inputs)
    mic_speech: list | None = None                 # quand le streamer parle [(début, fin)] (temps de la vidéo) : le micro
                                                   # est coupé entre ses phrases (clavier, souris). None = micro tel quel
    encoder: str | None = None
    texts: dict = field(default_factory=dict)      # {"enabled", "ace", "killCounter", "pseudo"}
    subtitles: bool = False                         # sous-titres auto mot par mot (français)
    auto_mix: bool = True                           # niveaux cohérents + voix devant + volume final -14 LUFS
    cards: bool = False                             # écran de transition + swoosh avant chaque clip (vidéo YouTube)
    outro: bool = False                             # « Abonne-toi » et la chaîne Twitch à la fin (15 s)
    outro_channel: str | None = None                # chaîne Twitch affichée sur la fin
    cam_zoom: bool = False                          # vidéo YouTube : la webcam grossit quand le streamer réagit


def probe(path: str) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height:format=duration", "-of", "default=nw=1", path],
                         capture_output=True, text=True, check=True).stdout
    info = dict(line.split("=", 1) for line in out.strip().splitlines() if "=" in line)
    return {"width": int(info["width"]), "height": int(info["height"]), "duration": float(info["duration"])}


def _even(v: float) -> int:
    return max(2, int(round(v / 2)) * 2)


PIP_MARGIN = 30
FRIEND_BORDER = "0x9146FF"


def friend_filter(fmt: str, layout: str, friend: dict, inp: str, delay: float = 0.0) -> tuple[str, str]:
    """Réaction du pote par-dessus la mise en page [lay] → [fr_out].
    pip : sa webcam dans un coin (bord violet) ; cut : plan de coupe plein écran pendant cut_dur secondes."""
    W, H = (1920, 1080) if fmt == "16x9" else (1080, 1920)
    shift = f",setpts=PTS+{delay:.3f}/TB" if delay > 0 else ""
    if friend.get("mode") == "cut":
        a = max(0.0, float(friend.get("cut_at", 0.0)))
        b = a + max(0.5, float(friend.get("cut_dur", 2.5)))
        chain = (f"{inp}scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1{shift}[fr];"
                 f"[lay][fr]overlay=0:0:eof_action=pass:enable='between(t,{a:.3f},{b:.3f})'[fr_out]")
        return chain, "[fr_out]"
    pw = 480 if fmt == "16x9" else 380
    top = 640 if (fmt == "9x16" and layout == "cam_top") else 0       # haut de la zone de jeu
    pos = friend.get("pos") or ("br" if fmt == "16x9" else "tr")
    x = f"W-w-{PIP_MARGIN}" if pos in ("tr", "br") else str(PIP_MARGIN)
    y = f"{top + PIP_MARGIN}" if pos in ("tr", "tl") else f"H-h-{PIP_MARGIN}"
    chain = (f"{inp}scale={pw - 12}:-2,pad=iw+12:ih+12:6:6:color={FRIEND_BORDER},setsar=1{shift}[fr];"
             f"[lay][fr]overlay={x}:{y}:eof_action=pass[fr_out]")
    return chain, "[fr_out]"


STICKER_FADE_IN, STICKER_FADE_OUT, STICKER_SLIDE = 0.15, 0.2, 0.25


def sticker_filter(inp: str, s: dict, k: int, last: str) -> tuple[str, str]:
    """Image PNG (transparente) posée sur [last] de s["start"] à s["end"] (s, temps du clip), à (x, y) en pixels de
    l'image finale, largeur s["w"]. anim : "fade" (apparition en fondu) ou "slide" (arrive par la droite)."""
    a, b = float(s["start"]), float(s["end"])
    x, y, w = int(s["x"]), int(s["y"]), _even(float(s["w"]))
    out_t = max(a, b - STICKER_FADE_OUT)
    chain = (f"{inp}format=rgba,scale={w}:-1,fade=t=in:st={a:.3f}:d={STICKER_FADE_IN}:alpha=1,"
             f"fade=t=out:st={out_t:.3f}:d={STICKER_FADE_OUT}:alpha=1[st{k}]")
    xe = str(x)
    if s.get("anim") == "slide":
        xe = f"'if(lt(t,{a + STICKER_SLIDE:.3f}),W-(W-{x})*(t-{a:.3f})/{STICKER_SLIDE},{x})'"
    chain += f";{last}[st{k}]overlay=x={xe}:y={y}:eof_action=pass:enable='between(t,{a:.3f},{b:.3f})'[sto{k}]"
    return chain, f"[sto{k}]"


def video_filter(fmt: str, layout: str, src_w: int, src_h: int, cam: Rect | None, fps: int,
                 dur: float, fade: float, post: str = "", friend: dict | None = None,
                 friend_input: str | None = None, friend_delay: float = 0.0, focus: tuple | None = None,
                 stickers: list | None = None, zooms: list | None = None) -> str:
    """Graphe vidéo pour un clip. Entrée [0:v], sortie [v]. `post` : filtre ajouté après la mise en page
    (ex. incrustation des sous-titres). `friend` : réaction d'un pote (entrée `friend_input`)."""
    tail = [post] if post else []
    if fade > 0 and dur > 2 * fade:
        tail += [f"fade=t=in:st=0:d={fade}", f"fade=t=out:st={dur - fade:.3f}:d={fade}"]
    base = _layout(fmt, layout, src_w, src_h, cam, fps, focus)
    last = "[lay]"
    if zooms and cam is not None and fmt == "16x9":
        from .youtube import cam_zoom_filter
        base = "[0:v]split=2[zsrc][zcam];" + base.replace("[0:v]", "[zsrc]", 1)
        chain, last = cam_zoom_filter(cam, src_w, src_h, zooms, "[zcam]", last)
        base += ";" + chain
    if friend and friend_input:
        chain, last = friend_filter(fmt, layout, friend, friend_input, friend_delay)
        base += ";" + chain
    for k, (inp, s) in enumerate(stickers or []):     # par-dessus le jeu et le pote, sous les textes (ASS)
        chain, last = sticker_filter(inp, s, k, last)
        base += ";" + chain
    return f"{base};{last}{','.join(tail) or 'null'}[v]"


def _layout(fmt: str, layout: str, src_w: int, src_h: int, cam: Rect | None, fps: int,
            focus: tuple | None = None) -> str:
    """Mise en page du clip : entrée [0:v], sortie [lay]."""
    if fmt == "16x9":
        return (f"[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,"
                f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps}[lay]")

    W, H = 1080, 1920
    if layout == "cam_full" and cam is not None:
        # Webcam en grand (Just Chatting…) : la webcam recadrée au format 9:16 remplit l'écran,
        # centrée sur le visage s'il a été trouvé (camfocus), sinon au milieu de la webcam.
        cx, cy, cw, ch = cam.x * src_w, cam.y * src_h, cam.w * src_w, cam.h * src_h
        fx, fy = focus if focus else (0.5, 0.5)
        if cw / ch > W / H:
            nw = ch * W / H
            cx, cw = cx + min(max(fx * cw - nw / 2, 0), cw - nw), nw
        else:
            nh = cw * H / W
            cy, ch = cy + min(max(fy * ch - nh / 2, 0), ch - nh), nh
        pos = lambda v: int(round(v / 2)) * 2      # décalage (peut être 0)
        return (f"[0:v]crop={_even(cw)}:{_even(ch)}:{pos(cx)}:{pos(cy)},scale={W}:{H},setsar=1,fps={fps}[lay]")
    if layout in ("game_only", "cam_full") or cam is None:
        # Recadrage central du jeu en 9:16. Fonctionne aussi pour les résolutions 4:3 étirées.
        cw = _even(src_h * W / H)
        return f"[0:v]crop={cw}:{src_h}:(iw-{cw})/2:0,scale={W}:{H},setsar=1,fps={fps}[lay]"

    cam_h, game_h = 640, H - 640
    cx, cy = _even(cam.x * src_w), _even(cam.y * src_h)
    cw, ch = _even(cam.w * src_w), _even(cam.h * src_h)
    # Jeu : bande centrale au ratio 1080:1280, pleine hauteur.
    gw = _even(min(src_w, src_h * W / game_h))
    cam_chain = (f"crop={cw}:{ch}:{cx}:{cy},scale={W}:{cam_h}:force_original_aspect_ratio=increase,"
                 f"crop={W}:{cam_h}")
    game_chain = f"crop={gw}:{src_h}:(iw-{gw})/2:0,scale={W}:{game_h}"
    order = "[cam][game]" if layout == "cam_top" else "[game][cam]"
    return (f"[0:v]split=2[a][b];[a]{cam_chain}[cam];[b]{game_chain}[game];"
            f"{order}vstack=inputs=2,setsar=1,fps={fps}[lay]")


LATE_TRACKS = 2.0            # clip qui commence plus de 2 s avant les pistes Sklip : son mixé de la vidéo


def _clip_cmd(spec: MontageSpec, clip: RenderClip, src: dict, out: str, enc: str, ass_file: str | None = None) -> list[str]:
    dur = clip.end - clip.start
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{clip.start:.3f}", "-t", f"{dur:.3f}", "-i", spec.video]
    vols = {**DEFAULT_VOLUMES, **spec.volumes, **clip.volumes}
    audio_parts, labels = [], []

    active = [(name, tf) for name, tf in spec.tracks.items() if name in TRACKS and vols.get(name, 0) > 0]
    # Clip d'avant le début des pistes (Sklip ouvert pendant l'enregistrement) : le son mixé de la vidéo.
    if spec.tracks and any(clip.start - tf.offset < -LATE_TRACKS for _, tf in spec.tracks.items()):
        active, use_tracks = [], False
    else:
        use_tracks = bool(spec.tracks)
    if use_tracks:
        named = {}
        for i, (name, tf) in enumerate(active, start=1):
            track_t = clip.start - tf.offset         # instant correspondant dans la piste Sklip
            delay = max(0.0, -track_t)
            cmd += ["-ss", f"{max(0.0, track_t):.3f}", "-t", f"{dur:.3f}", "-i", tf.path]
            gain = vols[name]
            if spec.auto_mix:                        # 100 % = niveau cible de la piste (voix devant, musique derrière)
                gain *= mixing.auto_gain(name, mixing.measure_track(tf.path, track_t, dur))
            chain = f"[{i}:a]aresample=48000,volume={gain:.4f}"
            if delay > 0:
                chain += f",adelay={int(delay * 1000)}:all=1"
            gate = mic_gate(spec.mic_speech, clip.start, dur) if name == "mic" else None
            audio_parts.append(chain + f",apad,atrim=0:{dur:.3f}" + (f",{gate}" if gate else "") + f"[t{i}]")
            named[name] = f"[t{i}]"
        if spec.auto_mix:
            key = "mic" if "mic" in named else ("discord" if "discord" in named else None)
            duck, named = mixing.ducking_graph(named, key)
            audio_parts += duck
        labels = list(named.values())
    else:
        # Pas de pistes séparées (VOD, ou Sklip ouvert en retard) : son mixé de la vidéo.
        audio_parts.append(f"[0:a:0]aresample=48000,apad,atrim=0:{dur:.3f}[t0]")
        labels.append("[t0]")

    if labels:
        mix = (f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:dropout_transition=0"
               if len(labels) > 1 else labels[0] + "anull")
    else:  # tout est coupé
        mix = f"anullsrc=r=48000:cl=stereo,atrim=0:{dur:.3f}"
    vfade = spec.fade if clip.fade is None else clip.fade
    fade = vfade if dur > 2 * vfade else 0
    if not fade and clip.fade == 0 and dur > 0.1:
        fade = 0.015                                 # coupe franche : fondu du son à peine audible, évite un « clic »
    afade = f",afade=t=in:st=0:d={fade},afade=t=out:st={dur - fade:.3f}:d={fade}" if fade else ""
    audio_parts.append(f"{mix},aformat=channel_layouts=stereo{afade}[a]")

    friend_input, friend_delay = None, 0.0
    if clip.friend and clip.friend.get("file") and os.path.exists(clip.friend["file"]):
        # extrait(u) = stream(u + offset) : le début du clip tombe à u = clip.start - offset dans l'extrait.
        u = clip.start - float(clip.friend.get("offset", 0.0))
        friend_delay = max(0.0, -u)
        friend_input = f"[{cmd.count('-i')}:v]"
        cmd += ["-ss", f"{max(0.0, u):.3f}", "-t", f"{dur:.3f}", "-i", clip.friend["file"]]
    stickers = []
    for s in clip.stickers:
        if s.get("file") and os.path.exists(s["file"]) and float(s["end"]) > float(s["start"]):
            stickers.append((f"[{cmd.count('-i')}:v]", s))
            cmd += ["-loop", "1", "-framerate", str(spec.fps), "-t", f"{dur:.3f}", "-i", s["file"]]
    zooms = None
    cam = clip.cam or spec.cam
    if spec.cam_zoom and spec.fmt == "16x9" and cam is not None and cam.w < 0.4:   # webcam déjà en grand : rien
        from .youtube import reaction_zooms
        zooms = reaction_zooms(clip.moments, clip.start, clip.end)
    vf = video_filter(spec.fmt, clip.layout, src["width"], src["height"], cam, spec.fps, dur, vfade,
                      post=ass_filter(ass_file) if ass_file else "", friend=clip.friend if friend_input else None,
                      friend_input=friend_input, friend_delay=friend_delay, focus=clip.focus, stickers=stickers,
                      zooms=zooms)
    cmd += ["-filter_complex", vf + ";" + ";".join(audio_parts), "-map", "[v]", "-map", "[a]",
            *encoder_args(enc), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", out]
    return cmd


MIC_GATE_LEAD = 0.12        # s gardées avant une phrase (l'attaque du premier mot)
MIC_GATE_TAIL = 0.25        # s gardées après (fin du mot, souffle)
MIC_GATE_RAMP = 0.08        # fondu d'ouverture / fermeture du micro


def mic_gate(speech, clip_start: float, dur: float) -> str | None:
    """Filtre qui coupe le micro entre les phrases du streamer (bruits de clavier et de souris).
    `speech` : [(début, fin)] dans le temps de la vidéo. Renvoie None s'il n'y a rien à couper."""
    if not speech:
        return None                                  # paroles inconnues : on ne coupe surtout pas le micro
    r = MIC_GATE_RAMP
    terms = []
    for a, b in speech:
        a, b = float(a) - clip_start - MIC_GATE_LEAD, float(b) - clip_start + MIC_GATE_TAIL
        if b + r <= 0 or a - r >= dur:
            continue
        if a <= 0 and b >= dur:
            return None                              # il parle pendant tout le clip
        terms.append(f"clip(min((t-{a:.3f})/{r}+1,({b:.3f}-t)/{r}+1),0,1)")
    if not terms:
        return "volume=0"
    return f"volume='min(1,{'+'.join(terms)})':eval=frame"


def live_music_ranges(spec: MontageSpec) -> list[tuple[float, float]]:
    """Passages du montage (en secondes, dans la vidéo finale) où l'on entend la musique du live."""
    if "music" not in spec.tracks:
        return []   # sans piste musique séparée, on ne sait pas isoler la musique du live
    out, t = [], 0.0
    for c in spec.clips:
        d = c.end - c.start
        if {**DEFAULT_VOLUMES, **spec.volumes, **c.volumes}.get("music", 0) > 0:
            out.append((round(t, 3), round(t + d, 3)))
        t += d
    return out


def added_music_volume(spec: MontageSpec) -> str:
    """Filtre de volume de la musique ajoutée : coupée pendant les clips qui gardent la musique du live,
    pour ne pas entendre deux chansons en même temps."""
    ranges = live_music_ranges(spec)
    if not ranges:
        return f"volume={spec.music_volume:.3f}"
    cond = "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b in ranges)
    return f"volume='if({cond},0,{spec.music_volume:.3f})':eval=frame"


MUSIC_XFADE = 2.0            # fondu enchaîné entre deux musiques
MUSIC_FADE_OUT = 2.5         # la musique s'éteint doucement à la fin du montage


def music_playlist(spec: MontageSpec) -> list[dict]:
    """Morceaux à jouer les uns après les autres (l'ancienne musique unique `music_file` = un seul morceau)."""
    if spec.music:
        return [m for m in spec.music if m.get("file")]
    if spec.music_file:
        return [{"file": spec.music_file, "start": spec.music_start}]
    return []


def music_inputs(spec: MontageSpec, total: float, first_input: int = 1) -> tuple[list[str], str]:
    """Arguments FFmpeg des musiques + filtre qui les enchaîne (fondu de MUSIC_XFADE s) → [mus].
    Le volume de chaque morceau est égalisé (sinon un morceau fort et un morceau doux se suivent mal),
    et la musique s'éteint en fondu à la fin du montage."""
    pl = music_playlist(spec)
    args, parts, labels = [], [], []
    for i, m in enumerate(pl):
        if m.get("start"):
            args += ["-ss", f"{float(m['start']):.3f}"]
        if m.get("dur") and i < len(pl) - 1:
            args += ["-t", f"{float(m['dur']) + MUSIC_XFADE:.3f}"]
        args += ["-i", m["file"]]
        lab = f"mu{i}"
        norm = f"loudnorm=I={mixing.TARGET_DB['music']}:TP=-2:LRA=11," if spec.auto_mix else ""
        parts.append(f"[{first_input + i}:a]{norm}aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[{lab}]")
        labels.append(lab)
    cur = labels[0]
    for i, lab in enumerate(labels[1:], 1):
        out = f"mx{i}"
        parts.append(f"[{cur}][{lab}]acrossfade=d={MUSIC_XFADE}:c1=tri:c2=tri[{out}]")
        cur = out
    fade_at = max(0.0, total - MUSIC_FADE_OUT)
    parts.append(f"[{cur}]atrim=0:{total:.3f},afade=t=out:st={fade_at:.3f}:d={MUSIC_FADE_OUT}[mus]")
    return args, ";".join(parts)


PARALLEL = 2                 # clips préparés en même temps à l'export (au-delà, la carte graphique sature)


def montage_duration(spec: MontageSpec) -> float:
    """Durée de la vidéo finale : les clips, plus les écrans de transition et la fin de la vidéo YouTube."""
    total = sum(c.end - c.start for c in spec.clips)
    if spec.cards or spec.outro:
        from . import youtube
        total += youtube.CARD_DUR * sum(1 for i in range(len(spec.clips)) if youtube.has_card(spec.clips, i, spec.cards))
        total += youtube.OUTRO_DUR if spec.outro else 0.0
    return total


def render_montage(spec: MontageSpec, progress=None) -> str:
    """Rend chaque clip puis les assemble. `progress(fraction, message)` est appelé au fil du rendu."""
    if not spec.clips:
        raise ValueError("Aucun clip à monter")
    enc = detect_encoder(spec.encoder)
    src = probe(spec.video)
    os.makedirs(os.path.dirname(os.path.abspath(spec.output)), exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="sklip_")
    try:
        parts = [os.path.join(tmp, f"part_{i:03d}.mp4") for i in range(len(spec.clips))]
        done = [0]
        lock = threading.Lock()
        # Vidéo YouTube : écran de transition quand on change de partie, « Abonne-toi » (15 s) à la fin.
        extras: list[tuple[int | None, str, list[str]]] = []      # (clip qu'il précède | None = fin, fichier, commande)
        if spec.cards or spec.outro:
            from . import youtube
            for i, clip in enumerate(spec.clips):
                if not youtube.has_card(spec.clips, i, spec.cards):
                    continue
                a = os.path.join(tmp, f"card_{i:03d}.ass")
                with open(a, "w", encoding="utf-8") as f:
                    f.write(youtube.card_ass(spec.fmt, *youtube.part_card(spec.clips, i)))
                out = os.path.join(tmp, f"card_{i:03d}.mp4")
                extras.append((i, out, youtube.still_cmd(spec, clip, src, clip.start, out, enc, a, youtube.CARD_DUR)))
            if spec.outro:
                last = spec.clips[-1]
                a = os.path.join(tmp, "outro.ass")
                with open(a, "w", encoding="utf-8") as f:
                    f.write(youtube.outro_ass(spec.fmt, channel=spec.outro_channel))
                out = os.path.join(tmp, "outro.mp4")
                extras.append((None, out, youtube.still_cmd(spec, last, src, last.end - 0.2, out, enc, a, youtube.OUTRO_DUR)))
        n_jobs = len(spec.clips) + len(extras)

        def extra(cmd: list[str]) -> None:
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode != 0 and enc != "libx264":
                r = subprocess.run([*cmd[:cmd.index("-c:v")], *encoder_args("libx264"), *cmd[cmd.index("-c:a"):]],
                                   capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError(f"FFmpeg a échoué sur un écran de transition : {r.stderr[-800:]}")
            with lock:
                done[0] += 1

        def one(i: int) -> None:
            clip = spec.clips[i]
            ass_file = _clip_overlays(spec, clip, os.path.join(tmp, f"part_{i:03d}.ass"))
            r = subprocess.run(_clip_cmd(spec, clip, src, parts[i], enc, ass_file), capture_output=True, text=True)
            if r.returncode != 0 and enc != "libx264":
                # La carte graphique refuse parfois plusieurs encodages à la fois : on refait ce clip au processeur.
                r = subprocess.run(_clip_cmd(spec, clip, src, parts[i], "libx264", ass_file), capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError(f"FFmpeg a échoué sur le clip {i + 1} : {r.stderr[-800:]}")
            with lock:
                done[0] += 1
                if progress:
                    progress(done[0] / (n_jobs + 1), f"Clip {done[0]}/{len(spec.clips)}")

        # Plusieurs clips préparés en même temps : le décodage de la vidéo du stream et les filtres tournent
        # sur le processeur, l'encodage sur la carte graphique ; à 3 à la fois, tout le PC travaille.
        workers = max(1, min(PARALLEL, len(spec.clips)))
        with ThreadPoolExecutor(workers) as pool:
            jobs = [pool.submit(one, i) for i in range(len(spec.clips))] + [pool.submit(extra, c) for _, _, c in extras]
            for f in jobs:
                f.result()
        before = {i: out for i, out, _ in extras if i is not None}
        parts = [q for i, part in enumerate(parts) for q in ([before[i]] if i in before else []) + [part]]
        parts += [out for i, out, _ in extras if i is None]
        listing = os.path.join(tmp, "list.txt")
        with open(listing, "w", encoding="utf-8") as f:
            for p in parts:
                f.write(f"file '{p}'\n")
        final = os.path.join(tmp, "final.mp4") if spec.auto_mix else spec.output
        playlist = music_playlist(spec)
        joined = os.path.join(tmp, "joined.mp4") if playlist else final
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", listing,
                        "-c", "copy", "-movflags", "+faststart", joined], check=True, capture_output=True)
        if playlist:
            total = montage_duration(spec)
            margs, mfilter = music_inputs(spec, total)
            vol = added_music_volume(spec)
            mix = (f"{mfilter};[mus]{vol}[m0];[0:a]asplit[a0][k];"
                   f"[m0][k]sidechaincompress={mixing.DUCK['music']}[m];"   # la musique s'efface sous la voix
                   "[a0][m]amix=inputs=2:normalize=0:duration=first[a]") if spec.auto_mix else                   f"{mfilter};[mus]{vol}[m];[0:a][m]amix=inputs=2:normalize=0:duration=first[a]"
            r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", joined, *margs, "-filter_complex", mix,
                                "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                                "-movflags", "+faststart", final], capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError(f"FFmpeg a échoué en ajoutant la musique : {r.stderr[-800:]}")
        if spec.auto_mix:
            if progress:
                progress(n_jobs / (n_jobs + 1), "Réglage du volume final")
            if mixing.normalize_loudness(final, spec.output) is None:
                shutil.copyfile(final, spec.output)
        if progress:
            progress(1.0, "Terminé")
        return spec.output
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _subtitle_words(spec: MontageSpec, clip: RenderClip) -> list[Word]:
    if clip.words is not None:
        return [w if isinstance(w, Word) else Word(**w) for w in clip.words]
    if not spec.subtitles:
        return []
    # Piste micro séparée si disponible (meilleure reconnaissance), sinon son mixé de la vidéo.
    mic = spec.tracks.get("mic")
    if mic and clip.start >= mic.offset - LATE_TRACKS:    # pas avant le début de la piste (Sklip ouvert en retard)
        start = clip.start - mic.offset
        return transcribe(mic.path, max(0.0, start), clip.end - mic.offset)
    return transcribe(spec.video, clip.start, clip.end)


def _clip_overlays(spec: MontageSpec, clip: RenderClip, path: str) -> str | None:
    content = build_ass(spec.fmt, clip.end - clip.start, _subtitle_words(spec, clip), clip.moments,
                        clip.start, spec.texts)
    if not content:
        return None
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return path


def export_moment(video: str, start: float, end: float, output: str, encoder: str | None = None) -> str:
    """Exporte un moment seul en 16:9 (dossier moments/ du stream), son mixé d'origine."""
    spec = MontageSpec(video=video, clips=[RenderClip(start, end)], output=output, fmt="16x9",
                       fade=0, encoder=encoder)
    return render_montage(spec)


def montage_filename(theme: str, fmt: str, bpm: float | None = None) -> str:
    name = f"sklip_{theme}_{fmt}"
    if bpm:
        name += f"_{int(round(bpm))}bpm"
    return name + ".mp4"

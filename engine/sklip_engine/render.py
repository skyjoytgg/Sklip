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


def encoder_args(enc: str) -> list[str]:
    if enc == "h264_nvenc":
        return ["-c:v", enc, "-preset", "p5", "-cq", "20", "-pix_fmt", "yuv420p"]
    if enc == "h264_amf":
        return ["-c:v", enc, "-quality", "balanced", "-rc", "cqp", "-qp_i", "20", "-qp_p", "22", "-pix_fmt", "yuv420p"]
    if enc == "h264_qsv":
        return ["-c:v", enc, "-global_quality", "21", "-pix_fmt", "nv12"]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]


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
    encoder: str | None = None
    texts: dict = field(default_factory=dict)      # {"enabled", "ace", "killCounter", "pseudo"}
    subtitles: bool = False                         # sous-titres auto mot par mot (français)
    auto_mix: bool = True                           # niveaux cohérents + voix devant + volume final -14 LUFS


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


def video_filter(fmt: str, layout: str, src_w: int, src_h: int, cam: Rect | None, fps: int,
                 dur: float, fade: float, post: str = "", friend: dict | None = None,
                 friend_input: str | None = None, friend_delay: float = 0.0, focus: tuple | None = None) -> str:
    """Graphe vidéo pour un clip. Entrée [0:v], sortie [v]. `post` : filtre ajouté après la mise en page
    (ex. incrustation des sous-titres). `friend` : réaction d'un pote (entrée `friend_input`)."""
    tail = [post] if post else []
    if fade > 0 and dur > 2 * fade:
        tail += [f"fade=t=in:st=0:d={fade}", f"fade=t=out:st={dur - fade:.3f}:d={fade}"]
    base = _layout(fmt, layout, src_w, src_h, cam, fps, focus)
    last = "[lay]"
    if friend and friend_input:
        chain, last = friend_filter(fmt, layout, friend, friend_input, friend_delay)
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


def _clip_cmd(spec: MontageSpec, clip: RenderClip, src: dict, out: str, enc: str, ass_file: str | None = None) -> list[str]:
    dur = clip.end - clip.start
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{clip.start:.3f}", "-t", f"{dur:.3f}", "-i", spec.video]
    vols = {**DEFAULT_VOLUMES, **spec.volumes, **clip.volumes}
    audio_parts, labels = [], []

    active = [(name, tf) for name, tf in spec.tracks.items() if name in TRACKS and vols.get(name, 0) > 0]
    if spec.tracks:
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
            audio_parts.append(chain + f",apad,atrim=0:{dur:.3f}[t{i}]")
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
    fade = spec.fade if dur > 2 * spec.fade else 0
    afade = f",afade=t=in:st=0:d={fade},afade=t=out:st={dur - fade:.3f}:d={fade}" if fade else ""
    audio_parts.append(f"{mix},aformat=channel_layouts=stereo{afade}[a]")

    friend_input, friend_delay = None, 0.0
    if clip.friend and clip.friend.get("file") and os.path.exists(clip.friend["file"]):
        # extrait(u) = stream(u + offset) : le début du clip tombe à u = clip.start - offset dans l'extrait.
        u = clip.start - float(clip.friend.get("offset", 0.0))
        friend_delay = max(0.0, -u)
        friend_input = f"[{cmd.count('-i')}:v]"
        cmd += ["-ss", f"{max(0.0, u):.3f}", "-t", f"{dur:.3f}", "-i", clip.friend["file"]]
    vf = video_filter(spec.fmt, clip.layout, src["width"], src["height"], clip.cam or spec.cam, spec.fps, dur, spec.fade,
                      post=ass_filter(ass_file) if ass_file else "", friend=clip.friend if friend_input else None,
                      friend_input=friend_input, friend_delay=friend_delay, focus=clip.focus)
    cmd += ["-filter_complex", vf + ";" + ";".join(audio_parts), "-map", "[v]", "-map", "[a]",
            *encoder_args(enc), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", out]
    return cmd


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


PARALLEL = 2                 # clips préparés en même temps à l'export (au-delà, la carte graphique sature)


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
                    progress(done[0] / (len(spec.clips) + 1), f"Clip {done[0]}/{len(spec.clips)}")

        # Plusieurs clips préparés en même temps : le décodage de la vidéo du stream et les filtres tournent
        # sur le processeur, l'encodage sur la carte graphique ; à 3 à la fois, tout le PC travaille.
        workers = max(1, min(PARALLEL, len(spec.clips)))
        with ThreadPoolExecutor(workers) as pool:
            for f in [pool.submit(one, i) for i in range(len(spec.clips))]:
                f.result()
        listing = os.path.join(tmp, "list.txt")
        with open(listing, "w", encoding="utf-8") as f:
            for p in parts:
                f.write(f"file '{p}'\n")
        final = os.path.join(tmp, "final.mp4") if spec.auto_mix else spec.output
        joined = os.path.join(tmp, "joined.mp4") if spec.music_file else final
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", listing,
                        "-c", "copy", "-movflags", "+faststart", joined], check=True, capture_output=True)
        if spec.music_file:
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", joined, "-ss", f"{spec.music_start:.3f}",
                            "-i", spec.music_file, "-filter_complex",
                            (f"[1:a]{added_music_volume(spec)}[m0];[0:a]asplit[a0][k];"
                             f"[m0][k]sidechaincompress={mixing.DUCK['music']}[m];"   # la musique s'efface sous la voix
                             "[a0][m]amix=inputs=2:normalize=0:duration=first[a]") if spec.auto_mix else
                            f"[1:a]{added_music_volume(spec)}[m];[0:a][m]amix=inputs=2:normalize=0:duration=first[a]",
                            "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                            "-movflags", "+faststart", final], check=True, capture_output=True)
        if spec.auto_mix:
            if progress:
                progress(len(spec.clips) / (len(spec.clips) + 1), "Réglage du volume final")
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
    if mic:
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

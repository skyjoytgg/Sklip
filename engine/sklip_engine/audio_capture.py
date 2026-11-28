"""Capture du son par Sklip lui-même, piste par piste, sans toucher à OBS.

- Jeu, Discord, musique : « process loopback » de Windows (Windows 10 2004 et plus) — on écoute
  uniquement le son d'un logiciel (et de ses sous-processus), comme une prise jack branchée sur lui.
- Micro : le micro par défaut de Windows.

Chaque piste est encodée au fil de l'eau en Opus 160 kb/s (.ogg) : ~170 Mo pour 3 h, sans limite de durée. Quand un logiciel ne fait pas de bruit (ou n'est pas
encore ouvert), on écrit du silence : toutes les pistes gardent la même durée, calée sur l'horloge.
Le calage précis sur la vidéo OBS est fait ensuite par audio_sync.py.

Arrêt : quand le fichier « stop » apparaît dans le dossier de capture (créé par l'appli).
"""
from __future__ import annotations

import ctypes
import json
import os
import sys
import threading
import time
from ctypes import POINTER, byref, c_int, c_uint32, c_uint64, c_void_p, wintypes

RATE, CHANNELS, BITS = 48000, 2, 16
BLOCK = CHANNELS * BITS // 8
REFTIMES_PER_SEC = 10_000_000
POLL_PROCESS = 5.0          # on recherche les logiciels pas encore ouverts toutes les 5 s

DEFAULT_TRACKS = {
    "game": {"exe": ["VALORANT-Win64-Shipping.exe"]},
    "mic": {"device": "default"},
    "discord": {"exe": ["Discord.exe", "DiscordPTB.exe", "DiscordCanary.exe"]},
    "music": {"exe": ["Spotify.exe"]},
}


# ---------- Trouver les logiciels ----------

class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD),
                ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD), ("szExeFile", ctypes.c_wchar * 260)]


def list_processes() -> list[tuple[int, int, str]]:
    """[(pid, pid du parent, nom de l'exe)]"""
    k32 = ctypes.windll.kernel32
    k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    snap = k32.CreateToolhelp32Snapshot(0x2, 0)
    out = []
    e = PROCESSENTRY32W()
    e.dwSize = ctypes.sizeof(e)
    ok = k32.Process32FirstW(snap, byref(e))
    while ok:
        out.append((e.th32ProcessID, e.th32ParentProcessID, e.szExeFile))
        ok = k32.Process32NextW(snap, byref(e))
    k32.CloseHandle(snap)
    return out


def root_pid(exe_names: list[str], procs: list[tuple[int, int, str]] | None = None) -> int | None:
    """Le processus « racine » du logiciel (Discord, Spotify… en ont plusieurs) : on capture tout son arbre."""
    procs = procs if procs is not None else list_processes()
    names = {n.lower() for n in exe_names}
    match = {pid: ppid for pid, ppid, name in procs if name.lower() in names}
    roots = [pid for pid, ppid in match.items() if ppid not in match]
    return min(roots) if roots else None


# ---------- Interfaces audio de Windows (COM) ----------

def _com():
    import comtypes
    from comtypes import COMMETHOD, GUID, HRESULT, IUnknown

    class WAVEFORMATEX(ctypes.Structure):
        _fields_ = [("wFormatTag", wintypes.WORD), ("nChannels", wintypes.WORD), ("nSamplesPerSec", wintypes.DWORD),
                    ("nAvgBytesPerSec", wintypes.DWORD), ("nBlockAlign", wintypes.WORD),
                    ("wBitsPerSample", wintypes.WORD), ("cbSize", wintypes.WORD)]

    class IAudioCaptureClient(IUnknown):
        _iid_ = GUID("{C8ADBD64-E71E-48a0-A4DE-185C395CD317}")
        _methods_ = [
            COMMETHOD([], HRESULT, "GetBuffer", (["out"], POINTER(POINTER(ctypes.c_byte)), "data"),
                      (["out"], POINTER(c_uint32), "frames"), (["out"], POINTER(c_uint32), "flags"),
                      (["out"], POINTER(c_uint64), "devpos"), (["out"], POINTER(c_uint64), "qpcpos")),
            COMMETHOD([], HRESULT, "ReleaseBuffer", (["in"], c_uint32, "frames")),
            COMMETHOD([], HRESULT, "GetNextPacketSize", (["out"], POINTER(c_uint32), "frames")),
        ]

    class IAudioClient(IUnknown):
        _iid_ = GUID("{1CB9AD4C-DBFA-4c32-B178-C2F568A703B2}")
        _methods_ = [
            COMMETHOD([], HRESULT, "Initialize", (["in"], c_int, "mode"), (["in"], wintypes.DWORD, "flags"),
                      (["in"], ctypes.c_longlong, "buffer"), (["in"], ctypes.c_longlong, "period"),
                      (["in"], POINTER(WAVEFORMATEX), "fmt"), (["in"], c_void_p, "session")),
            COMMETHOD([], HRESULT, "GetBufferSize", (["out"], POINTER(c_uint32), "frames")),
            COMMETHOD([], HRESULT, "GetStreamLatency", (["out"], POINTER(ctypes.c_longlong), "lat")),
            COMMETHOD([], HRESULT, "GetCurrentPadding", (["out"], POINTER(c_uint32), "pad")),
            COMMETHOD([], HRESULT, "IsFormatSupported", (["in"], c_int, "mode"), (["in"], c_void_p, "fmt"),
                      (["out"], POINTER(c_void_p), "closest")),
            COMMETHOD([], HRESULT, "GetMixFormat", (["out"], POINTER(c_void_p), "fmt")),
            COMMETHOD([], HRESULT, "GetDevicePeriod", (["out"], POINTER(ctypes.c_longlong), "d"),
                      (["out"], POINTER(ctypes.c_longlong), "m")),
            COMMETHOD([], HRESULT, "Start"),
            COMMETHOD([], HRESULT, "Stop"),
            COMMETHOD([], HRESULT, "Reset"),
            COMMETHOD([], HRESULT, "SetEventHandle", (["in"], wintypes.HANDLE, "h")),
            COMMETHOD([], HRESULT, "GetService", (["in"], POINTER(GUID), "iid"), (["out"], POINTER(POINTER(IUnknown)), "obj")),
        ]

    class IMMDevice(IUnknown):
        _iid_ = GUID("{D666063F-1587-4E43-81F1-B948E807363F}")
        _methods_ = [
            COMMETHOD([], HRESULT, "Activate", (["in"], POINTER(GUID), "iid"), (["in"], wintypes.DWORD, "ctx"),
                      (["in"], c_void_p, "params"), (["out"], POINTER(POINTER(IUnknown)), "obj")),
        ]

    class IMMDeviceEnumerator(IUnknown):
        _iid_ = GUID("{A95664D2-9614-4F35-A746-DE8DB63617E6}")
        _methods_ = [
            COMMETHOD([], HRESULT, "EnumAudioEndpoints", (["in"], c_int, "flow"), (["in"], wintypes.DWORD, "mask"),
                      (["out"], POINTER(c_void_p), "devs")),
            COMMETHOD([], HRESULT, "GetDefaultAudioEndpoint", (["in"], c_int, "flow"), (["in"], c_int, "role"),
                      (["out"], POINTER(POINTER(IMMDevice)), "dev")),
        ]

    class IActivateAudioInterfaceAsyncOperation(IUnknown):
        _iid_ = GUID("{72A22D78-CDE4-431D-B8CC-843A71199B6D}")
        _methods_ = [
            COMMETHOD([], HRESULT, "GetActivateResult", (["out"], POINTER(HRESULT), "hr"),
                      (["out"], POINTER(POINTER(IUnknown)), "obj")),
        ]

    class IActivateAudioInterfaceCompletionHandler(IUnknown):
        _iid_ = GUID("{41D949AB-9862-444A-80F6-C261334DA5EB}")
        _methods_ = [
            COMMETHOD([], HRESULT, "ActivateCompleted", (["in"], POINTER(IActivateAudioInterfaceAsyncOperation), "op")),
        ]

    class IAgileObject(IUnknown):
        _iid_ = GUID("{94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90}")
        _methods_ = []

    class Handler(comtypes.COMObject):
        _com_interfaces_ = [IActivateAudioInterfaceCompletionHandler, IAgileObject]

        def __init__(self):
            super().__init__()
            self.done = threading.Event()

        def IActivateAudioInterfaceCompletionHandler_ActivateCompleted(self, this, op):
            self.done.set()
            return 0

    return dict(comtypes=comtypes, GUID=GUID, IUnknown=IUnknown, WAVEFORMATEX=WAVEFORMATEX, IAudioClient=IAudioClient,
                IAudioCaptureClient=IAudioCaptureClient, IMMDeviceEnumerator=IMMDeviceEnumerator,
                IActivateAudioInterfaceAsyncOperation=IActivateAudioInterfaceAsyncOperation, Handler=Handler)


class _BLOB(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.ULONG), ("pBlobData", c_void_p)]


class _PROPVARIANT(ctypes.Structure):
    _fields_ = [("vt", wintypes.WORD), ("r1", wintypes.WORD), ("r2", wintypes.WORD), ("r3", wintypes.WORD), ("blob", _BLOB)]


class _LOOPBACK_PARAMS(ctypes.Structure):
    _fields_ = [("ActivationType", c_int), ("TargetProcessId", wintypes.DWORD), ("ProcessLoopbackMode", c_int)]


AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000
AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000
AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM = 0x80000000
AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY = 0x08000000
AUDCLNT_BUFFERFLAGS_SILENT = 0x2


def _format(C):
    f = C["WAVEFORMATEX"]()
    f.wFormatTag, f.nChannels, f.nSamplesPerSec, f.wBitsPerSample = 1, CHANNELS, RATE, BITS
    f.nBlockAlign = BLOCK
    f.nAvgBytesPerSec = RATE * BLOCK
    return f


def _process_client(C, pid: int):
    """IAudioClient qui n'entend que le processus `pid` et ses sous-processus."""
    params = _LOOPBACK_PARAMS(1, pid, 0)          # 1 = PROCESS_LOOPBACK, 0 = inclure l'arbre du processus
    pv = _PROPVARIANT(65, 0, 0, 0, _BLOB(ctypes.sizeof(params), ctypes.cast(byref(params), c_void_p)))
    handler = C["Handler"]()
    op = POINTER(C["IActivateAudioInterfaceAsyncOperation"])()
    fn = ctypes.windll.Mmdevapi.ActivateAudioInterfaceAsync
    fn.restype = ctypes.HRESULT
    iid = C["IAudioClient"]._iid_
    fn(ctypes.c_wchar_p("VAD\\Process_Loopback"), byref(iid), byref(pv),
       handler.QueryInterface(C["comtypes"].IUnknown), byref(op))
    if not handler.done.wait(5):
        raise RuntimeError("Windows n'a pas répondu à la demande de capture")
    hr, unk = op.GetActivateResult()
    if hr != 0:
        raise OSError(hr, "Capture du processus refusée (Windows 10 2004 ou plus requis)")
    client = unk.QueryInterface(C["IAudioClient"])
    fmt = _format(C)
    flags = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
    client.Initialize(0, flags, 2_000_000, 0, byref(fmt), None)
    return client


def _mic_client(C):
    enum = C["comtypes"].CoCreateInstance(C["GUID"]("{BCDE0395-E52F-467C-8E3D-C4579291692E}"),
                                          interface=C["IMMDeviceEnumerator"])
    dev = enum.GetDefaultAudioEndpoint(1, 0)          # 1 = capture, 0 = console
    client = dev.Activate(byref(C["IAudioClient"]._iid_), 0x17, None).QueryInterface(C["IAudioClient"])
    fmt = _format(C)
    flags = (AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
             | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY)
    client.Initialize(0, flags, 2_000_000, 0, byref(fmt), None)
    return client


# ---------- Enregistrement d'une piste ----------

class _OpusWriter:
    """Reçoit du PCM 48 kHz stéréo 16 bits et l'encode en Opus via FFmpeg."""

    def __init__(self, path: str):
        import subprocess
        self.proc = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(RATE), "-ac", str(CHANNELS), "-i", "-",
             "-c:a", "libopus", "-b:a", "160k", path],
            stdin=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def writeframesraw(self, data: bytes):
        self.proc.stdin.write(data)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        try:
            self.proc.stdin.close()
        finally:
            self.proc.wait(30)


class TrackRecorder(threading.Thread):
    """Enregistre une piste dans un WAV jusqu'à `stop`. Écrit du silence quand rien n'arrive."""

    def __init__(self, name: str, spec: dict, path: str, t0: float, stop: threading.Event, log=None):
        super().__init__(daemon=True, name=f"capture-{name}")
        self.name_, self.spec, self.path, self.t0, self.stop_ev = name, spec, path, t0, stop
        self.log = log or (lambda m: None)
        self.frames = 0
        self.source = None
        self.error = None

    def _pad_to(self, wav, t: float):
        """Ajoute du silence pour que la piste atteigne l'instant `t` (secondes depuis t0)."""
        want = int(t * RATE)
        if want - self.frames > RATE // 20:                      # plus de 50 ms de retard
            n = want - self.frames
            wav.writeframesraw(b"\0" * (n * BLOCK))
            self.frames += n

    def _open_client(self, C):
        if self.spec.get("device"):
            self.source = "micro par défaut"
            return _mic_client(C)
        pid = self.spec.get("pid") or root_pid(self.spec.get("exe", []))
        if pid is None:
            return None
        self.source = f"{(self.spec.get('exe') or ['pid'])[0]} (pid {pid})"
        return _process_client(C, pid)

    def run(self):
        try:
            self._run()
        except Exception as e:      # on note l'erreur, la capture des autres pistes continue
            self.error = f"{type(e).__name__}: {e}"
            self.log(f"{self.name_} : erreur {self.error}")

    def _run(self):
        import comtypes
        try:
            comtypes.CoInitializeEx(comtypes.COINIT_MULTITHREADED)
        except OSError:
            pass                    # COM déjà prêt sur ce fil
        C = _com()
        k32 = ctypes.windll.kernel32
        k32.CreateEventW.restype = wintypes.HANDLE
        with _OpusWriter(self.path) as wav:
            client, last_try = None, -1e9
            try:
                while not self.stop_ev.is_set():
                    now = time.time() - self.t0
                    if client is None:
                        self._pad_to(wav, now)
                        if now - last_try >= POLL_PROCESS:
                            last_try = now
                            try:
                                client = self._open_client(C)
                            except Exception as e:   # le logiciel a pu se fermer entre-temps
                                self.error = str(e)
                                client = None
                            if client is not None:
                                ev = k32.CreateEventW(None, False, False, None)
                                client.SetEventHandle(ev)
                                cap = client.GetService(byref(C["IAudioCaptureClient"]._iid_)).QueryInterface(
                                    C["IAudioCaptureClient"])
                                client.Start()
                                self.log(f"{self.name_} : capture de {self.source}")
                        else:
                            time.sleep(0.1)
                        continue
                    k32.WaitForSingleObject(ev, 100)
                    while True:
                        n = cap.GetNextPacketSize()
                        if not n:
                            break
                        data, frames, flags, _, _ = cap.GetBuffer()
                        if frames:
                            self._pad_to(wav, time.time() - self.t0 - frames / RATE)
                            raw = b"\0" * (frames * BLOCK) if flags & AUDCLNT_BUFFERFLAGS_SILENT else \
                                ctypes.string_at(data, frames * BLOCK)
                            wav.writeframesraw(raw)
                            self.frames += frames
                        cap.ReleaseBuffer(frames)
                    self._pad_to(wav, time.time() - self.t0 - 0.2)   # silence du logiciel : on avance quand même
            finally:
                if client is not None:
                    try:
                        client.Stop()
                    except Exception:
                        pass
                self._pad_to(wav, time.time() - self.t0)


def capture(folder: str, tracks: dict | None = None, max_seconds: float | None = None, progress=None) -> dict:
    """Enregistre les pistes dans `folder` jusqu'à l'apparition de `folder/stop` (ou `max_seconds`).

    Renvoie {"started_at": horloge (s), "tracks": {nom: {"path", "source"}}} — aussi écrit dans capture.json.
    """
    tracks = tracks or DEFAULT_TRACKS
    sys.coinit_flags = 0            # COM en mode « multi-fils » (indispensable pour la capture par processus)
    import comtypes  # noqa: F401  (initialise COM sur ce fil avant de lancer les autres)
    os.makedirs(folder, exist_ok=True)
    stop_file = os.path.join(folder, "stop")
    if os.path.exists(stop_file):
        os.remove(stop_file)
    stop = threading.Event()
    t0 = time.time()
    recs = [TrackRecorder(n, spec, os.path.join(folder, f"{n}.ogg"), t0, stop, log=lambda m: progress and progress(0, m))
            for n, spec in tracks.items()]
    for r in recs:
        r.start()
    if progress:
        progress(0.0, f"Capture démarrée à {t0:.3f}")
    info_path = os.path.join(folder, "capture.json")
    while not stop.is_set():
        time.sleep(0.25)
        if os.path.exists(stop_file) or (max_seconds and time.time() - t0 >= max_seconds):
            stop.set()
    for r in recs:
        r.join(5)
    info = {"started_at": t0, "stopped_at": time.time(),
            "tracks": {r.name_: {"path": r.path, "source": r.source, "error": r.error} for r in recs}}
    with open(info_path, "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False, indent=1)
    return info


def tracks_for_video(info: dict, record_started_at: float, video: str | None = None, sync=None) -> dict:
    """Pistes capturées → {nom: {"path", "offset"}} pour le rendu (vidéo(t) = piste(t - offset)).

    Décalage de départ : l'heure de début de la capture moins l'heure de début de l'enregistrement OBS.
    Si la vidéo est donnée, on l'affine en comparant le son du jeu (aussi présent dans la vidéo).
    Les pistes jamais ouvertes (logiciel absent tout le live) sont ignorées. Sklip ouvert après le début de
    l'enregistrement : le décalage est grand (la piste commence plus tard), le rendu met du silence avant.
    """
    offset = round(float(info["started_at"]) - float(record_started_at), 4)
    found = {n: t for n, t in info["tracks"].items() if t.get("source") and os.path.exists(t["path"])}
    ref = "game" if "game" in found else ("mic" if "mic" in found else None)
    if video and ref:
        from .audio_sync import sync_track
        try:
            # Sklip ouvert pendant l'enregistrement : la piste commence bien après la vidéo, on cherche là.
            r = sync(video, found[ref]["path"]) if sync else sync_track(video, found[ref]["path"], guess=offset)
            if r["confidence"] >= 0.3 and abs(r["offset"] - offset) < 10:
                offset = r["offset"]          # même horloge pour toutes les pistes : un seul décalage
        except Exception:
            pass                               # on garde le décalage de l'horloge
    return {n: {"path": t["path"], "offset": offset} for n, t in found.items()}

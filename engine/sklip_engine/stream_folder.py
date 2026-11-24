"""Dossier par stream : Sklip/Streams/AAAA-MM-JJ_titre/ avec stats.html, moments/, montages/."""
from __future__ import annotations

import html
import json
import os
import re
import unicodedata
from datetime import date

STAT_LABELS = [
    ("kills", "Kills"), ("multikills", "Multi-kills"), ("aces", "Aces"), ("clutchs", "Clutchs"),
    ("morts", "Morts"), ("peak_viewers", "Peak de viewers"), ("pics_chat", "Pics de chat"),
    ("clips_viewers", "Clips des viewers"), ("marqueurs", "Marqueurs"),
]


def slugify(text: str, max_len: int = 60) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return (text[:max_len].rstrip("-")) or "stream"


def create_stream_folder(root: str, title: str, day: date | None = None) -> dict:
    day = day or date.today()
    base = os.path.join(root, "Streams", f"{day.isoformat()}_{slugify(title)}")
    path, n = base, 2
    while os.path.exists(path):  # deux streams le même jour avec le même titre
        path = f"{base}-{n}"
        n += 1
    for sub in ("moments", "montages"):
        os.makedirs(os.path.join(path, sub))
    return {"path": path, "moments": os.path.join(path, "moments"), "montages": os.path.join(path, "montages")}


def fmt_time(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:02d}-{s % 3600 // 60:02d}-{s % 60:02d}"


def moment_filename(t: float, mtype: str) -> str:
    return f"{fmt_time(t)}_{mtype}.mp4"


def _duration(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600} h {s % 3600 // 60:02d}" if s >= 3600 else f"{s // 60} min"


def write_stats_html(folder: str, title: str, stats: dict, moments: list[dict] | None = None) -> str:
    """Récap lisible d'un double-clic. `stats` : compteurs + raids [{channel, viewers}] + durées."""
    e = html.escape
    tiles = "".join(
        f'<div class="tile"><div class="v">{e(str(stats.get(k, 0)))}</div><div class="l">{label}</div></div>'
        for k, label in STAT_LABELS)
    raids = stats.get("raids", [])
    raid_rows = "".join(f"<li><b>{e(r['channel'])}</b> — {int(r.get('viewers', 0))} viewers</li>" for r in raids) \
        or "<li class='muted'>Aucun raid</li>"
    mom_rows = "".join(
        f"<tr><td>{e(fmt_time(m['t']).replace('-', ':'))}</td><td>{e(m['type'])}</td>"
        f"<td><a href='moments/{e(moment_filename(m['t'], m['type']))}'>ouvrir</a></td></tr>"
        for m in (moments or []))
    page = f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>Sklip — {e(title)}</title>
<style>
body{{background:#0e0e12;color:#efeff1;font-family:Segoe UI,system-ui,sans-serif;margin:0;padding:32px}}
h1{{margin:0 0 4px;font-size:26px}} .muted{{color:#8a8a99}}
.meta{{color:#adadb8;margin-bottom:24px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:28px}}
.tile{{background:#18181f;border:1px solid #2a2a35;border-radius:10px;padding:16px}}
.tile .v{{font-size:30px;font-weight:700;color:#bf94ff}} .tile .l{{color:#adadb8;font-size:13px;margin-top:4px}}
h2{{font-size:17px;border-left:3px solid #9146ff;padding-left:10px}}
table{{border-collapse:collapse;width:100%;max-width:640px}} td{{padding:6px 10px;border-bottom:1px solid #26262f}}
a{{color:#bf94ff}} ul{{padding-left:20px}}
</style></head><body>
<h1>{e(title)}</h1>
<div class="meta">Durée du stream : {_duration(stats.get('duree_stream', 0))} · Sur Valorant : {_duration(stats.get('duree_valorant', 0))}</div>
<div class="grid">{tiles}</div>
<h2>Raids</h2><ul>{raid_rows}</ul>
<h2>Moments</h2><table>{mom_rows or "<tr><td class='muted'>Aucun moment</td></tr>"}</table>
</body></html>"""
    path = os.path.join(folder, "stats.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(page)
    with open(os.path.join(folder, "stats.json"), "w", encoding="utf-8") as f:
        json.dump({"title": title, "stats": stats, "moments": moments or []}, f, ensure_ascii=False, indent=2)
    return path

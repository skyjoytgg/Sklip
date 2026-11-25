// Onglet « Lives » : la liste des lives analysés (miniature, titre, date, durée) et le détail d'un live
// (moments, clips, stats et journal du live) pour la frise. Rien n'est modifié dans les dossiers, sauf la
// miniature (thumb.jpg) ajoutée la première fois.

const fs = require('node:fs');
const path = require('node:path');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

/** Date du live (ms) : début de l'enregistrement OBS, sinon la date du nom du dossier (AAAA-MM-JJ_…). */
function liveDate(session, name) {
  if (session && session.record_started_at) return Math.round(session.record_started_at * 1000);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(name || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime() : null;
}

const countClips = (clips) => Object.values(clips || {}).reduce((n, c) => n + c.length, 0);

/** Une ligne de la liste. */
function liveRow(folder) {
  const name = path.basename(folder);
  const session = readJson(path.join(folder, 'session.json'));
  if (!session) return null;
  return {
    folder, name, title: session.title || name, date: liveDate(session, name),
    duration: session.duration || (session.stats && session.stats.duree_stream) || 0,
    stats: session.stats || {}, clips: countClips(session.clips),
    hasThumb: fs.existsSync(path.join(folder, 'thumb.jpg')),
  };
}

/** Tous les lives analysés, du plus récent au plus ancien. */
function listLives(streamsDir) {
  let names = [];
  try { names = fs.readdirSync(streamsDir); } catch { return []; }
  return names.map((n) => liveRow(path.join(streamsDir, n))).filter(Boolean)
    .sort((a, b) => (b.date || 0) - (a.date || 0) || b.name.localeCompare(a.name));
}

/** Le journal du live qui correspond à cet enregistrement (début à ±2 min près). */
function matchJournal(journals, startMs) {
  if (!startMs) return null;
  let best = null;
  for (const j of journals || []) {
    const d = Math.abs(j.start - startMs);
    if (d <= 120e3 && (!best || d < best.d)) best = { id: j.id, d };
  }
  return best ? best.id : null;
}

/** Tout ce qu'il faut pour la page d'un live. */
function liveDetail(folder, { journals = [], getJournal = () => null } = {}) {
  const session = readJson(path.join(folder, 'session.json'));
  if (!session) return null;
  const row = liveRow(folder);
  const startMs = session.record_started_at ? session.record_started_at * 1000 : null;
  const jid = matchJournal(journals, startMs);
  const clips = [];
  for (const [theme, list] of Object.entries(session.clips || {})) {
    for (const c of list) clips.push({ theme, start: c.start, end: c.end, score: c.score, types: [...new Set((c.moments || []).map((m) => m.type))] });
  }
  clips.sort((a, b) => a.start - b.start);
  return {
    ...row, startMs, moments: session.moments || [], clips, themes: Object.keys(session.clips || {}),
    video: session.video, videoExists: !!(session.video && fs.existsSync(session.video)),
    segments: session.segments || [],
    journal: jid ? getJournal(jid) : null,
  };
}

/** Instant de la miniature : le plus beau moment (ace, clutch, multi-kill…), sinon au tiers du live. */
function thumbTime(session) {
  const best = [...(session.moments || [])].filter((m) => ['ace', 'clutch', 'multikill', 'kill'].includes(m.type))
    .sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  const d = session.duration || 0;
  return best ? Math.max(0, Math.min(best.t, d - 1)) : Math.max(0, d / 3);
}

module.exports = { listLives, liveRow, liveDetail, liveDate, matchJournal, thumbTime, readJson };

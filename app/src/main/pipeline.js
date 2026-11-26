// Fin du live → analyse → éditeur. Fonctions pures (testées dans test/pipeline.test.js) :
// on rassemble les moments venus d'ailleurs que l'image (Twitch, marqueurs) dans le temps de la vidéo.

const fs = require('node:fs');
const path = require('node:path');
const tm = require('./twitch-moments');

/** Marqueurs (raccourci clavier, Stream Deck) : instants en ms → moments dans le temps de l'enregistrement. */
function markerMoments(markers, recordStartMs) {
  if (!recordStartMs) return [];
  return markers
    .map((m) => ({ type: 'marker', t: Math.round((m.at - recordStartMs) / 10) / 100, meta: { source: m.source || 'raccourci' } }))
    .filter((m) => m.t >= 0);
}

/** Lit les fichiers Twitch « en attente » (un par live terminé). */
function readPendingTwitch(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^twitch-.*\.json$/.test(f)).map((f) => {
    try { return { file: path.join(dir, f), ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }; } catch { return null; }
  }).filter(Boolean);
}

/** Le live Twitch qui chevauche l'enregistrement (ou null). */
function pickTwitchData(pending, recordStartMs, recordStopMs) {
  const overlap = (d) => Math.min(d.endedAt, recordStopMs) - Math.max(d.startedAt, recordStartMs);
  const ok = pending.filter((d) => d.startedAt && d.endedAt && overlap(d) > 0);
  return ok.sort((a, b) => overlap(b) - overlap(a))[0] || null;
}

/** Moments Twitch dans le temps de l'enregistrement + stats (raids, peak). */
function twitchExtras(data, recordStartMs) {
  if (!data) return { moments: [], stats: {}, chat: [] };
  let moments = data.moments || [];
  // Si l'enregistrement n'était pas connu à la fin du live, on recale maintenant.
  if (!data.recordStartedAt && recordStartMs) moments = tm.streamToRecordingTime(moments, data.startedAt, recordStartMs);
  const viewers = (data.viewers || []).map((v) => v.viewers);
  return {
    moments,
    stats: {
      raids: (data.raids || []).map((r) => ({ channel: r.channel, viewers: r.viewers })),
      peak_viewers: viewers.length ? Math.max(...viewers) : null,
    },
    title: data.title || null,
    chat: tm.chatInRecordingTime(data.chat, data.recordStartedAt || recordStartMs || data.startedAt),
  };
}

/** Titre du dossier : titre du live Twitch, sinon « Stream du 25/11 ». */
function streamTitle(twitchTitle, date = new Date()) {
  if (twitchTitle && twitchTitle.trim()) return twitchTitle.trim();
  return `Stream du ${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Session du moteur → données de l'éditeur pour un thème. */
/** Webcam à utiliser : celle trouvée dans ce stream (auto), sinon le réglage manuel, sinon aucune. */
function pickCam(cam, detected) {
  const rect = (c) => ({ x: c.x, y: c.y, w: c.w, h: c.h });
  if (!cam || cam.enabled === false) return { cam: null, source: 'none' };
  if (cam.auto !== false && detected) return { cam: rect(detected), source: 'auto' };
  return { cam: rect(cam), source: cam.auto !== false ? 'auto_failed' : 'manual' };
}

function editorSession(session, theme, { cam, tracks } = {}) {
  const th = session.clips[theme] ? theme : session.themes[0];
  const picked = pickCam(cam, session.cam_detected);
  return {
    stream: { title: session.title, duration: session.duration, video: session.video, folder: session.folder },
    theme: th, themes: session.themes, target: session.target,
    moments: session.moments, clips: session.clips[th] || [],
    cam: picked.cam, camSource: picked.source, camDetected: session.cam_detected || null,
    tracks: tracks || session.tracks || null,
    speech: session.speech || [],
    chat: session.chat || [],         // messages du chat (temps de la vidéo) : à afficher quand le streamer les lit     // quand le streamer parle : aimant et « Ajuster aux phrases » dans l'éditeur
  };
}

module.exports = { pickCam, markerMoments, readPendingTwitch, pickTwitchData, twitchExtras, streamTitle, editorSession };

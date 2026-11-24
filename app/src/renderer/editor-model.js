// Modèle de l'éditeur de montage : fonctions pures (testées dans test/editor-model.test.js).
// Un projet de montage = { streamDuration, fmt, bpm, clips: [...], volumes, texts }.

const TRACKS = ['game', 'mic', 'discord', 'music'];
const TRACK_LABELS = { game: 'Jeu', mic: 'Micro', discord: 'Discord', music: 'Musique' };
const DEFAULT_VOLUMES = { game: 1, mic: 1, discord: 1, music: 0 };
const LAYOUTS = { cam_top: 'Cam en haut', cam_bottom: 'Cam en bas', game_only: 'Jeu seul' };
const MIN_CLIP = 1.0;
const PRE_ROLL = 4.0;
const POST_ROLL = 2.0;

let idSeq = 0;
const newId = () => `c${Date.now().toString(36)}${(idSeq++).toString(36)}`;

function makeClip(c) {
  return {
    id: c.id || newId(),
    start: c.start,
    end: c.end,
    layout: c.layout || 'cam_top',
    volumes: c.volumes || {},
    moments: c.moments || [],
  };
}

function createProject({ clips = [], streamDuration, fmt = '9x16', bpm = null, volumes, texts } = {}) {
  return {
    streamDuration,
    fmt,
    bpm,
    clips: clips.map(makeClip),
    volumes: { ...DEFAULT_VOLUMES, ...(volumes || {}) },
    texts: { subtitles: true, enabled: false, ace: true, killCounter: true, pseudo: '', ...(texts || {}) },
  };
}

const totalDuration = (p) => p.clips.reduce((s, c) => s + (c.end - c.start), 0);

/** Position de début de chaque clip dans le montage final. */
function clipOffsets(p) {
  let t = 0;
  return p.clips.map((c) => { const o = t; t += c.end - c.start; return o; });
}

function updateClip(p, id, patch) {
  return { ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

/** Déplace un clip à une nouvelle position dans la timeline (glisser-déposer). */
function moveClip(p, id, toIndex) {
  const from = p.clips.findIndex((c) => c.id === id);
  if (from < 0) return p;
  const clips = p.clips.slice();
  const [c] = clips.splice(from, 1);
  const to = Math.max(0, Math.min(clips.length, toIndex > from ? toIndex - 1 : toIndex));
  clips.splice(to, 0, c);
  return { ...p, clips };
}

function snapDuration(d, bpm) {
  if (!bpm) return d;
  const beat = 60 / bpm;
  return Math.max(1, Math.round(d / beat)) * beat;
}

/**
 * Rogne un clip en tirant un de ses bords. `edge` = 'start' | 'end', `delta` en secondes
 * (positif = vers la droite). Respecte : durée min, bornes du stream, grille BPM.
 */
function trimClip(p, id, edge, delta) {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  let { start, end } = c;
  const maxEnd = p.streamDuration ?? Infinity;
  if (edge === 'start') {
    start = Math.max(0, Math.min(end - MIN_CLIP, start + delta));
    if (p.bpm) start = Math.max(0, end - snapDuration(end - start, p.bpm));
  } else {
    end = Math.min(maxEnd, Math.max(start + MIN_CLIP, end + delta));
    if (p.bpm) end = Math.min(maxEnd, start + snapDuration(end - start, p.bpm));
  }
  return updateClip(p, id, { start: round(start), end: round(end) });
}

function round(x) { return Math.round(x * 1000) / 1000; }

/** Ajoute un moment détecté comme nouveau clip (à la fin, ou à l'index donné). */
function addMoment(p, moment, index = p.clips.length) {
  let start = Math.max(0, moment.t - PRE_ROLL);
  let end = moment.t + POST_ROLL;
  if (p.streamDuration != null) end = Math.min(end, p.streamDuration);
  if (p.bpm) start = Math.max(0, end - snapDuration(end - start, p.bpm));
  const clips = p.clips.slice();
  clips.splice(index, 0, makeClip({ start: round(start), end: round(end), moments: [moment] }));
  return { ...p, clips };
}

function removeClip(p, id) {
  return { ...p, clips: p.clips.filter((c) => c.id !== id) };
}

/** Un moment est « utilisé » s'il tombe dans un des clips du montage. */
function isMomentUsed(p, moment) {
  return p.clips.some((c) => moment.t >= c.start && moment.t <= c.end);
}

function setGlobalVolume(p, track, value) {
  return { ...p, volumes: { ...p.volumes, [track]: value } };
}

function setClipVolume(p, id, track, value) {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  const volumes = { ...c.volumes };
  if (value === null) delete volumes[track]; else volumes[track] = value;
  return updateClip(p, id, { volumes });
}

/** Volume réellement appliqué à un clip (réglage du clip, sinon réglage global). */
function effectiveVolume(p, clip, track) {
  return clip.volumes[track] ?? p.volumes[track] ?? DEFAULT_VOLUMES[track];
}

/** Paramètres envoyés au moteur (commande `render`). */
function toRenderSpec(p, { video, output, cam, tracks, musicFile, musicStart }) {
  return {
    video, output, cam, fmt: p.fmt,
    tracks: tracks || {},
    volumes: p.volumes,
    texts: p.texts,
    subtitles: !!p.texts.subtitles,
    bpm: p.bpm,
    music_file: musicFile || null,
    music_start: musicStart || 0,
    clips: p.clips.map((c) => ({ start: c.start, end: c.end, layout: c.layout, volumes: c.volumes,
      moments: c.moments })),
  };
}

function fmtTime(s) {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(sec).padStart(2, '0')}`;
}

module.exports = {
  TRACKS, TRACK_LABELS, DEFAULT_VOLUMES, LAYOUTS, MIN_CLIP,
  createProject, totalDuration, clipOffsets, moveClip, trimClip, addMoment, removeClip, updateClip,
  isMomentUsed, setGlobalVolume, setClipVolume, effectiveVolume, toRenderSpec, snapDuration, fmtTime,
};

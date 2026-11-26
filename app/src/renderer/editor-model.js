// Modèle de l'éditeur de montage : fonctions pures (testées dans test/editor-model.test.js).
// Un projet de montage = { streamDuration, fmt, bpm, clips: [...], volumes, texts }.

const TRACKS = ['game', 'mic', 'discord', 'music'];
const TRACK_LABELS = { game: 'Jeu', mic: 'Micro', discord: 'Discord', music: 'Musique' };
const DEFAULT_VOLUMES = { game: 1, mic: 1, discord: 1, music: 0 };
const LAYOUTS = { cam_top: 'Cam en haut', cam_bottom: 'Cam en bas', game_only: 'Jeu seul', cam_full: 'Cam en grand' };
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
    cam: c.cam || null,          // webcam de la scène OBS de ce clip (Just Chatting…), sinon celle du montage
    scene: c.scene || null,      // passage : « VALORANT », « Just Chatting »…
    focus: c.focus,              // « Cam en grand » : centre du visage dans la webcam ({ x, y } de 0 à 1) ;
                                 // undefined = pas encore cherché, null = pas trouvé (centre de la webcam)
    volumes: c.volumes || {},
    moments: c.moments || [],
    subs: c.subs || null,        // sous-titres : null = pas encore générés ; sinon lignes [{ start, end, words }]
    friend: c.friend || null,    // réaction d'un pote : { id, name, file, offset, duration, mode, pos, cutT, cutDur }
  };
}

function createProject({ clips = [], streamDuration, fmt = '9x16', bpm = null, volumes, texts } = {}) {
  return {
    streamDuration,
    fmt,
    bpm,
    clips: clips.map(makeClip),
    volumes: { ...DEFAULT_VOLUMES, ...(volumes || {}) },
    autoMix: true,               // niveaux cohérents, voix devant, volume final -14 LUFS
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
function trimClip(p, id, edge, delta, speech = null) {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  let { start, end } = c;
  const maxEnd = p.streamDuration ?? Infinity;
  if (edge === 'start') {
    start = Math.max(0, Math.min(end - MIN_CLIP, start + delta));
    if (p.bpm) start = Math.max(0, end - snapDuration(end - start, p.bpm));
    else if (speech) start = Math.min(end - MIN_CLIP, snapToSpeech(start, 'start', speech));
  } else {
    end = Math.min(maxEnd, Math.max(start + MIN_CLIP, end + delta));
    if (p.bpm) end = Math.min(maxEnd, start + snapDuration(end - start, p.bpm));
    else if (speech) end = Math.min(maxEnd, Math.max(start + MIN_CLIP, snapToSpeech(end, 'end', speech)));
  }
  return updateClip(p, id, { start: round(start), end: round(end) });
}

// La voix du streamer (`speech` = [[début, fin], …] dans le temps du stream, trouvé à l'analyse).
const SNAP = 0.35;        // s : un bord tiré près d'un début/fin de phrase s'y colle (aimant)
const SENTENCE_MAX = 6;   // s : « Ajuster aux phrases » ne bouge pas un bord de plus de 6 s

/** Aimant : colle `t` au début (edge 'start') ou à la fin (edge 'end') de phrase le plus proche, s'il est tout près. */
function snapToSpeech(t, edge, speech) {
  let best = t; let dist = SNAP;
  for (const [a, b] of speech || []) {
    const x = edge === 'start' ? Math.max(0, a - 0.15) : b + 0.2;
    if (Math.abs(x - t) < dist) { dist = Math.abs(x - t); best = x; }
  }
  return best;
}

/** La phrase en cours à l'instant t, ou null. */
function sentenceAt(t, speech) {
  return (speech || []).find(([a, b]) => a < t && t < b) || null;
}

/** « Ajuster aux phrases » : si un bord coupe une phrase, on recule le début / prolonge la fin jusqu'à elle. */
function fitToSentences(p, id, speech) {
  const c = p.clips.find((x) => x.id === id);
  if (!c || !speech) return p;
  let { start, end } = c;
  const s = sentenceAt(start, speech);
  if (s && start - s[0] <= SENTENCE_MAX) start = Math.max(0, s[0] - 0.15);
  const e = sentenceAt(end, speech);
  if (e && e[1] - end <= SENTENCE_MAX) end = Math.min(p.streamDuration ?? Infinity, e[1] + 0.2);
  return updateClip(p, id, { start: round(start), end: round(end) });
}

const REACTION_STATUS = {
  refused: 'demande refusée',
  absent: "pas d'enregistrement à ce moment-là",
  not_together: "son Sklip ne vous a pas vus en chat partagé à ce moment-là",
  error: "son Sklip n'a pas réussi à découper sa webcam",
  expired: "pas de réponse en 7 jours (il n'a pas ouvert Sklip)",
};
/** Pourquoi une réaction n'est pas arrivée, en clair. */
function reactionStatusText(status) { return REACTION_STATUS[status] || 'réaction indisponible'; }

/** Bords qui coupent une phrase : { start: bool, end: bool }. */
function cutsSentence(c, speech) {
  return { start: !!sentenceAt(c.start, speech), end: !!sentenceAt(c.end, speech) };
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

/** Le clip garde-t-il la musique qui passait pendant le live ? */
function hasLiveMusic(p, clip) {
  return effectiveVolume(p, clip, 'music') > 0;
}

/**
 * Garder (ou non) la musique du live sur ce clip, par ex. quand le streamer chante dessus.
 * Activé : volume musique du clip à 100 %. Désactivé : on revient au réglage global (coupé par défaut).
 */
function setLiveMusic(p, id, on) {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  const volumes = { ...c.volumes };
  if (on) volumes.music = 1;
  else if ((p.volumes.music ?? DEFAULT_VOLUMES.music) > 0) volumes.music = 0;
  else delete volumes.music;
  return updateClip(p, id, { volumes });
}

/**
 * Texte proposé pour poster la vidéo (titre, description, hashtags). Gardé à côté du montage dans un .json,
 * pour qu'une future publication automatique (TikTok, YouTube Shorts) n'ait plus qu'à l'envoyer.
 */
function suggestPost(p, { streamTitle = '', theme = 'kills', channel = '' } = {}) {
  const all = p.clips.flatMap((c) => c.moments || []);
  const has = (t) => all.find((m) => m.type === t);
  const best = all.reduce((a, m) => (!a || (m.meta?.count || 1) > (a.meta?.count || 1) ? m : a), null);
  let title;
  if (theme === 'bestof') title = has('ace') ? 'Le best-of du live (avec un ACE) 🔥' : 'Le best-of du live 🔥';
  else if (all.some((m) => m.meta?.knives?.length)) title = 'Kill au couteau 🔪';
  else if (has('ace')) title = 'ACE 🔥';
  else if (has('clutch')) title = `Clutch ${has('clutch').meta?.vs ? `1v${has('clutch').meta.vs}` : ''} 🧠`.replace('  ', ' ');
  else if (best && best.type === 'multikill') title = `${best.meta.count}K 😤`;
  else if (theme === 'drole') title = 'Le moment où tout part en vrille 😂';
  else if (theme === 'communaute') title = 'Merci la commu ❤️';
  else if (theme === 'discussion') title = 'En direct avec le chat 🎙️';
  else title = 'Les meilleurs kills du stream 🎯';
  const tags = ['#valorant', '#valorantclips', '#twitch', '#gaming'];
  if (p.fmt === '9x16') tags.push('#shorts', '#fyp');
  if (all.some((m) => m.meta?.knives?.length)) tags.push('#knife');
  if (theme === 'drole') tags.push('#funny');
  if (theme === 'discussion') tags.push('#justchatting');
  const desc = [streamTitle && `Extrait du live « ${streamTitle} »`, channel && `En live sur twitch.tv/${channel}`]
    .filter(Boolean).join(' — ');
  return { title: title.trim(), description: desc, hashtags: tags, format: p.fmt, duration: Math.round(totalDuration(p) * 10) / 10 };
}

// ---------- Sous-titres modifiables ----------
// Les temps sont ceux du stream : rogner ou déplacer un clip ne décale pas ce qui a été écrit.

const LINE_MAX_WORDS = 6;
const LINE_MAX_GAP = 0.8;

/** Mots reconnus → lignes faciles à corriger (coupées sur un blanc, une ponctuation ou 6 mots). */
function linesFromWords(words) {
  const lines = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    const prev = last && last.words[last.words.length - 1];
    if (last && last.words.length < LINE_MAX_WORDS && w.start - prev.end <= LINE_MAX_GAP && !/[.!?…]$/.test(prev.text)) {
      last.words.push(w);
      last.end = w.end;
    } else {
      lines.push({ start: w.start, end: w.end, words: [w] });
    }
  }
  return lines;
}

const lineText = (line) => line.words.map((w) => w.text).join(' ');

/** Ajoute les sous-titres générés (mots en temps du stream) au clip. */
function setClipWords(p, id, words) {
  return updateClip(p, id, { subs: linesFromWords(words) });
}

/**
 * Corrige le texte d'une ligne. Même nombre de mots : on garde le timing de chaque mot (correction d'une faute).
 * Sinon (blague, phrase réécrite) : les nouveaux mots se partagent la durée de la ligne. Texte vide : ligne supprimée.
 */
function setLineText(p, id, index, text) {
  const c = p.clips.find((x) => x.id === id);
  if (!c || !c.subs || !c.subs[index]) return p;
  const line = c.subs[index];
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const subs = c.subs.slice();
  if (!parts.length) {
    subs.splice(index, 1);
  } else if (parts.length === line.words.length) {
    subs[index] = { ...line, words: line.words.map((w, i) => ({ ...w, text: parts[i] })) };
  } else {
    const step = Math.max(0.05, (line.end - line.start) / parts.length);
    subs[index] = { ...line, words: parts.map((t, i) => ({ start: round(line.start + i * step), end: round(line.start + (i + 1) * step), text: t })) };
  }
  return updateClip(p, id, { subs });
}

/** Ajoute une ligne à l'instant `t` (temps du stream), par ex. pour une blague. */
function addLine(p, id, t, text = 'Texte', duration = 1.5) {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  const start = round(Math.max(c.start, Math.min(t, c.end - 0.3)));
  const end = round(Math.min(c.end, start + duration));
  const subs = [...(c.subs || []), { start, end, words: [{ start, end, text }] }].sort((a, b) => a.start - b.start);
  return updateClip(p, id, { subs });
}

/** Mots du clip pour le rendu (temps relatifs au clip), ou undefined si jamais générés (le moteur s'en charge). */
function clipWordsForRender(c) {
  if (!c.subs) return undefined;
  return c.subs.flatMap((l) => l.words)
    .filter((w) => w.end > c.start && w.start < c.end)
    .map((w) => ({ start: round(Math.max(0, w.start - c.start)), end: round(Math.min(c.end, w.end) - c.start), text: w.text }));
}

/** Ligne affichée dans l'aperçu à l'instant `t` (temps du stream), avec l'index du mot prononcé. */
function subtitleAt(c, t) {
  if (!c || !c.subs) return null;
  const line = c.subs.find((l) => t >= l.start && t <= l.end + 0.15);
  if (!line) return null;
  let k = line.words.findIndex((w) => t >= w.start && t < w.end);
  if (k < 0) k = line.words.filter((w) => w.start <= t).length - 1;
  return { words: line.words.map((w) => w.text), current: k };
}

/** Paramètres envoyés au moteur (commande `render`). */
// ---------- Réactions des amis ----------
const REACTION_MODES = { pip: 'Incrustation', cut: 'Plan de coupe' };
const PIP_POSITIONS = { tr: 'Haut droite', tl: 'Haut gauche', br: 'Bas droite', bl: 'Bas gauche' };
const CUT_DURATIONS = [1.5, 2.5, 4];

/** Réactions reçues → clips qui contiennent le moment (incrustation par défaut). Une réaction retirée ne revient pas. */
function attachReactions(p, reactions) {
  const dismissed = new Set(p.dismissedReactions || []);
  const used = new Set(p.clips.filter((c) => c.friend).map((c) => c.friend.id));
  let changed = false;
  const clips = p.clips.map((c) => {
    if (c.friend) return c;
    const r = (reactions || []).find((x) => x.status === 'ok' && x.file && !dismissed.has(x.id) && !used.has(x.id)
      && x.t >= c.start && x.t <= c.end);
    if (!r) return c;
    used.add(r.id);
    changed = true;
    return { ...c, friend: { id: r.id, name: r.friend, file: r.file, offset: r.offset, duration: r.duration || null,
      mode: 'pip', pos: null, cutT: round(r.t + 0.3), cutDur: 2.5 } };
  });
  return changed ? { ...p, clips } : p;
}

function setFriend(p, id, patch) {
  const c = p.clips.find((x) => x.id === id);
  if (!c || !c.friend) return p;
  if (patch === null) {   // retirer la réaction de ce clip
    return { ...updateClip(p, id, { friend: null }), dismissedReactions: [...(p.dismissedReactions || []), c.friend.id] };
  }
  return updateClip(p, id, { friend: { ...c.friend, ...patch } });
}

/** Ce qu'on voit du pote à l'instant `t` du stream : null, ou { u (temps dans son extrait), full (plan de coupe) }. */
function friendAt(c, t) {
  const f = c.friend;
  if (!f) return null;
  const u = t - f.offset;
  if (u < 0 || (f.duration && u > f.duration)) return null;
  if (f.mode === 'cut') return t >= f.cutT && t < f.cutT + f.cutDur ? { u, full: true } : null;
  return { u, full: false };
}

function friendForRender(c) {
  const f = c.friend;
  if (!f) return undefined;
  return { file: f.file, offset: f.offset, mode: f.mode, pos: f.pos || undefined,
    cut_at: round(Math.max(0, f.cutT - c.start)), cut_dur: f.cutDur };
}

/** Webcam d'un clip : celle de sa scène OBS si on la connaît (sauf webcam réglée à la main pour les clips de jeu). */
/** « Cam en grand » avec une petite webcam (moins de la moitié de la hauteur, comme le moteur) : l'image sera floue. */
const FULL_MIN_H = 0.5;
function blurryFull(c, cam, camManual = false) {
  const k = c && c.layout === 'cam_full' ? clipCam(c, cam, camManual) : null;
  return !!(k && k.h < FULL_MIN_H);
}

function clipCam(c, cam, camManual = false) {
  if (!cam || !c.cam) return cam || null;
  return c.layout === 'cam_full' || !camManual ? c.cam : cam;
}

function toRenderSpec(p, { video, output, cam, tracks, musicFile, musicStart, post, camManual = false }) {
  return {
    post: post || null,
    auto_mix: p.autoMix !== false,
    video, output, cam: cam && cam.enabled !== false ? { x: cam.x, y: cam.y, w: cam.w, h: cam.h } : null, fmt: p.fmt,
    tracks: tracks || {},
    volumes: p.volumes,
    texts: p.texts,
    subtitles: !!p.texts.subtitles,
    bpm: p.bpm,
    music_file: musicFile || null,
    music_start: musicStart || 0,
    clips: p.clips.map((c) => ({ start: c.start, end: c.end, layout: c.layout, volumes: c.volumes,
      cam: c.cam && cam ? clipCam(c, cam, camManual) : undefined,
      focus: c.layout === 'cam_full' && c.focus ? c.focus : undefined,
      moments: c.moments, words: p.texts.subtitles ? clipWordsForRender(c) : undefined, friend: friendForRender(c) })),
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
  clipCam, blurryFull, createProject, totalDuration, clipOffsets, moveClip, trimClip, addMoment, removeClip, updateClip,
  snapToSpeech, fitToSentences, cutsSentence, reactionStatusText,
  isMomentUsed, setGlobalVolume, setClipVolume, effectiveVolume, hasLiveMusic, setLiveMusic, toRenderSpec, suggestPost,
  REACTION_MODES, PIP_POSITIONS, CUT_DURATIONS, attachReactions, setFriend, friendAt,
  linesFromWords, lineText, setClipWords, setLineText, addLine, clipWordsForRender, subtitleAt, snapDuration, fmtTime,
};

// Modèle de l'éditeur de montage : fonctions pures (testées dans test/editor-model.test.js).
// Un projet de montage = { streamDuration, fmt, bpm, clips: [...], volumes, texts }.

const { isViewerMessage, cleanChatText } = require('../main/chat-bots');

const TRACKS = ['game', 'mic', 'discord', 'music'];
const TRACK_LABELS = { game: 'Jeu', mic: 'Micro', discord: 'Discord', music: 'Musique' };
const DEFAULT_VOLUMES = { game: 1, mic: 1, discord: 1, music: 0 };
const LAYOUTS = { cam_top: 'Cam en haut', cam_bottom: 'Cam en bas', game_only: 'Jeu seul', cam_full: 'Cam en grand' };
const MIN_CLIP = 1.0;
// Contexte autour d'un moment (demande de Sky : 6 s c'est trop court, on ne voit pas l'action venir).
const CONTEXT_BEFORE = 30.0;     // s avant le moment (rire, kill, cri…)
const CONTEXT_AFTER = 8.0;       // s après : la réaction, et ne pas couper le streamer qui parle encore
const COMBO_LEAD = 10.0;         // multi-kill / ace / clutch : s avant le premier kill
// Un clip viewer est créé APRÈS l'action, et le viewer choisit son extrait jusqu'à ~90 s avant (Sky : 1 min à 1 min 30).
const VIEWER_CLIP = { before: 85.0, after: 10.0 };
// Fins de partie : le dernier round avant la bannière ; l'écran du rang ne dure que 1 à 3 s (avant : chargement).
const TYPE_WINDOW = { victory: [1.0, 5.0], defeat: [1.0, 5.0], rr: [1.5, 3.5] };   // comme le moteur (selection.py)

/** Fenêtre [début, fin] du clip proposé pour un moment. */
function momentWindow(m) {
  if (m.type === 'viewer_clip') {
    const mt = m.meta || {};
    if (mt.before != null) return { start: m.t - mt.before - 5, end: m.t + (mt.after || 0) + 3 };   // passage exact du clip
    return { start: m.t - VIEWER_CLIP.before, end: m.t + VIEWER_CLIP.after };
  }
  if (TYPE_WINDOW[m.type]) return { start: m.t - TYPE_WINDOW[m.type][0], end: m.t + TYPE_WINDOW[m.type][1] };
  const first = m.meta && m.meta.t_start != null ? Number(m.meta.t_start) : m.t;
  return { start: Math.min(m.t - CONTEXT_BEFORE, first - COMBO_LEAD), end: m.t + CONTEXT_AFTER };
}

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
    voices: c.voices || [],      // répliques des coéquipiers : [{ agent, name, start, end, text, on, auto }]
    chat: c.chat || [],          // bulles du chat : [{ t, user, text, color, badges, start, end, auto }] (temps du stream)
    gameChat: c.gameChat || null, // messages du chat du jeu lus dans l'image : null = pas encore lus ; [{ t, user, text, team }]
    teaser: c.teaser || false,    // morceau du teaser du début (les meilleurs instants en coupes rapides)
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
  const w = momentWindow(moment);
  let start = Math.max(0, w.start);
  let end = w.end;
  if (p.streamDuration != null) end = Math.min(end, p.streamDuration);
  if (p.bpm) start = Math.max(0, end - snapDuration(end - start, p.bpm));
  const clips = p.clips.slice();
  clips.splice(index, 0, makeClip({ start: round(start), end: round(end), moments: [moment] }));
  return { ...p, clips };
}

/**
 * Aperçu d'un moment sans l'ajouter au montage : un projet d'un seul clip (même découpe que « + Ajouter »),
 * avec la mise en page du clip qui le contient s'il y en a un (`like` : clips du montage ou proposés par Sklip).
 */
function peekProject(p, moment, like = []) {
  const q = addMoment({ ...p, clips: [] }, moment);
  const near = like.find((c) => moment.t >= c.start && moment.t <= c.end);
  if (near) q.clips[0] = { ...q.clips[0], layout: near.layout || q.clips[0].layout, cam: near.cam, focus: near.focus };
  return q;
}

/**
 * Coupe un clip en deux à l'instant `at` (temps du stream) : deux clips qui se suivent, mêmes réglages.
 * Moments, répliques, bulles du chat et sous-titres vont dans la moitié où ils tombent ; la réaction d'un pote
 * reste dans la moitié où elle commence. Rien si la coupe laisse un morceau de moins de MIN_CLIP.
 */
function splitClip(p, id, at) {
  const i = p.clips.findIndex((c) => c.id === id);
  if (i < 0) return p;
  const c = p.clips[i];
  if (!(at - c.start >= MIN_CLIP && c.end - at >= MIN_CLIP)) return p;
  at = round(at);
  const side = (t) => (t < at ? 0 : 1);
  const part = (k) => makeClip({
    ...c, id: undefined,
    start: k ? at : c.start, end: k ? c.end : at,
    moments: c.moments.filter((m) => side(m.t) === k),
    voices: (c.voices || []).filter((v) => side(v.start) === k),
    chat: (c.chat || []).filter((m) => side(m.start != null ? m.start : m.t) === k),
    gameChat: c.gameChat ? c.gameChat.filter((m) => side(m.t) === k) : null,
    subs: c.subs ? c.subs.filter((l) => side(l.start) === k) : null,
    friend: c.friend && side(c.friend.offset) === k ? c.friend : null,
  });
  const clips = p.clips.slice();
  clips.splice(i, 1, part(0), part(1));
  return { ...p, clips };
}

// ---------- Teaser ----------
// Sky (26/11) : le meilleur moment au tout début, comme un teaser (« un multi-kill mais juste les 3 kills avec
// coupure rapide »), puis le clip entier reste à sa place dans le montage.
const TEASER_MAX = 3.0;          // s en tout
const TEASER_KILL = [0.7, 0.3];  // autour de chaque kill : le tir et l'élimination (1 s)
const TEASER_ONE = [2.0, 1.0];   // un seul instant (rire, ace, clutch…) : 3 s

const momentPower = (m) => (Number(m.score) || 0) + 10 * Math.max(0, ((m.meta && m.meta.count) || 1) - 1);

/** Les instants du teaser pour un montage : [{ start, end, from }] (temps du stream), ou [] s'il n'y a rien de fort. */
function teaserCuts(p) {
  let best = null;
  let from = null;
  for (const c of p.clips) {
    if (c.teaser) continue;
    for (const m of c.moments || []) if (!best || momentPower(m) > momentPower(best)) { best = m; from = c; }
  }
  if (!best) return [];
  const kills = ((best.meta && best.meta.kills) || []).map(Number).filter((t) => t >= from.start && t <= from.end);
  let cuts;
  if (kills.length >= 2) {
    const each = Math.min(TEASER_KILL[0] + TEASER_KILL[1], TEASER_MAX / Math.min(kills.length, 3));
    const keep = kills.slice(-3);                                  // les 3 derniers : la fin de l'action
    cuts = keep.map((k) => ({ start: k - each * 0.7, end: k + each * 0.3 }));
    for (let i = 1; i < cuts.length; i++) cuts[i].start = Math.max(cuts[i].start, cuts[i - 1].end);   // pas de doublon
    cuts = cuts.filter((x) => x.end - x.start >= 0.4);
  } else {
    cuts = [{ start: best.t - TEASER_ONE[0], end: best.t + TEASER_ONE[1] }];
  }
  return cuts.map((x) => ({ start: round(Math.max(from.start, x.start)), end: round(Math.min(from.end, x.end)), from }))
    .filter((x) => x.end - x.start >= 0.4);
}

const hasTeaser = (p) => p.clips.some((c) => c.teaser);

/** Ajoute (ou enlève avec `on = false`) le teaser au début du montage. */
function setTeaser(p, on = true) {
  const rest = p.clips.filter((c) => !c.teaser);
  if (!on) return { ...p, clips: rest, teaserOff: true };
  const cuts = teaserCuts({ ...p, clips: rest });
  if (!cuts.length) return { ...p, clips: rest };
  const parts = cuts.map((x) => makeClip({
    start: x.start, end: x.end, layout: x.from.layout, cam: x.from.cam, scene: x.from.scene, focus: x.from.focus,
    volumes: x.from.volumes, teaser: true, subs: [], gameChat: [], chat: [], voices: [],
  }));
  return { ...p, clips: [...parts, ...rest], teaserOff: false };
}

function removeClip(p, id) {
  return { ...p, clips: p.clips.filter((c) => c.id !== id) };
}

// ---------- Moments retirés de la liste (le streamer n'en veut pas) ----------
const momentKey = (m) => `${m.type}@${Math.round(m.t * 10) / 10}`;
const isMomentHidden = (p, m) => (p.hiddenMoments || []).includes(momentKey(m));

/** Retire un moment de la liste « Moments détectés » (ou le remet avec `hidden = false`). Gardé dans le projet. */
function hideMoment(p, m, hidden = true) {
  const k = momentKey(m);
  const list = (p.hiddenMoments || []).filter((x) => x !== k);
  return { ...p, hiddenMoments: hidden ? [...list, k] : list };
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
  const rr = has('rr') && has('rr').meta?.rr;
  if (theme === 'bestof') title = has('ace') ? 'Le best-of du live (avec un ACE) 🔥' : 'Le best-of du live 🔥';
  else if (all.some((m) => m.meta?.knives?.length)) title = 'Kill au couteau 🔪';
  else if (has('ace')) title = 'ACE 🔥';
  else if (has('clutch')) title = `Clutch ${has('clutch').meta?.vs ? `1v${has('clutch').meta.vs}` : ''} 🧠`.replace('  ', ' ');
  else if (best && best.type === 'multikill') title = `${best.meta.count}K 😤`;
  else if (has('victory')) title = `VICTOIRE${has('victory').meta?.score ? ` ${has('victory').meta.score}` : ''} 🏆${rr > 0 ? ` (+${rr} RR)` : ''}`;
  else if (rr < 0) title = `${rr} RR… 💀`;
  else if (theme === 'drole') title = 'Le moment où tout part en vrille 😂';
  else if (theme === 'communaute') title = 'Merci la commu ❤️';
  else if (theme === 'discussion') title = 'En direct avec le chat 🎙️';
  else title = 'Les meilleurs kills du stream 🎯';
  const tags = ['#valorant', '#valorantclips', '#twitch', '#gaming'];
  if (p.fmt === '9x16') tags.push('#shorts', '#fyp');
  if (all.some((m) => m.meta?.knives?.length)) tags.push('#knife');
  if (theme === 'drole') tags.push('#funny');
  if (has('rr') || has('victory')) tags.push('#ranked');
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

/** Affiche ou cache une ligne de sous-titre (`index`), ou toutes les lignes du clip (`index` = null). Le texte est gardé. */
function setLineOn(p, id, index, on) {
  const c = p.clips.find((x) => x.id === id);
  if (!c || !c.subs) return p;
  const subs = c.subs.map((l, i) => (index == null || i === index ? { ...l, off: !on } : l));
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
  return c.subs.filter((l) => !l.off).flatMap((l) => l.words)
    .filter((w) => w.end > c.start && w.start < c.end)
    .map((w) => ({ start: round(Math.max(0, w.start - c.start)), end: round(Math.min(c.end, w.end) - c.start), text: w.text }));
}

/** Ligne affichée dans l'aperçu à l'instant `t` (temps du stream), avec l'index du mot prononcé. */
function subtitleAt(c, t) {
  if (!c || !c.subs) return null;
  const line = c.subs.find((l) => !l.off && t >= l.start && t <= l.end + 0.15);
  if (!line) return null;
  let k = line.words.findIndex((w) => t >= w.start && t < w.end);
  if (k < 0) k = line.words.filter((w) => w.start <= t).length - 1;
  return { words: line.words.map((w) => w.text), current: k };
}

// ---------- Messages du chat sur la vidéo ----------
const CHAT_LOOKBACK = 180;      // messages proposés : jusqu'à 3 min avant le clip (le streamer lit avec du retard)

const sameMsg = (a, b) => a.t === b.t && a.user === b.user && a.text === b.text;

/** Messages du chat autour d'un clip, du plus récent au plus ancien. */
function chatNear(chat, c, lookback = CHAT_LOOKBACK) {
  // Les streams déjà analysés peuvent encore contenir des messages de bots : on les écarte ici aussi.
  return (chat || []).filter((m) => m.t >= c.start - lookback && m.t <= c.end && isViewerMessage(m))
    .map((m) => ({ ...m, text: cleanChatText(m.text) })).sort((a, b) => b.t - a.t);
}

// Chat du jeu (Valorant) : couleur du pseudo comme dans le jeu, bleu allié / rouge ennemi.
const GAME_CHAT_COLORS = { ally: '#5ECBEF', enemy: '#FF4655' };
const GAME_CHAT_LOOKBACK = 10;
const GAME_CHAT_SHOW = 3;        // s : durée d'affichage d'un message du chat du jeu

/** Messages du chat du jeu d'un clip, au format des messages Twitch (pour la même liste et la même bulle). */
/** Chat du jeu lu pendant l'analyse ({ spans, messages }) pour ce clip, ou null s'il n'a pas été lu là. */
function gameChatFromSession(gc, c, lookback = GAME_CHAT_LOOKBACK) {
  if (!gc || !gc.spans) return null;
  const a = c.start - lookback;
  if (!gc.spans.some(([x, y]) => x <= a + 0.5 && y >= c.end - 0.5)) return null;
  return (gc.messages || []).filter((m) => m.t >= a && m.t <= c.end);
}

function gameChatNear(c, lookback = GAME_CHAT_LOOKBACK) {
  return (c.gameChat || []).filter((m) => m.t >= c.start - lookback && m.t <= c.end)
    .map((m) => ({ ...m, color: GAME_CHAT_COLORS[m.team] || null, badges: [], game: true })).sort((a, b) => b.t - a.t);
}

/** Temps de lecture d'un message (s) : de 2,5 à 7 s selon sa longueur. */
function chatReadTime(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  return Math.min(7, Math.max(2.5, 1.2 + 0.32 * words));
}

const isChatShown = (c, m) => (c.chat || []).some((b) => sameMsg(b, m));

/** Ajoute ou enlève la bulle d'un message dans un clip. Ajoutée à la main : quand le message arrive (ou au début du clip). */
function toggleChat(p, id, m) {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  if (isChatShown(c, m)) return updateClip(p, id, { chat: c.chat.filter((b) => !sameMsg(b, m)) });
  const dur = m.game ? GAME_CHAT_SHOW : chatReadTime(m.text);       // chat du jeu : 3 s (Sky)
  let start = Math.max(m.t, c.start) + 0.2;
  if (start > c.end - 1.5) start = c.start + 0.3;
  for (const o of [...(c.chat || [])].sort((x, y) => x.start - y.start)) {   // pas deux bulles en même temps
    if (start < o.end && start + dur > o.start && o.end + 0.1 < c.end - 1) start = o.end + 0.1;
  }
  const end = Math.min(c.end, start + dur);
  const b = { t: m.t, user: m.user, text: m.text, color: m.color || null, badges: m.badges || [],
    start: round(start), end: round(end), auto: false };
  return updateClip(p, id, { chat: [...(c.chat || []), b].sort((x, y) => x.start - y.start) });
}

/** Déplace la bulle pour qu'elle commence à `t` (temps du stream), même durée, sans sortir du clip. */
function moveChat(p, id, m, t) {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  return updateClip(p, id, { chat: c.chat.map((b) => {
    if (!sameMsg(b, m)) return b;
    const d = b.end - b.start;
    const s = Math.min(Math.max(c.start, t), Math.max(c.start, c.end - d));
    return { ...b, start: round(s), end: round(Math.min(c.end, s + d)) };
  }) });
}

/** Bulles visibles à l'instant `t` du stream. */
const chatAt = (c, t) => (c.chat || []).filter((b) => t >= b.start && t < b.end);

/**
 * Où poser la bulle dans l'image finale (px) : à cheval entre la webcam et le jeu en 9:16 (comme sur TikTok),
 * en haut du jeu sans webcam, en bas à gauche en 16:9. `h` : hauteur de la bulle.
 */
function chatPlacement(fmt, layout, h) {
  if (fmt === '16x9') return { x: 60, y: Math.round(1080 * 0.58 - h / 2), w: 760 };
  const w = 920, x = 80;
  if (layout === 'cam_top') return { x, y: Math.max(20, Math.round(640 - h * 0.6)), w };
  if (layout === 'cam_bottom') return { x, y: Math.round(1280 - h * 0.4), w };
  return { x, y: 260, w };
}
const chatWidth = (fmt) => (fmt === '16x9' ? 760 : 920);

// ---------- Répliques des coéquipiers (vocal du jeu) : l'agent en grand + sa phrase façon BD ----------
const VOICE_MIN = 2.5;           // une réplique reste au moins 2,5 s à l'écran…
const VOICE_AFTER = 0.8;         // … et un peu après la fin de la phrase

/** Moment où la réplique est affichée (temps du stream), sans sortir du clip. */
function voiceShown(c, v) {
  const a = Math.max(c.start, v.start - 0.2);
  return { start: round(a), end: round(Math.min(c.end, Math.max(v.end + VOICE_AFTER, a + VOICE_MIN))) };
}

function setVoice(p, id, i, patch) {
  const c = p.clips.find((x) => x.id === id);
  if (!c || !c.voices[i]) return p;
  return updateClip(p, id, { voices: c.voices.map((v, k) => (k === i ? { ...v, ...patch } : v)) });
}

/** Réplique ajoutée à la main à l'instant `t` (agent choisi, texte à écrire). */
function addVoice(p, id, t, agent) {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  const start = round(Math.min(Math.max(c.start, t), Math.max(c.start, c.end - 1)));
  const v = { agent: agent ? agent.uuid : null, name: agent ? agent.name : '?', start, end: round(Math.min(c.end, start + 2)),
    text: '', on: true, auto: false };
  return updateClip(p, id, { voices: [...c.voices, v].sort((a, b) => a.start - b.start) });
}

function removeVoice(p, id, i) {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  return updateClip(p, id, { voices: c.voices.filter((_, k) => k !== i) });
}

/** Répliques affichées à l'instant `t` du stream (la plus récente si elles se chevauchent). */
function voiceAt(c, t) {
  const on = (c.voices || []).filter((v) => v.on && v.agent && v.text.trim());
  const now = on.filter((v) => { const s = voiceShown(c, v); return t >= s.start && t < s.end; });
  return now.length ? now[now.length - 1] : null;
}

/**
 * Où poser l'agent et le texte dans l'image finale (px). `ratio` = hauteur / largeur du portrait.
 * 9:16 cam en haut : texte en haut du jeu, agent en bas à droite (il dépasse un peu du bord, comme sur TikTok).
 */
function voicePlacement(fmt, layout, ratio = 1.6) {
  if (fmt === '16x9') {
    const h = 760, w = Math.round(h / ratio);
    return { agent: { x: 1920 - Math.round(w * 0.9), y: 1080 - h, w }, text: { x: 60, y: 110, w: 1100 } };
  }
  const zone = layout === 'cam_top' ? [640, 1920] : layout === 'cam_bottom' ? [0, 1280] : [0, 1920];
  const h = Math.round((zone[1] - zone[0]) * 0.82);
  const w = Math.round(h / ratio);
  return { agent: { x: 1080 - Math.round(w * 0.82), y: zone[1] - h, w },
    text: { x: 50, y: zone[0] + (layout === 'cam_top' ? 50 : 160), w: 980 } };
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

function toRenderSpec(p, { video, output, cam, tracks, musicFile, musicStart, post, camManual = false, stickers = {} }) {
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
      moments: c.moments, words: p.texts.subtitles ? clipWordsForRender(c) : undefined, friend: friendForRender(c),
      stickers: stickers[c.id] && stickers[c.id].length ? stickers[c.id] : undefined,
      fade: c.teaser ? 0 : undefined })),                     // teaser : coupes franches, sans fondu au noir
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
  clipCam, blurryFull, createProject, totalDuration, clipOffsets, moveClip, trimClip, addMoment, peekProject, removeClip, updateClip,
  snapToSpeech, fitToSentences, cutsSentence, reactionStatusText,
  momentWindow, splitClip, teaserCuts, setTeaser, hasTeaser, TEASER_MAX, isMomentUsed, isMomentHidden, hideMoment, setGlobalVolume, setClipVolume, effectiveVolume, hasLiveMusic, setLiveMusic, toRenderSpec, suggestPost,
  REACTION_MODES, PIP_POSITIONS, CUT_DURATIONS, attachReactions, setFriend, friendAt,
  chatNear, gameChatNear, gameChatFromSession, GAME_CHAT_COLORS, chatReadTime, isChatShown, toggleChat, moveChat, chatAt, chatPlacement, chatWidth,
  voiceShown, setVoice, addVoice, removeVoice, voiceAt, voicePlacement,
  linesFromWords, lineText, setClipWords, setLineText, setLineOn, addLine, clipWordsForRender, subtitleAt, snapDuration, fmtTime,
};

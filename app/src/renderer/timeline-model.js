// Frise d'un live : moments du jeu (kills, aces, clutchs…), coulisses (journal du live) et clips.
// Fonctions pures, testées dans test/timeline-model.test.js.

/** Catégories (une seule peut être choisie à la fois, ou « Tout »). */
const CATEGORIES = [
  { id: 'kill', label: 'Kills', color: '#9146ff', types: ['kill'] },
  { id: 'multikill', label: 'Multi-kills', color: '#ff8a3d', types: ['multikill'] },
  { id: 'ace', label: 'Aces', color: '#ffc400', types: ['ace'] },
  { id: 'clutch', label: 'Clutchs', color: '#22d3ee', types: ['clutch'] },
  { id: 'funny_death', label: 'Morts drôles', color: '#ff5fa2', types: ['funny_death'] },
  { id: 'laugh', label: 'Rires', color: '#ff7ab8', types: ['laugh'] },
  { id: 'scream', label: 'Cris', color: '#fb7185', types: ['scream'] },
  { id: 'marker', label: 'Marqueurs', color: '#f472b6', types: ['marker'] },
  { id: 'community', label: 'Communauté', color: '#00d68f', types: ['chat_spike', 'raid', 'viewer_peak', 'viewer_clip'] },
  { id: 'backstage', label: 'Coulisses', color: '#7c7c94', types: [] },
];

const BACKSTAGE = {
  record: { label: 'Enregistrement', color: '#9146ff' },
  audio: { label: 'Pistes audio', color: '#00d68f' },
  marker: { label: 'Marqueur', color: '#f472b6' },
  chat: { label: 'Chat partagé', color: '#38bdf8' },
  scan: { label: 'Analyse pendant le live', color: '#7c7c94' },
  twitch: { label: 'Twitch', color: '#c084fc' },
  analysis: { label: 'Analyse', color: '#a78bfa' },
  scene: { label: 'Scène OBS', color: '#94a3b8' },
  game: { label: 'Catégorie Twitch', color: '#c084fc' },
};

/** Couleur d'un jeu / d'une catégorie Twitch sur la frise. */
const GAME_COLORS = { 'just chatting': '#38bdf8', 'hors jeu': '#64748b' };
const PALETTE = ['#f59e0b', '#22c55e', '#e879f9', '#14b8a6', '#f97316', '#a3e635'];
function gameColor(game) {
  const g = String(game || 'hors jeu').toLowerCase();
  if (g.includes('valorant')) return '#ff4655';
  if (GAME_COLORS[g]) return GAME_COLORS[g];
  let h = 0;
  for (const ch of g) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
const gameName = (g) => (!g ? 'Hors jeu' : /valorant/i.test(g) ? 'Valorant' : g);

/** Bandes de couleur de la frise : passages de la session (jeu, sinon devinette du bandeau de score). */
function gameBands(segments, duration) {
  const out = [];
  for (const s of segments || []) {
    const game = gameName(s.game || s.game_guess);
    const end = Math.min(s.end, duration || s.end);
    if (end <= s.start) continue;
    const prev = out[out.length - 1];
    if (prev && prev.game === game && Math.abs(prev.end - s.start) < 1) prev.end = end;
    else out.push({ start: s.start, end, game, color: gameColor(game) });
  }
  return out;
}

/** Bandes d'après le journal seul (accueil) : les changements de catégorie Twitch. */
function journalBands(journal, duration) {
  const changes = ((journal && journal.events) || []).filter((e) => e.kind === 'game')
    .map((e) => ({ t: Math.max(0, (e.at - journal.start) / 1000), game: e.label.replace(/^Catégorie Twitch : /, '') }));
  if (!changes.length) return [];
  const end = duration || Math.max(...changes.map((c) => c.t)) + 1;
  return gameBands(changes.map((c, i) => ({ start: i === 0 ? 0 : c.t, end: changes[i + 1] ? changes[i + 1].t : end, game: c.game })), end);
}

const MOMENT_LABELS = {
  kill: 'Kill', multikill: 'Multi-kill', ace: 'Ace', clutch: 'Clutch', funny_death: 'Mort drôle', laugh: 'Rire',
  scream: 'Cri', marker: 'Marqueur', chat_spike: 'Pic de chat', raid: 'Raid', viewer_peak: 'Peak de viewers', viewer_clip: 'Clip d’un viewer',
};

const TYPE_TO_CAT = {};
for (const c of CATEGORIES) for (const t of c.types) TYPE_TO_CAT[t] = c.id;

const catOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

function momentLabel(m) {
  const base = MOMENT_LABELS[m.type] || m.type;
  const meta = m.meta || {};
  if (m.type === 'multikill' && meta.count) return `${base} ×${meta.count}`;
  if (m.type === 'raid' && (meta.channel || meta.from)) return `Raid de ${meta.channel || meta.from}`;
  if ((m.type === 'laugh' || m.type === 'scream') && meta.text) return `${base} : « ${meta.text} »`;
  return base;
}

function momentDetail(m) {
  const meta = m.meta || {};
  const parts = [];
  if (meta.round !== undefined) parts.push(`partie ${(meta.game || 0) + 1}, round ${meta.round}`);
  if (m.type === 'raid' && meta.viewers) parts.push(`${meta.viewers} viewers`);
  if (m.type === 'marker' && meta.source) parts.push({ streamdeck: 'Stream Deck', raccourci: 'raccourci clavier', chat: '!clip dans le chat' }[meta.source] || meta.source);
  return parts.join(' · ');
}

/**
 * Tous les événements de la frise, triés par temps (s depuis le début de l'enregistrement).
 * Un marqueur noté dans le journal ET trouvé par l'analyse n'apparaît qu'une fois (celui de l'analyse).
 */
function buildEvents({ moments = [], journal = null, startMs = null }) {
  const out = moments.map((m) => {
    const cat = TYPE_TO_CAT[m.type] || 'community';
    return { t: m.t, cat, kind: m.type, label: momentLabel(m), detail: momentDetail(m), level: 'ok', score: m.score || 0, source: 'moment' };
  });
  const start = startMs || (journal && journal.start);
  const hasMarkers = moments.some((m) => m.type === 'marker');
  for (const e of (journal && journal.events) || []) {
    if (e.kind === 'marker' && hasMarkers) continue;
    out.push({ t: (e.at - start) / 1000, cat: e.kind === 'marker' ? 'marker' : 'backstage', kind: e.kind,
      label: e.label, detail: e.detail || '', level: e.level || 'ok', at: e.at, source: 'journal' });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Combien d'événements par catégorie (pour les boutons du filtre). */
function countByCat(events) {
  const n = {};
  for (const e of events) n[e.cat] = (n[e.cat] || 0) + 1;
  return n;
}

const filterEvents = (events, cat) => (!cat || cat === 'all' ? events : events.filter((e) => e.cat === cat));

const AFTER = 0.18;   // part de la frise réservée à « après le live »
const MIN_GAP = 4.2;  // % : deux marque-pages plus proches passent sur une autre rangée
const ROWS = 3;
const MANY = 45;      // au-delà, les kills (nombreux) deviennent de simples points sur l'axe

/** Position (%) et rangée de chaque événement. `duration` = durée de l'enregistrement (s), null s'il est en cours
 * (l'axe va alors jusqu'à `runningEnd`, le temps écoulé). */
function layout(events, duration, runningEnd = null) {
  const end = duration || runningEnd || Math.max(1, ...events.map((e) => e.t));
  const after = events.filter((e) => duration && e.t > duration);
  const liveWidth = after.length ? 100 * (1 - AFTER) : 100;
  const small = events.length > MANY;
  const items = events.map((e, i) => {
    let x;
    if (duration && e.t > duration) x = liveWidth + ((after.indexOf(e) + 1) / (after.length + 1)) * (100 - liveWidth);
    else x = Math.max(0, Math.min(liveWidth, (e.t / end) * liveWidth));
    return { ...e, i, x, dot: small && e.cat === 'kill' };
  });
  const last = Array(ROWS).fill(-Infinity);
  for (const p of [...items].filter((e) => !e.dot).sort((a, b) => a.x - b.x)) {
    let row = last.findIndex((x) => p.x - x >= MIN_GAP);
    if (row < 0) row = last.indexOf(Math.min(...last));
    p.row = row;
    last[row] = p.x;
  }
  return { items, liveWidth, end };
}

/** Graduations de l'axe (en temps du live). */
function ticks(end, liveWidth) {
  const step = [5, 10, 15, 30, 60, 120].map((m) => m * 60).find((s) => end / s <= 6) || 240 * 60;
  const out = [];
  for (let t = 0; t <= end; t += step) {
    const x = (t / end) * liveWidth;
    if (t === 0 || x < liveWidth - 9) out.push({ x, label: t === 0 ? 'début' : duration(t) });
  }
  return out;
}

/** « 2 h 14 », « 34 min ». */
function duration(sec) {
  const m = Math.max(0, Math.round(sec / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** « 1:12:05 » : instant dans le live. */
function stamp(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** Couleur et icône d'un événement. */
function look(e) {
  if (e.source === 'journal' && e.cat === 'backstage') {
    return { color: (BACKSTAGE[e.kind] || BACKSTAGE.record).color, icon: { scene: 'scene', game: 'twitch' }[e.kind] || e.kind };
  }
  if (e.cat === 'community') return { color: catOf('community').color, icon: 'community' };
  return { color: catOf(e.cat).color, icon: e.kind === 'marker' ? 'marker' : e.cat };
}

/** Journal seul (accueil) → événements. */
const journalEvents = (journal) => buildEvents({ journal, startMs: journal.start });

module.exports = { gameColor, gameBands, journalBands, gameName, CATEGORIES, BACKSTAGE, buildEvents, countByCat, filterEvents, layout, ticks, duration, stamp, look, journalEvents, momentLabel };

// Données d'exemple : utilisées pour l'aperçu dans un navigateur, tant qu'aucune analyse réelle n'existe.
export const MOMENT_INFO = {
  ace: { label: 'Ace', color: '#ffc400' },
  multikill: { label: 'Multi-kill', color: '#ff8a3d' },
  clutch: { label: 'Clutch', color: '#22d3ee' },
  kill: { label: 'Kill', color: '#9146ff' },
  funny_death: { label: 'Mort drôle', color: '#ff5fa2' },
  laugh: { label: 'Rire', color: '#ff7ab8' },
  scream: { label: 'Cri', color: '#fb7185' },
  chat_spike: { label: 'Pic de chat', color: '#60a5fa' },
  raid: { label: 'Raid', color: '#00d68f' },
  viewer_peak: { label: 'Peak viewers', color: '#34d399' },
  viewer_clip: { label: 'Clip viewer', color: '#a3e635' },
  marker: { label: 'Marqueur', color: '#f472b6' },
  victory: { label: 'win', color: '#2ee6a8' },
  defeat: { label: 'loose', color: '#ff4655' },
  rr: { label: 'rr', color: '#e2e8f0' },
};

export const DEMO_SESSION = {
  stream: { title: 'Ranked avec les potes', duration: 3 * 3600 + 620, video: null },
  theme: 'kills',
  target: 30,
  moments: [
    { type: 'kill', t: 412, score: 30 },
    { type: 'multikill', t: 1288, score: 80, meta: { count: 3 } },
    { type: 'raid', t: 1530, score: 79, meta: { channel: 'Kamel', viewers: 42 } },
    { type: 'kill', t: 2050, score: 30 },
    { type: 'clutch', t: 2911, score: 80, meta: { situation: '1v2' } },
    { type: 'laugh', t: 3302, score: 45 },
    { type: 'ace', t: 4475, score: 100 },
    { type: 'chat_spike', t: 4482, score: 55, meta: { intensity: 3 } },
    { type: 'funny_death', t: 5120, score: 55 },
    { type: 'defeat', t: 5226, score: 35, meta: { score: '5-13' } },
    { type: 'rr', t: 5255, score: 57, meta: { rr: -25, result: 'defeat' } },
    { type: 'kill', t: 6034, score: 30 },
    { type: 'multikill', t: 7710, score: 70, meta: { count: 2 } },
    { type: 'viewer_clip', t: 8090, score: 60 },
    { type: 'kill', t: 9802, score: 30 },
    { type: 'marker', t: 10411, score: 65 },
  ],
  // Messages du chat (aperçu) : celui de 1279 s est lu par le streamer dans le 1er clip.
  chat: [
    { t: 1271.4, user: 'Kamel', text: 'il est chaud ce soir', color: '#1E90FF', badges: ['vip'] },
    { t: 1279.2, user: 'Lilacassette', text: "J'envoie des pieds, j'envoie tout mais que au top frag", color: '#FF69B4', badges: ['subscriber'] },
    { t: 1286.0, user: 'Nightbot', text: 'Suivez Sky sur TikTok : tiktok.com/@sky', color: '#7C7CE1', badges: ['moderator'] },
    { t: 1290.5, user: 'zoe_val', text: 'TRIPLE KILL 🔥🔥', color: null, badges: [] },
  ],
  clips: [
    { start: 1278, end: 1292, chat: [{ t: 1279.2, user: 'Lilacassette', text: "J'envoie des pieds, j'envoie tout mais que au top frag",
      color: '#FF69B4', badges: ['subscriber'], start: 1281.7, end: 1286.2, auto: true }] },
    { start: 2907, end: 2913 },
    { start: 4471, end: 4484 },
    { start: 5225, end: 5231 },          // fin de partie classée : « loose » puis « rr-25 »
    { start: 5253.5, end: 5258.5 },
    { start: 7706, end: 7712 },
  ],
};

// Aperçu : journal d'un live de 2 h 14 (frise de l'accueil).
const J0 = new Date(2026, 10, 24, 21, 0, 0).getTime();
const jm = (min) => J0 + min * 60000;
export const DEMO_JOURNAL = {
  id: J0, start: J0, stop: jm(134),
  events: [
    { at: jm(0), kind: 'record', label: 'Enregistrement OBS démarré', detail: '', level: 'ok' },
    { at: jm(0.1), kind: 'audio', label: 'Capture des pistes audio lancée', detail: '', level: 'ok' },
    { at: jm(0.2), kind: 'scene', label: 'Scène OBS : Just Chatting', detail: 'webcam en grand', level: 'ok' },
    { at: jm(0.5), kind: 'game', label: 'Catégorie Twitch : Just Chatting', detail: '', level: 'ok' },
    { at: jm(1), kind: 'twitch', label: 'Live Twitch détecté', detail: '', level: 'ok' },
    { at: jm(14), kind: 'scene', label: 'Scène OBS : Valorant', detail: 'webcam en haut à gauche', level: 'ok' },
    { at: jm(14.2), kind: 'game', label: 'Catégorie Twitch : VALORANT', detail: '', level: 'ok' },
    { at: jm(120), kind: 'scene', label: 'Scène OBS : Just Chatting', detail: 'webcam en grand', level: 'ok' },
    { at: jm(120.3), kind: 'game', label: 'Catégorie Twitch : Just Chatting', detail: '', level: 'ok' },
    { at: jm(5), kind: 'scan', label: '4 min déjà analysées', detail: '', level: 'ok' },
    { at: jm(18), kind: 'marker', label: 'Marqueur (Stream Deck)', detail: '', level: 'ok' },
    { at: jm(32), kind: 'chat', label: 'kamel en chat partagé', detail: 'ami de confiance : ses réactions sont possibles', level: 'ok' },
    { at: jm(35), kind: 'scan', label: '34 min déjà analysées', detail: '', level: 'ok' },
    { at: jm(47), kind: 'marker', label: 'Marqueur (raccourci clavier)', detail: '', level: 'ok' },
    { at: jm(65), kind: 'marker', label: 'Marqueur (Stream Deck)', detail: '', level: 'ok' },
    { at: jm(66), kind: 'scan', label: '64 min déjà analysées', detail: '', level: 'ok' },
    { at: jm(74), kind: 'chat', label: 'Chat partagé : Twitch ne répond pas', detail: 'fetch failed (coupure internet ?)', level: 'warn' },
    { at: jm(81), kind: 'chat', label: 'kamel a quitté le chat partagé', detail: '', level: 'ok' },
    { at: jm(95), kind: 'scan', label: '94 min déjà analysées', detail: '', level: 'ok' },
    { at: jm(101), kind: 'twitch', label: 'Raid de Lea', detail: '42 viewers', level: 'ok' },
    { at: jm(112), kind: 'marker', label: 'Marqueur (Stream Deck)', detail: '', level: 'ok' },
    { at: jm(125), kind: 'scan', label: '124 min déjà analysées', detail: '', level: 'ok' },
    { at: jm(134), kind: 'record', label: 'Enregistrement OBS arrêté', detail: '2026-11-24 21-00-00.mkv', level: 'ok' },
    { at: jm(134.1), kind: 'twitch', label: 'Fin du live Twitch', detail: '', level: 'ok' },
    { at: jm(134.2), kind: 'audio', label: 'Capture audio : 3 pistes', detail: 'Jeu ✓ · Micro ✓ · Discord ✓ · Musique ✗ (pas de son trouvé)', level: 'ok' },
    { at: jm(134.3), kind: 'analysis', label: 'Attente des infos Twitch (1 min 30)', detail: '', level: 'ok' },
    { at: jm(135.8), kind: 'analysis', label: 'Analyse lancée', detail: '26 morceau(x) déjà analysé(s) pendant le live', level: 'ok' },
    { at: jm(138), kind: 'analysis', label: 'Analyse terminée : 143 moments, 9 clips', detail: 'en 2 min · Ranked avec les potes', level: 'ok' },
  ],
};

// Aperçu : onglet Lives (moments du live de 2 h 14 + deux lives plus anciens).
function demoMoments() {
  const out = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let t = 900; t < 7150; t += 70 + rnd() * 160) out.push({ type: 'kill', t: Math.round(t), score: 30, meta: { game: Math.floor(t / 2400), round: 1 + Math.floor((t % 2400) / 110) } });
  [[1288, 3], [2420, 2], [3960, 2], [5230, 3], [6980, 2], [7710, 4]].forEach(([t, count]) => out.push({ type: 'multikill', t, score: 70, meta: { count } }));
  out.push({ type: 'ace', t: 4475, score: 100, meta: { game: 1, round: 9 } });
  [[2911, '1v2'], [5555, '1v3'], [7300, '1v2']].forEach(([t, situation]) => out.push({ type: 'clutch', t, score: 80, meta: { situation } }));
  [[300, 'Ha ha ha ha'], [3302, 'Mdr'], [6100, 'Ha ha'], [7600, '']].forEach(([t, text]) => out.push({ type: 'laugh', t, score: 45, meta: { text } }));
  [[2010, 'Oh non regarde'], [4471, 'Oh oh stop please'], [7450, 'Regarde regarde']].forEach(([t, text]) => out.push({ type: 'scream', t, score: 50, meta: { text } }));
  [[1080, 'streamdeck'], [2820, 'raccourci'], [3900, 'streamdeck'], [6720, 'streamdeck']].forEach(([t, source]) => out.push({ type: 'marker', t, score: 65, meta: { source } }));
  out.push({ type: 'raid', t: 6060, score: 75, meta: { channel: 'Lea', viewers: 42 } });
  out.push({ type: 'chat_spike', t: 4482, score: 55, meta: {} });
  out.push({ type: 'funny_death', t: 5120, score: 55, meta: {} });
  return out.sort((a, b) => a.t - b.t);
}
const DM = demoMoments();
const demoClips = () => DM.filter((m) => m.score >= 45).map((m) => ({
  theme: ['laugh', 'scream', 'funny_death'].includes(m.type) ? 'drole' : ['raid', 'chat_spike', 'marker'].includes(m.type) ? 'communaute' : 'kills',
  start: m.t - 6, end: m.t + 4, score: m.score, types: [m.type],
}));
export const DEMO_LIVES = [
  { folder: 'demo-1', name: '2026-11-24_ranked-avec-les-potes', title: 'Ranked avec les potes', date: J0, duration: 134 * 60,
    stats: { kills: 41, multikills: 6, aces: 1, clutchs: 3, morts: 33, marqueurs: 4, raids: [{ channel: 'Lea', viewers: 42 }], peak_viewers: 134 }, clips: demoClips().length },
  { folder: 'demo-2', name: '2026-11-22_valo-chill', title: 'VALO CHILL', date: J0 - 2 * 86400e3 + 3600e3, duration: 3 * 3600 + 22 * 60,
    stats: { kills: 87, multikills: 9, aces: 0, clutchs: 2, morts: 70, marqueurs: 1, raids: [], peak_viewers: 98 }, clips: 11 },
  { folder: 'demo-3', name: '2026-11-19_ranked-plat-neon', title: 'RANKED PLAT NEON', date: J0 - 5 * 86400e3, duration: 2 * 3600 + 41 * 60,
    stats: { kills: 64, multikills: 5, aces: 1, clutchs: 4, morts: 58, marqueurs: 6, raids: [], peak_viewers: 121 }, clips: 9 },
];
export const demoLive = (folder) => {
  const row = DEMO_LIVES.find((l) => l.folder === folder) || DEMO_LIVES[0];
  const camJ = { x: 0.125, y: 0, w: 0.75, h: 1 }; const camV = { x: 0.025, y: 0.056, w: 0.225, h: 0.219 };
  const segments = [{ start: 0, end: 840, game: 'Just Chatting', scene: 'Just Chatting', cam: camJ, full: true },
    { start: 840, end: 7200, game: 'VALORANT', scene: 'Valorant', cam: camV, full: false },
    { start: 7200, end: 8040, game: 'Just Chatting', scene: 'Just Chatting', cam: camJ, full: true }];
  return { ...row, startMs: row.date, moments: DM, clips: demoClips(), themes: ['kills', 'drole', 'communaute'], segments,
    journal: row.folder === 'demo-1' ? DEMO_JOURNAL : null };
};

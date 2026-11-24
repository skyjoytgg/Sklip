// Données d'exemple : utilisées pour l'aperçu dans un navigateur, tant qu'aucune analyse réelle n'existe.
export const MOMENT_INFO = {
  ace: { label: 'Ace', color: '#ffc400' },
  multikill: { label: 'Multi-kill', color: '#ff8a3d' },
  clutch: { label: 'Clutch', color: '#22d3ee' },
  kill: { label: 'Kill', color: '#9146ff' },
  funny_death: { label: 'Mort drôle', color: '#ff5fa2' },
  laugh: { label: 'Rire', color: '#ff7ab8' },
  chat_spike: { label: 'Pic de chat', color: '#60a5fa' },
  raid: { label: 'Raid', color: '#00d68f' },
  viewer_peak: { label: 'Peak viewers', color: '#34d399' },
  viewer_clip: { label: 'Clip viewer', color: '#a3e635' },
  marker: { label: 'Marqueur', color: '#f472b6' },
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
    { type: 'kill', t: 6034, score: 30 },
    { type: 'multikill', t: 7710, score: 70, meta: { count: 2 } },
    { type: 'viewer_clip', t: 8090, score: 60 },
    { type: 'kill', t: 9802, score: 30 },
    { type: 'marker', t: 10411, score: 65 },
  ],
  clips: [
    { start: 1284, end: 1292 },
    { start: 2907, end: 2913 },
    { start: 4471, end: 4484 },
    { start: 7706, end: 7712 },
  ],
};

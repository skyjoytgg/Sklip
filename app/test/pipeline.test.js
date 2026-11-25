const test = require('node:test');
const assert = require('node:assert');
const p = require('../src/main/pipeline');

const T0 = Date.parse('2026-11-24T20:00:00Z');

test('marqueurs dans le temps de l\'enregistrement', () => {
  const ms = p.markerMoments([{ at: T0 + 65_000 }, { at: T0 - 5000 }, { at: T0 + 1000, source: 'streamdeck' }], T0);
  assert.deepEqual(ms, [
    { type: 'marker', t: 65, meta: { source: 'raccourci' } },
    { type: 'marker', t: 1, meta: { source: 'streamdeck' } },
  ]);
  assert.deepEqual(p.markerMoments([{ at: T0 }], null), []);
});

test('le live Twitch qui chevauche l\'enregistrement est choisi', () => {
  const pending = [
    { startedAt: T0 - 86400e3, endedAt: T0 - 80000e3 },              // la veille
    { startedAt: T0 - 60e3, endedAt: T0 + 3 * 3600e3, moments: [{ type: 'raid', t: 120 }] },
  ];
  assert.equal(p.pickTwitchData(pending, T0, T0 + 3600e3), pending[1]);
  assert.equal(p.pickTwitchData(pending, T0 + 10 * 3600e3, T0 + 11 * 3600e3), null);
});

test('moments Twitch recalés sur l\'enregistrement + stats', () => {
  const data = { startedAt: T0 - 60e3, endedAt: T0 + 3600e3, moments: [{ type: 'raid', t: 120 }, { type: 'chat_spike', t: 30 }],
    raids: [{ channel: 'Kamel', viewers: 42, at: 'x' }], viewers: [{ viewers: 80 }, { viewers: 134 }] };
  const ex = p.twitchExtras(data, T0);
  assert.deepEqual(ex.moments, [{ type: 'raid', t: 60 }]);         // le live a commencé 60 s avant l'enregistrement
  assert.deepEqual(ex.stats, { raids: [{ channel: 'Kamel', viewers: 42 }], peak_viewers: 134 });
  assert.deepEqual(p.twitchExtras(null, T0), { moments: [], stats: {} });
});

test('titre du stream', () => {
  assert.equal(p.streamTitle('  RANKED PLAT NEON '), 'RANKED PLAT NEON');
  assert.equal(p.streamTitle(null, new Date(2026, 10, 5)), 'Stream du 05/11');
});

test('session de l\'éditeur pour un thème', () => {
  const s = { title: 'T', duration: 100, video: 'v.mkv', folder: 'f', target: 30, themes: ['kills', 'drole'],
    moments: [{ type: 'kill', t: 10 }], clips: { kills: [{ start: 6, end: 12 }], drole: [] } };
  const e = p.editorSession(s, 'drole', { cam: { x: 0, y: 0, w: 0.2, h: 0.3, enabled: true } });
  assert.equal(e.theme, 'drole');
  assert.deepEqual(e.clips, []);
  assert.deepEqual(e.cam, { x: 0, y: 0, w: 0.2, h: 0.3 });
  assert.equal(p.editorSession(s, 'inconnu').theme, 'kills');
  assert.equal(p.editorSession(s, 'kills', { cam: { enabled: false } }).cam, null);
});

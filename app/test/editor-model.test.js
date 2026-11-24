const test = require('node:test');
const assert = require('node:assert');
const m = require('../src/renderer/editor-model');

const base = () => m.createProject({
  streamDuration: 3600,
  clips: [
    { id: 'a', start: 96, end: 102 },
    { id: 'b', start: 296, end: 305 },
    { id: 'c', start: 1196, end: 1202 },
  ],
});

test('durée totale et positions', () => {
  const p = base();
  assert.strictEqual(m.totalDuration(p), 21);
  assert.deepStrictEqual(m.clipOffsets(p), [0, 6, 15]);
});

test('glisser-déposer : déplacer un clip', () => {
  const ids = (p) => p.clips.map((c) => c.id).join('');
  assert.strictEqual(ids(m.moveClip(base(), 'c', 0)), 'cab');
  assert.strictEqual(ids(m.moveClip(base(), 'a', 3)), 'bca');
  assert.strictEqual(ids(m.moveClip(base(), 'a', 2)), 'bac');
  assert.strictEqual(ids(m.moveClip(base(), 'b', 1)), 'abc');
});

test('rognage : bornes et durée minimale', () => {
  let p = m.trimClip(base(), 'a', 'start', -200);
  assert.strictEqual(p.clips[0].start, 0);
  p = m.trimClip(base(), 'a', 'start', 50);
  assert.strictEqual(p.clips[0].start, 101);  // 1 s minimum
  p = m.trimClip(base(), 'c', 'end', 9999);
  assert.strictEqual(p.clips[2].end, 3600);   // fin du stream
});

test('rognage calé sur le BPM', () => {
  let p = { ...base(), bpm: 120 };
  p = m.trimClip(p, 'a', 'end', 0.7);
  const d = p.clips[0].end - p.clips[0].start;
  assert.ok(Math.abs(d / 0.5 - Math.round(d / 0.5)) < 1e-6, String(d));
});

test('ajouter un moment, retirer un clip', () => {
  let p = m.addMoment(base(), { type: 'raid', t: 2000 }, 1);
  assert.strictEqual(p.clips.length, 4);
  assert.deepStrictEqual([p.clips[1].start, p.clips[1].end], [1996, 2002]);
  assert.ok(m.isMomentUsed(p, { t: 2000 }));
  p = m.removeClip(p, p.clips[1].id);
  assert.ok(!m.isMomentUsed(p, { t: 2000 }));
});

test('volumes : global, par clip, musique coupée par défaut', () => {
  let p = base();
  assert.strictEqual(p.volumes.music, 0);
  assert.strictEqual(p.volumes.discord, 1);
  p = m.setGlobalVolume(p, 'mic', 0.5);
  p = m.setClipVolume(p, 'b', 'mic', 1.5);
  assert.strictEqual(m.effectiveVolume(p, p.clips[0], 'mic'), 0.5);
  assert.strictEqual(m.effectiveVolume(p, p.clips[1], 'mic'), 1.5);
  p = m.setClipVolume(p, 'b', 'mic', null);
  assert.strictEqual(m.effectiveVolume(p, p.clips[1], 'mic'), 0.5);
});

test('spécification de rendu', () => {
  const p = m.updateClip(base(), 'b', { layout: 'game_only' });
  const spec = m.toRenderSpec(p, { video: 'rec.mkv', output: 'out.mp4' });
  assert.strictEqual(spec.clips.length, 3);
  assert.strictEqual(spec.clips[1].layout, 'game_only');
  assert.strictEqual(spec.fmt, '9x16');
});

test('format du temps', () => {
  assert.strictEqual(m.fmtTime(65), '1:05');
  assert.strictEqual(m.fmtTime(3725), '1:02:05');
});

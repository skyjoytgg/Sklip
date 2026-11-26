const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../src/renderer/style-model');
const M = require('../src/renderer/editor-model');
const { StyleStore } = require('../src/main/style-store');

const kill = (t) => ({ type: 'kill', t, score: 30 });
const raid = (t) => ({ type: 'raid', t, score: 75 });
const proposed = [{ start: 100, end: 140, moments: [kill(130)] }, { start: 500, end: 520, moments: [raid(510)] }];

// Sky avance le début des kills de 5 s, passe en « cam en grand », et retire les raids.
const edited = () => ({ clips: [{ start: 95, end: 142, layout: 'cam_full', moments: [kill(130)] }], texts: { subtitles: true }, volumes: { game: 1, mic: 1.2, discord: 1, music: 0 } });

test('habitudes : ce que le streamer a changé dans un montage', () => {
  const o = S.observe(proposed, edited());
  assert.deepStrictEqual(o.clips, [
    { type: 'kill', removed: false, dStart: -5, dEnd: 2, layout: 'cam_full' },
    { type: 'raid', removed: true }]);
  assert.strictEqual(o.teaser, false);
});

test('habitudes : rien avant 3 montages, puis appliquées aux montages suivants', () => {
  const two = { a: S.observe(proposed, edited()), b: S.observe(proposed, edited()) };
  const p0 = M.createProject({ clips: proposed, streamDuration: 3600 });
  assert.deepStrictEqual(S.applyStyle(p0, S.profile(two)).changes, []);
  const prof = S.profile({ ...two, c: S.observe(proposed, edited()) });
  assert.strictEqual(prof.types.kill.dStart, -5);
  assert.strictEqual(prof.types.kill.layout, 'cam_full');
  assert.strictEqual(prof.types.raid.removedRate, 1);
  const { project, changes } = S.applyStyle(M.createProject({ clips: [{ start: 1000, end: 1040, moments: [kill(1030)] },
    { start: 2000, end: 2020, moments: [raid(2010)] }], streamDuration: 3600 }), prof);
  assert.deepStrictEqual(project.clips.map((c) => [c.start, c.end, c.layout]), [[995, 1042, 'cam_full']]);
  assert.strictEqual(project.volumes.mic, 1.2);
  assert.ok(changes.includes('Kills : 5 s de plus avant'));
  assert.ok(changes.some((c) => c.startsWith('Raids')));
});

test('habitudes : teaser enlevé presque à chaque fois → plus de teaser', () => {
  const off = { clips: [], teaserOff: true };
  assert.strictEqual(S.wantsTeaser(S.profile({ a: off, b: off })), true);
  assert.strictEqual(S.wantsTeaser(S.profile({ a: off, b: off, c: off })), false);
});

test('habitudes : gardées dans style.json, une observation par montage, la plus récente', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sklip-style-'));
  const st = new StyleStore(path.join(dir, 'style.json'));
  st.record('live1|kills', { clips: [{ type: 'kill', removed: true }] });
  st.record('live1|kills', { clips: [{ type: 'kill', removed: false, dStart: 0, dEnd: 0 }] });
  const again = new StyleStore(path.join(dir, 'style.json'));
  assert.deepStrictEqual(Object.keys(again.all()), ['live1|kills']);
  assert.strictEqual(again.all()['live1|kills'].clips[0].removed, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

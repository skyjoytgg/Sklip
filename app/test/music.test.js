const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const M = require('../src/renderer/editor-model');
const music = require('../src/main/music');

const T = (name, duration) => ({ file: `C:/m/${name}.mp3`, title: name, duration });

test('une seule musique si elle couvre tout le montage', () => {
  const plan = M.planMusic([T('a', 200), T('b', 40)], 60, 0);
  const longOnes = M.planMusic([T('a', 200), T('b', 240)], 60, 0);
  assert.strictEqual(longOnes.length, 1);
  assert.strictEqual(longOnes[0].dur, 60);
  assert.ok(plan.length >= 1);
  assert.ok(Math.abs(plan.reduce((s, m) => s + m.dur, 0) - 60) < 0.01);
});

test('montage de 5 min : plusieurs musiques enchaînées, sans répéter la même à la suite', () => {
  const tracks = [T('a', 130), T('b', 150), T('c', 110)];
  const plan = M.planMusic(tracks, 300, 3);
  assert.ok(plan.length >= 2);
  assert.ok(Math.abs(plan.reduce((s, m) => s + m.dur, 0) - 300) < 0.01);
  for (let i = 1; i < plan.length; i++) assert.notStrictEqual(plan[i].file, plan[i - 1].file);
  for (const m of plan) assert.ok(m.dur <= tracks.find((t) => t.file === m.file).duration - M.MUSIC_XFADE + 1e-9);
});

test('une seule musique courte : rejouée pour couvrir la durée', () => {
  const plan = M.planMusic([T('a', 60)], 150, 0);
  assert.ok(Math.abs(plan.reduce((s, m) => s + m.dur, 0) - 150) < 0.01);
});

test('« Changer » donne un autre tirage, toujours le même pour un même numéro', () => {
  const tracks = ['a', 'b', 'c', 'd', 'e'].map((n) => T(n, 400));
  const firsts = new Set([0, 1, 2, 3, 4, 5].map((s) => M.planMusic(tracks, 60, s)[0].file));
  assert.ok(firsts.size > 1);
  assert.deepStrictEqual(M.planMusic(tracks, 60, 2), M.planMusic(tracks, 60, 2));
  assert.deepStrictEqual(M.planMusic([], 60, 0), []);
});

test("toRenderSpec : musique libre seulement si elle est activée", () => {
  let p = M.createProject({ clips: [{ start: 0, end: 30 }, { start: 50, end: 80 }] });
  const tracks = [T('a', 200)];
  assert.deepStrictEqual(M.toRenderSpec(p, { video: 'v', output: 'o', musicTracks: tracks }).music, []);
  p = M.setBgm(p, { on: true, volume: 0.5 });
  const spec = M.toRenderSpec(p, { video: 'v', output: 'o', musicTracks: tracks });
  assert.deepStrictEqual(spec.music, [{ file: 'C:/m/a.mp3', start: 0, dur: 60 }]);
  assert.strictEqual(spec.music_volume, 0.5);
  assert.strictEqual(M.musicName({ file: 'C:\\x\\Night Drive.mp3' }), 'Night Drive');
});

test('dossier « Mes musiques » : créé avec une note, fichiers audio trouvés', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sklip-music-'));
  const dir = music.ensureUserDir(root);
  assert.ok(fs.existsSync(path.join(dir, 'LISEZ-MOI.txt')));
  fs.writeFileSync(path.join(dir, 'a.mp3'), 'x');
  fs.mkdirSync(path.join(dir, 'chill'));
  fs.writeFileSync(path.join(dir, 'chill', 'b.ogg'), 'x');
  assert.deepStrictEqual(music.audioFiles(dir).map((f) => path.basename(f)).sort(), ['a.mp3', 'b.ogg']);
  assert.deepStrictEqual(music.audioFiles(path.join(root, 'absent')), []);
});

test('sans clavier ni souris : phrases envoyées seulement avec une piste micro et des phrases connues', () => {
  const off = M.createProject({ clips: [{ start: 0, end: 30 }] });
  assert.strictEqual(off.cleanMic, false);                     // à cocher, pas par défaut (Sky 27/11)
  assert.strictEqual(M.toRenderSpec(off, { tracks: { mic: {} }, speech: [[1, 3]] }).mic_speech, null);
  const p = { ...off, cleanMic: true };
  const speech = [[1, 3]];
  const mic = { mic: { path: 'mic.ogg', offset: 0 } };
  assert.deepStrictEqual(M.toRenderSpec(p, { tracks: mic, speech }).mic_speech, speech);
  assert.strictEqual(M.toRenderSpec(p, { tracks: {}, speech }).mic_speech, null);
  assert.strictEqual(M.toRenderSpec(p, { tracks: mic, speech: [] }).mic_speech, null);
  assert.strictEqual(M.toRenderSpec({ ...p, cleanMic: false }, { tracks: mic, speech }).mic_speech, null);
});

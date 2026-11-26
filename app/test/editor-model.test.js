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

test('garder la musique du live sur un seul clip', () => {
  let p = m.createProject({ clips: [{ start: 10, end: 20 }, { start: 40, end: 50 }], streamDuration: 100 });
  const [a, b] = p.clips;
  assert.equal(m.hasLiveMusic(p, a), false);                 // musique coupée par défaut
  p = m.setLiveMusic(p, a.id, true);
  assert.equal(m.hasLiveMusic(p, p.clips[0]), true);
  assert.equal(m.hasLiveMusic(p, p.clips[1]), false);
  assert.equal(m.toRenderSpec(p, { video: 'v', output: 'o' }).clips[0].volumes.music, 1);
  p = m.setLiveMusic(p, a.id, false);
  assert.equal(m.hasLiveMusic(p, p.clips[0]), false);
  assert.equal('music' in p.clips[0].volumes, false);        // retour au réglage global
  // Musique montée dans le mixeur global : décocher la coupe pour ce clip seulement.
  p = m.setGlobalVolume(p, 'music', 0.6);
  p = m.setLiveMusic(p, b.id, false);
  assert.equal(m.hasLiveMusic(p, p.clips[1]), false);
  assert.equal(m.hasLiveMusic(p, p.clips[0]), true);
});

test('texte proposé pour poster la vidéo', () => {
  let p = m.createProject({ clips: [{ start: 10, end: 20, moments: [{ type: 'multikill', t: 15, meta: { count: 3 } }] }], streamDuration: 100 });
  let post = m.suggestPost(p, { streamTitle: 'RANKED PLAT NEON', channel: 'sky' });
  assert.equal(post.title, '3K 😤');
  assert.ok(post.hashtags.includes('#shorts'));
  assert.match(post.description, /RANKED PLAT NEON.*twitch\.tv\/sky/);
  p = m.createProject({ clips: [{ start: 10, end: 20, moments: [{ type: 'clutch', t: 15, meta: { vs: 3 } }] }], streamDuration: 100, fmt: '16x9' });
  post = m.suggestPost(p);
  assert.equal(post.title, 'Clutch 1v3 🧠');
  assert.ok(!post.hashtags.includes('#shorts'));
  assert.equal(m.toRenderSpec(p, { video: 'v', output: 'o', post }).post.title, 'Clutch 1v3 🧠');
  p = m.createProject({ clips: [{ start: 10, end: 20, moments: [{ type: 'multikill', t: 15, meta: { count: 3, knives: [15] } }] }], streamDuration: 100 });
  post = m.suggestPost(p);
  assert.equal(post.title, 'Kill au couteau 🔪');
  assert.ok(post.hashtags.includes('#knife'));
});

test('sous-titres : lignes, correction, blague, rendu', () => {
  const words = [
    { start: 30.14, end: 30.56, text: 'Tu' }, { start: 30.56, end: 30.66, text: 'mets' }, { start: 30.66, end: 31.02, text: 'ton...' },
    { start: 31.02, end: 32.04, text: 'Oulah!' }, { start: 40.84, end: 41.48, text: '50' }, { start: 41.48, end: 42.12, text: 'Renault!' },
  ];
  let p = m.createProject({ clips: [{ id: 'k', start: 28, end: 44 }], streamDuration: 100 });
  p = m.setClipWords(p, 'k', words);
  const lines = p.clips[0].subs;
  assert.deepEqual(lines.map(m.lineText), ['Tu mets ton...', 'Oulah!', '50 Renault!']);
  // Faute corrigée : même nombre de mots → chaque mot garde son timing.
  p = m.setLineText(p, 'k', 2, '50 Raze!');
  assert.deepEqual(p.clips[0].subs[2].words.map((w) => [w.start, w.text]), [[40.84, '50'], [41.48, 'Raze!']]);
  // Blague : phrase réécrite → les mots se partagent la durée de la ligne.
  p = m.setLineText(p, 'k', 1, 'il a eu peur du noir');
  const l = p.clips[0].subs[1];
  assert.equal(l.words.length, 6);
  assert.equal(l.words[0].start, 31.02);
  assert.ok(Math.abs(l.words[5].end - 32.04) < 0.01);
  // Ligne vidée = supprimée ; ligne ajoutée à la tête de lecture.
  p = m.setLineText(p, 'k', 0, '   ');
  p = m.addLine(p, 'k', 35, 'GG');
  assert.deepEqual(p.clips[0].subs.map(m.lineText), ['il a eu peur du noir', 'GG', '50 Raze!']);
  // Rendu : temps relatifs au clip, seulement si les sous-titres sont activés.
  const spec = m.toRenderSpec(p, { video: 'v', output: 'o' });
  assert.deepEqual(spec.clips[0].words[6], { start: 7, end: 8.5, text: 'GG' });
  assert.equal(m.toRenderSpec({ ...p, texts: { ...p.texts, subtitles: false } }, { video: 'v', output: 'o' }).clips[0].words, undefined);
  // Rognage : le texte reste au même endroit du stream, ce qui sort du clip n'est plus rendu.
  p = m.updateClip(p, 'k', { start: 37 });
  assert.deepEqual(m.clipWordsForRender(p.clips[0]).map((w) => w.text), ['50', 'Raze!']);
  // Aperçu : la ligne et le mot prononcé.
  assert.deepEqual(m.subtitleAt(p.clips[0], 41.6), { words: ['50', 'Raze!'], current: 1 });
  assert.equal(m.subtitleAt(p.clips[0], 38), null);
  // Jamais générés : le moteur s'en charge.
  assert.equal(m.clipWordsForRender(m.createProject({ clips: [{ start: 0, end: 5 }] }).clips[0]), undefined);
});

test('marge : allonger au-delà du découpage de départ, aimant sur les phrases', () => {
  const speech = [[90, 95.5], [101, 104], [290, 310]];
  let p = m.trimClip(base(), 'a', 'start', -10);                  // la vidéo continue avant le clip
  assert.strictEqual(p.clips[0].start, 86);
  p = m.trimClip(base(), 'a', 'end', 2.1, speech);               // 104.1 : collé à la fin de phrase (104.2)
  assert.strictEqual(p.clips[0].end, 104.2);
  p = m.trimClip(base(), 'a', 'start', -0.5, speech);            // 95.5 : rien d'assez près → pas d'aimant
  assert.strictEqual(p.clips[0].start, 95.5);
  p = m.trimClip(base(), 'a', 'start', 0.5, speech);             // sans BPM seulement : avec BPM, la grille gagne
  assert.strictEqual(p.clips[0].start, 96.5);
});

test('ajuster aux phrases', () => {
  const speech = [[90, 95.5], [101, 104], [280, 320]];
  const p = base();
  assert.deepStrictEqual(m.cutsSentence(p.clips[0], speech), { start: false, end: true });
  const q = m.fitToSentences(p, 'a', speech);
  assert.deepStrictEqual([q.clips[0].start, q.clips[0].end], [96, 104.2]);
  const r = m.fitToSentences(p, 'b', speech);                     // phrase de 40 s : on ne bouge pas de 16 s
  assert.deepStrictEqual([r.clips[1].start, r.clips[1].end], [296, 305]);
  assert.deepStrictEqual(m.cutsSentence(p.clips[0], null), { start: false, end: false });
});

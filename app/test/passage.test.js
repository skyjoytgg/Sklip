const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/renderer/editor-model');

const multi = { type: 'multikill', t: 52, score: 90, meta: { count: 3, kills: [30, 49, 52] } };
const proj = () => M.createProject({ streamDuration: 3600, clips: [{ start: 25, end: 56, moments: [multi] }, { start: 100, end: 110 }] });

test('enlever un passage au milieu : deux morceaux collés, le reste du montage ne bouge pas', () => {
  const p = proj();
  const q = M.cutPassage(p, p.clips[0].id, 45, 34);           // bornes dans n'importe quel ordre
  assert.strictEqual(q.clips.length, 3);
  assert.deepStrictEqual(q.clips.map((c) => [c.start, c.end]), [[25, 34], [45, 56], [100, 110]]);
  assert.strictEqual(M.totalDuration(q), M.totalDuration(p) - 11);
  assert.deepStrictEqual(q.clips[0].moments, [multi]);         // le compteur de kills marche sur les deux morceaux
  assert.deepStrictEqual(q.clips[1].moments, [multi]);
  assert.strictEqual(q.clips[1].joined, true);
  assert.strictEqual(q.clips[2], p.clips[1]);
});

test('passage contre un bord : le clip est juste rogné ; passage trop court : rien', () => {
  const p = proj();
  const id = p.clips[0].id;
  assert.deepStrictEqual(M.cutPassage(p, id, 25.4, 30).clips.map((c) => [c.start, c.end])[0], [30, 56]);
  assert.deepStrictEqual(M.cutPassage(p, id, 50, 56).clips.map((c) => [c.start, c.end])[0], [25, 50]);
  assert.strictEqual(M.cutPassage(p, id, 40, 40.1), p);
});

test('temps morts : entre deux kills éloignés, sans couper une phrase', () => {
  const c = proj().clips[0];
  assert.deepStrictEqual(M.deadTimes(c), [[32.5, 46]]);       // 30 → 49 : on garde 2,5 s après et 3 s avant
  assert.deepStrictEqual(M.deadTimes(c, [[44, 47.5]]), [[32.5, 43.85]]);   // je parle à 44 s : on s'arrête avant
  const p = proj();
  const q = M.removeDeadTimes(p, p.clips[0].id);
  assert.deepStrictEqual(q.clips.map((x) => [x.start, x.end]).slice(0, 2), [[25, 32.5], [46, 56]]);
  assert.deepStrictEqual(M.deadTimes({ start: 0, end: 20, moments: [{ type: 'multikill', t: 8, meta: { kills: [5, 8] } }] }), []);
});

test('teaser : un clip coupé en morceaux prend les kills du bon morceau', () => {
  const p = proj();
  const q = M.cutPassage(p, p.clips[0].id, 34, 45);
  const cuts = M.teaserCuts(q);
  assert.ok(cuts.length >= 1);
  assert.strictEqual(cuts[0].from.id, q.clips[1].id);
});

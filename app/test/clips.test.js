const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listClips, setPosted } = require('../src/main/clips');

test('onglet Clips : vidéos exportées de tous les streams, les plus récentes d\'abord, avec titre et « déjà posté »', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sklip-clips-'));
  const s1 = path.join(root, 'Streams', '2026-11-26_stream', 'montages');
  const s2 = path.join(root, 'Streams', '2026-11-27_stream', 'montages');
  fs.mkdirSync(s1, { recursive: true }); fs.mkdirSync(s2, { recursive: true });
  fs.writeFileSync(path.join(root, 'Streams', '2026-11-26_stream', 'stats.json'), JSON.stringify({ title: 'Stream du 26/11' }));
  fs.writeFileSync(path.join(s1, 'sklip_kills_9x16.mp4'), 'x');
  fs.writeFileSync(path.join(s1, 'sklip_kills_9x16.json'), JSON.stringify({ title: 'Triple kill', hashtags: ['#valorant'], published: {} }));
  fs.writeFileSync(path.join(s2, 'sklip_bestof_16x9.mp4'), 'xx');
  fs.writeFileSync(path.join(s2, 'vide.mp4'), '');                       // export en cours : ignoré
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(s2, 'sklip_bestof_16x9.mp4'), later, later);
  const list = listClips(root);
  assert.deepStrictEqual(list.map((c) => c.name), ['sklip_bestof_16x9.mp4', 'sklip_kills_9x16.mp4']);
  const k = list[1];
  assert.strictEqual(k.stream, 'Stream du 26/11');
  assert.strictEqual(k.themeName, 'Kills');
  assert.strictEqual(k.fmt, '9x16');
  assert.deepStrictEqual(k.post, { title: 'Triple kill', hashtags: ['#valorant'] });
  assert.strictEqual(k.posted, false);
  assert.ok(setPosted(k.file, true));
  assert.strictEqual(listClips(root)[1].posted, true);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(s1, 'sklip_kills_9x16.json'), 'utf8')).title, 'Triple kill');
  setPosted(k.file, false);
  assert.strictEqual(listClips(root)[1].posted, false);
  assert.deepStrictEqual(listClips(path.join(root, 'absent')), []);
});

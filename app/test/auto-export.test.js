const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { plan, autoExport } = require('../src/main/auto-export');

const session = (folder) => ({
  title: 'Live', folder, video: 'C:/v.mkv', duration: 3600, themes: ['kills', 'bestof'], target: 60,
  targets: { kills: 60, bestof: 300 },
  moments: [{ type: 'multikill', t: 1208.75, score: 80, meta: { count: 3, kills: [1183.75, 1202.75, 1208.75] } },
    { type: 'rr', t: 2000, score: 57, meta: { rr: -25 } }],
  clips: { kills: [{ start: 1170, end: 1216 }], bestof: [{ start: 1170, end: 1216 }, { start: 1997, end: 2006 }], drole: [] },
  cam_detected: { x: 0, y: 0, w: 0.2, h: 0.2 },
});

test('export auto : un montage par thème et par format, avec le teaser et le titre proposé', () => {
  const jobs = plan(session('/x'), { formats: ['9x16', '16x9'], cam: { auto: true } });
  assert.deepStrictEqual(jobs.map((j) => `${j.theme}/${j.fmt}`), ['kills/9x16', 'kills/16x9', 'bestof/9x16', 'bestof/16x9']);
  assert.ok(jobs[0].project.clips[0].teaser);
  assert.strictEqual(jobs[0].post.title, '3K 😤');
  assert.ok(jobs[0].output.endsWith(path.join('montages', 'sklip_kills_9x16.mp4')));
});

test('export auto : ne remplace pas un export déjà fait, garde le montage pour l\'éditeur', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sklip-auto-'));
  fs.mkdirSync(path.join(dir, 'montages'));
  fs.writeFileSync(path.join(dir, 'montages', 'sklip_kills_9x16.mp4'), 'déjà là');
  const calls = [];
  const done = await autoExport(session(dir), { formats: ['9x16'], cam: { auto: true }, engine: async (cmd, spec) => { calls.push(spec.output); return {}; } });
  assert.deepStrictEqual(calls.map((o) => path.basename(o)), ['sklip_bestof_9x16.mp4']);
  assert.strictEqual(done.length, 1);
  assert.ok(fs.existsSync(path.join(dir, 'montage-kills.json')));
  fs.rmSync(dir, { recursive: true, force: true });
});

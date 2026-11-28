const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/renderer/editor-model');
const { plan } = require('../src/main/auto-export');

// Vidéo YouTube 8–15 min (Sky 26/11 : 1A 2C 3C 4AB 5 ; 28/11 : Just Chatting au début, sous-titres coupés, export auto).
const clips = [{ start: 100, end: 145, part: 'talk' }, { start: 1170, end: 1216, moments: [{ type: 'ace', t: 1200, score: 100, meta: { game: 0 } }] },
  { start: 2000, end: 2010, moments: [{ type: 'kill', t: 2005, score: 20, meta: { game: 1 } }] }];

test('vidéo YouTube : 16:9, sans teaser, sous-titres coupés, transitions et « Abonne-toi » à l\'export', () => {
  const p = M.asYoutube(M.setTeaser(M.createProject({ clips, fmt: '9x16' })));
  assert.strictEqual(p.fmt, '16x9');
  assert.ok(!M.hasTeaser(p));
  assert.strictEqual(p.texts.subtitles, false);
  const spec = M.toRenderSpec(p, { video: 'v', output: 'o' });
  assert.deepStrictEqual([spec.cards, spec.outro, spec.youtube, spec.subtitles], [true, true, true, false]);
  // Coupes sèches, partie de chaque clip, zoom webcam activé par défaut.
  assert.deepStrictEqual(spec.clips.map((c) => [c.fade, c.part]), [[0, 'talk'], [0, 'game:0'], [0, 'game:1']]);
  assert.strictEqual(spec.cam_zoom, true);
  assert.strictEqual(M.toRenderSpec(M.setCamZoom(p, false), { video: 'v', output: 'o' }).cam_zoom, false);
  assert.strictEqual(M.YT_OUTRO, 15);
  assert.strictEqual(M.exportDuration(p), 45 + 46 + 10 + 2 * M.YT_CARD + M.YT_OUTRO);
  const short = M.toRenderSpec(M.createProject({ clips }), { video: 'v', output: 'o' });
  assert.deepStrictEqual([short.cards, short.outro, short.youtube], [false, false, false]);
  assert.match(M.suggestPost(p, { theme: 'youtube' }).title, /^Mon live en 2 minutes \(avec un ACE\)/);
  // Musique libre : planifiée sur toute la vidéo, transitions comprises.
  const withMusic = M.toRenderSpec(M.setBgm(p, { on: true }), { video: 'v', output: 'o', musicTracks: [{ file: 'a.mp3', duration: 600 }] });
  assert.strictEqual(withMusic.music[0].dur, M.exportDuration(p));
});

test('export auto : la vidéo YouTube seulement en 16:9, sans teaser', () => {
  const session = {
    title: 'Live', folder: '/x', video: 'C:/v.mkv', duration: 9000, themes: ['kills', 'youtube'], target: 60,
    moments: [{ type: 'ace', t: 1200, score: 100, meta: {} }],
    clips: { kills: [{ start: 1170, end: 1216 }], youtube: clips }, cam_detected: null,
  };
  const jobs = plan(session, { formats: ['9x16', '16x9'], cam: { auto: true } });
  assert.deepStrictEqual(jobs.map((j) => `${j.theme}/${j.fmt}`), ['kills/9x16', 'kills/16x9', 'youtube/16x9']);
  const yt = jobs[2];
  assert.ok(yt.project.youtube && !M.hasTeaser(yt.project) && yt.project.texts.subtitles === false);
  assert.ok(yt.output.endsWith('sklip_youtube_16x9.mp4'));
});

test('vidéo YouTube : un écran seulement quand on change de partie', () => {
  const k = (t, game) => ({ type: 'kill', t, score: 20, meta: game == null ? {} : { game } });
  const p = M.asYoutube(M.createProject({ clips: [
    { start: 0, end: 30 },                                     // Just Chatting du début
    { start: 100, end: 110, moments: [k(105, 0)] }, { start: 200, end: 210, moments: [k(205, 0)] },
    { start: 300, end: 310, moments: [{ type: 'victory', t: 305, meta: {} }] },      // bannière : même partie
    { start: 400, end: 410, moments: [k(405, 1)] },
    { start: 900, end: 940, part: 'talk' },                    // le mot de la fin
  ] }), 'youtube_partie');
  assert.deepStrictEqual(M.ytCards(p), [false, true, false, false, true, true]);
  assert.strictEqual(p.ytTheme, 'youtube_partie');
  const spec = M.toRenderSpec(p, { video: 'v', output: 'o', channel: 'skyjoytgg', faces: 'C:/Sklip/Têtes' });
  assert.deepStrictEqual([spec.theme, spec.outro_channel, spec.faces], ['youtube_partie', 'skyjoytgg', 'C:/Sklip/Têtes']);
  assert.match(M.suggestPost(p, { theme: 'youtube_partie' }).title, /^La partie la plus folle de mon live/);
  assert.ok(M.isLongTheme('youtube_partie'));
});

test('mes têtes : dossier créé avec sa note, photos listées', () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const faces = require('../src/main/faces');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sklip-faces-'));
  assert.deepStrictEqual(faces.list(root), []);
  const d = faces.ensureDir(root);
  assert.ok(fs.readFileSync(path.join(d, 'LISEZ-MOI.txt'), 'utf8').includes('Supprimer l'));
  fs.writeFileSync(path.join(d, 'rire.png'), 'x'); fs.writeFileSync(path.join(d, 'choc.PNG'), 'x');
  assert.deepStrictEqual(faces.list(root), ['choc.PNG', 'rire.png']);
});

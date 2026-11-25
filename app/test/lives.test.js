const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('../src/main/lives');
const M = require('../src/renderer/timeline-model');

const START = Date.UTC(2026, 10, 24, 20, 0, 0);

function makeLive(root, name, session) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(session));
  return dir;
}

test('liste des lives : du plus récent au plus ancien, dossiers incomplets ignorés', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sklip-lives-'));
  makeLive(root, '2026-11-19_vieux', { title: 'Vieux', duration: 600, stats: { kills: 3 }, clips: { kills: [{ start: 1, end: 9 }] } });
  makeLive(root, '2026-11-24_ranked', { title: 'Ranked', duration: 8040, record_started_at: START / 1000, stats: { kills: 41 },
    clips: { kills: [{ start: 1, end: 9 }, { start: 20, end: 30 }], drole: [{ start: 50, end: 60 }] } });
  fs.mkdirSync(path.join(root, '2026-11-25_pas-fini'));
  const lives = L.listLives(root);
  assert.deepStrictEqual(lives.map((l) => l.title), ['Ranked', 'Vieux']);
  assert.strictEqual(lives[0].date, START);
  assert.strictEqual(lives[0].clips, 3);
  assert.strictEqual(lives[1].date, new Date(2026, 10, 19, 12).getTime());
  assert.deepStrictEqual(L.listLives(path.join(root, 'absent')), []);
});

test('page d’un live : clips triés, journal retrouvé à ±2 min, miniature sur le plus beau moment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sklip-lives-'));
  const session = { title: 'Ranked', duration: 8040, record_started_at: START / 1000, video: 'absent.mkv',
    moments: [{ type: 'kill', t: 100, score: 30 }, { type: 'ace', t: 4475, score: 100 }],
    clips: { drole: [{ start: 50, end: 60, moments: [{ type: 'laugh' }] }], kills: [{ start: 4470, end: 4480, moments: [{ type: 'ace' }] }] } };
  const dir = makeLive(root, '2026-11-24_ranked', session);
  const journal = { id: START + 30e3, start: START + 30e3, events: [] };
  const live = L.liveDetail(dir, { journals: [{ id: 1, start: START - 10 * 60e3 }, journal], getJournal: (id) => (id === journal.id ? journal : null) });
  assert.deepStrictEqual(live.clips.map((c) => [c.theme, c.start, c.types]), [['drole', 50, ['laugh']], ['kills', 4470, ['ace']]]);
  assert.strictEqual(live.journal, journal);
  assert.strictEqual(live.videoExists, false);
  assert.strictEqual(L.thumbTime(session), 4475);
  assert.strictEqual(L.thumbTime({ duration: 900 }), 300);
  assert.strictEqual(L.matchJournal([{ id: 9, start: START + 5 * 60e3 }], START), null);
});

test('frise : moments + coulisses, un seul marqueur, filtre par catégorie', () => {
  const journal = { start: START, stop: START + 600e3, events: [
    { at: START, kind: 'record', label: 'Enregistrement OBS démarré', level: 'ok' },
    { at: START + 120e3, kind: 'marker', label: 'Marqueur (Stream Deck)', level: 'ok' },
    { at: START + 300e3, kind: 'chat', label: 'Twitch ne répond pas', level: 'warn' },
    { at: START + 660e3, kind: 'analysis', label: 'Analyse terminée', level: 'ok' },
  ] };
  const moments = [{ type: 'kill', t: 30 }, { type: 'multikill', t: 60, meta: { count: 3 } }, { type: 'ace', t: 90 },
    { type: 'marker', t: 120, meta: { source: 'streamdeck' } }, { type: 'raid', t: 200, meta: { channel: 'Lea', viewers: 42 } }];
  const ev = M.buildEvents({ moments, journal, startMs: START });
  assert.deepStrictEqual(ev.map((e) => e.cat), ['backstage', 'kill', 'multikill', 'ace', 'marker', 'community', 'backstage', 'backstage']);
  assert.strictEqual(ev[2].label, 'Multi-kill ×3');
  assert.strictEqual(ev[5].label, 'Raid de Lea');
  assert.deepStrictEqual(M.countByCat(ev), { backstage: 3, kill: 1, multikill: 1, ace: 1, marker: 1, community: 1 });
  assert.deepStrictEqual(M.filterEvents(ev, 'ace').map((e) => e.t), [90]);
  assert.strictEqual(M.filterEvents(ev, 'all').length, 8);

  const { items, liveWidth } = M.layout(ev, 600);
  assert.ok(liveWidth < 100);                                   // une étape après la fin : zone « après le live »
  const after = items.find((e) => e.label === 'Analyse terminée');
  assert.ok(after.x > liveWidth);
  assert.ok(items.every((e) => e.row >= 0 && e.row < 3));
});

test('frise : beaucoup de kills → simples points sur l’axe ; durées lisibles', () => {
  const moments = Array.from({ length: 60 }, (_, i) => ({ type: 'kill', t: i * 100 }));
  moments.push({ type: 'ace', t: 3000 });
  const { items } = M.layout(M.buildEvents({ moments }), 6100);
  assert.ok(items.filter((e) => e.cat === 'kill').every((e) => e.dot));
  assert.ok(!items.find((e) => e.cat === 'ace').dot);
  assert.strictEqual(M.duration(8040), '2 h 14');
  assert.strictEqual(M.duration(1500), '25 min');
  assert.strictEqual(M.stamp(4475), '1:14:35');
  assert.strictEqual(M.stamp(75), '1:15');
});

test('passages du live : scène OBS + catégorie Twitch → segments, couleurs de la frise', () => {
  const { buildSegments } = require('../src/main/segments');
  const camV = { x: 0, y: 0, w: 0.22, h: 0.3 }; const camJ = { x: 0.125, y: 0, w: 0.75, h: 1 };
  const at = (min) => START + min * 60e3;
  const segs = buildSegments({
    start: at(0), stop: at(120),
    scenes: [{ at: at(0), scene: 'Just Chatting', cam: camJ, full: true }, { at: at(15), scene: 'Valorant', cam: camV },
      { at: at(16), scene: 'Valorant', cam: { ...camV, x: 0.001 } }, { at: at(110), scene: 'Just Chatting', cam: camJ, full: true }],
    games: [{ at: at(1), game: 'Just Chatting' }, { at: at(14), game: 'VALORANT' }, { at: at(111), game: 'Just Chatting' }],
  });
  assert.deepStrictEqual(segs.map((s) => [s.start / 60, s.end / 60, s.game, s.scene]), [
    [0, 14, 'Just Chatting', 'Just Chatting'], [14, 15, 'VALORANT', 'Just Chatting'], [15, 110, 'VALORANT', 'Valorant'],
    [110, 111, 'VALORANT', 'Just Chatting'], [111, 120, 'Just Chatting', 'Just Chatting']]);
  const bands = M.gameBands(segs, 7200);
  assert.deepStrictEqual(bands.map((b) => [b.game, b.start / 60, b.end / 60]),
    [['Just Chatting', 0, 14], ['Valorant', 14, 111], ['Just Chatting', 111, 120]]);
  assert.strictEqual(bands[1].color, '#ff4655');
  assert.strictEqual(M.gameColor('Just Chatting'), '#38bdf8');
  assert.strictEqual(M.gameColor('Minecraft'), M.gameColor('minecraft'));
  // Accueil : bandes d'après les changements de catégorie notés dans le journal.
  const journal = { start: at(0), events: [{ at: at(1), kind: 'game', label: 'Catégorie Twitch : Just Chatting' },
    { at: at(14), kind: 'game', label: 'Catégorie Twitch : VALORANT' }] };
  assert.deepStrictEqual(M.journalBands(journal, 3600).map((b) => [b.game, b.start, b.end]), [['Just Chatting', 0, 840], ['Valorant', 840, 3600]]);
});

test('éditeur : webcam de la scène du clip (Just Chatting en grand), réglage manuel respecté pour le jeu', () => {
  const E = require('../src/renderer/editor-model');
  const global = { x: 0, y: 0, w: 0.2, h: 0.3 };
  const camJ = { x: 0.125, y: 0, w: 0.75, h: 1 };
  const p = E.createProject({ streamDuration: 600, clips: [
    { start: 10, end: 20, layout: 'cam_full', cam: camJ, scene: 'Just Chatting' },
    { start: 100, end: 110, layout: 'cam_top', cam: { x: 0.01, y: 0, w: 0.21, h: 0.3 } },
    { start: 200, end: 210 }] });
  const spec = E.toRenderSpec(p, { video: 'v.mkv', output: 'o.mp4', cam: global });
  assert.deepStrictEqual(spec.clips.map((c) => [c.layout, c.cam && c.cam.x]), [['cam_full', 0.125], ['cam_top', 0.01], ['cam_top', undefined]]);
  const manual = E.toRenderSpec(p, { video: 'v.mkv', output: 'o.mp4', cam: global, camManual: true });
  assert.deepStrictEqual(manual.clips.map((c) => c.cam && c.cam.x), [0.125, 0, undefined]);
  assert.strictEqual(E.LAYOUTS.cam_full, 'Cam en grand');
});

test('éditeur : « Cam en grand » garde le cadrage sur le visage trouvé par le moteur', () => {
  const E = require('../src/renderer/editor-model');
  const camJ = { x: 0.125, y: 0, w: 0.75, h: 1 };
  const p = E.createProject({ streamDuration: 600, clips: [
    { start: 10, end: 20, layout: 'cam_full', cam: camJ, focus: { x: 0.7, y: 0.3 } },
    { start: 30, end: 40, layout: 'cam_top', cam: camJ, focus: { x: 0.7, y: 0.3 } }] });
  const spec = E.toRenderSpec(p, { video: 'v.mkv', output: 'o.mp4', cam: { x: 0, y: 0, w: 0.2, h: 0.3 } });
  assert.deepStrictEqual(spec.clips.map((c) => c.focus), [{ x: 0.7, y: 0.3 }, undefined]);
});

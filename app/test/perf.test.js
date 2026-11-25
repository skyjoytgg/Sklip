const test = require('node:test');
const assert = require('node:assert');
const { verdict, cpuLoad } = require('../src/main/perf');

const pc = (o) => ({ speed: 11, cores: 16, ramGB: 32, freeRamGB: 16, load: 10, gameRunning: false,
  obsRunning: false, encoder: 'h264_amf', ...o });

test('PC puissant avec encodeur de carte graphique : pendant le live', () => {
  const v = verdict(pc());
  assert.equal(v.verdict, 'live');
  assert.equal(v.mode, 'live');
  assert.ok(v.reasons.some((r) => r.includes("Valorant n'était pas ouvert")));
});

test('jeu ouvert et déjà très chargé : après le live', () => {
  const v = verdict(pc({ gameRunning: true, obsRunning: true, load: 88 }));
  assert.equal(v.verdict, 'apres');
  assert.equal(v.mode, 'end_of_stream');
});

test('petit PC sans encodeur matériel : après le live', () => {
  assert.equal(verdict(pc({ speed: 1.2, cores: 4, ramGB: 8, freeRamGB: 2, encoder: 'libx264' })).verdict, 'apres');
});

test('PC moyen (12 Go de RAM) : limite, on conseille après le live', () => {
  const v = verdict(pc({ cores: 8, ramGB: 12, freeRamGB: 4, speed: 4 }));
  assert.equal(v.verdict, 'limite');
  assert.equal(v.mode, 'end_of_stream');
});

test('la charge mesurée est un pourcentage', async () => {
  const l = await cpuLoad(200);
  assert.ok(l >= 0 && l <= 100);
});

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LiveJournal, captureEvent } = require('../src/main/live-journal');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sklip-journal-'));

test('journal du live : étapes notées, gardées sur le disque, aussi dans le journal texte', () => {
  const dir = tmp();
  const lines = [];
  const log = { info: (l) => lines.push(['info', l]), warn: (l) => lines.push(['warn', l]), error: (l) => lines.push(['err', l]) };
  let t = 1_000_000;
  const changes = [];
  const j = new LiveJournal({ dir, log, now: () => t, onChange: (c) => changes.push(c.events.length) });
  assert.strictEqual(j.add('marker', 'avant le live'), null);   // rien sans enregistrement
  j.start(t);
  t += 60e3; j.add('marker', 'Marqueur (Stream Deck)');
  t += 60e3; j.add('chat', 'Chat partagé : Twitch ne répond pas', { level: 'warn' });
  t += 60e3; j.stop(t, 'live.mkv');
  t += 30e3; j.add('analysis', 'Analyse terminée : 12 moments, 4 clips');
  assert.deepStrictEqual(changes, [1, 2, 3, 4, 5]);
  assert.ok(lines.some(([lvl, l]) => lvl === 'warn' && l.includes('Twitch ne répond pas')));

  const again = new LiveJournal({ dir });           // Sklip relancé : on relit le disque
  const [live] = again.list();
  assert.deepStrictEqual(live, { id: 1_000_000, start: 1_000_000, stop: 1_180_000, count: 5, problems: 1 });
  assert.strictEqual(again.get(live.id).events[4].label, 'Analyse terminée : 12 moments, 4 clips');
});

test('journal du live : seuls les 20 derniers lives sont gardés', () => {
  const dir = tmp();
  const j = new LiveJournal({ dir });
  for (let i = 1; i <= 23; i++) j.start(i * 1000);
  const ids = j.list().map((l) => l.id);
  assert.strictEqual(ids.length, 20);
  assert.strictEqual(ids[0], 23000);
  assert.ok(!ids.includes(3000));
});

test('résumé des pistes audio capturées', () => {
  const ok = captureEvent({ tracks: { game: { source: 'VALORANT' }, mic: { source: 'Micro' }, discord: { source: null } } });
  assert.strictEqual(ok.label, 'Capture audio : 2 pistes');
  assert.strictEqual(ok.level, 'ok');
  assert.match(ok.detail, /Discord ✗/);
  const noMic = captureEvent({ tracks: { game: { source: 'VALORANT' }, mic: { source: null, error: 'micro occupé' } } });
  assert.strictEqual(noMic.level, 'warn');
  assert.match(noMic.detail, /Micro ✗ \(micro occupé\)/);
  assert.strictEqual(captureEvent(null).level, 'error');
});

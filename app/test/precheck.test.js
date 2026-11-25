const test = require('node:test');
const assert = require('node:assert');
const { runPrecheck, verdict } = require('../src/main/precheck');

const base = (o = {}) => ({
  settings: { audio: { captureEnabled: true, gameApp: 'VALORANT-Win64-Shipping.exe', musicApp: 'Spotify.exe' }, analysisMode: 'end_of_stream' },
  obsConnected: true,
  scenes: async () => [{ name: 'Valorant', type: 'jeu', overlays: [{ name: 'Logo', zones: ['kill'] }] },
    { name: 'Just Chatting', type: 'discussion', overlays: [] }],
  recordDir: async () => 'D:/Videos',
  freeBytes: async () => 200 * 1024 ** 3,
  micTest: async () => ({ ok: true }),
  running: async () => new Set(['discord.exe']),
  twitchConnected: true, hotkey: 'F9', streamDeck: true, ...o,
});

test('vérification avant le live : tout va bien sauf un overlay → « prêt, 1 point à vérifier »', async () => {
  const rows = await runPrecheck(base());
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.strictEqual(by.obs.level, 'ok');
  assert.match(by.scenes.detail, /Jeu : Valorant · Discussion : Just Chatting/);
  assert.strictEqual(rows.find((r) => r.label === 'Overlay « Logo »').level, 'warn');
  assert.strictEqual(by.disk.level, 'ok');
  assert.strictEqual(by.mic.level, 'ok');
  assert.strictEqual(by.discord.level, 'ok');
  assert.strictEqual(by.game.level, 'info');          // Valorant pas encore lancé : normal
  assert.deepStrictEqual(verdict(rows), { level: 'warn', text: 'Prêt, 1 point à vérifier' });
});

test('vérification avant le live : OBS fermé, micro muet, disque presque plein → problèmes à régler', async () => {
  const rows = await runPrecheck(base({ obsConnected: false, micTest: async () => ({ ok: false, error: 'pas de micro' }),
    twitchConnected: false, hotkey: null, streamDeck: false }));
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.strictEqual(by.obs.level, 'error');
  assert.ok(!by.scenes && !by.disk);                  // sans OBS, on ne lit ni scènes ni disque
  assert.strictEqual(by.mic.level, 'error');
  assert.strictEqual(by.twitch.level, 'warn');
  assert.strictEqual(by.markers.level, 'warn');
  assert.strictEqual(verdict(rows).text, '2 problèmes à régler avant le live');
  const full = await runPrecheck(base({ freeBytes: async () => 5 * 1024 ** 3 }));
  assert.strictEqual(full.find((r) => r.id === 'disk').level, 'error');
  assert.deepStrictEqual(verdict([{ level: 'ok' }]), { level: 'ok', text: 'Tout est prêt, bon live !' });
});

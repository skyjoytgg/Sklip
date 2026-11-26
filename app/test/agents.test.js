const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Agents, API } = require('../src/main/agents');

const V = '707eab51-4836-f488-046a-cda6bf494859';
const R = 'a3bfb853-43b2-7238-a4f1-ad90e9e46bcc';

function fakeFetch(calls, { offline = false } = {}) {
  return async (url) => {
    calls.push(url);
    if (offline) throw new Error('hors ligne');
    if (url === API) {
      return { ok: true, json: async () => ({ data: [
        { uuid: V, displayName: 'Viper', displayIcon: 'https://x/icon_v.png', fullPortrait: 'https://x/full_v.png', role: { displayName: 'Contrôleur' } },
        { uuid: R, displayName: 'Reyna', displayIcon: 'https://x/icon_r.png', fullPortrait: null, role: null },
        { uuid: '../pas-un-uuid', displayName: 'Pirate', displayIcon: 'https://x/evil.png' },
      ] }) };
    }
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(`png:${url}`).buffer };
  };
}

test('agents : liste + icônes téléchargées une seule fois, uuid douteux ignorés', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sklip-agents-'));
  const calls = [];
  const a = new Agents(dir, { fetchImpl: fakeFetch(calls) });
  assert.equal(await a.ensureIcons(), dir);
  assert.ok(fs.existsSync(path.join(dir, `icon_${V}.png`)) && fs.existsSync(path.join(dir, `icon_${R}.png`)));
  assert.deepEqual(a.list().map((x) => x.name), ['Reyna', 'Viper']);
  assert.ok(!calls.includes('https://x/evil.png'));
  const n = calls.length;
  await a.ensureIcons();                                  // à jour : aucun nouveau téléchargement
  assert.equal(calls.length, n);
});

test('agents : sans connexion, ancienne liste gardée ; sans rien, null', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sklip-agents-'));
  assert.equal(await new Agents(dir, { fetchImpl: fakeFetch([], { offline: true }) }).ensureIcons(), null);
  await new Agents(dir, { fetchImpl: fakeFetch([]) }).ensureIcons();
  const f = path.join(dir, 'agents.json');
  const d = JSON.parse(fs.readFileSync(f, 'utf8')); d.at = 0; fs.writeFileSync(f, JSON.stringify(d));   // liste périmée
  assert.equal(await new Agents(dir, { fetchImpl: fakeFetch([], { offline: true }) }).ensureIcons(), dir);
});

test('agents : portrait téléchargé, détouré puis gardé en cache', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sklip-agents-'));
  const calls = [];
  const crop = (buf) => ({ png: Buffer.from('rogné'), width: 700, height: 1500, src: buf });
  const a = new Agents(dir, { fetchImpl: fakeFetch(calls), crop });
  await a.ensureIcons();
  const p = await a.portrait(V);
  assert.deepEqual([p.width, p.height], [700, 1500]);
  assert.equal(fs.readFileSync(p.file, 'utf8'), 'rogné');
  const n = calls.length;
  assert.deepEqual(await a.portrait(V), p);              // déjà là : pas retéléchargé
  assert.equal(calls.length, n);
  assert.equal(await a.portrait(R), null);               // pas de portrait chez Riot
  assert.equal(await a.portrait('../../etc'), null);
});

import test from 'node:test';
import assert from 'node:assert';
import { createHandler, memoryStore, twitchValidator, MAX_PART, TTL_MS } from '../src/relay.js';

const tokens = { 'tok-sky': 'sky', 'tok-kamel': 'kamel', 'tok-lea': 'lea' };
function setup() {
  const store = memoryStore();
  let t = 1_000_000;
  const handle = createHandler({ store, validate: async (tok) => tokens[tok] || null, now: () => t });
  const call = async (tok, method, path, body, headers = {}) => {
    const init = { method, headers: { authorization: `Bearer ${tok}`, ...headers } };
    if (body !== undefined) init.body = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body);
    const r = await handle(new Request(`https://relay.test${path}`, init));
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, data: ct.includes('json') ? await r.json() : new Uint8Array(await r.arrayBuffer()) };
  };
  return { store, call, tick: (ms) => { t += ms; } };
}

test('sans connexion Twitch valide : rien', async () => {
  const { call } = setup();
  assert.strictEqual((await call('faux', 'GET', '/v1/messages')).status, 401);
  assert.deepStrictEqual((await call('tok-sky', 'GET', '/v1/ping')).data, { ok: true, login: 'sky' });
});

test('chacun ne lit que ses messages, et ne peut pas se faire passer pour un autre', async () => {
  const { call } = setup();
  const r = await call('tok-sky', 'POST', '/v1/messages', { id: 'req-1', kind: 'request', to: 'kamel', from: 'lea', body: { wall_start: 1 } });
  assert.strictEqual(r.status, 200);
  const k = await call('tok-kamel', 'GET', '/v1/messages');
  assert.strictEqual(k.data.length, 1);
  assert.strictEqual(k.data[0].from, 'sky');                 // l'expéditeur vient du jeton, pas du message
  assert.deepStrictEqual(k.data[0].body, { wall_start: 1 });
  assert.strictEqual((await call('tok-lea', 'GET', '/v1/messages')).data.length, 0);
  // Léa ne peut ni écraser ni effacer le message de Sky.
  assert.strictEqual((await call('tok-lea', 'POST', '/v1/messages', { id: 'req-1', kind: 'request', to: 'lea' })).status, 409);
  assert.strictEqual((await call('tok-lea', 'DELETE', '/v1/messages/req-1')).status, 403);
  assert.strictEqual((await call('tok-kamel', 'DELETE', '/v1/messages/req-1')).status, 200);
  assert.strictEqual((await call('tok-kamel', 'GET', '/v1/messages')).data.length, 0);
});

test('messages invalides refusés', async () => {
  const { call } = setup();
  for (const m of [{ id: 'a b', kind: 'request', to: 'kamel' }, { id: 'x', kind: 'spam', to: 'kamel' },
    { id: 'x', kind: 'request', to: 'Kamel!' }, { id: 'x', kind: 'request', to: 'kamel', body: { s: 'a'.repeat(5000) } }]) {
    assert.ok([400, 413].includes((await call('tok-sky', 'POST', '/v1/messages', m)).status));
  }
});

test('fichier en morceaux : seul le destinataire peut le lire', async () => {
  const { call } = setup();
  const a = new Uint8Array(MAX_PART).fill(7);
  const b = new Uint8Array(10).fill(9);
  assert.strictEqual((await call('tok-kamel', 'PUT', '/v1/files/rep-1/0?to=sky', a)).status, 200);
  assert.strictEqual((await call('tok-kamel', 'PUT', '/v1/files/rep-1/1?to=sky', b)).status, 200);
  assert.strictEqual((await call('tok-kamel', 'PUT', '/v1/files/rep-1/2?to=sky', new Uint8Array(MAX_PART + 1))).status, 413);
  assert.strictEqual((await call('tok-lea', 'PUT', '/v1/files/rep-1/1?to=lea', b)).status, 403);   // pas le sien
  assert.strictEqual((await call('tok-lea', 'GET', '/v1/files/rep-1/0')).status, 404);
  const got = await call('tok-sky', 'GET', '/v1/files/rep-1/1');
  assert.deepStrictEqual([...got.data], [...b]);
  assert.strictEqual((await call('tok-lea', 'DELETE', '/v1/files/rep-1')).status, 403);
  assert.strictEqual((await call('tok-sky', 'DELETE', '/v1/files/rep-1')).status, 200);
  assert.strictEqual((await call('tok-sky', 'GET', '/v1/files/rep-1/0')).status, 404);
});

test('ménage : tout disparaît au bout de 7 jours', async () => {
  const { store, call, tick } = setup();
  await call('tok-sky', 'POST', '/v1/messages', { id: 'req-1', kind: 'request', to: 'kamel' });
  await call('tok-kamel', 'PUT', '/v1/files/rep-1/0?to=sky', new Uint8Array(5));
  tick(TTL_MS + 1);
  await store.purge(1_000_000 + TTL_MS + 1 - TTL_MS);
  assert.strictEqual(store.messages.size, 0);
  assert.strictEqual(store.parts.size, 0);
});

test('jeton Twitch vérifié auprès de Twitch, seulement ceux de Sklip', async () => {
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls++;
    const tok = init.headers.Authorization.slice(6);
    if (tok === 'bon') return new Response(JSON.stringify({ client_id: 'sklip', login: 'Sky' }));
    if (tok === 'autre-appli') return new Response(JSON.stringify({ client_id: 'autre', login: 'pirate' }));
    return new Response('{}', { status: 401 });
  };
  const v = twitchValidator({ TWITCH_CLIENT_ID: 'sklip' }, fetchImpl);
  assert.strictEqual(await v('bon'), 'sky');
  assert.strictEqual(await v('bon'), 'sky');
  assert.strictEqual(calls, 1);                                   // gardé en mémoire 10 min
  assert.strictEqual(await v('autre-appli'), null);
  assert.strictEqual(await v('mauvais'), null);
  assert.strictEqual(await v('dev:sky'), null);                   // jetons factices seulement en mode test local
  assert.strictEqual(await twitchValidator({ DEV_FAKE_AUTH: '1' }, fetchImpl)('dev:Kamel'), 'kamel');
});

const test = require('node:test');
const assert = require('node:assert');
const tm = require('../src/main/twitch-moments');
const { TwitchAuth, TwitchLive } = require('../src/main/twitch');

const START = Date.parse('2026-11-24T20:00:00Z');
const at = (s) => new Date(START + s * 1000).toISOString();

// ---------- Moments ----------

test('raids', () => {
  const [m] = tm.raidMoments([{ at: at(1530), channel: 'Kamel', viewers: 42 }], START);
  assert.deepStrictEqual(m, { type: 'raid', t: 1530, meta: { channel: 'Kamel', viewers: 42 } });
});

test('peak de viewers : record, montée rapide, seuil', () => {
  const v = [10, 12, 11, 13, 20, 22, 21, 15, 14, 30, 28].map((n, i) => ({ at: at(i * 60), viewers: n }));
  assert.deepStrictEqual(tm.viewerPeakMoments(v, START, { mode: 'record' }).map((m) => m.t), [540]);
  const rise = tm.viewerPeakMoments(v, START, { mode: 'rise', risePercent: 40, riseMinutes: 3 });
  assert.deepStrictEqual(rise.map((m) => m.t), [240, 540]);
  assert.deepStrictEqual(tm.viewerPeakMoments(v, START, { mode: 'threshold', threshold: 20 }).map((m) => m.t), [240, 540]);
});

test('mots-clés du chat', () => {
  assert.ok(tm.matchesKeywords('KEKW KEKW'));
  assert.ok(!tm.matchesKeywords('kekw'));            // les emotes sont sensibles à la casse
  assert.ok(tm.matchesKeywords('MDR trop fort', ['mdr']));
  assert.ok(tm.matchesKeywords('ptdrrr', ['ptdr']));
  assert.ok(!tm.matchesKeywords('commander', ['mdr']));
});

test('pic de chat', () => {
  const msgs = [];
  for (let s = 0; s < 600; s += 37) msgs.push({ at: at(s), text: 'LUL' });      // bruit de fond
  for (let i = 0; i < 14; i++) msgs.push({ at: at(305 + i * 0.5), text: i % 2 ? 'KEKW' : 'mdr' });
  msgs.push({ at: at(306), text: 'salut tout le monde' });
  const spikes = tm.chatSpikeMoments(msgs, START, { keywords: ['mdr'] });
  assert.strictEqual(spikes.length, 1);
  assert.strictEqual(spikes[0].t, 297);  // fenêtre 300-310, 3 s avant
});

test('!clip réservé au streamer et aux modos', () => {
  const ms = tm.chatMarkerMoments([
    { at: at(100), text: '!clip', badges: ['moderator'], user: 'modo' },
    { at: at(200), text: '!clip', badges: [], user: 'viewer' },
    { at: at(300), text: '!CLIP ace', badges: ['broadcaster'], user: 'sky' },
  ], START);
  assert.deepStrictEqual(ms.map((m) => m.t), [98, 298]);
});

test('clips des viewers', () => {
  const [a, b] = tm.viewerClipMoments([
    { vod_offset: 1000, duration: 30, title: 'ACE', creator_name: 'x', view_count: 3 },
    { vod_offset: null, created_at: at(2030), duration: 30, title: 'lol' },
  ], START);
  assert.strictEqual(a.t, 1021);
  assert.strictEqual(b.t, 2021);
});

test('temps du stream → temps de l\'enregistrement', () => {
  const ms = tm.streamToRecordingTime([{ type: 'raid', t: 100 }, { type: 'raid', t: 1 }], START, START + 5000);
  assert.deepStrictEqual(ms.map((m) => m.t), [95]);   // l'enregistrement a démarré 5 s après le live
});

// ---------- Connexion (Device Code Flow) ----------

function fakeFetch(routes) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url, opts });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    const res = routes[key](url, opts, calls);
    return { ok: res.status < 400, status: res.status, json: async () => res.body };
  };
  f.calls = calls;
  return f;
}

test('connexion : code, attente, jetons, profil', async () => {
  let polls = 0;
  const saved = [];
  const fetchImpl = fakeFetch({
    'https://id.twitch.tv/oauth2/device': () => ({ status: 200, body: { device_code: 'dc', user_code: 'ABCD-EFGH', verification_uri: 'https://www.twitch.tv/activate?device-code=ABCD-EFGH', interval: 5, expires_in: 1800 } }),
    'https://id.twitch.tv/oauth2/token': () => (++polls < 3
      ? { status: 400, body: { status: 400, message: 'authorization_pending' } }
      : { status: 200, body: { access_token: 'at', refresh_token: 'rt', expires_in: 14000 } }),
    'https://api.twitch.tv/helix/users': () => ({ status: 200, body: { data: [{ id: '42', login: 'sky', display_name: 'Sky', profile_image_url: 'x' }] } }),
  });
  const auth = new TwitchAuth({ clientId: 'cid', fetchImpl, store: { load: () => null, save: (t) => saved.push(t) } });
  const login = await auth.startDeviceLogin();
  assert.strictEqual(login.userCode, 'ABCD-EFGH');
  assert.ok(fetchImpl.calls[0].opts.body.includes('client_id=cid'));
  assert.ok(!fetchImpl.calls[0].opts.body.includes('secret'));
  const user = await auth.waitForLogin(login, { wait: async () => {} });
  assert.strictEqual(user.name, 'Sky');
  assert.strictEqual(polls, 3);
  assert.ok(auth.isConnected());
  assert.strictEqual(saved.at(-1).user.id, '42');
  const usersCall = fetchImpl.calls.find((c) => c.url.includes('/helix/users'));
  assert.strictEqual(usersCall.opts.headers.Authorization, 'Bearer at');
});

test('jeton expiré : renouvelé automatiquement', async () => {
  let now = 1_000_000;
  const fetchImpl = fakeFetch({
    'https://id.twitch.tv/oauth2/token': () => ({ status: 200, body: { access_token: 'at2', refresh_token: 'rt2', expires_in: 14000 } }),
    'https://api.twitch.tv/helix/streams': () => ({ status: 200, body: { data: [] } }),
  });
  const auth = new TwitchAuth({ clientId: 'cid', fetchImpl, now: () => now,
    store: { load: () => ({ access_token: 'old', refresh_token: 'rt', expires_at: now + 10_000, user: { id: '42' } }), save: () => {} } });
  assert.strictEqual(await auth.getStream('42'), null);
  const refresh = fetchImpl.calls.find((c) => c.url.endsWith('/token'));
  assert.ok(refresh.opts.body.includes('grant_type=refresh_token'));
  assert.strictEqual(auth.tokens.access_token, 'at2');
});

test('clips : pagination', async () => {
  let page = 0;
  const fetchImpl = fakeFetch({
    'https://api.twitch.tv/helix/clips': () => (page++ === 0
      ? { status: 200, body: { data: [{ id: 1 }, { id: 2 }], pagination: { cursor: 'c' } } }
      : { status: 200, body: { data: [{ id: 3 }], pagination: {} } }),
  });
  const auth = new TwitchAuth({ clientId: 'cid', fetchImpl,
    store: { load: () => ({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 1e7 }), save: () => {} } });
  const clips = await auth.getClips('42', at(0), at(3600));
  assert.deepStrictEqual(clips.map((c) => c.id), [1, 2, 3]);
});

// ---------- EventSub ----------

test('EventSub : abonnements, raid, chat, fin du live', async () => {
  const posted = [];
  const auth = {
    tokens: { user: { id: '42' } },
    helix: async (path, o) => { posted.push(o.body); return {}; },
    getStream: async () => ({ viewer_count: 17, started_at: at(0), game_name: 'VALORANT' }),
  };
  class FakeWS { constructor() { FakeWS.i = this; } close() {} }
  const live = new TwitchLive(auth, { WebSocketImpl: FakeWS, viewerInterval: 1e9 });
  const events = [];
  live.on('streamOffline', (d) => events.push(d));
  live.on('marker', (d) => events.push({ marker: d }));
  live.start();
  const send = (message_type, payload, ts = at(0)) => FakeWS.i.onmessage({ data: JSON.stringify({ metadata: { message_type, message_timestamp: ts }, payload }) });
  send('session_welcome', { session: { id: 'S1' } });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepStrictEqual(posted.map((b) => b.type), ['stream.online', 'stream.offline', 'channel.raid', 'channel.chat.message']);
  assert.ok(posted.every((b) => b.transport.session_id === 'S1'));
  const notif = (type, event, ts) => send('notification', { subscription: { type }, event }, ts);
  notif('channel.raid', { from_broadcaster_user_name: 'Kamel', viewers: 42 }, at(1530));
  notif('channel.chat.message', { chatter_user_name: 'modo', message: { text: '!clip' }, badges: [{ set_id: 'moderator' }] }, at(1600));
  notif('stream.offline', {}, at(7200));
  assert.strictEqual(events.length, 2);
  const data = events[1];
  assert.strictEqual(data.raids[0].channel, 'Kamel');
  assert.strictEqual(data.chat.length, 1);
  assert.strictEqual(data.viewers[0].viewers, 17);
  assert.strictEqual(data.endedAt - data.startedAt, 7200 * 1000);
  live.stop();
});

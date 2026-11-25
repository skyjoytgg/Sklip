const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MAX_TRIES, FriendService, reactionRequests, friendsTogether, findRecording } = require('../src/main/friends');
const M = require('../src/renderer/editor-model');

const REC = Date.UTC(2026, 10, 25, 20, 0, 0);   // début de l'enregistrement de Sky
const warnings = [];
const log = { info() {}, warn: (...a) => warnings.push(a.join(' ')), error() {} };

test('pote en chat partagé au moment du clip', () => {
  const presence = [{ at: REC + 60e3, logins: ['Kamel', 'inconnu'] }, { at: REC + 3600e3, logins: ['lea'] }];
  const friends = [{ login: 'kamel' }, { login: 'lea' }];
  assert.deepStrictEqual(friendsTogether(presence, friends, REC + 120e3), ['kamel']);
  assert.deepStrictEqual(friendsTogether(presence, friends, REC + 1800e3), []);
  assert.deepStrictEqual(friendsTogether(presence, friends, REC + 1800e3, REC + 3550e3).sort(), ['lea']);
});

test('chat partagé rejoint en cours de live : seulement pendant le passage, avec 1 min de marge', () => {
  // Sky commence seul, Kamel arrive vers 10 min (relevés chaque minute de 10 à 20 min), puis repart.
  const presence = [];
  for (let m = 10; m <= 20; m++) presence.push({ at: REC + m * 60e3, logins: ['kamel'] });
  const friends = [{ login: 'kamel' }];
  const at = (min) => friendsTogether(presence, friends, REC + min * 60e3);
  assert.deepStrictEqual(at(5), []);            // ace 5 min avant : seul
  assert.deepStrictEqual(at(8), []);            // 2 min avant : seul (avant, ça comptait)
  assert.deepStrictEqual(at(9.5), ['kamel']);   // entre deux relevés : dans la marge
  assert.deepStrictEqual(at(15), ['kamel']);
  assert.deepStrictEqual(at(20.8), ['kamel']);
  assert.deepStrictEqual(at(23), []);           // reparti
  // Un relevé raté (internet) ne coupe pas le passage ; une longue absence, si.
  const holes = presence.filter((p) => p.at !== REC + 15 * 60e3);
  assert.deepStrictEqual(friendsTogether(holes, friends, REC + 15 * 60e3), ['kamel']);
  const back = [...presence, { at: REC + 40 * 60e3, logins: ['kamel'] }];
  assert.deepStrictEqual(friendsTogether(back, friends, REC + 30 * 60e3), []);
});

test('demandes seulement pour les aces et clutchs en chat partagé', () => {
  const session = { record_started_at: REC / 1000, folder: 'X',
    moments: [{ type: 'ace', t: 100 }, { type: 'kill', t: 110 }, { type: 'clutch', t: 2000 }],
    clips: { kills: [{ start: 92, end: 118 }] } };
  const reqs = reactionRequests(session, { me: 'Sky', friends: [{ login: 'kamel' }],
    presence: [{ at: REC + 100e3, logins: ['kamel'] }], now: 1 });
  assert.strictEqual(reqs.length, 1);                      // clutch à 2000 s : Kamel n'était plus là
  assert.deepStrictEqual([reqs[0].from, reqs[0].to, reqs[0].reason], ['sky', 'kamel', 'ace']);
  assert.strictEqual(reqs[0].wall_start, REC + 87e3);      // tout le clip + 5 s de marge
  assert.strictEqual(reqs[0].wall_end, REC + 123e3);
});

test("retrouver l'instant dans l'enregistrement du pote", () => {
  const recs = [{ video: 'a.mkv', start: REC - 7200e3, stop: REC - 3600e3 }, { video: 'b.mkv', start: REC - 600e3, stop: REC + 3600e3 }];
  const r = findRecording(recs, REC + 87e3, REC + 123e3);
  assert.deepStrictEqual([r.video, r.start, r.duration], ['b.mkv', 687, 36]);
  assert.strictEqual(findRecording(recs, REC + 7200e3, REC + 7230e3), null);
});

/** Le vrai code du serveur (relay/), en mémoire, et deux (ou trois) Sklip qui lui parlent. */
async function setup() {
  const { createHandler, memoryStore } = await import('../../relay/src/relay.js');
  const store = memoryStore();
  const handle = createHandler({ store, validate: async (tok) => (tok.startsWith('tok-') ? tok.slice(4) : null) });
  const fetchImpl = async (url, init) => handle(new Request(url, init));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sklip-amis-'));
  const sessionFolder = path.join(root, 'sky', 'Streams', '2026-11-25_ranked');
  fs.mkdirSync(sessionFolder, { recursive: true });
  const session = { folder: sessionFolder, video: 'C:/obs/sky.mkv', record_started_at: REC / 1000,
    tracks: { discord: { path: 'C:/captures/discord.opus', offset: 0.4 } },
    moments: [{ type: 'ace', t: 100 }], clips: { kills: [{ start: 92, end: 118 }] } };
  fs.writeFileSync(path.join(sessionFolder, 'session.json'), JSON.stringify(session));
  const calls = [];
  const engine = async (cmd, p) => {
    calls.push([cmd, p]);
    if (cmd === 'friend-extract') { fs.writeFileSync(p.out, Buffer.alloc(2_500_000, 3)); return { out: p.out, duration: p.duration, size: 2_500_000 }; }
    if (cmd === 'friend-sync') return { offset: p.guess - 0.8, method: 'son', confidence: 0.9 };
    throw new Error(cmd);
  };
  const mk = (who, settings, extra = {}) => {
    const dataDir = path.join(root, who);
    fs.mkdirSync(dataDir, { recursive: true });
    const events = [];
    const svc = new FriendService({ getSettings: () => settings, getLogin: () => who, getToken: async () => `tok-${who}`,
      relayUrl: 'https://relay.test', fetchImpl, engine, dataDir, log, notify: (type, d) => events.push({ type, ...d }), ...extra });
    return { svc, events, dataDir };
  };
  const video = path.join(root, 'kamel.mkv');
  fs.writeFileSync(video, '');
  return { store, session, calls, mk, video, fetchImpl };
}

test('aller-retour complet via le serveur Sklip', async () => {
  const { store, session, calls, mk, video } = await setup();
  const sky = mk('sky', { friends: [{ login: 'kamel', autoAccept: true }] });
  const kamel = mk('kamel', { friends: [{ login: 'sky', autoAccept: true }], cam: { x: 0.7, y: 0, w: 0.3, h: 0.3 } });
  kamel.svc.addRecording(video, REC - 600e3, REC + 3600e3);
  sky.svc.recordPresence(['kamel'], REC + 90e3);           // chacun a vu l'autre dans le chat partagé
  kamel.svc.recordPresence(['sky'], REC + 95e3);

  assert.strictEqual(await sky.svc.requestForSession(session), 1);
  const sent = [...store.messages.values()][0];
  assert.strictEqual(sent.from, 'sky');
  assert.ok(!sent.body.includes('ranked') && !sent.body.includes('local'));   // rien de local n'est envoyé

  await kamel.svc.tick();                                   // Kamel découpe sa webcam et l'envoie (3 morceaux)
  const ex = calls.find((c) => c[0] === 'friend-extract')[1];
  assert.deepStrictEqual([ex.video, ex.start, ex.duration], [video, 687, 36]);
  assert.deepStrictEqual(ex.cam, { x: 0.7, y: 0, w: 0.3, h: 0.3 });
  assert.strictEqual(store.parts.size, 3);
  assert.ok(!fs.existsSync(ex.out));                        // la copie locale chez Kamel est effacée

  await sky.svc.tick();                                     // Sky la reçoit, calée sur sa piste Discord
  const sync = calls.find((c) => c[0] === 'friend-sync')[1];
  assert.deepStrictEqual([sync.guess, sync.reference, sync.ref_offset], [87, 'C:/captures/discord.opus', 0.4]);
  const reactions = JSON.parse(fs.readFileSync(path.join(session.folder, 'reactions.json'), 'utf8'));
  assert.strictEqual(reactions.length, 1);
  assert.deepStrictEqual([reactions[0].friend, reactions[0].offset], ['kamel', 86.2]);
  assert.strictEqual(fs.statSync(reactions[0].file).size, 2_500_000);
  assert.strictEqual(sky.events[0].type, 'reaction-received');
  assert.strictEqual(store.messages.size, 0);               // tout est effacé du serveur
  assert.strictEqual(store.parts.size, 0);

  // Dans l'éditeur : la réaction va sur le clip de l'ace, en incrustation.
  let p = M.createProject({ clips: [{ start: 92, end: 118 }, { start: 300, end: 320 }] });
  p = M.attachReactions(p, reactions);
  assert.strictEqual(p.clips[0].friend.mode, 'pip');
  assert.strictEqual(p.clips[1].friend, null);
  const spec = M.toRenderSpec(p, { video: 'v', output: 'o' });
  assert.deepStrictEqual(spec.clips[0].friend, { file: reactions[0].file, offset: 86.2, mode: 'pip', pos: undefined, cut_at: 8.3, cut_dur: 2.5 });
  p = M.setFriend(p, p.clips[0].id, { mode: 'cut' });
  assert.deepStrictEqual(M.friendAt(p.clips[0], 100.5), { u: 100.5 - 86.2, full: true });
  assert.strictEqual(M.friendAt(p.clips[0], 95), null);
  p = M.setFriend(p, p.clips[0].id, null);
  assert.strictEqual(M.attachReactions(p, reactions).clips[0].friend, null);   // retirée : ne revient pas
});

test("même ami de confiance : rien n'est envoyé si son Sklip ne nous a pas vus en chat partagé", async () => {
  const { session, calls, mk, video } = await setup();
  const sky = mk('sky', { friends: [{ login: 'kamel' }] });
  const kamel = mk('kamel', { friends: [{ login: 'sky' }] });
  kamel.svc.addRecording(video, REC - 600e3, REC + 3600e3);
  sky.svc.recordPresence(['kamel'], REC + 90e3);            // Sky prétend qu'ils étaient ensemble…
  kamel.svc.recordPresence(['lea'], REC + 95e3);            // …mais Kamel était en chat partagé avec Léa
  await sky.svc.requestForSession(session);
  await kamel.svc.tick();
  assert.strictEqual(calls.length, 0);                      // sa webcam n'est pas découpée
  await sky.svc.tick();
  const reactions = JSON.parse(fs.readFileSync(path.join(session.folder, 'reactions.json'), 'utf8'));
  assert.strictEqual(reactions[0].status, 'not_together');
});

test("le bouton de l'éditeur ne propose que les potes du chat partagé", async () => {
  const { session, mk } = await setup();
  const sky = mk('sky', { friends: [{ login: 'kamel' }, { login: 'lea' }] });
  sky.svc.recordPresence(['kamel', 'inconnu'], REC + 90e3);
  assert.deepStrictEqual(sky.svc.friendsForClip(session, { start: 92, end: 118 }), ['kamel']);
  assert.deepStrictEqual(sky.svc.friendsForClip(session, { start: 3000, end: 3020 }), []);
  await assert.rejects(sky.svc.requestManual(session, { start: 92, end: 118 }, 'lea'), /pas en chat partagé avec lea/);
});

test('le pote valide à la main, ou refuse ; les inconnus sont ignorés', async () => {
  const { session, calls, mk, video } = await setup();
  const sky = mk('sky', { friends: [{ login: 'kamel' }, { login: 'lea' }] });
  const kamel = mk('kamel', { friends: [{ login: 'sky', autoAccept: false }] });
  const lea = mk('lea', { friends: [] });
  kamel.svc.addRecording(video, REC - 600e3, REC + 3600e3);
  sky.svc.recordPresence(['kamel', 'lea'], REC + 90e3);
  kamel.svc.recordPresence(['sky'], REC + 90e3);
  await sky.svc.requestManual(session, { start: 92, end: 118, moments: [{ t: 100 }] }, 'kamel');
  await sky.svc.requestManual(session, { start: 92, end: 118 }, 'lea');

  await lea.svc.tick();                                     // Léa n'a pas Sky en ami : rien
  await kamel.svc.tick();
  assert.strictEqual(calls.length, 0);                      // rien n'est envoyé sans l'accord de Kamel
  assert.strictEqual(kamel.svc.pending().length, 1);
  assert.strictEqual(kamel.events[0].type, 'reaction-request');
  await kamel.svc.refuse(kamel.svc.pending()[0].id);
  await sky.svc.tick();
  const reactions = JSON.parse(fs.readFileSync(path.join(session.folder, 'reactions.json'), 'utf8'));
  assert.deepStrictEqual(reactions.map((r) => r.status), ['refused']);
});

test('pas de découpe pendant un live du pote ; « absent » sans enregistrement', async () => {
  const { session, calls, mk } = await setup();
  let recording = true;
  const sky = mk('sky', { friends: [{ login: 'kamel' }] });
  const kamel = mk('kamel', { friends: [{ login: 'sky' }] }, { isRecording: () => recording });
  sky.svc.recordPresence(['kamel'], REC + 90e3);
  kamel.svc.recordPresence(['sky'], REC + 90e3);
  await sky.svc.requestManual(session, { start: 92, end: 118 }, 'kamel');
  await kamel.svc.tick();
  await sky.svc.tick();
  assert.ok(!fs.existsSync(path.join(session.folder, 'reactions.json')));   // il est en live : plus tard
  recording = false;
  await kamel.svc.tick();
  await sky.svc.tick();
  assert.strictEqual(calls.length, 0);
  const reactions = JSON.parse(fs.readFileSync(path.join(session.folder, 'reactions.json'), 'utf8'));
  assert.strictEqual(reactions[0].status, 'absent');
});

test('sans Twitch connecté ou sans serveur : en attente, sans erreur', async () => {
  const { mk } = await setup();
  const a = mk('sky', { friends: [] }, { getLogin: () => '' });
  assert.deepStrictEqual(a.svc.status(), { ready: false, reason: 'twitch' });
  await a.svc.tick();
  const b = mk('sky', { friends: [] }, { relayUrl: '' });
  assert.deepStrictEqual(b.svc.status(), { ready: false, reason: 'server' });
});


test('sans internet à la fin du live : la demande attend et repart toute seule', async () => {
  const { session, mk, video, fetchImpl } = await setup();
  let online = false;
  const flaky = async (url, init) => { if (!online) throw new Error('getaddrinfo ENOTFOUND'); return fetchImpl(url, init); };
  const sky = mk('sky', { friends: [{ login: 'kamel', autoAccept: true }] }, { fetchImpl: flaky, retryDelays: [0, 0] });
  const kamel = mk('kamel', { friends: [{ login: 'sky', autoAccept: true }] });
  kamel.svc.addRecording(video, REC - 600e3, REC + 3600e3);
  sky.svc.recordPresence(['kamel'], REC + 90e3);
  kamel.svc.recordPresence(['sky'], REC + 95e3);

  assert.strictEqual(await sky.svc.requestForSession(session), 0);
  let st = sky.svc.status();
  assert.strictEqual(st.outbox, 1);
  assert.strictEqual(st.offline, true);
  await sky.svc.tick();                                     // toujours pas d'internet : rien de perdu
  assert.strictEqual(sky.svc.status().outbox, 1);

  online = true;
  await sky.svc.tick();                                     // internet revenu : la demande part
  st = sky.svc.status();
  assert.strictEqual(st.outbox, 0);
  assert.strictEqual(st.offline, false);
  assert.deepStrictEqual(st.waiting.map((w) => w.to), ['kamel']);
  await kamel.svc.tick();
  await sky.svc.tick();
  assert.strictEqual(sky.events.at(-1).status, 'ok');
  assert.deepStrictEqual(sky.svc.status().waiting, []);
});

test('serveur qui hoquette (erreur 500) : on réessaie sans rien dire', async () => {
  const { session, mk, fetchImpl } = await setup();
  let fails = 1;
  const hiccup = async (url, init) => (fails-- > 0 ? new Response('{}', { status: 503 }) : fetchImpl(url, init));
  const sky = mk('sky', { friends: [{ login: 'kamel' }] }, { fetchImpl: hiccup, retryDelays: [0, 0] });
  sky.svc.recordPresence(['kamel'], REC + 90e3);
  assert.strictEqual(await sky.svc.requestForSession(session), 1);
  assert.strictEqual(sky.svc.status().outbox, 0);
});

test("découpe impossible chez le pote : il abandonne après quelques essais et prévient", async () => {
  const { session, mk, video } = await setup();
  const sky = mk('sky', { friends: [{ login: 'kamel' }] });
  const broken = async () => { throw new Error('FFmpeg a planté'); };
  const kamel = mk('kamel', { friends: [{ login: 'sky' }] }, { engine: broken });
  kamel.svc.addRecording(video, REC - 600e3, REC + 3600e3);
  sky.svc.recordPresence(['kamel'], REC + 90e3);
  kamel.svc.recordPresence(['sky'], REC + 95e3);
  await sky.svc.requestForSession(session);
  for (let i = 0; i < MAX_TRIES; i++) await kamel.svc.tick();
  await kamel.svc.tick();                                   // plus rien à faire : déjà abandonné
  await sky.svc.tick();
  assert.strictEqual(sky.events.length, 1);
  assert.strictEqual(sky.events[0].status, 'error');
  const saved = JSON.parse(fs.readFileSync(path.join(session.folder, 'reactions.json'), 'utf8'));
  assert.strictEqual(saved[0].status, 'error');
});

test("pote qui n'ouvre pas Sklip pendant 7 jours : demande expirée", async () => {
  const { session, mk } = await setup();
  let now = REC + 4 * 3600e3;
  const sky = mk('sky', { friends: [{ login: 'kamel' }] }, { now: () => now });
  sky.svc.recordPresence(['kamel'], REC + 90e3);
  await sky.svc.requestForSession(session);
  now += 6 * 24 * 3600e3;
  await sky.svc.tick();
  assert.strictEqual(sky.events.length, 0);
  now += 2 * 24 * 3600e3;
  await sky.svc.tick();
  assert.strictEqual(sky.events[0].status, 'expired');
  assert.deepStrictEqual(sky.svc.status().waiting, []);
});

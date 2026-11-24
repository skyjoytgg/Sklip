const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { ObsWatcher, computeAuth, isRequestAllowed } = require('../src/main/obs-watcher');

// Faux OBS : enregistre ce que Sklip envoie et répond comme obs-websocket v5.
function makeFakeObs({ auth = null, streaming = false, recording = false } = {}) {
  const sent = [];
  class FakeWS {
    constructor() {
      FakeWS.instance = this;
      setImmediate(() => this.serverSend(0, { obsWebSocketVersion: '5.5.0', rpcVersion: 1, authentication: auth || undefined }));
    }
    serverSend(op, d) { this.onmessage({ data: JSON.stringify({ op, d }) }); }
    send(raw) {
      const msg = JSON.parse(raw);
      sent.push(msg);
      if (msg.op === 1) setImmediate(() => this.serverSend(2, { negotiatedRpcVersion: 1 }));
      if (msg.op === 6) {
        const { requestType, requestId } = msg.d;
        const data = requestType === 'GetStreamStatus' ? { outputActive: streaming }
          : requestType === 'GetRecordStatus' ? { outputActive: recording } : {};
        setImmediate(() => this.serverSend(7, { requestType, requestId, requestStatus: { result: true, code: 100 }, responseData: data }));
      }
    }
    close() { this.onclose && this.onclose(); }
  }
  return { FakeWS, sent };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

test('calcul d\'authentification conforme à obs-websocket v5', () => {
  const sha = (s) => crypto.createHash('sha256').update(s).digest('base64');
  const expected = sha(sha('mdp' + 'sel') + 'defi');
  assert.strictEqual(computeAuth('mdp', 'sel', 'defi'), expected);
});

test('liste blanche : aucune requête de modification n\'est autorisée', () => {
  const forbidden = ['SetProfileParameter', 'SetRecordDirectory', 'SetInputAudioTracks', 'CreateInput',
    'RemoveInput', 'SetCurrentProfile', 'SetCurrentSceneCollection', 'CreateScene', 'SetVideoSettings',
    'SetStreamServiceSettings', 'SetInputSettings', 'SetHotkey', 'TriggerHotkeyByName'];
  for (const r of forbidden) {
    assert.strictEqual(isRequestAllowed(r), false, r);
    assert.strictEqual(isRequestAllowed(r, { allowRecordControl: true }), false, r);
  }
  assert.strictEqual(isRequestAllowed('GetRecordStatus'), true);
  assert.strictEqual(isRequestAllowed('StartRecord'), false);
  assert.strictEqual(isRequestAllowed('StartRecord', { allowRecordControl: true }), true);
});

test('une requête interdite n\'est jamais envoyée à OBS', async () => {
  const { FakeWS, sent } = makeFakeObs();
  const w = new ObsWatcher({ WebSocketImpl: FakeWS });
  w.connect();
  await tick();
  await assert.rejects(w.request('SetRecordDirectory', { recordDirectory: 'C:/' }), /refusée/);
  assert.ok(!sent.some((m) => m.op === 6 && m.d.requestType === 'SetRecordDirectory'));
});

test('connexion avec mot de passe + suivi live/enregistrement', async () => {
  const { FakeWS, sent } = makeFakeObs({ auth: { salt: 's', challenge: 'c' } });
  const w = new ObsWatcher({ password: 'pw', WebSocketImpl: FakeWS });
  const events = [];
  for (const e of ['connected', 'streamStarted', 'recordStopped', 'streamStopped']) w.on(e, (d) => events.push([e, d]));
  w.connect();
  await tick();
  const identify = sent.find((m) => m.op === 1);
  assert.strictEqual(identify.d.authentication, computeAuth('pw', 's', 'c'));
  FakeWS.instance.serverSend(5, { eventType: 'StreamStateChanged', eventData: { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' } });
  FakeWS.instance.serverSend(5, { eventType: 'RecordStateChanged', eventData: { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED', outputPath: 'D:/Videos/2026-11-24 20-00-00.mkv' } });
  FakeWS.instance.serverSend(5, { eventType: 'StreamStateChanged', eventData: { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' } });
  await tick();
  assert.deepStrictEqual(events.map((e) => e[0]), ['connected', 'streamStarted', 'recordStopped', 'streamStopped']);
  assert.strictEqual(events[2][1].path, 'D:/Videos/2026-11-24 20-00-00.mkv');
  // Option auto-enregistrement désactivée : Sklip n'a rien lancé.
  assert.ok(!sent.some((m) => m.op === 6 && m.d.requestType === 'StartRecord'));
});

test('option auto-enregistrement : lance puis arrête seulement son propre enregistrement', async () => {
  const { FakeWS, sent } = makeFakeObs();
  const w = new ObsWatcher({ autoRecord: true, WebSocketImpl: FakeWS });
  w.connect();
  await tick();
  FakeWS.instance.serverSend(5, { eventType: 'StreamStateChanged', eventData: { outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' } });
  await tick();
  FakeWS.instance.serverSend(5, { eventType: 'RecordStateChanged', eventData: { outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' } });
  FakeWS.instance.serverSend(5, { eventType: 'StreamStateChanged', eventData: { outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' } });
  await tick();
  const types = sent.filter((m) => m.op === 6).map((m) => m.d.requestType);
  assert.ok(types.includes('StartRecord'));
  assert.ok(types.includes('StopRecord'));
});

test('option auto-enregistrement : ne touche pas un enregistrement lancé par le streamer', async () => {
  const { FakeWS, sent } = makeFakeObs({ recording: true });
  const w = new ObsWatcher({ autoRecord: true, WebSocketImpl: FakeWS });
  w.connect();
  await tick();
  FakeWS.instance.serverSend(5, { eventType: 'StreamStateChanged', eventData: { outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' } });
  FakeWS.instance.serverSend(5, { eventType: 'StreamStateChanged', eventData: { outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' } });
  await tick();
  const types = sent.filter((m) => m.op === 6).map((m) => m.d.requestType);
  assert.ok(!types.includes('StartRecord'));
  assert.ok(!types.includes('StopRecord'));
});

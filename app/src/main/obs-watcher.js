// Sklip — observateur OBS en LECTURE SEULE (obs-websocket v5, intégré à OBS 28+).
//
// Règle du cahier des charges : Sklip ne modifie JAMAIS la configuration OBS
// (profil, scènes, sources, pistes audio, format/dossier d'enregistrement, raccourcis).
// Toutes les requêtes passent par une liste blanche. Toute requête hors liste
// est refusée AVANT d'être envoyée à OBS.

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

// Requêtes de lecture : toujours autorisées.
const READ_ONLY_REQUESTS = new Set([
  'GetVersion',
  'GetStreamStatus',
  'GetRecordStatus',
  'GetRecordDirectory',
  'GetVideoSettings',
  // Où est la webcam dans la scène affichée (lecture seule, voir obs-scenes.js).
  'GetSceneList',
  'GetCurrentProgramScene',
  'GetSceneItemList',
  'GetGroupSceneItemList',
]);

// Requêtes d'action : autorisées seulement si le streamer a coché l'option
// « Lancer l'enregistrement OBS au début du live ». Elles appuient sur le bouton,
// avec les réglages du streamer, sans en changer aucun.
const RECORD_CONTROL_REQUESTS = new Set(['StartRecord', 'StopRecord']);

const OP = { Hello: 0, Identify: 1, Identified: 2, Event: 5, Request: 6, RequestResponse: 7 };
const SUBS = { General: 1 << 0, Scenes: 1 << 2, Outputs: 1 << 6 };

function computeAuth(password, salt, challenge) {
  const sha = (s) => crypto.createHash('sha256').update(s).digest('base64');
  return sha(sha(password + salt) + challenge);
}

function isRequestAllowed(requestType, { allowRecordControl = false } = {}) {
  if (READ_ONLY_REQUESTS.has(requestType)) return true;
  if (allowRecordControl && RECORD_CONTROL_REQUESTS.has(requestType)) return true;
  return false;
}

class ObsWatcher extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} [opts.url]  ex. ws://127.0.0.1:4455
   * @param {string} [opts.password]
   * @param {boolean} [opts.autoRecord] option « Lancer l'enregistrement OBS au début du live »
   * @param {Function} [opts.WebSocketImpl] injecté pour les tests (par défaut : WebSocket natif de Node 22)
   */
  constructor({ url = 'ws://127.0.0.1:4455', password = '', autoRecord = false, WebSocketImpl } = {}) {
    super();
    this.url = url;
    this.password = password;
    this.autoRecord = autoRecord;
    this.WebSocketImpl = WebSocketImpl || globalThis.WebSocket;
    this.ws = null;
    this.identified = false;
    this.pending = new Map();
    this.nextId = 1;
    this.state = { streaming: false, recording: false, recordingStartedBySklip: false, lastRecordingPath: null };
  }

  connect() {
    const ws = new this.WebSocketImpl(this.url, 'obswebsocket.json');
    this.ws = ws;
    ws.onmessage = (ev) => this._onMessage(typeof ev.data === 'string' ? ev.data : String(ev.data));
    ws.onclose = () => {
      this.identified = false;
      for (const { reject } of this.pending.values()) reject(new Error('OBS déconnecté'));
      this.pending.clear();
      this.emit('disconnected');
    };
    ws.onerror = (err) => this.emit('error', err);
  }

  close() {
    if (this.ws) this.ws.close();
  }

  _send(op, d) {
    this.ws.send(JSON.stringify({ op, d }));
  }

  /** Envoie une requête à OBS, seulement si elle est dans la liste blanche. */
  request(requestType, requestData) {
    if (!isRequestAllowed(requestType, { allowRecordControl: this.autoRecord })) {
      return Promise.reject(new Error(`Requête OBS refusée par Sklip (lecture seule) : ${requestType}`));
    }
    if (!this.identified) return Promise.reject(new Error('OBS non connecté'));
    const requestId = String(this.nextId++);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const d = { requestType, requestId };
      if (requestData) d.requestData = requestData;
      this._send(OP.Request, d);
    });
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { op, d } = msg;
    switch (op) {
      case OP.Hello: {
        const identify = { rpcVersion: 1, eventSubscriptions: SUBS.General | SUBS.Scenes | SUBS.Outputs };
        if (d.authentication) {
          identify.authentication = computeAuth(this.password, d.authentication.salt, d.authentication.challenge);
        }
        this._send(OP.Identify, identify);
        break;
      }
      case OP.Identified:
        this.identified = true;
        this.emit('connected');
        this._syncInitialState().catch((e) => this.emit('error', e));
        break;
      case OP.RequestResponse: {
        const p = this.pending.get(d.requestId);
        if (!p) return;
        this.pending.delete(d.requestId);
        if (d.requestStatus && d.requestStatus.result) p.resolve(d.responseData || {});
        else p.reject(new Error(`OBS: ${d.requestType} a échoué (${d.requestStatus && d.requestStatus.comment})`));
        break;
      }
      case OP.Event:
        this._onEvent(d.eventType, d.eventData || {});
        break;
      default:
        break;
    }
  }

  async _syncInitialState() {
    const [stream, record] = await Promise.all([
      this.request('GetStreamStatus'),
      this.request('GetRecordStatus'),
    ]);
    this.state.streaming = !!stream.outputActive;
    this.state.recording = !!record.outputActive;
    this.emit('state', { ...this.state });
    // Sklip ouvert (ou OBS reconnecté) pendant l'enregistrement : on le prend en route. OBS dit depuis combien de
    // temps il enregistre (lecture seule) ; c'est l'heure de début qui cale les moments sur la vidéo.
    if (record.outputActive) {
      const ms = Number(record.outputDuration) || 0;
      this.emit('recordStarted', { at: Date.now() - ms, late: true, since: ms });
    }
  }

  _onEvent(type, data) {
    if (type === 'StreamStateChanged') {
      if (data.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED') {
        this.state.streaming = true;
        this.emit('streamStarted');
        if (this.autoRecord && !this.state.recording) {
          this.request('StartRecord')
            .then(() => { this.state.recordingStartedBySklip = true; })
            .catch((e) => this.emit('error', e));
        }
      } else if (data.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') {
        this.state.streaming = false;
        this.emit('streamStopped');
        // On n'arrête que l'enregistrement que Sklip a lui-même lancé.
        if (this.autoRecord && this.state.recordingStartedBySklip && this.state.recording) {
          this.request('StopRecord').catch((e) => this.emit('error', e));
        }
      }
    } else if (type === 'RecordStateChanged') {
      if (data.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED') {
        this.state.recording = true;
        this.emit('recordStarted', { at: Date.now() });
      } else if (data.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') {
        this.state.recording = false;
        this.state.recordingStartedBySklip = false;
        this.state.lastRecordingPath = data.outputPath || null;
        this.emit('recordStopped', { path: data.outputPath || null, at: Date.now() });
      }
    } else if (type === 'CurrentProgramSceneChanged') {
      this.emit('sceneChanged', { scene: data.sceneName, at: Date.now() });
    } else if (type === 'ExitStarted') {
      this.emit('obsClosing');
    }
  }
}

module.exports = { ObsWatcher, computeAuth, isRequestAllowed, READ_ONLY_REQUESTS, RECORD_CONTROL_REQUESTS };

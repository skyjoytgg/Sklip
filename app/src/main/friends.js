// Amis de confiance : récupérer la réaction d'un pote (sa webcam) sur un ace ou un clutch.
//
// Règle : un pote n'envoie sa webcam QUE si son propre Sklip a vu que vous étiez en chat partagé Twitch
// à ce moment-là (vérifié chez lui, avec ses propres relevés : impossible de tricher avec une fausse heure).
//
// Les deux Sklip passent par le mini-serveur gratuit de Sklip (relay.js), avec leur connexion Twitch :
// rien à créer ni à régler. Côté pote, seule sa webcam est découpée, et seulement sur les secondes
// demandées (jamais toute la VOD) ; son enregistrement OBS est seulement lu. Tout est effacé du serveur
// dès que la réaction est récupérée.

const fs = require('node:fs');
const path = require('node:path');
const { RelayBox } = require('./relay');

const REACTION_TYPES = new Set(['ace', 'clutch']);
const PRESENCE_EVERY = 2 * 60 * 1000;    // Sklip regarde le chat partagé toutes les 2 min pendant le live
const PRESENCE_WINDOW = 3 * 60 * 1000;   // un relevé compte ±3 min autour du moment
const PRESENCE_KEEP = 30 * 86400e3;      // relevés gardés 30 jours
const MARGIN = 5;                        // s ajoutées avant/après (horloges des PC pas parfaitement à l'heure)
const MAX_REQUEST = 90;                  // s maximum par demande

const login = (s) => String(s || '').trim().toLowerCase().replace(/^@/, '');
const safeId = (s) => String(s).replace(/[^\w-]/g, '_');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

/** Amis de confiance vus dans le chat partagé entre `fromMs` et `toMs` (± la fenêtre). */
function friendsTogether(presence, friends, fromMs, toMs = fromMs) {
  const trusted = new Set(friends.map((f) => login(f.login || f)));
  const out = new Set();
  for (const p of presence || []) {
    if (p.at < fromMs - PRESENCE_WINDOW || p.at > toMs + PRESENCE_WINDOW) continue;
    for (const l of p.logins || []) if (trusted.has(login(l))) out.add(login(l));
  }
  return [...out];
}

/** Fenêtre (temps du stream) à demander pour un moment : tous les clips qui le contiennent, plus une marge. */
function momentWindow(session, t) {
  let start = t - 8; let end = t + 6;
  for (const clips of Object.values(session.clips || {})) {
    for (const c of clips) {
      if (c.start <= t && t <= c.end) { start = Math.min(start, c.start); end = Math.max(end, c.end); }
    }
  }
  start = Math.max(0, start - MARGIN);
  end = Math.min(start + MAX_REQUEST, end + MARGIN);
  return { start, end };
}

function makeRequest({ me, to, recordStartMs, start, end, reason, t, now }) {
  const wallStart = Math.round(recordStartMs + start * 1000);
  return {
    id: safeId(`${login(me)}-${login(to)}-${wallStart}`),
    from: login(me), to: login(to), wall_start: wallStart, wall_end: Math.round(recordStartMs + end * 1000),
    reason, created: now,
    local: { stream_start: start, t },   // gardé chez le demandeur seulement (jamais envoyé)
  };
}

/** Demandes automatiques après l'analyse : aces et clutchs où un ami de confiance était en chat partagé. */
function reactionRequests(session, { me, friends, presence, now = Date.now() }) {
  const recordStartMs = session.record_started_at ? session.record_started_at * 1000 : null;
  if (!me || !recordStartMs || !friends.length) return [];
  const out = [];
  const seen = new Set();
  for (const m of session.moments || []) {
    if (!REACTION_TYPES.has(m.type)) continue;
    const at = recordStartMs + m.t * 1000;
    const who = friendsTogether(presence, friends, at);
    if (!who.length) continue;
    const w = momentWindow(session, m.t);
    for (const to of who) {
      const r = makeRequest({ me, to, recordStartMs, ...w, reason: m.type, t: m.t, now });
      if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
    }
  }
  return out;
}

/** Côté pote : l'enregistrement qui contient la période demandée, et où elle tombe dedans. */
function findRecording(recordings, wallStart, wallEnd) {
  let best = null;
  for (const r of recordings || []) {
    const stop = r.stop || Infinity;
    const overlap = Math.min(stop, wallEnd) - Math.max(r.start, wallStart);
    if (overlap > 0 && (!best || overlap > best.overlap)) best = { ...r, overlap };
  }
  if (!best) return null;
  const from = Math.max(best.start, wallStart);
  const to = Math.min(best.stop || wallEnd, wallEnd);
  return { video: best.video, start: (from - best.start) / 1000, duration: (to - from) / 1000, wallStart: from };
}

/** Le service qui tourne dans Sklip : envoie les demandes, y répond, récupère les réactions. */
class FriendService {
  constructor({ getSettings, getLogin, getToken, relayUrl, fetchImpl, engine, dataDir, log,
    notify = () => {}, isRecording = () => false, now = Date.now }) {
    Object.assign(this, { getSettings, getLogin, getToken, relayUrl, fetchImpl, engine, dataDir, log, notify, isRecording, now });
    this.stateFile = path.join(dataDir, 'friends-state.json');
    this.recordingsFile = path.join(dataDir, 'recordings.json');
    this.presenceFile = path.join(dataDir, 'presence.json');
    this.busy = false;
  }

  /** Prêt si le serveur est configuré et que Twitch est connecté. */
  get box() {
    if (!this.relayUrl || !this.getLogin()) return null;
    return new RelayBox({ url: this.relayUrl, getToken: this.getToken, fetchImpl: this.fetchImpl });
  }

  status() {
    if (!this.relayUrl) return { ready: false, reason: 'server' };
    if (!this.getLogin()) return { ready: false, reason: 'twitch' };
    return { ready: true, login: this.getLogin() };
  }

  friends() { return (this.getSettings().friends || []).filter((f) => f.login); }
  state() { return { handled: {}, sent: {}, pending: [], ...readJson(this.stateFile, {}) }; }
  saveState(s) { writeJson(this.stateFile, s); }

  /** Relevés du chat partagé (faits par CE Sklip pendant les lives de son streamer). */
  presence() { return readJson(this.presenceFile, []); }

  recordPresence(logins, at = this.now()) {
    const list = this.presence().filter((p) => at - p.at < PRESENCE_KEEP);
    list.push({ at, logins: logins.map(login) });
    writeJson(this.presenceFile, list);
  }

  /** Étions-nous en chat partagé avec `who` pendant cette période ? (relevés de ce PC uniquement) */
  together(who, fromMs, toMs) {
    return friendsTogether(this.presence(), [who], fromMs, toMs).length > 0;
  }

  /** Chaque enregistrement OBS terminé est noté : on pourra y retrouver un instant demandé par un pote. */
  addRecording(video, start, stop) {
    const list = readJson(this.recordingsFile, []).filter((r) => r.video !== video);
    list.push({ video, start, stop });
    writeJson(this.recordingsFile, list.slice(-200));
  }

  async _send(reqs, folder) {
    const box = this.box;
    if (!box || !reqs.length) return 0;
    const st = this.state();
    let n = 0;
    for (const r of reqs) {
      if (st.sent[r.id]) continue;
      await box.sendRequest(r);
      st.sent[r.id] = { folder, to: r.to, reason: r.reason, ...r.local, wall_start: r.wall_start };
      n++;
    }
    this.saveState(st);
    return n;
  }

  /** Après l'analyse d'un live : demandes automatiques (aces / clutchs en chat partagé). */
  async requestForSession(session) {
    const reqs = reactionRequests(session, { me: this.getLogin(), friends: this.friends(), presence: this.presence(), now: this.now() });
    const n = await this._send(reqs, session.folder);
    if (n) this.log.info(`Amis : ${n} demande(s) de réaction envoyée(s)`);
    return n;
  }

  /** Amis de confiance avec qui on était en chat partagé pendant ce clip (pour le bouton de l'éditeur). */
  friendsForClip(session, clip) {
    const rec = session.record_started_at ? session.record_started_at * 1000 : null;
    if (!rec) return [];
    return friendsTogether(this.presence(), this.friends(), rec + clip.start * 1000, rec + clip.end * 1000);
  }

  /** Depuis l'éditeur : demander à un pote sa réaction sur un clip précis. */
  async requestManual(session, clip, to) {
    const recordStartMs = session.record_started_at ? session.record_started_at * 1000 : null;
    if (!recordStartMs) throw new Error("Ce stream n'a pas été enregistré avec Sklip ouvert : impossible de retrouver l'heure exacte.");
    if (!this.box) throw new Error('Connecte Twitch dans Réglages pour récupérer les réactions de tes potes.');
    if (!this.together(to, recordStartMs + clip.start * 1000, recordStartMs + clip.end * 1000)) {
      throw new Error(`Tu n'étais pas en chat partagé avec ${to} pendant ce clip.`);
    }
    const start = Math.max(0, clip.start - MARGIN);
    const end = Math.min(start + MAX_REQUEST, clip.end + MARGIN);
    const t = (clip.moments && clip.moments[0] && clip.moments[0].t) || (clip.start + clip.end) / 2;
    const r = makeRequest({ me: this.getLogin(), to, recordStartMs, start, end, reason: 'manuel', t, now: this.now() });
    await this._send([r], session.folder);
    return r.id;
  }

  pending() { return this.state().pending; }

  async accept(id) {
    const st = this.state();
    const req = st.pending.find((p) => p.id === id);
    if (!req) return;
    st.pending = st.pending.filter((p) => p.id !== id);
    this.saveState(st);
    await this._answer(req);
  }

  async refuse(id) {
    const st = this.state();
    const req = st.pending.find((p) => p.id === id);
    st.pending = st.pending.filter((p) => p.id !== id);
    st.handled[id] = 'refused';
    this.saveState(st);
    const box = this.box;
    if (req && box) await box.reply({ id, from: req.to, to: req.from, status: 'refused' });
  }

  /** Côté pote : vérifie le chat partagé, découpe la webcam et l'envoie. */
  async _answer(req) {
    const box = this.box;
    if (!box) return;
    const base = { id: req.id, from: req.to, to: req.from };
    const st = this.state();
    let status = 'ok';
    let rec = null;
    if (!this.together(req.from, req.wall_start, req.wall_end)) status = 'not_together';
    else {
      rec = findRecording(readJson(this.recordingsFile, []), req.wall_start, req.wall_end);
      if (!rec || !fs.existsSync(rec.video)) status = 'absent';
    }
    if (status !== 'ok') {
      await box.reply({ ...base, status });
    } else {
      const out = path.join(this.dataDir, 'envois', `${safeId(req.id)}.mp4`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      try {
        const r = await this.engine('friend-extract', { video: rec.video, start: rec.start, duration: rec.duration,
          out, cam: this.getSettings().cam });
        await box.reply({ ...base, status: 'ok', wall_start: Math.round(rec.wallStart), duration: r.duration }, out);
      } finally {
        fs.rmSync(out, { force: true });
      }
      this.log.info(`Amis : réaction envoyée à ${req.from}`);
    }
    st.handled[req.id] = status;
    this.saveState(st);
  }

  /** Côté streamer : importe une réaction reçue dans le dossier du stream, calée sur la piste Discord. */
  async _receive(box, rep, sent) {
    const file = path.join(sent.folder, 'reactions.json');
    const list = readJson(file, []).filter((r) => r.id !== rep.id);
    const entry = { id: rep.id, friend: rep.from, reason: sent.reason, t: sent.t, status: rep.status, received: this.now() };
    if (rep.status === 'ok') {
      const session = readJson(path.join(sent.folder, 'session.json'), {});
      const dest = path.join(sent.folder, 'reactions', `${safeId(rep.id)}.mp4`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await box.download(rep.id, rep.parts, dest);
      // extrait(u) = stream(u + offset). Par les horloges : offset = début de l'extrait - début de l'enregistrement.
      const guess = (rep.wall_start - session.record_started_at * 1000) / 1000;
      const discord = session.tracks && session.tracks.discord;
      const sync = await this.engine('friend-sync', { extract: dest, guess,
        reference: discord ? discord.path : session.video, ref_offset: discord ? discord.offset || 0 : 0 })
        .catch(() => ({ offset: guess, method: 'horloge', confidence: 0 }));
      Object.assign(entry, { file: dest, offset: sync.offset, sync: sync.method, duration: rep.duration });
    }
    list.push(entry);
    writeJson(file, list);
    await box.cleanup(rep.id);
    return entry;
  }

  /** Toutes les minutes : répondre aux demandes reçues, récupérer les réactions arrivées. */
  async tick() {
    const box = this.box;
    if (!box || this.busy) return;
    this.busy = true;
    try {
      const inbox = await box.inbox();
      const friends = new Map(this.friends().map((f) => [login(f.login), f]));
      // 1. Demandes de mes potes.
      for (const req of inbox.filter((m) => m.kind === 'request')) {
        const st = this.state();
        if (st.handled[req.id] || st.pending.some((p) => p.id === req.id)) continue;
        const f = friends.get(login(req.from));
        if (!f) continue;                                   // pas un ami de confiance : ignoré
        if (f.autoAccept === false) {
          st.pending.push(req);
          this.saveState(st);
          this.notify('reaction-request', { from: req.from, reason: req.reason, id: req.id });
          continue;
        }
        if (this.isRecording()) continue;                   // pas de découpe pendant un live : on le fera après
        await this._answer(req);
      }
      // 2. Réponses à mes demandes.
      for (const rep of inbox.filter((m) => m.kind === 'reply')) {
        const st = this.state();
        const sent = st.sent[rep.id];
        if (!sent) continue;
        const entry = await this._receive(box, rep, sent);
        const st2 = this.state();
        delete st2.sent[rep.id];
        this.saveState(st2);
        this.notify('reaction-received', entry);
      }
    } catch (e) {
      this.log.warn('Amis :', e);
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { FriendService, reactionRequests, friendsTogether, findRecording, momentWindow, login, MARGIN, PRESENCE_EVERY };

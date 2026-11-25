// Connexion Twitch : « Se connecter avec Twitch » (Device Code Flow, sans secret),
// API Helix (viewers, clips, VOD) et EventSub WebSocket (raids, chat, début/fin du live).
//
// Une seule application Twitch Developer (celle de Sky), de type « Public ».
// Le Client ID n'est pas secret : il peut être dans l'appli.

const { EventEmitter } = require('node:events');

function loadClientId() {
  if (process.env.SKLIP_TWITCH_CLIENT_ID) return process.env.SKLIP_TWITCH_CLIENT_ID;
  try { return require('../../config.json').twitchClientId || ''; } catch { return ''; }
}
const CLIENT_ID = loadClientId();
const SCOPES = ['user:read:chat'];       // lire le chat via EventSub. Raids, viewers et clips : aucun scope requis.
const ID_URL = 'https://id.twitch.tv/oauth2';
const HELIX = 'https://api.twitch.tv/helix';
const EVENTSUB_WS = 'wss://eventsub.wss.twitch.tv/ws';

const form = (o) => new URLSearchParams(o).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TwitchAuth extends EventEmitter {
  /**
   * @param {object} o
   * @param {Function} [o.fetchImpl]
   * @param {object} [o.store] { load(): tokens|null, save(tokens) } — chiffré par l'appli (safeStorage)
   */
  constructor({ clientId = CLIENT_ID, fetchImpl = globalThis.fetch, store, now = () => Date.now() } = {}) {
    super();
    this.clientId = clientId;
    this.fetch = fetchImpl;
    this.store = store || { load: () => null, save: () => {} };
    this.now = now;
    this.tokens = this.store.load();
  }

  isConnected() { return !!(this.tokens && this.tokens.refresh_token); }

  /** Étape 1 : demande un code à afficher au streamer. */
  async startDeviceLogin() {
    const r = await this.fetch(`${ID_URL}/device`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: this.clientId, scopes: SCOPES.join(' ') }),
    });
    if (!r.ok) throw new Error(`Twitch : impossible de démarrer la connexion (${r.status})`);
    const d = await r.json();
    return { deviceCode: d.device_code, userCode: d.user_code, url: d.verification_uri, interval: d.interval || 5, expiresIn: d.expires_in };
  }

  /** Étape 2 : attend que le streamer valide dans son navigateur. */
  async waitForLogin({ deviceCode, interval = 5, expiresIn = 1800 }, { signal, wait = sleep } = {}) {
    const deadline = this.now() + expiresIn * 1000;
    let delay = interval;
    while (this.now() < deadline) {
      if (signal && signal.aborted) throw new Error('Connexion annulée');
      await wait(delay * 1000);
      const r = await this.fetch(`${ID_URL}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ client_id: this.clientId, scopes: SCOPES.join(' '), device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.access_token) {
        await this._saveTokens(d);
        const user = await this.getUser();
        this.tokens.user = user;
        this.store.save(this.tokens);
        this.emit('connected', user);
        return user;
      }
      const msg = String(d.message || '');
      if (msg.includes('authorization_pending')) continue;
      if (msg.includes('slow_down')) { delay += 5; continue; }
      throw new Error(msg.includes('expired') ? 'Le code a expiré, recommence.' : `Twitch : connexion refusée (${msg || r.status})`);
    }
    throw new Error('Le code a expiré, recommence.');
  }

  async _saveTokens(d) {
    this.tokens = { ...(this.tokens || {}), access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: this.now() + (d.expires_in || 3600) * 1000 };
    this.store.save(this.tokens);
  }

  async refresh() {
    const r = await this.fetch(`${ID_URL}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: this.clientId, grant_type: 'refresh_token', refresh_token: this.tokens.refresh_token }),
    });
    if (!r.ok) {
      this.logout();
      throw new Error('Session Twitch expirée : reconnecte-toi.');
    }
    await this._saveTokens(await r.json());
  }

  async accessToken() {
    if (!this.isConnected()) throw new Error('Pas connecté à Twitch');
    if (!this.tokens.expires_at || this.tokens.expires_at - this.now() < 60_000) await this.refresh();
    return this.tokens.access_token;
  }

  logout() {
    this.tokens = null;
    this.store.save(null);
    this.emit('disconnected');
  }

  /** Appel Helix avec renouvellement automatique du jeton. */
  async helix(path, { method = 'GET', query, body } = {}, retry = true) {
    const url = `${HELIX}${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
    const r = await this.fetch(url, {
      method,
      headers: { 'Client-Id': this.clientId, Authorization: `Bearer ${await this.accessToken()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401 && retry) { await this.refresh(); return this.helix(path, { method, query, body }, false); }
    if (!r.ok) throw new Error(`Twitch API ${path} : ${r.status}`);
    return r.status === 204 ? {} : r.json();
  }

  async getUser() {
    const d = await this.helix('/users');
    const u = d.data[0];
    return { id: u.id, login: u.login, name: u.display_name, avatar: u.profile_image_url };
  }

  async getStream(userId) {
    const d = await this.helix('/streams', { query: { user_id: userId } });
    return d.data[0] || null;  // { viewer_count, started_at, game_name, title } ou null hors live
  }

  /** Catégorie actuelle de la chaîne (« VALORANT », « Just Chatting »…). Information publique, aucun scope requis. */
  async getChannelGame(broadcasterId) {
    const d = await this.helix('/channels', { query: { broadcaster_id: broadcasterId } });
    return (d.data && d.data[0] && d.data[0].game_name) || null;
  }

  /** Tous les clips créés pendant le stream (pagination incluse). */
  async getClips(broadcasterId, startedAt, endedAt) {
    const out = [];
    let cursor;
    do {
      const query = { broadcaster_id: broadcasterId, started_at: startedAt, ended_at: endedAt, first: '100' };
      if (cursor) query.after = cursor;
      const d = await this.helix('/clips', { query });
      out.push(...d.data);
      cursor = d.pagination && d.pagination.cursor;
    } while (cursor && out.length < 1000);
    return out;
  }

  /** Chaînes avec qui on partage le chat en ce moment (pseudos), sans soi-même. Aucun scope requis. */
  async getSharedChatLogins(broadcasterId) {
    const d = await this.helix('/shared_chat/session', { query: { broadcaster_id: broadcasterId } });
    const s = d.data && d.data[0];
    const ids = s ? s.participants.map((p) => p.broadcaster_id).filter((id) => id !== broadcasterId) : [];
    if (!ids.length) return [];
    const u = await this.helix(`/users?${ids.map((id) => `id=${encodeURIComponent(id)}`).join('&')}`);
    return u.data.map((x) => x.login);
  }

  async getVideos(userId, first = 20) {
    const d = await this.helix('/videos', { query: { user_id: userId, type: 'archive', first: String(first) } });
    return d.data;
  }
}

/**
 * Écoute en direct : raids reçus, messages du chat, début/fin du live.
 * Pendant un live, relève aussi le nombre de viewers toutes les minutes.
 */
class TwitchLive extends EventEmitter {
  constructor(auth, { WebSocketImpl = globalThis.WebSocket, viewerInterval = 60_000, url = EVENTSUB_WS } = {}) {
    super();
    this.auth = auth;
    this.WebSocketImpl = WebSocketImpl;
    this.viewerInterval = viewerInterval;
    this.url = url;
    this.session = null;
    this.timer = null;
    this.stopped = false;
    this.data = null;    // relevés du live en cours
  }

  start() {
    this.stopped = false;
    this._connect(this.url);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    if (this.ws) this.ws.close();
  }

  _connect(url) {
    const ws = new this.WebSocketImpl(url);
    this.ws = ws;
    ws.onmessage = (ev) => this._onMessage(JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)), ws);
    ws.onclose = () => { if (!this.stopped && this.ws === ws) setTimeout(() => this._connect(EVENTSUB_WS), 5000); };
    ws.onerror = (e) => this.emit('error', e);
  }

  async _subscribe(sessionId) {
    const uid = this.auth.tokens.user.id;
    const subs = [
      ['stream.online', '1', { broadcaster_user_id: uid }],
      ['stream.offline', '1', { broadcaster_user_id: uid }],
      ['channel.raid', '1', { to_broadcaster_user_id: uid }],
      ['channel.chat.message', '1', { broadcaster_user_id: uid, user_id: uid }],
    ];
    for (const [type, version, condition] of subs) {
      await this.auth.helix('/eventsub/subscriptions', { method: 'POST',
        body: { type, version, condition, transport: { method: 'websocket', session_id: sessionId } } });
    }
    this.emit('ready');
    // Si Sklip est ouvert alors que le live a déjà commencé.
    const stream = await this.auth.getStream(uid);
    if (stream && !this.data) this._beginStream(Date.parse(stream.started_at));
  }

  _onMessage(msg, ws) {
    const type = msg.metadata && msg.metadata.message_type;
    if (type === 'session_welcome') {
      const reconnecting = !!this.session;
      this.session = msg.payload.session;
      if (!reconnecting) this._subscribe(this.session.id).catch((e) => this.emit('error', e));
    } else if (type === 'session_reconnect') {
      const old = ws;
      this._connect(msg.payload.session.reconnect_url);
      setTimeout(() => old.close(), 1000);
    } else if (type === 'notification') {
      this._onEvent(msg.payload.subscription.type, msg.payload.event, msg.metadata.message_timestamp);
    }
  }

  _beginStream(startMs) {
    this.data = { startedAt: startMs, raids: [], chat: [], viewers: [] };
    this.emit('streamOnline', { startedAt: startMs });
    const poll = async () => {
      try {
        const s = await this.auth.getStream(this.auth.tokens.user.id);
        if (s && this.data) this.data.viewers.push({ at: Date.now(), viewers: s.viewer_count, game: s.game_name });
      } catch (e) { this.emit('error', e); }
    };
    poll();
    clearInterval(this.timer);
    this.timer = setInterval(poll, this.viewerInterval);
  }

  _onEvent(subType, ev, at) {
    if (subType === 'stream.online') {
      this._beginStream(Date.parse(ev.started_at || at));
    } else if (subType === 'stream.offline') {
      clearInterval(this.timer);
      const data = this.data;
      this.data = null;
      if (data) this.emit('streamOffline', { ...data, endedAt: Date.parse(at) });
    } else if (!this.data) {
      // hors live : on ignore
    } else if (subType === 'channel.raid') {
      const raid = { at, channel: ev.from_broadcaster_user_name, viewers: ev.viewers };
      this.data.raids.push(raid);
      this.emit('raid', raid);
    } else if (subType === 'channel.chat.message') {
      const m = { at, user: ev.chatter_user_name, text: ev.message.text, badges: (ev.badges || []).map((b) => b.set_id) };
      this.data.chat.push(m);
      if (/^!clip\b/i.test(m.text.trim()) && m.badges.some((b) => b === 'broadcaster' || b === 'moderator')) {
        this.emit('marker', { at, by: m.user });
      }
    }
  }
}

module.exports = { TwitchAuth, TwitchLive, CLIENT_ID, SCOPES };

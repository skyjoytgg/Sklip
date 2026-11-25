// Client du mini-serveur Sklip (dossier relay/ du dépôt) : la boîte aux lettres entre amis de confiance.
// Identité = le jeton Twitch que Sklip a déjà : le streamer n'a rien à créer ni à régler.

const fs = require('node:fs');

const PART = 1_000_000;   // taille des morceaux envoyés (voir MAX_PART du serveur)

const RETRY_DELAYS = [1000, 4000];   // internet qui coupe, serveur surchargé : on réessaie 2 fois

class RelayBox {
  constructor({ url, getToken, fetchImpl = globalThis.fetch, retryDelays = RETRY_DELAYS }) {
    this.url = url.replace(/\/+$/, '');
    this.getToken = getToken;
    this.fetch = fetchImpl;
    this.retryDelays = retryDelays;
  }

  // Toutes les requêtes peuvent être refaites sans risque (le serveur remplace ce qui existe déjà).
  async _call(method, path, body, raw = false) {
    for (let attempt = 0; ; attempt++) {
      let r;
      try {
        r = await this._once(method, path, body);
      } catch (e) {
        if (attempt >= this.retryDelays.length) throw new Error(`Serveur Sklip injoignable (${e.message || e})`);
        await new Promise((ok) => setTimeout(ok, this.retryDelays[attempt]));
        continue;
      }
      if (r.ok) return raw ? new Uint8Array(await r.arrayBuffer()) : r.json();
      if ((r.status >= 500 || r.status === 429) && attempt < this.retryDelays.length) {
        await new Promise((ok) => setTimeout(ok, this.retryDelays[attempt]));
        continue;
      }
      let msg = '';
      try { msg = (await r.json()).error; } catch { /* pas de JSON */ }
      const err = new Error(`Serveur Sklip : ${msg || r.status}`);
      err.status = r.status;
      throw err;
    }
  }

  async _once(method, path, body) {
    const headers = { authorization: `Bearer ${await this.getToken()}` };
    let payload;
    if (body instanceof Uint8Array) { payload = body; headers['content-type'] = 'application/octet-stream'; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    return this.fetch(`${this.url}${path}`, { method, headers, body: payload });
  }

  /** Tous les messages qui me sont adressés (demandes et réponses). */
  async inbox() {
    return (await this._call('GET', '/v1/messages')).map((m) => ({ ...m.body, kind: m.kind, from: m.from, to: m.to }));
  }

  async sendRequest(req) {
    const { local, from, to, id, ...body } = req;   // rien de local n'est envoyé
    await this._call('POST', '/v1/messages', { id: `req-${id}`, kind: 'request', to, body: { id, ...body } });
  }

  /** Réponse, avec l'extrait de webcam envoyé en morceaux. */
  async reply(meta, file) {
    let parts = 0;
    if (file) {
      const buf = fs.readFileSync(file);
      for (let off = 0; off < buf.length; off += PART, parts++) {
        await this._call('PUT', `/v1/files/${encodeURIComponent(meta.id)}/${parts}?to=${encodeURIComponent(meta.to)}`,
          new Uint8Array(buf.subarray(off, off + PART)));
      }
    }
    const { to, from, ...body } = meta;
    await this._call('POST', '/v1/messages', { id: `rep-${meta.id}`, kind: 'reply', to, body: { ...body, parts } });
  }

  async download(id, parts, dest) {
    const chunks = [];
    for (let n = 0; n < parts; n++) chunks.push(await this._call('GET', `/v1/files/${encodeURIComponent(id)}/${n}`, undefined, true));
    fs.writeFileSync(dest, Buffer.concat(chunks.map((c) => Buffer.from(c))));
  }

  /** Une fois la réaction récupérée : tout est effacé du serveur. */
  async cleanup(id) {
    await this._call('DELETE', `/v1/messages/req-${encodeURIComponent(id)}`);
    await this._call('DELETE', `/v1/messages/rep-${encodeURIComponent(id)}`);
    await this._call('DELETE', `/v1/files/${encodeURIComponent(id)}`);
  }
}

module.exports = { RelayBox, PART, RETRY_DELAYS };

// Mini-serveur de Sklip : une boîte aux lettres entre les Sklip des amis de confiance.
//
// - Identité : le jeton Twitch que Sklip a déjà (vérifié auprès de Twitch). Aucun compte à créer.
// - Messages : demandes (« ta webcam entre telle et telle heure ») et réponses, lisibles seulement par
//   l'expéditeur et le destinataire.
// - Fichiers : l'extrait de webcam, en morceaux de 1 Mo, lisible seulement par l'expéditeur et le destinataire.
// - Tout est effacé dès que c'est récupéré, et au bout de 7 jours au plus tard (ménage quotidien).

export const MAX_PART = 1_000_000;       // octets par morceau (limite de taille d'une ligne D1 : 2 Mo)
export const MAX_PARTS = 16;             // 16 Mo max par extrait
export const MAX_BODY = 4096;            // un message, c'est juste quelques heures et un pseudo
export const MAX_PENDING = 200;          // messages en attente par expéditeur
export const TTL_MS = 7 * 86400e3;

const ID = /^[\w-]{1,120}$/;
const LOGIN = /^[a-z0-9_]{1,25}$/;
const KINDS = new Set(['request', 'reply']);

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' },
});
const fail = (status, message) => json({ error: message }, status);

/** Vérifie un jeton Twitch : renvoie le pseudo (en minuscules) ou null. Résultat gardé 10 min. */
export function twitchValidator(env, fetchImpl = fetch, now = Date.now) {
  const cache = new Map();
  return async (token) => {
    if (!token) return null;
    if (env.DEV_FAKE_AUTH === '1' && token.startsWith('dev:')) return token.slice(4).toLowerCase();
    const hit = cache.get(token);
    if (hit && hit.until > now()) return hit.login;
    const r = await fetchImpl('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` } });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.client_id !== env.TWITCH_CLIENT_ID || !d.login) return null;   // seulement les jetons de l'appli Sklip
    const login = String(d.login).toLowerCase();
    if (cache.size > 1000) cache.clear();
    cache.set(token, { login, until: now() + 10 * 60e3 });
    return login;
  };
}

export function createHandler({ store, validate, now = Date.now }) {
  return async function handle(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'v1') return fail(404, 'introuvable');
    const auth = request.headers.get('authorization') || '';
    const me = await validate(auth.replace(/^Bearer\s+/i, '').trim());
    if (!me) return fail(401, 'connexion Twitch invalide');
    const route = `${request.method} ${parts[1] || ''}`;

    if (route === 'GET ping') return json({ ok: true, login: me });

    if (route === 'POST messages') {
      const text = await request.text();
      if (text.length > MAX_BODY + 512) return fail(413, 'message trop long');
      let m;
      try { m = JSON.parse(text); } catch { return fail(400, 'JSON invalide'); }
      const body = JSON.stringify(m.body || {});
      if (!ID.test(m.id || '') || !KINDS.has(m.kind) || !LOGIN.test(m.to || '') || body.length > MAX_BODY) {
        return fail(400, 'message invalide');
      }
      const old = await store.getMessage(m.id);
      if (old && old.from !== me) return fail(409, 'identifiant déjà pris');
      if (!old && (await store.countFrom(me)) >= MAX_PENDING) return fail(429, 'trop de messages en attente');
      await store.putMessage({ id: m.id, kind: m.kind, from: me, to: m.to, body, created: now() });
      return json({ ok: true });
    }

    if (route === 'GET messages') {
      const list = await store.listMessages(me);
      return json(list.map((m) => ({ id: m.id, kind: m.kind, from: m.from, to: m.to, created: m.created, body: JSON.parse(m.body) })));
    }

    if (route === 'DELETE messages' && parts[2]) {
      const m = await store.getMessage(parts[2]);
      if (m && m.from !== me && m.to !== me) return fail(403, 'interdit');
      if (m) await store.deleteMessage(m.id);
      return json({ ok: true });
    }

    if (parts[1] === 'files' && parts[2]) {
      const id = parts[2];
      if (!ID.test(id)) return fail(400, 'identifiant invalide');
      const owner = await store.fileOwner(id);
      if (request.method === 'DELETE') {
        if (owner && owner.from !== me && owner.to !== me) return fail(403, 'interdit');
        if (owner) await store.deleteFile(id);
        return json({ ok: true });
      }
      const n = Number(parts[3]);
      if (!Number.isInteger(n) || n < 0 || n >= MAX_PARTS) return fail(400, 'morceau invalide');
      if (request.method === 'PUT') {
        const to = url.searchParams.get('to') || '';
        if (!LOGIN.test(to)) return fail(400, 'destinataire invalide');
        if (owner && (owner.from !== me || owner.to !== to)) return fail(403, 'interdit');
        const data = new Uint8Array(await request.arrayBuffer());
        if (!data.length || data.length > MAX_PART) return fail(413, 'morceau trop gros');
        await store.putPart({ id, n, from: me, to, data, created: now() });
        return json({ ok: true });
      }
      if (request.method === 'GET') {
        if (!owner || (owner.from !== me && owner.to !== me)) return fail(404, 'introuvable');
        const data = await store.getPart(id, n);
        if (!data) return fail(404, 'introuvable');
        return new Response(data, { headers: { 'content-type': 'application/octet-stream' } });
      }
    }
    return fail(404, 'introuvable');
  };
}

/** Stockage Cloudflare D1 (voir schema.sql). */
export function d1Store(db) {
  const msg = (r) => r && { id: r.id, kind: r.kind, from: r.from_login, to: r.to_login, body: r.body, created: r.created };
  return {
    async getMessage(id) { return msg(await db.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first()); },
    async countFrom(from) { return (await db.prepare('SELECT COUNT(*) AS n FROM messages WHERE from_login = ?').bind(from).first()).n; },
    async putMessage(m) {
      await db.prepare('INSERT OR REPLACE INTO messages (id, kind, from_login, to_login, body, created) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(m.id, m.kind, m.from, m.to, m.body, m.created).run();
    },
    async listMessages(to) {
      const r = await db.prepare('SELECT * FROM messages WHERE to_login = ? ORDER BY created LIMIT 100').bind(to).all();
      return r.results.map(msg);
    },
    async deleteMessage(id) { await db.prepare('DELETE FROM messages WHERE id = ?').bind(id).run(); },
    async fileOwner(id) {
      const r = await db.prepare('SELECT from_login, to_login FROM parts WHERE id = ? LIMIT 1').bind(id).first();
      return r && { from: r.from_login, to: r.to_login };
    },
    async putPart(p) {
      await db.prepare('INSERT OR REPLACE INTO parts (id, n, from_login, to_login, data, created) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(p.id, p.n, p.from, p.to, p.data, p.created).run();
    },
    async getPart(id, n) {
      const r = await db.prepare('SELECT data FROM parts WHERE id = ? AND n = ?').bind(id, n).first();
      return r && new Uint8Array(r.data);
    },
    async deleteFile(id) { await db.prepare('DELETE FROM parts WHERE id = ?').bind(id).run(); },
    async purge(before) {
      await db.batch([db.prepare('DELETE FROM messages WHERE created < ?').bind(before),
        db.prepare('DELETE FROM parts WHERE created < ?').bind(before)]);
    },
  };
}

/** Stockage en mémoire : pour les tests (ceux du serveur et ceux de l'appli). */
export function memoryStore() {
  const messages = new Map();
  const parts = new Map();
  return {
    messages, parts,
    async getMessage(id) { return messages.get(id) || null; },
    async countFrom(from) { return [...messages.values()].filter((m) => m.from === from).length; },
    async putMessage(m) { messages.set(m.id, m); },
    async listMessages(to) { return [...messages.values()].filter((m) => m.to === to).sort((a, b) => a.created - b.created).slice(0, 100); },
    async deleteMessage(id) { messages.delete(id); },
    async fileOwner(id) { const p = [...parts.values()].find((x) => x.id === id); return p ? { from: p.from, to: p.to } : null; },
    async putPart(p) { parts.set(`${p.id}/${p.n}`, p); },
    async getPart(id, n) { const p = parts.get(`${id}/${n}`); return p ? p.data : null; },
    async deleteFile(id) { for (const [k, p] of parts) if (p.id === id) parts.delete(k); },
    async purge(before) {
      for (const [k, m] of messages) if (m.created < before) messages.delete(k);
      for (const [k, p] of parts) if (p.created < before) parts.delete(k);
    },
  };
}

// Point d'entrée Cloudflare Workers du mini-serveur Sklip. Toute la logique est dans relay.js (testée).
import { createHandler, d1Store, twitchValidator, TTL_MS } from './relay.js';

const fail = (status, message) => new Response(JSON.stringify({ error: message }), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' },
});

// Tables créées automatiquement au premier appel : rien à faire à la main.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, kind TEXT NOT NULL, from_login TEXT NOT NULL,
    to_login TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS messages_to ON messages(to_login)',
  'CREATE INDEX IF NOT EXISTS messages_from ON messages(from_login)',
  `CREATE TABLE IF NOT EXISTS parts (id TEXT NOT NULL, n INTEGER NOT NULL, from_login TEXT NOT NULL,
    to_login TEXT NOT NULL, data BLOB NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (id, n))`,
];

async function ensureSchema(db) {
  if (ensureSchema.done) return;
  await db.batch(SCHEMA.map((q) => db.prepare(q)));
  ensureSchema.done = true;
}

let validator = null;

export default {
  async fetch(request, env) {
    validator = validator || twitchValidator(env);
    try {
      await ensureSchema(env.DB);
      return await createHandler({ store: d1Store(env.DB), validate: validator })(request);
    } catch (e) {
      return fail(500, 'erreur du serveur');
    }
  },
  async scheduled(_event, env) {
    await ensureSchema(env.DB);
    await d1Store(env.DB).purge(Date.now() - TTL_MS);
  },
};

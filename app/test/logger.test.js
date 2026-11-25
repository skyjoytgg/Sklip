const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Logger, redact } = require('../src/main/logger');

test('les secrets sont masqués', () => {
  const s = redact({ obs: { url: 'ws://127.0.0.1:4455', password: 'hunter2' }, twitch: { access_token: 'abc' }, n: 3 });
  assert.deepEqual(s, { obs: { url: 'ws://127.0.0.1:4455', password: '***' }, twitch: { access_token: '***' }, n: 3 });
  assert.equal(redact('Authorization: Bearer abc123 ok'), 'Authorization: Bearer *** ok');
  assert.equal(redact('{"password":"x1","a":1}'), '{"password":"***","a":1}');
});

test('journal, nettoyage et rapport', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sklip-log-'));
  const old = path.join(dir, 'sklip-2020-01-01.log');
  fs.writeFileSync(old, 'vieux');
  fs.utimesSync(old, new Date('2020-01-01'), new Date('2020-01-01'));
  const log = new Logger(dir);
  assert.equal(fs.existsSync(old), false);
  log.error('Moteur :', new Error('boom'), { password: 'secret' });
  const out = log.report(dir, { version: '0.1.0', settings: { obs: { password: 'pw' } } });
  const txt = fs.readFileSync(out, 'utf8');
  assert.match(txt, /boom/);
  assert.doesNotMatch(txt, /secret|"pw"/);
  fs.rmSync(dir, { recursive: true, force: true });
});

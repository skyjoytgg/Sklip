const test = require('node:test');
const assert = require('node:assert');
const { Markers } = require('../src/main/markers');

test('raccourci : enregistré, remplacé, refusé', () => {
  const taken = new Set(['F10']);
  const reg = new Map();
  const gs = {
    register: (a, cb) => { if (taken.has(a) || !/^(F\d+|Ctrl\+Shift\+\w)$/.test(a)) return false; reg.set(a, cb); return true; },
    unregister: (a) => reg.delete(a),
  };
  const got = [];
  const mk = new Markers({ onMarker: (m) => got.push(m) });
  assert.equal(mk.setHotkey(gs, 'F9'), true);
  reg.get('F9')();
  assert.equal(got[0].source, 'raccourci');
  assert.equal(mk.setHotkey(gs, 'F10'), false);           // déjà pris
  assert.equal(reg.has('F9'), false);                      // l'ancien est libéré
  assert.equal(mk.hotkey, null);
});

test('Stream Deck : requête locale vers /marker', async () => {
  const got = [];
  const mk = new Markers({ onMarker: (m) => got.push(m) });
  const port = await mk.startHttp(0);
  const r = await fetch(`http://127.0.0.1:${port}/marker`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  assert.equal((await fetch(`http://127.0.0.1:${port}/autre`)).status, 404);
  assert.equal(got.length, 1);
  assert.equal(got[0].source, 'streamdeck');
  mk.stop();
});

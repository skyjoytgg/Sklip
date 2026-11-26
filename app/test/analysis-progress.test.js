const test = require('node:test');
const assert = require('node:assert');
const { percent, remaining } = require('../src/renderer/analysis-progress');

test("avancement de l'analyse : pourcentage et temps restant", () => {
  const t0 = 1_000_000;
  assert.strictEqual(percent({ fraction: 0.423 }), '42 %');
  assert.strictEqual(percent({}), '0 %');
  assert.strictEqual(remaining({ running: false }), '');
  assert.strictEqual(remaining({ running: true, fraction: 0.01, startedAt: t0 }, t0 + 60e3), 'calcul du temps restant…');
  assert.strictEqual(remaining({ running: true, fraction: 0.5, startedAt: t0 }, t0 + 10 * 60e3), 'environ 10 min');
  assert.strictEqual(remaining({ running: true, fraction: 0.9, startedAt: t0 }, t0 + 5 * 60e3), "moins d'une minute");
  assert.strictEqual(remaining({ running: true, fraction: 0.97, startedAt: t0 }, t0 + 60e3), 'presque fini');
  assert.strictEqual(remaining({ running: true, fraction: 0.1, startedAt: t0 }, t0 + 20 * 60e3), 'environ 3 h');
});

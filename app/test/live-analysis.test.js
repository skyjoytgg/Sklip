const test = require('node:test');
const assert = require('node:assert');
const { pickRecordingFile, nextChunk } = require('../src/main/live-analysis');

const T0 = Date.parse('2026-11-24T20:00:00Z');

test("le fichier en cours d'enregistrement est trouvé", () => {
  const files = [
    { name: '2026-11-23 21-00-00.mkv', mtimeMs: T0 - 86400e3 },        // live de la veille
    { name: '2026-11-24 20-00-00.mkv', mtimeMs: T0 + 600e3 },
    { name: 'notes.txt', mtimeMs: T0 + 700e3 },
  ];
  assert.equal(pickRecordingFile(files, T0).name, '2026-11-24 20-00-00.mkv');
  assert.equal(pickRecordingFile(files.slice(0, 1), T0), null);
});

test('morceaux de 60 s minimum, sans les 20 dernières secondes', () => {
  assert.equal(nextChunk(0, 70), null);
  assert.deepEqual(nextChunk(0, 300), { start: 0, duration: 280 });
  assert.deepEqual(nextChunk(280, 600), { start: 280, duration: 300 });
  assert.equal(nextChunk(280, 350), null);
});

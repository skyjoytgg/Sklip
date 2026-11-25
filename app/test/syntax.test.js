// Le processus principal (main.js…) n'est pas chargé par les autres tests (il a besoin d'Electron) :
// on vérifie au moins que chaque fichier se lit sans erreur de syntaxe (sinon Sklip ne démarre plus du tout).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('fichiers du processus principal : pas d’erreur de syntaxe', () => {
  const dir = path.join(__dirname, '..', 'src');
  const files = [...fs.readdirSync(path.join(dir, 'main')).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, 'main', f)),
    path.join(dir, 'preload.js')];
  assert.ok(files.length > 10);
  for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
});

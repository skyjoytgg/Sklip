// Musiques libres de droits (Sky 27/11) : le pack fourni avec Sklip + le dossier « Mes musiques » du streamer
// (Documents/Sklip/Musiques), où il peut glisser les musiques qu'il a le droit d'utiliser.
const fs = require('node:fs');
const path = require('node:path');

const AUDIO = /\.(mp3|ogg|wav|flac|m4a|opus)$/i;

/** Dossier du pack : à côté de l'appli une fois installée, sinon app/music pendant le développement. */
function packDir({ packaged, resourcesPath, appDir }) {
  return packaged ? path.join(resourcesPath, 'music') : path.join(appDir, 'music');
}

const userDir = (root) => path.join(root, 'Musiques');

/** Fichiers audio d'un dossier (et de ses sous-dossiers, un niveau). */
function audioFiles(dir) {
  const out = [];
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of names) {
    const p = path.join(dir, d.name);
    if (d.isFile() && AUDIO.test(d.name)) out.push(p);
    else if (d.isDirectory()) {
      try { for (const n of fs.readdirSync(p)) if (AUDIO.test(n)) out.push(path.join(p, n)); } catch { /* illisible */ }
    }
  }
  return out.sort();
}

/** Crée « Mes musiques » avec une petite note la première fois. */
function ensureUserDir(root) {
  const dir = userDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const note = path.join(dir, 'LISEZ-MOI.txt');
  if (!fs.existsSync(note)) {
    fs.writeFileSync(note, [
      'Mets ici les musiques que tu as le droit d\'utiliser dans tes vidéos (mp3, wav, ogg, m4a, flac).',
      'Sklip les ajoute à tes montages, avec celles de son pack : une seule si elle est assez longue,',
      'sinon plusieurs enchaînées avec un fondu.',
      '',
      'Attention : une musique d\'artiste connu (Spotify, YouTube…) n\'est PAS libre de droits,',
      'même si tu l\'as achetée. Prends des musiques « libres de droits » pour usage commercial',
      '(par ex. licence CC0, ou la bibliothèque audio de YouTube pour YouTube).',
    ].join('\r\n'));
  }
  return dir;
}

module.exports = { packDir, userDir, audioFiles, ensureUserDir, AUDIO };

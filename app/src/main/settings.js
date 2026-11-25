// Réglages de Sklip, stockés dans un fichier JSON du dossier utilisateur de l'appli.
// Rien ici n'est écrit dans OBS.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  obs: { url: 'ws://127.0.0.1:4455', password: '', autoRecord: false },
  analysisMode: 'end_of_stream',        // end_of_stream | live | manual
  themes: ['kills'],
  targetDuration: 30,                    // 15 à 60 s
  formats: ['9x16'],
  cam: { x: 0, y: 0, w: 0.22, h: 0.3 },  // webcam (normalisée), en haut à gauche par défaut, réglable
  audio: {
    captureEnabled: true,
    micDevice: null,
    musicApp: 'Spotify.exe',
    useObsTracksIfPresent: false,
    volumes: { game: 1, mic: 1, discord: 1, music: 0 },
  },
  viewerPeak: { mode: 'record', risePercent: 20, riseMinutes: 3, threshold: 50 },
  chatKeywords: ['LUL', 'KEKW', 'OMEGALUL', 'mdr', 'ptdr'],
  markerHotkey: 'F9',
  retentionDays: 7,
  libraryRoot: null,                     // par défaut : Documents/Sklip
  firstRunDone: false,                   // assistant de départ terminé (ou passé)
  editorTourDone: false,                 // bulles guidées de l'éditeur vues (ou passées)
  pcTest: null,                          // dernier résultat du test du PC
};

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = deepMerge(base[k], over[k]);
  return out;
}

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = DEFAULTS;
    try { this.data = deepMerge(DEFAULTS, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* premier lancement */ }
  }
  get() { return this.data; }
  update(patch) {
    this.data = deepMerge(this.data, patch);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.data;
  }
}

module.exports = { Settings, DEFAULTS, deepMerge };

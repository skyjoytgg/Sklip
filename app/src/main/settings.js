// Réglages de Sklip, stockés dans un fichier JSON du dossier utilisateur de l'appli.
// Rien ici n'est écrit dans OBS.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  obs: { url: 'ws://127.0.0.1:4455', password: '', autoRecord: true },   // enregistrement lancé avec le streaming
  analysisMode: 'end_of_stream',        // end_of_stream | live | manual
  themes: ['kills'],
  targetDuration: 30,                    // 15 à 60 s
  formats: ['9x16'],
  // Webcam : trouvée toute seule dans chaque stream (auto) ; sinon ce rectangle (réglé à la main). Défaut : position de Sky.
  cam: { x: 0.026, y: 0.056, w: 0.224, h: 0.222, enabled: true, auto: true },
  audio: {
    captureEnabled: true,
    micDevice: null,
    musicApp: 'Spotify.exe',               // logiciel de musique capturé à part
    gameApp: 'VALORANT-Win64-Shipping.exe',
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
  editorTourVersion: 0,                  // version du tuto vue (nouvelles étapes montrées seules ensuite)
  pcTest: null,                          // dernier résultat du test du PC
  lastSessionFolder: null,               // dernier stream analysé (ouvert par « Montage »)
  friends: [],                           // amis de confiance (pseudos Twitch) : [{ login, autoAccept }]
  sceneTypes: {},                        // scènes OBS choisies par le streamer : { « Valorant »: 'jeu', « Just Chatting »: 'discussion', … }
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

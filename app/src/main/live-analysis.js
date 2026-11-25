// Analyse pendant le live (mode « Pendant le stream ») : toutes les 5 minutes, Sklip mesure le morceau
// d'enregistrement qui vient d'être écrit. À la fin du live, il ne reste que les dernières minutes à lire.
// Le fichier d'enregistrement est seulement lu. OBS n'est pas modifié (seule requête : GetRecordDirectory).

const fs = require('node:fs');
const path = require('node:path');

const CHUNK_EVERY = 5 * 60 * 1000;   // une mesure toutes les 5 min
const MIN_CHUNK = 60;                // au moins 60 s de vidéo par morceau
const SAFETY = 20;                   // on ne lit pas les 20 dernières secondes (encore en cours d'écriture)
const VIDEO_EXT = new Set(['.mkv', '.mp4', '.mov', '.flv', '.ts']);

/** Le fichier que OBS est en train d'écrire : la vidéo la plus récente, créée après le début de l'enregistrement. */
function pickRecordingFile(files, recordStartMs) {
  const ok = files.filter((f) => VIDEO_EXT.has(path.extname(f.name).toLowerCase()) && f.mtimeMs >= recordStartMs - 10_000);
  return ok.sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
}

/** Prochain morceau à mesurer, ou null s'il est trop court. */
function nextChunk(doneEnd, elapsedSec) {
  const end = elapsedSec - SAFETY;
  return end - doneEnd >= MIN_CHUNK ? { start: doneEnd, duration: end - doneEnd } : null;
}

class LiveAnalyzer {
  constructor({ engine, obs, log, dir, onEvent = () => {} }) {
    Object.assign(this, { engine, obs, log, dir, onEvent });
    this.chunks = [];
    this.doneEnd = 0;
    this.video = null;
    this.timer = null;
    this.running = null;
    this.disabled = false;
  }

  start(recordStartMs) {
    this.recordStartMs = recordStartMs;
    fs.mkdirSync(this.dir, { recursive: true });
    this.timer = setInterval(() => this.tick().catch((e) => this.fail(e)), CHUNK_EVERY);
  }

  fail(e) {
    // Fichier illisible pendant l'écriture (ex. MP4 classique) : on garde tout pour l'après-live.
    this.log.warn('Analyse pendant le live désactivée pour ce live :', e);
    this.onEvent('Analyse pendant le live arrêtée (tout sera lu à la fin)', 'warn');
    this.disabled = true;
  }

  async findVideo() {
    const { recordDirectory } = await this.obs.request('GetRecordDirectory');
    const files = fs.readdirSync(recordDirectory).map((name) => {
      try { return { name, mtimeMs: fs.statSync(path.join(recordDirectory, name)).mtimeMs }; } catch { return null; }
    }).filter(Boolean);
    const f = pickRecordingFile(files, this.recordStartMs);
    return f ? path.join(recordDirectory, f.name) : null;
  }

  async tick() {
    if (this.disabled || this.running) return;
    if (!this.video) this.video = await this.findVideo();
    if (!this.video) return;
    const c = nextChunk(this.doneEnd, (Date.now() - this.recordStartMs) / 1000);
    if (!c) return;
    const out = path.join(this.dir, `chunk-${String(this.chunks.length).padStart(3, '0')}.npz`);
    this.running = this.engine('scan-chunk', { video: this.video, start: c.start, duration: c.duration, out });
    try {
      const r = await this.running;
      if (!r.frames) throw new Error('aucune image lue');
      this.chunks.push(out);
      this.doneEnd = r.end;
      this.log.info(`Analyse pendant le live : ${Math.round(this.doneEnd / 60)} min mesurées`);
      // Sur la frise : le premier morceau, puis toutes les 30 min (pas 1 marque-page toutes les 5 min).
      const half = Math.floor(this.doneEnd / 1800);
      if (this.chunks.length === 1 || half > (this.lastHalf || 0)) this.onEvent(`${Math.round(this.doneEnd / 60)} min déjà analysées`, 'ok');
      this.lastHalf = half;
    } finally {
      this.running = null;
    }
  }

  /** Fin de l'enregistrement : attend le morceau en cours, renvoie les morceaux déjà mesurés. */
  async stop() {
    clearInterval(this.timer);
    if (this.running) await this.running.catch(() => {});
    return { video: this.video, chunks: this.disabled ? [] : this.chunks, doneEnd: this.doneEnd };
  }
}

module.exports = { LiveAnalyzer, pickRecordingFile, nextChunk, CHUNK_EVERY };

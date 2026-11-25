// Journal du live : chaque étape importante d'un enregistrement (capture audio, marqueurs, pote en chat
// partagé, analyse…) est notée avec son heure. L'interface l'affiche en frise avec des marque-pages,
// et chaque étape va aussi dans le journal texte (donc dans « Créer un rapport de bug »).

const fs = require('node:fs');
const path = require('node:path');

const KEEP = 20;   // lives gardés

const TRACK_NAMES = { game: 'Jeu', mic: 'Micro', discord: 'Discord', music: 'Musique' };

/** Résumé des pistes capturées (capture.json du moteur) → une étape du journal. */
function captureEvent(info) {
  if (!info || !info.tracks) return { label: 'Capture audio : aucune piste', level: 'error' };
  const parts = [];
  let ok = 0;
  for (const [name, t] of Object.entries(info.tracks)) {
    const good = !!(t.source && !t.error);
    if (good) ok++;
    parts.push(`${TRACK_NAMES[name] || name} ${good ? '✓' : `✗${t.error ? ` (${t.error})` : ' (pas de son trouvé)'}`}`);
  }
  const mic = info.tracks.mic && info.tracks.mic.source && !info.tracks.mic.error;
  return { label: `Capture audio : ${ok} piste${ok > 1 ? 's' : ''}`, detail: parts.join(' · '),
    level: ok === 0 ? 'error' : mic ? 'ok' : 'warn' };
}

class LiveJournal {
  constructor({ dir, log, now = Date.now, onChange = () => {} }) {
    Object.assign(this, { dir, log, now, onChange });
    this.current = null;
    fs.mkdirSync(dir, { recursive: true });
  }

  file(id) { return path.join(this.dir, `live-${id}.json`); }

  /** Début d'un enregistrement OBS. */
  start(at = this.now()) {
    this.current = { id: at, start: at, stop: null, events: [] };
    this.add('record', 'Enregistrement OBS démarré', { at });
    this.cleanup();
  }

  /** Fin de l'enregistrement (les étapes suivantes, comme l'analyse, restent dans ce live). */
  stop(at = this.now(), detail) {
    if (!this.current) return;
    this.current.stop = at;
    this.add('record', 'Enregistrement OBS arrêté', { at, detail });
  }

  /** Ajoute une étape. level : ok | warn | error. */
  add(kind, label, { detail = '', level = 'ok', at = this.now() } = {}) {
    if (!this.current) return null;
    const ev = { at, kind, label, detail, level };
    this.current.events.push(ev);
    const line = `Journal du live : ${label}${detail ? ` — ${detail}` : ''}`;
    if (this.log) (level === 'error' ? this.log.error : level === 'warn' ? this.log.warn : this.log.info).call(this.log, line);
    this.save();
    this.onChange(this.current);
    return ev;
  }

  save() {
    const tmp = `${this.file(this.current.id)}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.current));
      fs.renameSync(tmp, this.file(this.current.id));
    } catch { /* disque plein : la frise sera incomplète, pas grave */ }
  }

  /** Les derniers lives, du plus récent au plus ancien : [{ id, start, stop, count, problems }]. */
  list() {
    return this.ids().map((id) => {
      const j = this.get(id);
      return j && { id: j.id, start: j.start, stop: j.stop, count: j.events.length,
        problems: j.events.filter((e) => e.level !== 'ok').length };
    }).filter(Boolean);
  }

  get(id) {
    if (this.current && this.current.id === Number(id)) return this.current;
    try { return JSON.parse(fs.readFileSync(this.file(id), 'utf8')); } catch { return null; }
  }

  ids() {
    let files = [];
    try { files = fs.readdirSync(this.dir); } catch { /* dossier absent */ }
    return files.map((f) => /^live-(\d+)\.json$/.exec(f)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => b - a);
  }

  cleanup() {
    for (const id of this.ids().slice(KEEP)) fs.rmSync(this.file(id), { force: true });
  }
}

module.exports = { LiveJournal, captureEvent };

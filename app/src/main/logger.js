// Journal de Sklip : un fichier par jour dans <dossier de l'appli>/logs, gardé 7 jours.
// Sert à comprendre un bug chez un pote : « Créer un rapport de bug » rassemble tout dans un seul fichier texte,
// sans mot de passe ni jeton (masqués automatiquement).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const KEEP_DAYS = 7;
const SECRET_KEYS = /pass(word)?|token|secret|authorization|cookie|client_?secret/i;

/** Masque les secrets dans un texte ou un objet (avant d'écrire dans le journal ou le rapport). */
function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value
      .replace(/(oauth:|Bearer\s+)[\w-]+/gi, '$1***')
      .replace(/("?(?:password|access_token|refresh_token|token)"?\s*[:=]\s*"?)[^"&\s,}]+/gi, '$1***');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) && v ? '***' : redact(v)]));
  }
  return value;
}

function fmt(arg) {
  if (arg instanceof Error) return `${arg.message}\n${arg.stack || ''}`;
  if (typeof arg === 'object') { try { return JSON.stringify(redact(arg)); } catch { return String(arg); } }
  return redact(String(arg));
}

class Logger {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.cleanup();
  }

  file(d = new Date()) { return path.join(this.dir, `sklip-${d.toISOString().slice(0, 10)}.log`); }

  write(level, ...args) {
    const line = `${new Date().toISOString()} [${level}] ${args.map(fmt).join(' ')}\n`;
    try { fs.appendFileSync(this.file(), line); } catch { /* disque plein : tant pis pour le journal */ }
  }

  info(...a) { this.write('info', ...a); }
  warn(...a) { this.write('warn', ...a); }
  error(...a) { this.write('erreur', ...a); }

  /** Supprime les journaux de plus de KEEP_DAYS jours (uniquement les fichiers sklip-*.log de ce dossier). */
  cleanup(now = Date.now()) {
    for (const f of fs.readdirSync(this.dir)) {
      if (!/^sklip-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const p = path.join(this.dir, f);
      if (now - fs.statSync(p).mtimeMs > KEEP_DAYS * 86400e3) fs.rmSync(p, { force: true });
    }
  }

  /** Écrit un rapport (infos du PC, réglages sans secrets, journaux récents) et renvoie son chemin. */
  report(outDir, { version, settings } = {}) {
    const logs = fs.readdirSync(this.dir).filter((f) => f.endsWith('.log')).sort();
    const parts = [
      `Rapport de bug Sklip — ${new Date().toLocaleString('fr-FR')}`,
      `Version : ${version || '?'} · Windows ${os.release()} · ${os.cpus()[0]?.model || '?'} · ${Math.round(os.totalmem() / 2 ** 30)} Go`,
      '', '=== Réglages (mots de passe masqués) ===', JSON.stringify(redact(settings || {}), null, 2),
      ...logs.flatMap((f) => ['', `=== ${f} ===`, fs.readFileSync(path.join(this.dir, f), 'utf8').slice(-400000)]),
    ];
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `sklip-rapport-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`);
    fs.writeFileSync(out, redact(parts.join('\n')));
    return out;
  }
}

module.exports = { Logger, redact, KEEP_DAYS };

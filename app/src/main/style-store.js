// Montages observés (voir src/renderer/style-model.js), gardés dans le dossier de Sklip : style.json.
const fs = require('node:fs');
const path = require('node:path');

const KEEP = 60;

class StyleStore {
  constructor(file) {
    this.file = file;
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.data = { montages: {} }; }
    if (!this.data.montages) this.data.montages = {};
  }
  all() { return this.data.montages; }
  /** Un montage retouché : remplace l'observation précédente du même montage (sauvegardé à chaque changement). */
  record(key, observation) {
    delete this.data.montages[key];               // remis en dernier : les plus récents comptent
    this.data.montages[key] = { ...observation, at: Date.now() };
    const keys = Object.keys(this.data.montages);
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete this.data.montages[k];
    this.save();
  }
  reset() { this.data = { montages: {} }; this.save(); }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }
}

module.exports = { StyleStore };

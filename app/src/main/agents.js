// Images officielles des agents Valorant (Riot, contenu de fan gratuit), récupérées sur valorant-api.com.
// - icônes : pour reconnaître qui parle dans le vocal du jeu (moteur, voicechat.py) ;
// - grands portraits détourés : affichés en grand sur la vidéo avec la réplique (téléchargés seulement au besoin).
// Tout est rangé dans <données de Sklip>/agents ; la liste est rafraîchie toutes les 2 semaines (nouveaux agents).

const fs = require('node:fs');
const path = require('node:path');

const API = 'https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=fr-FR';
const REFRESH = 14 * 86400e3;
const okUuid = (u) => /^[0-9a-f-]{36}$/i.test(String(u));

class Agents {
  constructor(dir, { fetchImpl = globalThis.fetch, crop = null } = {}) {
    this.dir = dir;
    this.fetch = fetchImpl;
    this.crop = crop;          // (buffer PNG) → { png, width, height } : retire le vide autour de l'agent (Electron)
    this.pending = null;
  }

  _read() {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, 'agents.json'), 'utf8')); } catch { return null; }
  }

  async _download(url, file) {
    const r = await this.fetch(url);
    if (!r.ok) throw new Error(`Téléchargement impossible (${r.status})`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(file, buf);
    return buf;
  }

  /** Liste + icônes à jour. Renvoie le dossier (pour le moteur), ou null sans connexion et sans copie locale. */
  async ensureIcons() {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      fs.mkdirSync(this.dir, { recursive: true });
      let data = this._read();
      const stale = !data || !data.at || Date.now() - data.at > REFRESH;
      if (stale) {
        try {
          const r = await this.fetch(API);
          if (!r.ok) throw new Error(String(r.status));
          const json = await r.json();
          data = { at: Date.now(), data: (json.data || []).filter((a) => okUuid(a.uuid)).map((a) => ({
            uuid: a.uuid, displayName: a.displayName, displayIcon: a.displayIcon, fullPortrait: a.fullPortrait,
            role: a.role ? a.role.displayName : null })) };
          fs.writeFileSync(path.join(this.dir, 'agents.json'), JSON.stringify(data));
        } catch (e) {
          if (!data) return null;           // pas de connexion : on garde l'ancienne liste si elle existe
        }
      }
      for (const a of data.data) {
        const f = path.join(this.dir, `icon_${a.uuid}.png`);
        if (!fs.existsSync(f) && a.displayIcon) await this._download(a.displayIcon, f).catch(() => {});
      }
      return this.dir;
    })().finally(() => { this.pending = null; });
    return this.pending;
  }

  /** [{ uuid, name, role }] triés par nom (liste de l'éditeur). */
  list() {
    const d = this._read();
    return d ? d.data.map((a) => ({ uuid: a.uuid, name: a.displayName, role: a.role }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')) : [];
  }

  /** Grand portrait détouré de l'agent : { file, width, height } (téléchargé la première fois). */
  async portrait(uuid) {
    if (!okUuid(uuid)) return null;
    const file = path.join(this.dir, `portrait_${uuid}.png`);
    const meta = `${file}.json`;
    if (fs.existsSync(file) && fs.existsSync(meta)) return { file, ...JSON.parse(fs.readFileSync(meta, 'utf8')) };
    const a = (this._read() || { data: [] }).data.find((x) => x.uuid === uuid);
    if (!a || !a.fullPortrait) return null;
    fs.mkdirSync(this.dir, { recursive: true });
    const buf = await this._download(a.fullPortrait, file);
    let size = { width: 0, height: 0 };
    if (this.crop) {
      const c = this.crop(buf);
      if (c && c.png) { fs.writeFileSync(file, c.png); size = { width: c.width, height: c.height }; }
    }
    fs.writeFileSync(meta, JSON.stringify(size));
    return { file, ...size };
  }
}

/** Retire les bords transparents d'un PNG avec nativeImage d'Electron (les portraits ont beaucoup de vide). */
function cropTransparent(nativeImage, buf) {
  const img = nativeImage.createFromBuffer(buf);
  const { width, height } = img.getSize();
  const px = img.toBitmap();          // BGRA
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (px[(y * width + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { png: buf, width, height };
  const rect = { x: x0, y: y0, width: Math.min(width - x0, x1 - x0 + 2), height: Math.min(height - y0, y1 - y0 + 2) };
  const out = img.crop(rect);
  return { png: out.toPNG(), width: rect.width, height: rect.height };
}

module.exports = { Agents, cropTransparent, API };

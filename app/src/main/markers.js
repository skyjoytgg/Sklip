// Marqueurs pendant le live : « garde ce moment ! ».
// - un raccourci clavier global (F9 par défaut, réglable) ;
// - pour le Stream Deck : une touche « Raccourci » qui envoie le même raccourci, ou une touche
//   « Site web / Requête » vers http://127.0.0.1:47811/marker (accessible seulement depuis ce PC).

const http = require('node:http');

const HTTP_PORT = 47811;

class Markers {
  constructor({ onMarker, log } = {}) {
    this.onMarker = onMarker || (() => {});
    this.log = log || { info() {}, warn() {} };
    this.hotkey = null;
    this.server = null;
  }

  add(source) {
    const m = { at: Date.now(), source };
    this.onMarker(m);
    return m;
  }

  /** (Ré)enregistre le raccourci global. Renvoie false si le raccourci est invalide ou déjà pris. */
  setHotkey(globalShortcut, accel) {
    if (this.hotkey) { try { globalShortcut.unregister(this.hotkey); } catch { /* déjà libéré */ } }
    this.hotkey = null;
    if (!accel) return true;
    let ok = false;
    try { ok = globalShortcut.register(accel, () => this.add('raccourci')); } catch { ok = false; }
    if (ok) this.hotkey = accel;
    else this.log.warn(`Raccourci marqueur « ${accel} » impossible (invalide ou déjà utilisé par un autre logiciel).`);
    return ok;
  }

  /** Petit serveur local pour le Stream Deck. N'écoute que 127.0.0.1 : rien n'est accessible depuis Internet. */
  startHttp(port = HTTP_PORT) {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/marker' && (req.method === 'GET' || req.method === 'POST')) {
          const m = this.add('streamdeck');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, at: m.at }));
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Sklip : utilise /marker');
        }
      });
      this.server.on('error', (e) => { this.log.warn('Serveur marqueur indisponible :', e.message); resolve(false); });
      this.server.listen(port, '127.0.0.1', () => resolve(this.server.address().port));
    });
  }

  stop(globalShortcut) {
    if (globalShortcut && this.hotkey) { try { globalShortcut.unregister(this.hotkey); } catch { /* rien */ } }
    if (this.server) this.server.close();
  }
}

module.exports = { Markers, HTTP_PORT };

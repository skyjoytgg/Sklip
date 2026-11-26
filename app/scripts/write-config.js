// Prépare config.json (embarqué dans l'appli) au moment de construire l'installeur sur GitHub Actions.
// On part du config.json du dépôt (Client ID Twitch public, adresse du serveur des réactions) ;
// les variables du dépôt SKLIP_TWITCH_CLIENT_ID / SKLIP_RELAY_URL, si elles existent, le remplacent.
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '..', 'config.json');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* pas de fichier : on le crée */ }
if (process.env.SKLIP_TWITCH_CLIENT_ID) cfg.twitchClientId = process.env.SKLIP_TWITCH_CLIENT_ID;
if (process.env.SKLIP_RELAY_URL) cfg.relayUrl = process.env.SKLIP_RELAY_URL;
if (!cfg.twitchClientId) console.warn('Attention : pas de Client ID Twitch, la connexion Twitch ne marchera pas.');
if (!cfg.relayUrl) console.warn('Attention : pas d\'adresse de serveur, les réactions des potes ne marcheront pas.');
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');

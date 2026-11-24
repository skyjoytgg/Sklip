// Écrit config.json (embarqué dans l'appli) avec le Client ID Twitch fourni par GitHub Actions.
const fs = require('node:fs');
const path = require('node:path');
const clientId = process.env.SKLIP_TWITCH_CLIENT_ID || '';
if (!clientId) console.warn('Attention : SKLIP_TWITCH_CLIENT_ID est vide, la connexion Twitch ne marchera pas.');
fs.writeFileSync(path.join(__dirname, '..', 'config.json'), JSON.stringify({ twitchClientId: clientId }, null, 2));

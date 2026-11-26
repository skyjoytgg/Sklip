// Messages du chat qui ne viennent pas d'un viewer : bots (WizeBot, Nightbot…) et commandes « !… ».
// Ils ne sont jamais proposés en bulle sur la vidéo.

const KNOWN_BOTS = new Set([
  'wizebot', 'nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'soundalerts', 'sery_bot',
  'botisimo', 'kofistreambot', 'commanderroot', 'deepbot', 'phantombot', 'coebot', 'ankhbot', 'vivbot',
  'blerp', 'pretzelrocks', 'streamstickers', 'tangiabot', 'own3d', 'buttsbot', 'pokemoncommunitygame',
]);

/** Pseudo d'un bot : liste connue, ou pseudo qui finit par « bot » (« MonSuperBot », « xyz_bot »). */
function isBot(user) {
  const u = String(user || '').trim().toLowerCase();
  return !!u && (KNOWN_BOTS.has(u) || /bot$/.test(u));
}

/** Texte lisible : retire l'enrobage « /me » (\u0001ACTION … \u0001) et les caractères invisibles. */
function cleanChatText(text) {
  return String(text || '')
    .replace(/^\u0001ACTION\s*/, '').replace(/\u0001$/, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .trim();
}

/** Un message à garder pour les bulles : écrit par un viewer, pas une commande. */
function isViewerMessage(m) {
  if (!m || isBot(m.user)) return false;
  const t = cleanChatText(m.text);
  return !!t && !t.startsWith('!');
}

module.exports = { isBot, cleanChatText, isViewerMessage };

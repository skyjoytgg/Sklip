// « Vérifier avant le live » : un tour rapide de tout ce dont Sklip a besoin, juste avant de lancer le live.
// Tout est LU (OBS en lecture seule, liste des logiciels ouverts, place sur le disque) ; seul le micro est
// essayé 2 secondes par la capture de Sklip (fichier temporaire supprimé ensuite).
// Chaque ligne : { id, label, level: 'ok' | 'warn' | 'error' | 'info', detail }.

const GB = 1024 ** 3;
const DISK_ERROR = 10 * GB;    // moins de 10 Go : un live de quelques heures peut ne pas tenir
const DISK_WARN = 30 * GB;

const ZONE_TEXT = { score: 'le score en haut', kill: 'la bannière des kills', spectate: "l'icône de spectateur" };

/**
 * deps : {
 *   obsConnected: bool, scenes: () => [...] (readScenes), recordDir: () => string | null,
 *   freeBytes: (dir) => number | null, micTest: () => { ok, error }, running: () => Set<string> (exe en minuscules),
 *   twitchConnected: bool, hotkey: string | null, streamDeck: bool, settings
 * }
 */
async function runPrecheck(d) {
  const s = d.settings;
  const out = [];
  const add = (id, label, level, detail = '') => out.push({ id, label, level, detail });
  const safe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };

  // 1. OBS
  if (!d.obsConnected) {
    add('obs', 'OBS', 'error', "Pas connecté : ouvre OBS, puis Outils → Paramètres du serveur WebSocket → « Activer ».");
  } else {
    add('obs', 'OBS', 'ok', 'Connecté (lecture seule : Sklip ne touche à rien).');
    // 2. Scènes et overlays
    const scenes = await safe(d.scenes, null);
    if (!scenes) {
      add('scenes', 'Scènes OBS', 'warn', 'Impossible de lire tes scènes.');
    } else {
      const jeu = scenes.filter((x) => x.type === 'jeu');
      const disc = scenes.filter((x) => x.type === 'discussion');
      if (!jeu.length) add('scenes', 'Scènes OBS', 'warn', "Aucune scène de jeu : vérifie « Tes scènes OBS » dans les Réglages.");
      else add('scenes', 'Scènes OBS', 'ok', `Jeu : ${jeu.map((x) => x.name).join(', ')}${disc.length ? ` · Discussion : ${disc.map((x) => x.name).join(', ')}` : ''}`);
      for (const sc of jeu) {
        for (const o of sc.overlays || []) {
          add(`overlay-${sc.name}-${o.name}`, `Overlay « ${o.name} »`, 'warn',
            `Dans « ${sc.name} », il cache ${o.zones.map((z) => ZONE_TEXT[z] || z).join(' et ')} : des moments peuvent être ratés.`);
        }
      }
    }
    // 3. Place pour l'enregistrement
    const dir = await safe(d.recordDir, null);
    const free = dir ? await safe(() => d.freeBytes(dir), null) : null;
    if (free == null) add('disk', "Disque de l'enregistrement", 'info', "Place libre inconnue.");
    else {
      const gb = Math.floor(free / GB);
      const level = free < DISK_ERROR ? 'error' : free < DISK_WARN ? 'warn' : 'ok';
      add('disk', "Disque de l'enregistrement", level, `${gb} Go libres${level === 'ok' ? '' : ' : fais de la place avant un long live'}.`);
    }
  }

  // 4. Pistes audio
  if (!s.audio || !s.audio.captureEnabled) {
    add('audio', 'Pistes audio', 'warn', 'Capture désactivée dans les Réglages : pas de micro / Discord séparés dans les clips.');
  } else {
    const mic = await safe(d.micTest, { ok: false, error: 'essai impossible' });
    add('mic', 'Micro', mic.ok ? 'ok' : 'error', mic.ok ? 'Capté (essai de 2 secondes).' : `Pas capté${mic.error ? ` (${mic.error})` : ''} : vérifie ton micro par défaut dans Windows.`);
    const procs = await safe(d.running, new Set());
    const isOn = (names) => names.some((n) => procs.has(String(n).toLowerCase()));
    const apps = [
      ['game', 'Son du jeu', [s.audio.gameApp || 'VALORANT-Win64-Shipping.exe'], 'Valorant'],
      ['discord', 'Discord', ['Discord.exe', 'DiscordPTB.exe', 'DiscordCanary.exe'], 'Discord'],
      ['music', 'Musique', [s.audio.musicApp || 'Spotify.exe'], (s.audio.musicApp || 'Spotify.exe').replace(/\.exe$/i, '')],
    ];
    for (const [id, label, names, name] of apps) {
      add(id, label, isOn(names) ? 'ok' : 'info', isOn(names) ? `${name} ouvert : son capté.`
        : `${name} pas encore ouvert : Sklip le captera dès que tu le lances.`);
    }
  }

  // 5. Twitch, marqueurs, analyse
  add('twitch', 'Twitch', d.twitchConnected ? 'ok' : 'warn', d.twitchConnected ? 'Connecté : raids, chat, catégorie et clips des viewers.'
    : 'Pas connecté : pas de raids, de chat ni de clips des viewers (Réglages → Twitch).');
  const marks = [d.hotkey && `touche ${d.hotkey}`, d.streamDeck && 'Stream Deck'].filter(Boolean);
  add('markers', 'Marqueurs', marks.length ? 'ok' : 'warn', marks.length ? `Prêts : ${marks.join(' et ')}.`
    : 'Ni raccourci ni Stream Deck disponibles : utilise le bouton de Sklip.');
  if (s.obs) {
    add('record', 'Enregistrement', s.obs.autoRecord ? 'ok' : 'warn', s.obs.autoRecord
      ? 'Démarre tout seul avec le streaming, et s\'arrête à la fin.'
      : "Pense à cliquer « Démarrer l'enregistrement » dans OBS (ou coche « Enregistrer tout seul » dans les Réglages).");
  }
  add('analysis', 'Analyse', s.analysisMode === 'manual' ? 'warn' : 'ok', s.analysisMode === 'manual'
    ? "Mode manuel : rien ne sera analysé tout seul à la fin." : s.analysisMode === 'live' ? 'Pendant le live, puis à la fin.' : 'Automatique à la fin du live.');
  return out;
}

/** Résumé : « Tout est prêt », « 2 points à vérifier »… */
function verdict(rows) {
  const errors = rows.filter((r) => r.level === 'error').length;
  const warns = rows.filter((r) => r.level === 'warn').length;
  if (errors) return { level: 'error', text: `${errors} problème${errors > 1 ? 's' : ''} à régler avant le live` };
  if (warns) return { level: 'warn', text: `Prêt, ${warns} point${warns > 1 ? 's' : ''} à vérifier` };
  return { level: 'ok', text: 'Tout est prêt, bon live !' };
}

module.exports = { runPrecheck, verdict, DISK_ERROR, DISK_WARN };

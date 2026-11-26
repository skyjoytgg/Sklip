// Transforme les données Twitch (raids, viewers, chat, clips) en moments Sklip.
// Fonctions pures, testées dans test/twitch.test.js.
// Tous les temps sont en secondes depuis le début du live (« temps du stream »).

const { isViewerMessage, cleanChatText } = require('./chat-bots');

const BASE_CHAT_KEYWORDS = ['LUL', 'KEKW', 'OMEGALUL', 'LULW', 'ICANT', 'Kappa', 'PogChamp', 'Pog', 'PogU', 'WutFace'];

const toStreamTime = (isoOrMs, streamStartMs) =>
  ((typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs)) - streamStartMs) / 1000;

/** Raids reçus → moments. raids = [{ at, channel, viewers }] */
function raidMoments(raids, streamStartMs) {
  return raids.map((r) => ({
    type: 'raid', t: toStreamTime(r.at, streamStartMs),
    meta: { channel: r.channel, viewers: r.viewers },
  }));
}

/**
 * Peaks de viewers. samples = [{ at, viewers }] (relevés toutes les ~60 s).
 * mode : 'record' (le maximum du stream), 'rise' (+risePercent % en riseMinutes), 'threshold' (passage d'un seuil).
 */
function viewerPeakMoments(samples, streamStartMs, opts = {}) {
  const { mode = 'record', risePercent = 20, riseMinutes = 3, threshold = 50 } = opts;
  const pts = samples.map((s) => ({ t: toStreamTime(s.at, streamStartMs), v: s.viewers })).sort((a, b) => a.t - b.t);
  if (!pts.length) return [];
  if (mode === 'record') {
    const best = pts.reduce((a, b) => (b.v > a.v ? b : a));
    return [{ type: 'viewer_peak', t: best.t, meta: { viewers: best.v, mode } }];
  }
  const out = [];
  if (mode === 'threshold') {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i - 1].v < threshold && pts[i].v >= threshold) {
        out.push({ type: 'viewer_peak', t: pts[i].t, meta: { viewers: pts[i].v, mode, threshold } });
      }
    }
    return out;
  }
  // mode 'rise' : hausse rapide. Un seul moment par montée (on attend la redescente).
  let armed = true;
  for (let i = 0; i < pts.length; i++) {
    const windowStart = pts[i].t - riseMinutes * 60;
    const base = Math.min(...pts.filter((p) => p.t >= windowStart && p.t <= pts[i].t).map((p) => p.v));
    const rising = base > 0 && (pts[i].v - base) / base * 100 >= risePercent;
    if (rising && armed) {
      out.push({ type: 'viewer_peak', t: pts[i].t, meta: { viewers: pts[i].v, from: base, mode } });
      armed = false;
    } else if (!rising) {
      armed = true;
    }
  }
  return out;
}

/** Le message contient-il un mot-clé ? Emotes : mot exact (sensible à la casse). Mots perso : insensible. */
function matchesKeywords(text, customKeywords = []) {
  const words = text.split(/\s+/);
  if (words.some((w) => BASE_CHAT_KEYWORDS.includes(w))) return true;
  const low = text.toLowerCase();
  return customKeywords.some((k) => {
    const kw = k.toLowerCase();
    return words.includes(k) || new RegExp(`(^|[^\\p{L}])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(low);
  });
}

/**
 * Pics de chat : fenêtres de `bucket` secondes ; un pic = beaucoup plus de messages « réaction »
 * que d'habitude (moyenne + 3 écarts-types, et au moins `minCount`).
 * messages = [{ at, text }]
 */
function chatSpikeMoments(messages, streamStartMs, { keywords = [], bucket = 10, minCount = 4 } = {}) {
  const hits = messages.filter((m) => matchesKeywords(m.text, keywords)).map((m) => toStreamTime(m.at, streamStartMs));
  if (!hits.length) return [];
  const n = Math.floor(Math.max(...hits) / bucket) + 1;
  const counts = new Array(n).fill(0);
  hits.forEach((t) => { if (t >= 0) counts[Math.floor(t / bucket)]++; });
  const mean = counts.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(counts.reduce((a, c) => a + (c - mean) ** 2, 0) / n);
  const limit = Math.max(minCount, mean + 3 * sd);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (counts[i] >= limit && !(i > 0 && counts[i - 1] >= limit)) {
      // Le moment drôle a eu lieu un peu avant la réaction du chat.
      out.push({ type: 'chat_spike', t: Math.max(0, i * bucket - 3), meta: { count: counts[i], intensity: Math.round(counts[i] / Math.max(1, mean)) } });
    }
  }
  return out;
}

/** Commande `!clip` du streamer ou d'un modérateur → marqueur. messages = [{ at, text, badges: ['moderator'] }] */
function chatMarkerMoments(messages, streamStartMs) {
  return messages
    .filter((m) => /^!clip\b/i.test(m.text.trim()))
    .filter((m) => (m.badges || []).some((b) => b === 'broadcaster' || b === 'moderator'))
    .map((m) => ({ type: 'marker', t: Math.max(0, toStreamTime(m.at, streamStartMs) - 2), meta: { source: '!clip', by: m.user } }));
}

/**
 * Clips créés par les viewers (API Get Clips). `vod_offset` donne la position exacte dans la VOD ;
 * sinon on estime depuis la date de création (le clip couvre les ~30 s précédentes).
 */
function viewerClipMoments(clips, streamStartMs) {
  return clips.map((c) => {
    const t = c.vod_offset != null ? c.vod_offset + (c.duration || 30) * 0.7
      : toStreamTime(c.created_at, streamStartMs) - (c.duration || 30) * 0.3;
    return { type: 'viewer_clip', t: Math.max(0, t), meta: { title: c.title, by: c.creator_name, views: c.view_count, url: c.url } };
  });
}

/** Passe du temps du stream au temps de l'enregistrement OBS (qui peut démarrer avant ou après le live). */
/**
 * Messages du chat dans le temps de l'enregistrement (pour les afficher sur la vidéo quand le streamer les lit).
 * Les commandes (« !clip »…) sont laissées de côté.
 */
function chatInRecordingTime(messages, recordStartMs) {
  return (messages || [])
    .filter(isViewerMessage)                       // ni bots (WizeBot…) ni commandes « !… »
    .map((m) => ({ t: Math.round(toStreamTime(m.at, recordStartMs) * 100) / 100, user: m.user, text: cleanChatText(m.text),
      color: m.color || null, badges: m.badges || [] }))
    .filter((m) => m.t >= 0);
}

function streamToRecordingTime(moments, streamStartMs, recordStartMs) {
  const shift = (streamStartMs - recordStartMs) / 1000;
  return moments.map((m) => ({ ...m, t: m.t + shift })).filter((m) => m.t >= 0);
}

module.exports = {
  BASE_CHAT_KEYWORDS, raidMoments, viewerPeakMoments, chatSpikeMoments, chatMarkerMoments,
  viewerClipMoments, matchesKeywords, streamToRecordingTime, chatInRecordingTime,
};

// Apprendre la façon de monter du streamer (Sky, 26/11 : « qu'il ait de moins en moins de modifications à faire »).
// Fonctions pures, utilisées par l'éditeur, l'export automatique et le processus principal (tests : test/style.test.js).
//
// 1. observe() : à chaque montage retouché, on compare le montage final aux clips proposés par Sklip.
//    Par type de moment (kill, rire, raid…) : clip retiré ou gardé, début / fin avancés ou reculés, mise en page.
//    Et pour le montage : teaser gardé ou enlevé, sous-titres, volumes.
// 2. profile() : la moyenne de tous les montages observés (le streamer, pas un montage en particulier).
// 3. applyStyle() : les prochains montages proposés en tiennent compte, dès 3 exemples d'un même type.

const MIN_SAMPLES = 3;          // pas d'habitude avant 3 exemples
const REMOVE_RATE = 0.7;        // type retiré 7 fois sur 10 ou plus : on ne le propose plus dans le montage
const LAYOUT_RATE = 0.6;        // mise en page choisie 6 fois sur 10 : par défaut pour ce type
const MAX_SHIFT = 30;           // s : on ne déplace jamais un bord de plus de 30 s
const MIN_LEN = 3;              // s : un clip ajusté garde au moins 3 s
const KEEP = 40;                // on ne garde que les 40 derniers montages (les goûts changent)

const mainMoment = (c) => [...(c.moments || [])].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (x) => Math.round(x * 10) / 10;

/** Ce que le streamer a changé dans un montage par rapport aux clips proposés (`proposed` : clips de la session). */
function observe(proposed, project) {
  const finals = (project.clips || []).filter((c) => !c.teaser);
  const clips = [];
  const used = new Set();
  for (const pc of proposed || []) {
    const mm = mainMoment(pc);
    if (!mm) continue;
    const parts = finals.filter((f) => f.end > pc.start && f.start < pc.end);
    parts.forEach((f) => used.add(f));
    if (!parts.length) { clips.push({ type: mm.type, removed: true }); continue; }
    const start = Math.min(...parts.map((f) => f.start));
    const end = Math.max(...parts.map((f) => f.end));
    const at = parts.find((f) => f.start <= mm.t && f.end >= mm.t) || parts[0];
    clips.push({ type: mm.type, removed: false, dStart: r1(start - pc.start), dEnd: r1(end - pc.end), layout: at.layout || null });
  }
  const added = finals.filter((f) => !used.has(f)).map((f) => (mainMoment(f) || {}).type).filter(Boolean);
  return {
    clips, added,
    teaser: (project.clips || []).some((c) => c.teaser),
    teaserOff: !!project.teaserOff,
    subtitles: project.texts ? project.texts.subtitles !== false : true,
    volumes: project.volumes || null,
  };
}

/** Habitudes du streamer, d'après ses montages observés ({ clé: observation }). */
function profile(observations) {
  const obs = Object.values(observations || {}).slice(-KEEP);
  const types = {};
  const slot = (k) => (types[k] = types[k] || { n: 0, removed: 0, dStart: [], dEnd: [], layouts: {}, added: 0 });
  for (const o of obs) {
    for (const c of o.clips || []) {
      const t = slot(c.type);
      t.n += 1;
      if (c.removed) { t.removed += 1; continue; }
      t.dStart.push(c.dStart || 0);
      t.dEnd.push(c.dEnd || 0);
      if (c.layout) t.layouts[c.layout] = (t.layouts[c.layout] || 0) + 1;
    }
    for (const a of o.added || []) slot(a).added += 1;
  }
  const out = { montages: obs.length, types: {} };
  for (const [k, t] of Object.entries(types)) {
    const kept = t.n - t.removed;
    const [layout, count] = Object.entries(t.layouts).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    out.types[k] = {
      n: t.n, kept, removedRate: t.n ? Math.round((t.removed / t.n) * 100) / 100 : 0, added: t.added,
      dStart: r1(median(t.dStart)), dEnd: r1(median(t.dEnd)),
      layout: kept >= MIN_SAMPLES && count / kept >= LAYOUT_RATE ? layout : null,
    };
  }
  const teaserSeen = obs.filter((o) => o.teaser || o.teaserOff);
  out.teaser = teaserSeen.length >= MIN_SAMPLES ? teaserSeen.filter((o) => o.teaser).length / teaserSeen.length >= 0.3 : null;
  out.subtitles = obs.length >= MIN_SAMPLES ? obs.filter((o) => o.subtitles).length / obs.length >= 0.3 : null;
  if (obs.length >= MIN_SAMPLES) {
    const vol = {};
    for (const tr of ['game', 'mic', 'discord']) {
      const xs = obs.map((o) => o.volumes && o.volumes[tr]).filter((x) => typeof x === 'number');
      if (xs.length >= MIN_SAMPLES) vol[tr] = Math.round(median(xs) * 100) / 100;
    }
    out.volumes = vol;
  }
  return out;
}

const TYPE_NAMES = { kill: 'Kills', multikill: 'Multi-kills', ace: 'Aces', clutch: 'Clutchs', laugh: 'Rires', scream: 'Cris',
  funny_death: 'Morts drôles', chat_spike: 'Pics de chat', raid: 'Raids', viewer_peak: 'Peaks', viewer_clip: 'Clips viewers',
  marker: 'Marqueurs', victory: 'Victoires', defeat: 'Défaites', rr: 'RR' };
const LAYOUT_NAMES = { cam_top: 'cam en haut', cam_bottom: 'cam en bas', game_only: 'jeu seul', cam_full: 'cam en grand' };
const secs = (d) => `${Math.abs(Math.round(d))} s`;

/**
 * Applique les habitudes à un montage proposé (clips pas encore retouchés). Renvoie { project, changes } :
 * `changes` = phrases à montrer au streamer (« Kills : 5 s de plus avant »). La musique n'est jamais touchée.
 */
function applyStyle(project, prof, { streamDuration } = {}) {
  if (!prof || !prof.types) return { project, changes: [] };
  const changes = new Set();
  const maxT = streamDuration != null ? streamDuration : project.streamDuration;
  const clips = [];
  for (const c of project.clips) {
    const mm = c.teaser ? null : mainMoment(c);
    const t = mm && prof.types[mm.type];
    if (!t || t.n < MIN_SAMPLES) { clips.push(c); continue; }
    const name = TYPE_NAMES[mm.type] || mm.type;
    if (t.removedRate >= REMOVE_RATE) { changes.add(`${name} : plus mis d'office (tu les retires presque toujours)`); continue; }
    const out = { ...c };
    if (t.kept >= MIN_SAMPLES) {
      const ds = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, t.dStart));
      const de = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, t.dEnd));
      if (Math.abs(ds) >= 1) {
        out.start = Math.max(0, Math.min(out.start + ds, mm.t - 1));
        changes.add(`${name} : ${secs(ds)} ${ds < 0 ? 'de plus' : 'de moins'} avant`);
      }
      if (Math.abs(de) >= 1) {
        out.end = Math.max(out.end + de, mm.t + 1);
        if (maxT != null) out.end = Math.min(out.end, maxT);
        changes.add(`${name} : ${secs(de)} ${de > 0 ? 'de plus' : 'de moins'} après`);
      }
      if (out.end - out.start < MIN_LEN) { out.start = c.start; out.end = c.end; }
      out.start = r1(out.start); out.end = r1(out.end);
      if (t.layout && t.layout !== c.layout) {
        out.layout = t.layout;
        if (t.layout === 'cam_full') out.focus = undefined;
        changes.add(`${name} : ${LAYOUT_NAMES[t.layout] || t.layout}`);
      }
    }
    clips.push(out);
  }
  let p = { ...project, clips: clips.length ? clips : project.clips };
  if (prof.subtitles === false && p.texts && p.texts.subtitles) {
    p = { ...p, texts: { ...p.texts, subtitles: false } };
    changes.add('Sous-titres coupés');
  }
  if (prof.volumes && Object.keys(prof.volumes).length && p.volumes) {
    const v = { ...p.volumes };
    let moved = false;
    for (const [k, x] of Object.entries(prof.volumes)) {
      if (Math.abs((v[k] ?? 1) - x) >= 0.05) { v[k] = x; moved = true; }
    }
    if (moved) { p = { ...p, volumes: v }; changes.add('Volumes du mixeur'); }
  }
  return { project: p, changes: [...changes] };
}

/** Ce que le streamer règle lui-même (pour savoir s'il a retouché le montage). */
function signature(p) {
  return JSON.stringify([(p.clips || []).map((c) => [c.start, c.end, c.layout, !!c.teaser]), p.texts, p.volumes, p.fmt]);
}

/** Teaser au début des nouveaux montages ? Oui par défaut, sauf si le streamer l'enlève presque toujours. */
const wantsTeaser = (prof) => !prof || prof.teaser !== false;

module.exports = { observe, profile, applyStyle, wantsTeaser, signature, MIN_SAMPLES };

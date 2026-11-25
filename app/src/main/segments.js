// Passages d'un live (Valorant, Just Chatting…) à partir de ce que Sklip a noté pendant l'enregistrement :
// la scène OBS et sa webcam (lecture seule, voir obs-scenes.js) et la catégorie Twitch.

const sameCam = (a, b) => (!a && !b) || (a && b && ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) < 0.01));

/**
 * scenes : [{ at, scene, cam, full }] · games : [{ at, game }] (heures en ms)
 * → [{ start, end, game, scene, cam, full }] en secondes depuis le début de l'enregistrement.
 */
function buildSegments({ scenes = [], games = [], start, stop }) {
  if (!start || !stop || stop <= start) return [];
  const times = [...new Set([start, ...scenes.map((s) => s.at), ...games.map((g) => g.at)])]
    .filter((t) => t >= start && t < stop).sort((a, b) => a - b);
  const latest = (list, t) => {
    let cur = null;
    for (const x of list) if (x.at <= t) cur = x;
    return cur || list[0] || null;   // avant le premier relevé : le premier connu
  };
  const out = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const sc = latest(scenes, t);
    const g = latest(games, t);
    const seg = { start: Math.round((t - start) / 10) / 100, end: Math.round(((times[i + 1] || stop) - start) / 10) / 100,
      game: g ? g.game : null, scene: sc ? sc.scene : null, type: sc ? sc.type || null : null,
      cam: sc ? sc.cam : null, full: !!(sc && sc.full) };
    const prev = out[out.length - 1];
    if (prev && prev.game === seg.game && prev.scene === seg.scene && prev.type === seg.type && sameCam(prev.cam, seg.cam)) prev.end = seg.end;
    else out.push(seg);
  }
  return out;
}

module.exports = { buildSegments, sameCam };

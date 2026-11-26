// Export automatique à la fin du live (option, Sky 26/11 : « montage prêt à poster dès la fin du live »).
// Pour chaque thème et chaque format choisis : le montage proposé par Sklip (avec le teaser au début), exporté tel
// quel dans le dossier du stream. Le streamer peut toujours l'ouvrir dans l'éditeur pour le retoucher et réexporter.
// Les sous-titres sont faits par le moteur ; les bulles du chat et les répliques des coéquipiers (dessinées par
// l'éditeur) ne sont ajoutées que quand le montage est exporté depuis l'éditeur.
const fs = require('node:fs');
const path = require('node:path');
const M = require('../renderer/editor-model');
const S = require('../renderer/style-model');
const pipeline = require('./pipeline');

/** Montages à exporter pour une session : [{ theme, fmt, project, output, post }]. */
function plan(session, { formats = ['9x16'], cam, channel = '', teaser = true, style = null } = {}) {
  const out = [];
  for (const theme of Object.keys(session.clips || {})) {
    const es = pipeline.editorSession(session, theme, { cam });
    if (!es.clips.length) continue;
    const clips = es.clips.map((c) => ({ ...c, moments: es.moments.filter((m) => m.t >= c.start && m.t <= c.end) }));
    for (const fmt of formats) {
      let project = M.createProject({ clips, streamDuration: es.stream.duration, fmt });
      project = S.applyStyle(project, style).project;                 // les habitudes du streamer
      if (teaser && S.wantsTeaser(style)) project = M.setTeaser(project);
      const post = M.suggestPost(project, { streamTitle: es.stream.title, theme, channel });
      const output = path.join(session.folder, 'montages', `sklip_${theme}_${fmt}.mp4`);
      out.push({ theme, fmt, project, output, post, cam: es.cam, tracks: es.tracks || {} });
    }
  }
  return out;
}

/**
 * Exporte tous les montages d'une session. Ne remplace jamais un fichier déjà là (export fait à la main).
 * Garde aussi le montage dans montage-<thème>.json (s'il n'existe pas) : l'éditeur rouvre exactement ce qui a été exporté.
 */
async function autoExport(session, { engine, formats, cam, channel, teaser, style, log, onStep } = {}) {
  const jobs = plan(session, { formats, cam, channel, teaser, style });
  const done = [];
  for (const [i, j] of jobs.entries()) {
    const saved = path.join(session.folder, `montage-${j.theme}.json`);
    if (!fs.existsSync(saved)) fs.writeFileSync(saved, JSON.stringify(j.project));
    if (fs.existsSync(j.output)) continue;
    if (onStep) onStep(i, jobs.length, j);
    try {
      fs.mkdirSync(path.dirname(j.output), { recursive: true });
      await engine('render', M.toRenderSpec(j.project, { video: session.video, output: j.output, cam: j.cam, tracks: j.tracks, post: j.post }));
      done.push(j);
    } catch (e) {
      if (log) log.warn(`Export automatique ${j.theme} ${j.fmt} :`, e);
    }
  }
  return done;
}

module.exports = { plan, autoExport };

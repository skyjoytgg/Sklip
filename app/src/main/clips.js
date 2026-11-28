// Onglet « Clips » (Sky 27/11 : « voir nos clips finis, juste à les glisser vers TikTok Studio ou YouTube ») :
// toutes les vidéos exportées (dossier montages/ de chaque stream), les plus récentes d'abord, avec le titre et
// les hashtags proposés (fiche .json écrite à côté de la vidéo par l'export).
const fs = require('node:fs');
const path = require('node:path');

const THEME_NAMES = { kills: 'Kills', drole: 'Drôle', communaute: 'Communauté', discussion: 'Discussion', bestof: 'Best-of', youtube: 'Vidéo YouTube', youtube_partie: 'YouTube : une partie' };

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** [{ file, name, folder, stream, theme, themeName, fmt, size, mtime, post, posted }] */
function listClips(root) {
  const dir = path.join(root, 'Streams');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const folder = path.join(dir, name);
    const mdir = path.join(folder, 'montages');
    if (!fs.existsSync(mdir)) continue;
    const stats = readJson(path.join(folder, 'stats.json')) || {};
    for (const f of fs.readdirSync(mdir).filter((n) => /\.mp4$/i.test(n))) {
      const file = path.join(mdir, f);
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (!st.size) continue;                                 // export en cours ou raté
      const m = /^sklip_([a-z]+)_(9x16|16x9)/i.exec(f);
      const post = readJson(file.replace(/\.mp4$/i, '.json'));
      out.push({
        file, name: f, folder, stream: stats.title || name, day: name.slice(0, 10),
        theme: m ? m[1] : null, themeName: m ? THEME_NAMES[m[1]] || m[1] : null, fmt: m ? m[2] : null,
        size: st.size, mtime: st.mtimeMs,
        post: post && post.title ? { title: post.title, hashtags: post.hashtags || [], ...(post.youtube_description ? { description: post.youtube_description } : {}) } : null,
        thumbnail: post && post.thumbnail && fs.existsSync(post.thumbnail) ? post.thumbnail : null,
        thumbnailIndex: (post && post.thumbnail_index) || 0,
        canRedoThumbnail: !!(post && post.thumbnail_params),
        posted: !!(post && post.published && post.published.manual),
      });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** « Déjà posté » coché / décoché : gardé dans la fiche .json à côté de la vidéo. */
function setPosted(file, posted) {
  if (!/\.mp4$/i.test(file) || !fs.existsSync(file)) return false;
  const jf = file.replace(/\.mp4$/i, '.json');
  const post = readJson(jf) || { video: file };
  post.published = { ...(post.published || {}) };
  if (posted) post.published.manual = new Date().toISOString();
  else delete post.published.manual;
  fs.writeFileSync(jf, JSON.stringify(post, null, 1));
  return true;
}

// Petite icône violette pour le glisser-déposer (Windows en veut une).
const DRAG_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAALklEQVR4nO3OIQEAAAgDMNLR74khxs3E/CZ71zQCAgICAgICAgICAgICAgIpBx6kKlSmhdND9wAAAABJRU5ErkJggg==';

module.exports = { listClips, setPosted, DRAG_ICON };

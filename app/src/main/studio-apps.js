// TikTok Studio / YouTube Studio installés comme applis sur le PC (Sky 28/11 : « au lieu d'ouvrir sur internet
// ça m'ouvre l'appli de mon PC »). Sur Windows ce sont des applis web installées depuis Chrome ou Edge : un
// raccourci du menu Démarrer « TikTok.lnk » → chrome_proxy.exe --profile-directory=Default --app-id=…
// On relance ce raccourci en lui donnant directement la page d'envoi. Sinon : le site dans le navigateur.
const fs = require('node:fs');
const path = require('node:path');

const SITES = {
  tiktok: { url: 'https://www.tiktok.com/tiktokstudio/upload', names: [/^tiktok studio$/i, /^tiktok$/i] },
  youtube: { url: 'https://studio.youtube.com', names: [/^youtube studio$/i] },
};

/** Raccourcis .lnk du menu Démarrer (un niveau de sous-dossiers suffit : « Applications Chrome », « Chrome Apps »…). */
function startMenuLinks(dirs) {
  const out = [];
  const walk = (dir, depth) => {
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory() && depth < 2) walk(p, depth + 1);
      else if (/\.lnk$/i.test(it.name)) out.push(p);
    }
  };
  for (const d of dirs) walk(d, 0);
  return out;
}

/** Le raccourci de l'appli pour `which` (« TikTok Studio » avant « TikTok » ; jamais « TikTok LIVE Studio »). */
function pickShortcut(links, which) {
  const site = SITES[which];
  if (!site) return null;
  for (const re of site.names) {
    const hit = links.find((l) => re.test(path.basename(l, path.extname(l))));
    if (hit) return hit;
  }
  return null;
}

/** Découpe les arguments d'un raccourci (guillemets respectés). */
function splitArgs(s) {
  return (String(s || '').match(/(?:[^\s"]+|"[^"]*")+/g) || []).map((a) => a.replace(/"/g, ''));
}

/** Commande pour ouvrir l'appli web installée sur la page d'envoi, ou null si ce n'est pas une appli Chrome / Edge. */
function launchCommand(link, url) {
  if (!link || !link.target || !/\\(chrome|chrome_proxy|msedge|msedge_proxy|brave|brave_proxy)\.exe$/i.test(link.target)) return null;
  const args = splitArgs(link.args);
  if (!args.some((a) => a.startsWith('--app-id='))) return null;
  return { file: link.target, args: [...args, `--app-launch-url-for-shortcuts-menu-item=${url}`] };
}

module.exports = { SITES, startMenuLinks, pickShortcut, splitArgs, launchCommand };

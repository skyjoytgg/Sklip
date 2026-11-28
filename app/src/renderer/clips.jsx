import { useEffect, useState } from 'react';
import { api } from './api.js';
import * as M from './editor-model.js';

// Onglet « Clips » (Sky 27/11) : tes vidéos finies, à glisser dans TikTok Studio ou YouTube Studio.
const mo = (b) => `${Math.max(1, Math.round(b / 1e6))} Mo`;
const when = (ms) => new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function ClipCard({ c, onPosted }) {
  const [copied, setCopied] = useState(null);
  const [thumb, setThumb] = useState({ file: c.thumbnail, v: 0, index: c.thumbnailIndex || 0, busy: false, note: '' });
  // « Autre tête » : la miniature refaite avec la tête suivante de « Mes têtes ».
  const otherFace = async () => {
    setThumb((t) => ({ ...t, busy: true }));
    try {
      const r = await api.redoThumbnail(c.file, thumb.index + 1);
      const name = r && r.face ? r.face.split(/[\\/]/).pop() : '';
      setThumb((t) => ({ file: (r && r.thumbnail) || t.file, v: t.v + 1, index: t.index + 1, busy: false,
        note: r && !r.faces ? 'Aucune photo dans « Mes têtes » : ta webcam est utilisée.' : name ? `Tête : ${name}` : '' }));
    } catch { setThumb((t) => ({ ...t, busy: false, note: 'Miniature pas refaite.' })); }
  };
  // Fiche absente (vieil export) : titre et hashtags proposés d'après le thème, comme à l'export.
  const post = c.post || M.suggestPost({ clips: [], fmt: c.fmt || '9x16' }, { theme: c.theme || 'kills' });
  const tags = post.hashtags.join(' ');
  const copy = (what, text) => navigator.clipboard.writeText(text)
    .then(() => { setCopied(what); setTimeout(() => setCopied(null), 1500); }).catch(() => {});
  return (
    <div className={'clipcard' + (c.posted ? ' posted' : '')}>
      <div className={'cc-video ' + (c.fmt === '16x9' ? 'h' : 'v')} draggable
        title="Glisse la vidéo dans la page d'envoi de TikTok Studio ou YouTube Studio"
        onDragStart={(e) => { e.preventDefault(); api.dragClip(c.file); }}>
        <video src={`file:///${c.file}#t=1`} preload="metadata" muted controls />
        <span className="cc-drag">⇱ Glisse-moi</span>
      </div>
      <div className="cc-body">
        <div className="cc-title">{post.title}</div>
        <div className="pi-tags">{tags}</div>
        <div className="note">{c.themeName || 'Montage'} · {c.fmt === '16x9' ? '16:9 (YouTube)' : '9:16 (TikTok, Shorts)'} · {mo(c.size)}</div>
        <div className="note">{c.stream} · exporté le {when(c.mtime)}</div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn sm" title="Pour TikTok : tout va dans la description"
            onClick={() => copy('all', `${post.title}\n${tags}`)}>{copied === 'all' ? 'Copié ✓' : 'Copier titre + hashtags'}</button>
          <button className="btn ghost sm" title="Pour le champ « Titre » de YouTube"
            onClick={() => copy('title', post.title)}>{copied === 'title' ? 'Copié ✓' : 'Titre'}</button>
          <button className="btn ghost sm" title="Pour la description de YouTube"
            onClick={() => copy('tags', tags)}>{copied === 'tags' ? 'Copié ✓' : 'Hashtags'}</button>
          <button className="btn ghost sm" onClick={() => api.showClip(c.file)}>Dossier</button>
        </div>
        {(post.description || thumb.file) && (
          <div className="cc-yt">
            {thumb.file && <img src={`file:///${thumb.file}?v=${thumb.v}`} alt="Miniature" draggable
              title="Miniature 1280×720 : glisse-la dans YouTube Studio (« Importer une miniature »)"
              onDragStart={(e) => { e.preventDefault(); api.dragClip(thumb.file); }} />}
            <div>
              {post.description && <button className="btn sm" title="Titre, chapitres (0:00 Début du live…) et hashtags, pour la description YouTube"
                onClick={() => copy('desc', post.description)}>{copied === 'desc' ? 'Copié ✓' : 'Copier la description + chapitres'}</button>}
              {thumb.file && <div className="note">Miniature : glisse-la dans YouTube Studio.</div>}
              {c.canRedoThumbnail && (
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn ghost sm" disabled={thumb.busy} onClick={otherFace}
                    title="Refait la miniature avec une autre photo de « Mes têtes »">{thumb.busy ? 'Miniature…' : '🔀 Autre tête'}</button>
                  <button className="btn ghost sm" onClick={() => api.openFacesFolder()}
                    title="Mets-y des photos détourées de ta tête (rire.png, choc.png…) : la note du dossier explique comment">📁 Mes têtes</button>
                </div>)}
              {thumb.note && <div className="note">{thumb.note}</div>}
            </div>
          </div>)}
        <label className="check" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={c.posted} onChange={(e) => onPosted(c, e.target.checked)} /> Déjà posté
        </label>
      </div>
    </div>
  );
}

export function Clips({ setPage }) {
  const [clips, setClips] = useState(null);
  const [hidePosted, setHidePosted] = useState(false);
  const [apps, setApps] = useState({});          // { tiktok: true } : l'appli est installée sur le PC
  useEffect(() => { (api.studioApps ? api.studioApps() : Promise.resolve({})).then((a) => setApps(a || {})).catch(() => {}); }, []);
  const load = () => api.listClips().then(setClips).catch(() => setClips([]));
  useEffect(() => { load(); }, []);
  const onPosted = async (c, posted) => {
    await api.clipPosted(c.file, posted);
    setClips((xs) => xs.map((x) => (x.file === c.file ? { ...x, posted } : x)));
  };
  const shown = (clips || []).filter((c) => !hidePosted || !c.posted);
  return (
    <>
      <h1>Clips</h1>
      <p className="sub">Tes vidéos finies. Ouvre TikTok Studio ou YouTube Studio, puis <b>glisse la vidéo</b> dans la page d'envoi,
        et colle le titre et les hashtags.</p>
      <div className="row" style={{ marginBottom: 16 }}>
        <button className="btn" onClick={() => api.openUploadSite('tiktok')}
          title={apps.tiktok ? "Ouvre l'appli TikTok de ton PC sur la page d'envoi" : 'Ouvre TikTok Studio dans ton navigateur'}>
          Ouvrir TikTok Studio{apps.tiktok ? ' (appli)' : ''}</button>
        <button className="btn" onClick={() => api.openUploadSite('youtube')}
          title={apps.youtube ? "Ouvre l'appli YouTube Studio de ton PC" : 'Ouvre YouTube Studio dans ton navigateur'}>
          Ouvrir YouTube Studio{apps.youtube ? ' (appli)' : ''}</button>
        <label className="check"><input type="checkbox" checked={hidePosted} onChange={(e) => setHidePosted(e.target.checked)} /> Cacher les clips déjà postés</label>
        <button className="btn ghost sm" onClick={load}>Actualiser</button>
      </div>
      {clips && !clips.length && (
        <div className="banner">Pas encore de clip fini. Dans « Montage », clique sur « Exporter » : la vidéo arrivera ici.
          <button className="btn sm" style={{ marginLeft: 10 }} onClick={() => setPage('montage')}>Aller au montage</button></div>)}
      <div className="clipgrid">{shown.map((c) => <ClipCard key={c.file} c={c} onPosted={onPosted} />)}</div>
    </>
  );
}

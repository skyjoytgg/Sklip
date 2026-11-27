import { useEffect, useState } from 'react';
import { api } from './api.js';

// Onglet « Clips » (Sky 27/11) : tes vidéos finies, à glisser dans TikTok Studio ou YouTube Studio.
const mo = (b) => `${Math.max(1, Math.round(b / 1e6))} Mo`;
const when = (ms) => new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function ClipCard({ c, onPosted }) {
  const [copied, setCopied] = useState(false);
  const text = c.post ? `${c.post.title}\n${c.post.hashtags.join(' ')}` : '';
  const copy = () => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  return (
    <div className={'clipcard' + (c.posted ? ' posted' : '')}>
      <div className={'cc-video ' + (c.fmt === '16x9' ? 'h' : 'v')} draggable
        title="Glisse la vidéo dans la page d'envoi de TikTok Studio ou YouTube Studio"
        onDragStart={(e) => { e.preventDefault(); api.dragClip(c.file); }}>
        <video src={`file:///${c.file}#t=1`} preload="metadata" muted controls />
        <span className="cc-drag">⇱ Glisse-moi</span>
      </div>
      <div className="cc-body">
        <div className="cc-title">{c.post ? c.post.title : c.name}</div>
        {c.post && <div className="pi-tags">{c.post.hashtags.join(' ')}</div>}
        <div className="note">{c.themeName || 'Montage'} · {c.fmt === '16x9' ? '16:9 (YouTube)' : '9:16 (TikTok, Shorts)'} · {mo(c.size)}</div>
        <div className="note">{c.stream} · exporté le {when(c.mtime)}</div>
        <div className="row" style={{ marginTop: 8 }}>
          {c.post && <button className="btn sm" onClick={copy}>{copied ? 'Copié ✓' : 'Copier titre + hashtags'}</button>}
          <button className="btn ghost sm" onClick={() => api.showClip(c.file)}>Dossier</button>
        </div>
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
        <button className="btn" onClick={() => api.openUploadSite('tiktok')}>Ouvrir TikTok Studio</button>
        <button className="btn" onClick={() => api.openUploadSite('youtube')}>Ouvrir YouTube Studio</button>
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

// Onglet « Lives » : une ligne par live (miniature, titre, date, durée) → la page du live (frise, clips, stats).
import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { Frise, CategoryFilter, clock } from './frise.jsx';
import { Icon } from './icons.jsx';
import { THEMES } from './constants.js';
import M from './timeline-model.js';

const dateText = (ms) => (ms ? new Date(ms).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '');
const themeLabel = (id) => (THEMES.find((t) => t.id === id) || { label: id }).label;

function Thumb({ folder, big }) {
  const [src, setSrc] = useState(undefined);
  useEffect(() => { let on = true; api.liveThumb(folder).then((s) => on && setSrc(s || null)); return () => { on = false; }; }, [folder]);
  return (
    <div className={'lv-thumb' + (big ? ' big' : '')}>
      {src ? <img src={src} alt="" /> : <span>{src === undefined ? '' : <Icon name="record" size={big ? 30 : 22} />}</span>}
    </div>
  );
}

function StatChips({ s, clips }) {
  const items = [['kill', 'kill', s.kills], ['ace', 'ace', s.aces], ['clutch', 'clutch', s.clutchs], ['analysis', 'clip', clips]];
  return (
    <div className="lv-chips">
      {items.filter(([, , n]) => n).map(([icon, label, n]) => (
        <span key={label}><Icon name={icon} size={13} /> {n} {label}{n > 1 ? 's' : ''}</span>
      ))}
    </div>
  );
}

function LiveList({ onOpen }) {
  const [lives, setLives] = useState(null);
  useEffect(() => { api.livesList().then(setLives); }, []);
  if (!lives) return null;
  if (!lives.length) return <div className="banner">Aucun live analysé pour l'instant. Après ton prochain live, il apparaîtra ici.</div>;
  return (
    <div className="lv-list">
      {lives.map((l) => (
        <button key={l.folder} className="lv-row" onClick={() => onOpen(l.folder)}>
          <Thumb folder={l.folder} />
          <div className="lv-info">
            <div className="lv-title">{l.title}</div>
            <div className="note">{dateText(l.date)}{l.date ? ` · ${clock(l.date)}` : ''}</div>
            <StatChips s={l.stats} clips={l.clips} />
          </div>
          <div className="lv-dur">{M.duration(l.duration)}</div>
          <span className="lv-go">›</span>
        </button>
      ))}
    </div>
  );
}

const TILES = [
  ['kill', 'Kills', (s) => s.kills], ['multikill', 'Multi-kills', (s) => s.multikills], ['ace', 'Aces', (s) => s.aces],
  ['clutch', 'Clutchs', (s) => s.clutchs], ['funny_death', 'Morts', (s) => s.morts], ['marker', 'Marqueurs', (s) => s.marqueurs],
  ['community', 'Raids', (s) => (s.raids || []).length], ['twitch', 'Peak viewers', (s) => s.peak_viewers],
];

function LiveDetail({ folder, onBack, openSession }) {
  const [live, setLive] = useState(null);
  const [cat, setCat] = useState('all');
  const [again, setAgain] = useState(null);       // null | 'ask' | 'busy' | 'done' | message d'erreur
  useEffect(() => { api.liveGet(folder).then(setLive); }, [folder]);
  const reanalyze = () => {
    setAgain('busy');
    api.reanalyze(folder).then(() => { setAgain('done'); return api.liveGet(folder).then(setLive); })
      .catch((e) => setAgain(String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')));
  };
  const events = useMemo(() => (live ? M.buildEvents({ moments: live.moments, journal: live.journal, startMs: live.startMs }) : []), [live]);
  const shown = useMemo(() => M.filterEvents(events, cat), [events, cat]);
  if (!live) return null;
  const types = cat === 'all' ? null : (M.CATEGORIES.find((c) => c.id === cat) || {}).types;
  const clips = types && types.length ? live.clips.filter((c) => c.types.some((t) => types.includes(t))) : live.clips;
  const s = live.stats || {};
  return (
    <>
      <button className="link" onClick={onBack}>‹ Tous les lives</button>
      <div className="lv-head">
        <Thumb folder={folder} big />
        <div className="grow">
          <h1>{live.title}</h1>
          <div className="sub" style={{ margin: 0 }}>{dateText(live.date)}{live.date ? ` · ${clock(live.date)}` : ''} · {M.duration(live.duration)}</div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => openSession(folder)} disabled={!live.clips.length}>Monter les clips</button>
            <button className="btn ghost" onClick={() => api.openFolder(folder)}>Dossier</button>
            <button className="btn ghost" disabled={again === 'busy'} onClick={() => setAgain('ask')}
              title="Refaire la détection avec la dernière version de Sklip">{again === 'busy' ? 'Réanalyse en cours…' : 'Réanalyser'}</button>
          </div>
          {again === 'ask' && (
            <div className="card" style={{ marginTop: 12, padding: 14 }}>
              <div>Refaire la détection de ce live avec la dernière version de Sklip (nouveaux kills repérés, clips plus larges).
                Quelques minutes : l'image a déjà été lue.</div>
              <div className="note" style={{ marginTop: 6 }}>Tes montages déjà retouchés sont mis de côté dans le dossier du live (jamais supprimés). La vidéo OBS n'est pas touchée.</div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn" onClick={reanalyze}>Réanalyser</button>
                <button className="btn ghost" onClick={() => setAgain(null)}>Annuler</button>
              </div>
            </div>)}
          {again === 'done' && <div className="note" style={{ marginTop: 10 }}>✓ Réanalyse terminée : les clips sont à jour.</div>}
          {again && !['ask', 'busy', 'done'].includes(again) && <div className="note" style={{ marginTop: 10, color: '#ff6b6b' }}>Réanalyse impossible : {again}</div>}
        </div>
      </div>
      <div className="lv-tiles">
        {TILES.filter(([, , f]) => f(s) !== undefined && f(s) !== null).map(([icon, label, f]) => (
          <div key={label} className="lv-tile"><Icon name={icon} size={18} /><div><b>{f(s)}</b><span>{label}</span></div></div>
        ))}
        <div className="lv-tile"><Icon name="analysis" size={18} /><div><b>{live.clips.length}</b><span>Clips</span></div></div>
      </div>
      <div className="card jr-card">
        <div className="jr-head"><h3>Frise du live</h3>
          {!live.journal && <span className="note">Pas de journal pour ce live (analysé à la main ou avant cette version).</span>}</div>
        <CategoryFilter events={events} value={cat} onChange={setCat} />
        <Frise events={shown} duration={live.duration} clips={clips} startMs={live.startMs} bands={M.gameBands(live.segments, live.duration)}
          onClip={(c) => openSession(folder, c.theme)} />
        <div className="fr-legend"><span className="fr-clip-ex" /> un clip proposé par Sklip (clique pour l'ouvrir dans l'éditeur)</div>
      </div>
      <h3 style={{ margin: '22px 0 8px' }}>Clips{cat !== 'all' ? ` · ${(M.CATEGORIES.find((c) => c.id === cat) || {}).label}` : ''} ({clips.length})</h3>
      {clips.length === 0 ? <div className="note">Aucun clip dans cette catégorie.</div> : (
        <table className="lv-clips">
          <tbody>{clips.map((c, k) => (
            <tr key={k}>
              <td className="mono">{M.stamp(c.start)} → {M.stamp(c.end)}</td>
              <td>{Math.round(c.end - c.start)} s</td>
              <td><span className="lv-types">{c.types.map((t) => {
                const look = M.look({ cat: M.CATEGORIES.find((x) => x.types.includes(t))?.id || 'community', kind: t, source: 'moment' });
                return <span key={t} style={{ color: look.color }}><Icon name={look.icon} size={15} /> {M.momentLabel({ type: t })}</span>;
              })}</span></td>
              <td className="note">{themeLabel(c.theme)}</td>
              <td style={{ textAlign: 'right' }}><button className="btn ghost sm" onClick={() => openSession(folder, c.theme)}>Monter</button></td>
            </tr>))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function LivesPage({ openSession }) {
  const [folder, setFolder] = useState(null);
  if (folder) return <LiveDetail folder={folder} onBack={() => setFolder(null)} openSession={openSession} />;
  return (
    <>
      <h1>Lives</h1>
      <p className="sub">Tes lives analysés. Clique sur un live pour voir sa frise, ses clips et ses stats.</p>
      <LiveList onOpen={setFolder} />
    </>
  );
}

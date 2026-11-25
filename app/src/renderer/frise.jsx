// Frise chronologique d'un live : marque-pages (icônes dessinées), clips le long de l'axe, filtre par catégorie.
import { useEffect, useMemo, useState } from 'react';
import { Icon } from './icons.jsx';
import M from './timeline-model.js';

export const clock = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Boutons « Tout / Kills / Aces / … » : une seule catégorie à la fois. */
export function CategoryFilter({ events, value, onChange }) {
  const counts = M.countByCat(events);
  const cats = M.CATEGORIES.filter((c) => counts[c.id]);
  return (
    <div className="fr-filter">
      <button className={'fr-cat' + (value === 'all' ? ' on' : '')} style={{ '--c': '#9146ff' }} onClick={() => onChange('all')}>
        <Icon name="all" size={14} /> Tout <b>{events.length}</b>
      </button>
      {cats.map((c) => (
        <button key={c.id} className={'fr-cat' + (value === c.id ? ' on' : '')} style={{ '--c': c.color }} onClick={() => onChange(c.id)}>
          <Icon name={c.id === 'backstage' ? 'record' : c.id} size={14} /> {c.label} <b>{counts[c.id]}</b>
        </button>
      ))}
    </div>
  );
}

function Bookmark({ ev, on, onClick }) {
  const { color, icon } = M.look(ev);
  if (ev.dot) {
    return <button className={'fr-dot' + (on ? ' on' : '')} style={{ left: `${ev.x}%`, '--c': color }} onClick={onClick} title={ev.label} />;
  }
  return (
    <button className={`bm lvl-${ev.level}${on ? ' on' : ''}`} style={{ left: `${ev.x}%`, '--c': color, '--row': ev.row }}
      onClick={onClick} title={ev.label}>
      <span className="bm-stem" />
      <span className="bm-tag"><Icon name={icon} size={15} stroke={2.2} /></span>
      {ev.level !== 'ok' && <i className="bm-alert">!</i>}
    </button>
  );
}

/**
 * events : M.buildEvents(...) · duration : durée de l'enregistrement en s (null = live en cours)
 * clips : [{ start, end, theme }] (bandes le long de l'axe) · startMs : heure du début (pour afficher l'heure)
 */
export function Frise({ events, duration, runningEnd = null, clips = [], bands = [], startMs = null, onClip }) {
  const { items, liveWidth, end } = useMemo(() => M.layout(events, duration, runningEnd), [events, duration, runningEnd]);
  const pick = () => {
    const p = items.find((e) => e.level === 'error') || items.find((e) => e.level === 'warn');
    if (p) return p.i;
    const best = [...items].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    return best ? best.i : null;
  };
  const [sel, setSel] = useState(pick);
  useEffect(() => setSel(pick()), [events]);
  const cur = items.find((e) => e.i === sel) || null;
  const order = [...items].sort((a, b) => a.t - b.t || a.i - b.i);
  const pos = cur ? order.indexOf(cur) : -1;
  const look = cur ? M.look(cur) : null;
  const span = end || 1;
  return (
    <div className="fr">
      <div className="fr-frise">
        {items.filter((e) => !e.dot).map((ev) => <Bookmark key={ev.i} ev={ev} on={sel === ev.i} onClick={() => setSel(ev.i)} />)}
        {bands.length > 0 && (
          <div className="fr-bands">
            {bands.map((b, k) => (
              <div key={k} className="fr-band" title={`${b.game} · ${M.stamp(b.start)} → ${M.stamp(b.end)}`}
                style={{ left: `${(b.start / span) * liveWidth}%`, width: `${((b.end - b.start) / span) * liveWidth}%`, '--c': b.color }} />
            ))}
          </div>
        )}
        <div className="fr-axis">
          <div className={'fr-live' + (duration ? '' : ' running')} style={{ width: `${liveWidth}%` }} />
          {liveWidth < 100 && <div className="fr-after" style={{ left: `${liveWidth}%` }}><span>après le live</span></div>}
          {clips.map((c, k) => (
            <button key={k} className="fr-clip" title={`Clip ${M.stamp(c.start)} → ${M.stamp(c.end)}`}
              style={{ left: `${(c.start / span) * liveWidth}%`, width: `${Math.max(0.4, ((c.end - c.start) / span) * liveWidth)}%` }}
              onClick={() => onClip && onClip(c)} />
          ))}
          {items.filter((e) => e.dot).map((ev) => <Bookmark key={ev.i} ev={ev} on={sel === ev.i} onClick={() => setSel(ev.i)} />)}
        </div>
        <div className="fr-ticks">
          {M.ticks(end, liveWidth).map((t) => <span key={t.x} style={{ left: `${t.x}%` }}>{t.label}</span>)}
          {duration ? <span className={'end' + (liveWidth >= 100 ? ' right' : '')} style={{ left: `${liveWidth}%` }}>fin · {M.duration(duration)}</span>
            : <span className="end now" style={{ left: '100%' }}>● en cours</span>}
        </div>
      </div>
      {bands.length > 0 && (
        <div className="fr-games">
          {[...new Map(bands.map((b) => [b.game, b])).values()].map((b) => {
            const total = bands.filter((x) => x.game === b.game).reduce((n, x) => n + x.end - x.start, 0);
            return <span key={b.game} style={{ '--c': b.color }}><i />{b.game} · {M.duration(total)}</span>;
          })}
        </div>
      )}
      {items.length === 0 && <div className="note">Rien dans cette catégorie pour ce live.</div>}
      {cur && (
        <div className={`fr-detail lvl-${cur.level}`} style={{ '--c': look.color }}>
          <div className="fr-ic"><Icon name={look.icon} size={22} /></div>
          <div>
            <div className="fr-title">{cur.label}</div>
            <div className="note">
              {duration && cur.t > duration ? `${M.duration(cur.t - duration)} après la fin` : `à ${M.stamp(cur.t)} du live`}
              {startMs ? ` · ${clock(startMs + cur.t * 1000)}` : ''}
            </div>
            {cur.detail && <div className="fr-text">{cur.detail}</div>}
          </div>
          <div className="fr-nav">
            <button className="btn ghost sm" disabled={pos <= 0} onClick={() => setSel(order[pos - 1].i)}>‹</button>
            <button className="btn ghost sm" disabled={pos >= order.length - 1} onClick={() => setSel(order[pos + 1].i)}>›</button>
          </div>
        </div>
      )}
    </div>
  );
}

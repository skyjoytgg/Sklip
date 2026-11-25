// Accueil : journal du dernier live en frise (en direct pendant l'enregistrement).
import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { Frise, CategoryFilter, clock } from './frise.jsx';
import M from './timeline-model.js';

export function LiveJournalCard({ onOpenLives }) {
  const [list, setList] = useState(null);
  const [id, setId] = useState(null);
  const [journal, setJournal] = useState(null);
  const [cat, setCat] = useState('all');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { api.journalList().then((l) => { setList(l); if (l[0]) setId(l[0].id); }); }, []);
  useEffect(() => { if (id) api.journalGet(id).then(setJournal); }, [id]);
  useEffect(() => api.onJournal((j) => {
    setJournal((cur) => (!cur || cur.id === j.id || !cur.stop ? j : cur));
    setId((cur) => cur || j.id);
    api.journalList().then(setList);
  }), []);
  useEffect(() => {
    if (!journal || journal.stop) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [journal]);
  const events = useMemo(() => (journal ? M.journalEvents(journal) : []), [journal]);
  const shown = useMemo(() => M.filterEvents(events, cat), [events, cat]);
  if (!list) return null;
  const problems = events.filter((e) => e.level !== 'ok').length;
  return (
    <div className="card jr-card">
      <div className="jr-head">
        <h3>Journal du live</h3>
        <div className="row nowrap">
          {list.length > 1 && (
            <select value={id || ''} onChange={(e) => setId(Number(e.target.value))}>
              {list.map((l) => (
                <option key={l.id} value={l.id}>
                  {new Date(l.start).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} · {clock(l.start)}
                  {l.stop ? ` · ${M.duration((l.stop - l.start) / 1000)}` : ' · en cours'}{l.problems ? ` · ${l.problems} à vérifier` : ''}
                </option>
              ))}
            </select>
          )}
          {onOpenLives && <button className="btn ghost sm" onClick={onOpenLives}>Tous les lives</button>}
        </div>
      </div>
      {journal ? (
        <>
          <div className="jr-sum">
            <span className={'jr-state ' + (problems ? (events.some((e) => e.level === 'error') ? 'bad' : 'warn') : 'ok')}>
              {problems ? `${problems} point${problems > 1 ? 's' : ''} à vérifier` : 'Tout s’est bien passé'}
            </span>
          </div>
          <CategoryFilter events={events} value={cat} onChange={setCat} />
          <Frise events={shown} startMs={journal.start}
            bands={M.journalBands(journal, journal.stop ? (journal.stop - journal.start) / 1000 : (now - journal.start) / 1000)}
            duration={journal.stop ? (journal.stop - journal.start) / 1000 : null}
            runningEnd={journal.stop ? null : (now - journal.start) / 1000} />
        </>
      ) : (
        <div className="note">Rien pour l'instant. Au prochain enregistrement OBS, chaque étape (pistes audio, marqueurs, chat partagé, analyse) s'affichera ici en frise.</div>
      )}
    </div>
  );
}

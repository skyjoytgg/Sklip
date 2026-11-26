import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import { Editor } from './editor.jsx';
import { TOUR_VERSION } from './tour.jsx';
import { THEMES, MODES } from './constants.js';
import { TwitchBlock } from './twitch-block.jsx';
import { Onboarding, PcTest } from './onboarding.jsx';
import { FriendsBlock } from './friends-block.jsx';
import { LiveJournalCard } from './live-journal.jsx';
import { PrecheckCard } from './precheck.jsx';
import { LivesPage } from './lives.jsx';
import { SceneTypes } from './scene-types.jsx';

function Sidebar({ page, setPage, obs }) {
  const [mk, setMk] = useState(null);
  useEffect(() => api.onMarker((m) => { setMk(m); setTimeout(() => setMk((x) => (x === m ? { ...m, old: true } : x)), 3000); }), []);
  const items = [['accueil', 'Accueil'], ['lives', 'Lives'], ['montage', 'Montage'], ['historique', 'Historique'], ['reglages', 'Réglages']];
  return (
    <aside className="side">
      <div className="logo">Sk<span>lip</span></div>
      {items.map(([id, label]) => (
        <button key={id} className={'nav' + (page === id ? ' on' : '')} onClick={() => setPage(id)}>{label}</button>
      ))}
      <div className="grow" />
      <div className="pill"><span className={'dot' + (obs.connected ? ' ok' : '')} />OBS {obs.connected ? 'connecté' : 'non connecté'}</div>
      <div className="pill"><span className={'dot' + (obs.streaming ? ' live' : '')} />{obs.streaming ? 'En live' : 'Hors live'}</div>
      {mk && <div className={'pill' + (mk.old ? '' : ' flash')}>📍 {mk.counted ? `${mk.total} marqueur${mk.total > 1 ? 's' : ''}` : "Marqueur ignoré (pas d'enregistrement)"}</div>}
    </aside>
  );
}

function Accueil({ settings, setSettings, obs, analysis, openSession, setPage }) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => api.onEngineProgress((p) => p.command === 'analyze' && setJob((j) => j && ({ ...j, ...p }))), []);
  const themes = settings.themes || [];
  const toggle = async (id) => {
    const next = themes.includes(id) ? themes.filter((t) => t !== id) : [...themes, id];
    setSettings(await api.updateSettings({ themes: next }));
  };
  const analyse = async () => {
    const video = await api.openVideo();
    if (!video) return;
    setError(null);
    setJob({ message: 'Préparation…', fraction: 0, video });
    try {
      const r = await api.analyzeVideo(video);
      openSession(r.folder);
    } catch (e) { setError(String(e.message || e)); }
    setJob(null);
  };
  const running = analysis.running || job;
  return (
    <>
      <h1>Salut 👋</h1>
      <p className="sub">Sklip observe OBS sans jamais modifier tes réglages, et monte tes meilleurs moments.</p>
      <div className="cards">
        <div className="card"><h3>OBS</h3><div className="big">{obs.connected ? 'Connecté' : 'En attente'}</div>
          <div className="note">{obs.recording ? 'Enregistrement en cours' : "Pas d'enregistrement en cours"}</div></div>
        <div className="card"><h3>Analyse</h3><div className="big">{MODES[settings.analysisMode]}</div>
          <div className="note">Modifiable dans les réglages</div></div>
        <div className="card"><h3>Durée des montages</h3><div className="big">{settings.targetDuration} s</div>
          <div className="note">{(settings.formats || []).join(' · ').replace('9x16', '9:16').replace('16x9', '16:9')}</div></div>
      </div>
      <h3 style={{ margin: '0 0 4px' }}>Thèmes à monter</h3>
      <div className="themes">
        {THEMES.map((t) => (
          <button key={t.id} className={'chip' + (themes.includes(t.id) ? ' on' : '')} onClick={() => toggle(t.id)}>{t.label}</button>
        ))}
        <button className="chip">+ Thème perso</button>
      </div>
      <div className="row">
        <button className="btn" onClick={analyse} disabled={!!running}>Analyser une vidéo…</button>
        {settings.lastSessionFolder && <button className="btn ghost" onClick={() => openSession(settings.lastSessionFolder)}>Ouvrir le dernier stream</button>}
      </div>
      <p className="note">Après un live, Sklip analyse tout seul ton enregistrement OBS (sauf en mode manuel). Une VOD Twitch téléchargée s'ouvre avec « Analyser une vidéo ».</p>
      {running && (
        <div className="card" style={{ marginTop: 20 }}>
          <div><b>Analyse en cours</b>{analysis.title ? ` — ${analysis.title}` : ''}</div>
          <div className="note">{(job && job.message) || analysis.message || 'Lecture de la vidéo…'}</div>
          <div className="bar"><div style={{ width: `${Math.round(((job && job.fraction) || analysis.fraction || 0) * 100)}%` }} /></div>
          <div className="note">Tu peux continuer à utiliser ton PC : Sklip tourne en priorité basse.</div>
        </div>
      )}
      {error && <div className="bad" style={{ marginTop: 12 }}>L'analyse a échoué : {error}</div>}
      <PrecheckCard />
      <LiveJournalCard onOpenLives={() => setPage('lives')} />
    </>
  );
}

function Historique({ openSession }) {
  const [streams, setStreams] = useState([]);
  useEffect(() => { api.listStreams().then(setStreams); }, []);
  return (
    <>
      <h1>Historique</h1>
      <p className="sub">Tes streams passés, leurs stats et leurs montages.</p>
      {streams.length === 0 ? <div className="banner">Aucun stream pour l'instant. Ils apparaîtront ici après ton prochain live.</div> : (
        <table>
          <thead><tr><th>Stream</th><th>Kills</th><th>Aces</th><th>Raids</th><th>Peak</th><th /></tr></thead>
          <tbody>{streams.map((s) => (
            <tr key={s.name}>
              <td><b>{s.title || s.name}</b><div className="note">{s.name.slice(0, 10)}</div></td>
              <td>{s.stats?.kills ?? '—'}</td><td>{s.stats?.aces ?? '—'}</td>
              <td>{s.stats?.raids?.length ?? '—'}</td><td>{s.stats?.peak_viewers ?? '—'}</td>
              <td><div className="row nowrap">
                {s.hasSession && <button className="btn sm" onClick={() => openSession(s.folder)}>Monter</button>}
                <button className="btn ghost sm" onClick={() => api.openFolder(s.folder)}>Dossier</button></div></td>
            </tr>))}
          </tbody>
        </table>)}
    </>
  );
}

function Reglages({ settings, setSettings }) {
  const set = async (patch) => setSettings(await api.updateSettings(patch));
  const [report, setReport] = useState(null);
  const [hotkeyOk, setHotkeyOk] = useState(null);
  useEffect(() => { api.markerHotkeyOk().then(setHotkeyOk); }, []);
  return (
    <>
      <h1>Réglages</h1>
      <TwitchBlock />
      <FriendsBlock settings={settings} set={set} />
      <h3>Test du PC</h3>
      <p className="note">Mesure si ton PC peut faire les clips pendant le live sans laguer. Le mieux : avec OBS et Valorant ouverts.</p>
      <PcTest settings={settings} setSettings={setSettings} compact />
      <div className="field"><label>Tutoriel</label>
        <div className="row">
          <button className="btn ghost sm" onClick={() => set({ firstRunDone: false, editorTourDone: false })}>Relancer le tuto</button>
          <span className="note">Réglages du début + bulles guidées dans l'éditeur.</span></div></div>
      <div className="field"><label>Un problème ?</label>
        <div className="row">
          <button className="btn ghost sm" onClick={async () => setReport(await api.bugReport())}>Créer un rapport de bug</button>
          <button className="link" onClick={() => api.openLogs()}>Ouvrir le dossier du journal</button>
          <span className="note">{report ? `Rapport créé : ${report} — envoie ce fichier à Sky.` : 'Crée un fichier sur ton Bureau (sans mot de passe) à envoyer.'}</span></div></div>
      <div className="banner">Sklip ne modifie jamais OBS : ni scènes, ni sources, ni pistes, ni format d'enregistrement.</div>
      <div className="field"><label>Adresse obs-websocket</label>
        <input defaultValue={settings.obs.url} onBlur={(e) => set({ obs: { url: e.target.value } })} /></div>
      <div className="field"><label>Mot de passe obs-websocket</label>
        <input type="password" defaultValue={settings.obs.password} onBlur={(e) => set({ obs: { password: e.target.value } })} /></div>
      <div className="field"><label>Tes scènes OBS</label>
        <SceneTypes settings={settings} set={set} /></div>
      <div className="field"><label>Enregistrer tout seul pendant le live</label>
        <div><input type="checkbox" checked={settings.obs.autoRecord} onChange={(e) => set({ obs: { autoRecord: e.target.checked } })} />
          <div className="note">Quand tu cliques « Démarrer le streaming » dans OBS, Sklip appuie sur « Démarrer l'enregistrement »
            (avec tes réglages OBS), et l'arrête à la fin du live. Un enregistrement lancé par toi n'est jamais arrêté.</div></div></div>
      <div className="field"><label>Déclenchement de l'analyse</label>
        <select value={settings.analysisMode} onChange={(e) => set({ analysisMode: e.target.value })}>
          {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="field"><label>Durée cible des montages</label>
        <div className="row"><input type="range" min="15" max="60" step="5" value={settings.targetDuration}
          onChange={(e) => set({ targetDuration: Number(e.target.value) })} /> {settings.targetDuration} s</div></div>
      <div className="field"><label>Capturer les pistes séparées (jeu, micro, Discord, musique)</label>
        <div><input type="checkbox" checked={settings.audio.captureEnabled} onChange={(e) => set({ audio: { captureEnabled: e.target.checked } })} />
          <div className="note">Enregistrés par Sklip à part, puis calés automatiquement sur ta vidéo OBS.</div></div></div>
      <div className="field"><label>Raccourci marqueur</label>
        <div>
          <div className="row">
            <input defaultValue={settings.markerHotkey} style={{ width: 140 }}
              onBlur={async (e) => { await set({ markerHotkey: e.target.value.trim() }); setHotkeyOk(await api.markerHotkeyOk()); }} />
            {hotkeyOk === false && <span className="bad">Raccourci impossible (invalide ou déjà pris par un autre logiciel)</span>}
          </div>
          <div className="note">Pendant le live, appuie dessus après un moment marrant : Sklip le gardera à coup sûr. Exemples : F9, Ctrl+Shift+M.
            Attention, le jeu ne reçoit plus cette touche.</div>
          <div className="note"><b>Stream Deck</b> : ajoute une touche « Raccourci clavier » qui envoie {settings.markerHotkey || 'F9'},
            ou une touche « Site web » (cocher « GET en arrière-plan ») vers <code>http://127.0.0.1:47811/marker</code>.</div>
        </div></div>
      <div className="field"><label>Garder les fichiers de travail</label>
        <div className="row"><input type="number" min="1" max="90" defaultValue={settings.retentionDays}
          onBlur={(e) => set({ retentionDays: Number(e.target.value) })} style={{ width: 80 }} /> jours
          <span className="note">Ton enregistrement OBS d'origine n'est jamais supprimé.</span></div></div>
    </>
  );
}

function NoSession({ settings, openSession, setPage }) {
  return (
    <div style={{ padding: '28px 34px' }}>
      <h1>Montage</h1>
      <p className="sub">Aucun stream analysé pour l'instant.</p>
      <div className="row">
        {settings.lastSessionFolder && <button className="btn" onClick={() => openSession(settings.lastSessionFolder)}>Ouvrir le dernier stream</button>}
        <button className="btn ghost" onClick={() => setPage('accueil')}>Analyser une vidéo</button>
      </div>
    </div>);
}

function App() {
  const [page, setPage] = useState('accueil');
  const [settings, setSettings] = useState(null);
  const [obs, setObs] = useState({ connected: false, streaming: false, recording: false });
  const [session, setSession] = useState(null);
  const [analysis, setAnalysis] = useState({ running: false });
  const [ready, setReady] = useState(null);     // montages prêts après un live
  const openSession = async (folder, theme) => {
    const s = await api.editorSession(folder, theme);
    if (s) { setSession({ ...s, folderKey: folder }); setPage('montage'); }
  };
  useEffect(() => {
    api.getSettings().then(setSettings);
    api.analysisStatus().then(setAnalysis);
    api.obsCurrent().then((s) => s && setObs((o) => ({ ...o, ...s })));
    const offs = [
      api.onAnalysisState((s) => setAnalysis(s)),
      api.onEngineProgress((p) => p.command === 'analyze' && setAnalysis((a) => (a.running ? { ...a, ...p } : a))),
      api.onAnalysisDone((d) => { setReady(d); api.getSettings().then(setSettings); }),
      api.onObsStatus((s) => setObs((o) => ({ ...o, ...s }))),
      api.onObsState((s) => setObs((o) => ({ ...o, ...s }))),
      api.onObsEvent((e) => {
        if (e.type === 'streamStarted') setObs((o) => ({ ...o, streaming: true }));
        if (e.type === 'streamStopped') setObs((o) => ({ ...o, streaming: false }));
      }),
    ];
    return () => offs.forEach((off) => off && off());
  }, []);
  if (!settings) return null;
  if (!settings.firstRunDone) {
    return <Onboarding settings={settings} setSettings={setSettings} obs={obs} onDone={() => setPage('accueil')} />;
  }
  return (
    <div className="app">
      <Sidebar page={page} setPage={setPage} obs={obs} />
      <main className={page === 'montage' ? 'full' : ''}>
        {page === 'montage' && !session && <NoSession settings={settings} openSession={openSession} setPage={setPage} />}
        {page === 'montage' && session && <Editor key={session.stream.folder + session.theme} session={session} onBack={() => setPage('accueil')}
          onTheme={(th) => openSession(session.folderKey, th)}
          showTour={!settings.editorTourDone || (settings.editorTourVersion || 1) < TOUR_VERSION}
          tourSeen={settings.editorTourDone ? settings.editorTourVersion || 1 : 0}
          onTourDone={async () => setSettings(await api.updateSettings({ editorTourDone: true, editorTourVersion: TOUR_VERSION }))} />}
        {ready && page !== 'montage' && (
          <div className="ready">🎬 <b>Tes montages sont prêts</b> — {ready.title} ({ready.stats?.kills ?? 0} kills)
            <button className="btn sm" onClick={() => { openSession(ready.folder); setReady(null); }}>Ouvrir l'éditeur</button>
            <button className="link" onClick={() => setReady(null)}>Plus tard</button></div>)}
        {page === 'accueil' && <Accueil settings={settings} setSettings={setSettings} obs={obs} analysis={analysis} openSession={openSession} setPage={setPage} />}
        {page === 'lives' && <LivesPage openSession={openSession} />}
        {page === 'historique' && <Historique openSession={openSession} />}
        {page === 'reglages' && <Reglages settings={settings} setSettings={setSettings} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

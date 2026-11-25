import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import { Editor } from './editor.jsx';
import { DEMO_SESSION } from './demo-data.js';
import { THEMES, MODES } from './constants.js';
import { TwitchBlock } from './twitch-block.jsx';
import { Onboarding, PcTest } from './onboarding.jsx';

function Sidebar({ page, setPage, obs }) {
  const items = [['accueil', 'Accueil'], ['montage', 'Montage'], ['historique', 'Historique'], ['reglages', 'Réglages']];
  return (
    <aside className="side">
      <div className="logo">Sk<span>lip</span></div>
      {items.map(([id, label]) => (
        <button key={id} className={'nav' + (page === id ? ' on' : '')} onClick={() => setPage(id)}>{label}</button>
      ))}
      <div className="grow" />
      <div className="pill"><span className={'dot' + (obs.connected ? ' ok' : '')} />OBS {obs.connected ? 'connecté' : 'non connecté'}</div>
      <div className="pill"><span className={'dot' + (obs.streaming ? ' live' : '')} />{obs.streaming ? 'En live' : 'Hors live'}</div>
    </aside>
  );
}

function Accueil({ settings, setSettings, obs }) {
  const [job, setJob] = useState(null);
  useEffect(() => api.onEngineProgress((p) => setJob((j) => ({ ...j, ...p }))), []);
  const themes = settings.themes || [];
  const toggle = async (id) => {
    const next = themes.includes(id) ? themes.filter((t) => t !== id) : [...themes, id];
    setSettings(await api.updateSettings({ themes: next }));
  };
  const analyse = async () => {
    const video = await api.openVideo();
    if (!video) return;
    setJob({ message: 'Analyse…', fraction: 0, video });
    // La détection (kills, rires, chat…) arrive à l'étape suivante du développement.
  };
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
        <button className="btn" onClick={analyse}>Analyser une vidéo…</button>
        <button className="btn ghost">Analyser une VOD Twitch</button>
      </div>
      {job && (
        <div className="card" style={{ marginTop: 20 }}>
          <div>{job.message}</div>
          <div className="bar"><div style={{ width: `${Math.round((job.fraction || 0) * 100)}%` }} /></div>
        </div>
      )}
    </>
  );
}

function Historique() {
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
              <td><button className="btn ghost" onClick={() => api.openFolder(s.folder)}>Ouvrir le dossier</button></td>
            </tr>))}
          </tbody>
        </table>)}
    </>
  );
}

function Reglages({ settings, setSettings }) {
  const set = async (patch) => setSettings(await api.updateSettings(patch));
  return (
    <>
      <h1>Réglages</h1>
      <TwitchBlock />
      <h3>Test du PC</h3>
      <p className="note">Mesure si ton PC peut faire les clips pendant le live sans laguer. Le mieux : avec OBS et Valorant ouverts.</p>
      <PcTest settings={settings} setSettings={setSettings} compact />
      <div className="field"><label>Tutoriel</label>
        <div className="row">
          <button className="btn ghost sm" onClick={() => set({ firstRunDone: false, editorTourDone: false })}>Relancer le tuto</button>
          <span className="note">Réglages du début + bulles guidées dans l'éditeur.</span></div></div>
      <div className="banner">Sklip ne modifie jamais OBS : ni scènes, ni sources, ni pistes, ni format d'enregistrement.</div>
      <div className="field"><label>Adresse obs-websocket</label>
        <input defaultValue={settings.obs.url} onBlur={(e) => set({ obs: { url: e.target.value } })} /></div>
      <div className="field"><label>Mot de passe obs-websocket</label>
        <input type="password" defaultValue={settings.obs.password} onBlur={(e) => set({ obs: { password: e.target.value } })} /></div>
      <div className="field"><label>Lancer l'enregistrement OBS au début du live</label>
        <div><input type="checkbox" checked={settings.obs.autoRecord} onChange={(e) => set({ obs: { autoRecord: e.target.checked } })} />
          <div className="note">Appuie seulement sur « Démarrer l'enregistrement », avec tes réglages OBS.</div></div></div>
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
        <input defaultValue={settings.markerHotkey} onBlur={(e) => set({ markerHotkey: e.target.value })} /></div>
      <div className="field"><label>Garder les fichiers de travail</label>
        <div className="row"><input type="number" min="1" max="90" defaultValue={settings.retentionDays}
          onBlur={(e) => set({ retentionDays: Number(e.target.value) })} style={{ width: 80 }} /> jours
          <span className="note">Ton enregistrement OBS d'origine n'est jamais supprimé.</span></div></div>
    </>
  );
}

function App() {
  const [page, setPage] = useState('accueil');
  const [settings, setSettings] = useState(null);
  const [obs, setObs] = useState({ connected: false, streaming: false, recording: false });
  useEffect(() => {
    api.getSettings().then(setSettings);
    const offs = [
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
        {page === 'montage' && <Editor session={DEMO_SESSION} onBack={() => setPage('accueil')}
          showTour={!settings.editorTourDone}
          onTourDone={async () => setSettings(await api.updateSettings({ editorTourDone: true }))} />}
        {page === 'accueil' && <Accueil settings={settings} setSettings={setSettings} obs={obs} />}
        {page === 'historique' && <Historique />}
        {page === 'reglages' && <Reglages settings={settings} setSettings={setSettings} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

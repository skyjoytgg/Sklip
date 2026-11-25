// Assistant de départ : le streamer choisit ses réglages, teste son PC, puis découvre l'éditeur
// (bulles guidées, voir tour.jsx) au premier montage. Tout peut être passé et relancé dans les réglages.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { THEMES, MODES, FORMATS } from './constants.js';
import { TwitchBlock } from './twitch-block.jsx';

const VERDICTS = {
  live: { cls: 'ok', title: 'Ton PC peut faire les clips pendant le live',
    text: "Il a de la marge : l'analyse et les clips ne devraient pas faire baisser tes FPS." },
  limite: { cls: 'warn', title: "C'est limite",
    text: "Possible, mais tu risques des petites baisses de FPS en jeu. On te conseille de tout faire après le live." },
  apres: { cls: 'bad', title: 'Mieux vaut tout faire après le live',
    text: "Pendant le jeu, ton PC risque de laguer. Sklip fera l'analyse et les clips dès la fin du stream." },
};

/** Test du PC + verdict. Utilisé dans l'assistant et dans les réglages. */
export function PcTest({ settings, setSettings, compact }) {
  const [result, setResult] = useState(settings.pcTest || null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => api.onEngineProgress((p) => p.command === 'benchmark' && setJob((j) => j && { ...j, ...p })), []);
  const start = async () => {
    setError(null); setJob({ fraction: 0, message: 'Lecture des infos du PC' });
    try {
      const r = await api.testPc();
      setResult(r);
      setSettings(await api.getSettings());
    } catch (e) { setError(String(e.message || e)); }
    setJob(null);
  };
  const v = result && VERDICTS[result.verdict];
  return (
    <div className="pctest">
      {!job && (
        <div className="row">
          <button className="btn" onClick={start}>{result ? 'Refaire le test' : 'Lancer le test (≈ 30 s)'}</button>
          {!compact && <span className="note">Pour un résultat plus juste : ouvre OBS et Valorant (reste dans le menu) avant de lancer le test.</span>}
        </div>)}
      {job && (
        <div className="card">
          <div>{job.message}…</div>
          <div className="bar"><div style={{ width: `${Math.round((job.fraction || 0) * 100)}%` }} /></div>
        </div>)}
      {error && <div className="bad" style={{ marginTop: 10 }}>Le test a échoué : {error}</div>}
      {v && !job && (
        <div className={'verdict ' + v.cls}>
          <div className="big">{v.title}</div>
          <div>{v.text}</div>
          <ul>{result.reasons.map((r, i) => <li key={i} className="note">{r}</li>)}</ul>
          <div className="note">
            {result.cpu} · {result.cores} threads · {result.ramGB} Go de RAM{result.gpus?.length ? ` · ${result.gpus.join(', ')}` : ''}
          </div>
        </div>)}
    </div>
  );
}

function ModeChoice({ settings, set }) {
  const advised = settings.pcTest?.mode;
  return (
    <div className="modes">
      {Object.entries(MODES).map(([k, label]) => (
        <button key={k} className={'mode' + (settings.analysisMode === k ? ' on' : '')} onClick={() => set({ analysisMode: k })}>
          <b>{label}</b>{advised === k && <span className="tag">Conseillé</span>}
          <div className="note">{{
            end_of_stream: "Rien ne tourne pendant que tu joues. Les montages sont prêts quelques minutes après la fin du live.",
            live: "Sklip analyse pendant le live : les montages sont prêts presque tout de suite à la fin.",
            manual: "Tu lances l'analyse toi-même, quand tu veux, depuis l'accueil.",
          }[k]}</div>
        </button>))}
    </div>
  );
}

const CORNERS = [['tl', 'En haut à gauche'], ['tr', 'En haut à droite'], ['bl', 'En bas à gauche'], ['br', 'En bas à droite']];

function cornerOf(cam) {
  if (!cam || cam.enabled === false) return 'none';
  return (cam.y > 0.5 - cam.h / 2 ? 'b' : 't') + (cam.x > 0.5 - cam.w / 2 ? 'r' : 'l');
}

function camFor(corner, w) {
  const h = Math.min(0.6, w * (16 / 9) * (3 / 4)); // webcam en 4:3 dans une image 16:9
  return { enabled: true, w, h, x: corner[1] === 'r' ? 1 - w : 0, y: corner[0] === 'b' ? 1 - h : 0 };
}

function CamPicker({ settings, set }) {
  const cam = settings.cam;
  const corner = cornerOf(cam);
  const w = cam?.w || 0.22;
  return (
    <>
      <div className="camframe">
        <div className="camgame">Ton jeu</div>
        {corner !== 'none' && (
          <div className="camzone" style={{ left: `${cam.x * 100}%`, top: `${cam.y * 100}%`, width: `${cam.w * 100}%`, height: `${cam.h * 100}%` }}>CAM</div>)}
      </div>
      <div className="themes">
        {CORNERS.map(([k, label]) => (
          <button key={k} className={'chip' + (corner === k ? ' on' : '')} onClick={() => set({ cam: camFor(k, w) })}>{label}</button>))}
        <button className={'chip' + (corner === 'none' ? ' on' : '')} onClick={() => set({ cam: { ...cam, enabled: false } })}>Pas de webcam</button>
      </div>
      {corner !== 'none' && (
        <div className="row">Taille
          <input type="range" min="0.12" max="0.4" step="0.01" value={w} onChange={(e) => set({ cam: camFor(corner, Number(e.target.value)) })} />
        </div>)}
      <div className="note">En 9:16, Sklip met ta webcam en haut et le jeu en dessous. Tu pourras changer ça clip par clip dans l'éditeur.</div>
    </>
  );
}

function Toggle({ checked, onChange, children }) {
  return <label className="check"><input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} /> {children}</label>;
}

export function Onboarding({ settings, setSettings, obs, onDone }) {
  const [step, setStep] = useState(0);
  const set = async (patch) => setSettings(await api.updateSettings(patch));
  const finish = async (skipped) => {
    // Passer le tuto = passer aussi les bulles de l'éditeur.
    setSettings(await api.updateSettings({ firstRunDone: true, ...(skipped ? { editorTourDone: true } : {}) }));
    onDone();
  };
  const themes = settings.themes || [];
  const formats = settings.formats || [];
  const toggleIn = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const steps = [
    {
      title: 'Bienvenue sur Sklip 👋',
      body: (
        <>
          <p>Sklip repère les meilleurs moments de tes streams (kills, aces, clutchs, raids, fous rires…) et te prépare des montages courts pour TikTok, Shorts et YouTube.</p>
          <p>En 2 minutes, on règle tout ensemble :</p>
          <ol className="steps-list">
            <li>OBS et Twitch</li><li>Ta webcam</li><li>Tes thèmes et formats</li><li>Le son</li><li>Un test de ton PC</li>
          </ol>
          <p className="note">Ensuite, à ton premier montage, des bulles te montreront comment utiliser l'éditeur.</p>
        </>),
    },
    {
      title: 'OBS et Twitch',
      body: (
        <>
          <div className="banner">Sklip regarde OBS sans jamais le modifier : ni scènes, ni sources, ni pistes, ni format d'enregistrement.</div>
          <p className="note">Dans OBS : menu <b>Outils → Paramètres du serveur WebSocket</b> → coche « Activer le serveur WebSocket », puis « Afficher les informations de connexion » pour copier le mot de passe.</p>
          <div className="field"><label>Adresse obs-websocket</label>
            <input defaultValue={settings.obs.url} onBlur={(e) => set({ obs: { url: e.target.value } })} /></div>
          <div className="field"><label>Mot de passe obs-websocket</label>
            <input type="password" defaultValue={settings.obs.password} onBlur={(e) => set({ obs: { password: e.target.value } })} /></div>
          <div className="pill"><span className={'dot' + (obs.connected ? ' ok' : '')} />OBS {obs.connected ? 'connecté ✔' : 'pas encore connecté (OBS doit être ouvert)'}</div>
          <div style={{ marginTop: 16 }}><TwitchBlock /></div>
        </>),
    },
    { title: 'Où est ta webcam ?', body: <CamPicker settings={settings} set={set} /> },
    {
      title: 'Tes montages',
      body: (
        <>
          <div className="lbl">Thèmes à monter</div>
          <div className="themes">
            {THEMES.map((t) => (
              <button key={t.id} className={'chip' + (themes.includes(t.id) ? ' on' : '')} onClick={() => set({ themes: toggleIn(themes, t.id) })}>{t.label}</button>))}
          </div>
          <div className="lbl">Formats</div>
          <div className="themes">
            {FORMATS.map(([id, label]) => (
              <button key={id} className={'chip' + (formats.includes(id) ? ' on' : '')} onClick={() => set({ formats: toggleIn(formats, id) })}>{label}</button>))}
          </div>
          <div className="lbl">Durée des montages</div>
          <div className="row"><input type="range" min="15" max="60" step="5" value={settings.targetDuration}
            onChange={(e) => set({ targetDuration: Number(e.target.value) })} /> <b>{settings.targetDuration} s</b></div>
        </>),
    },
    {
      title: 'Le son',
      body: (
        <>
          <Toggle checked={settings.audio.captureEnabled} onChange={(v) => set({ audio: { captureEnabled: v } })}>
            Enregistrer à part le jeu, ton micro, Discord et la musique</Toggle>
          <p className="note">Sklip les enregistre lui-même (sans toucher à OBS) et les cale sur ta vidéo. Dans l'éditeur, tu pourras baisser chaque son séparément.</p>
          <div className="lbl">Au départ, dans tes montages</div>
          <Toggle checked={settings.audio.volumes.discord > 0} onChange={(v) => set({ audio: { volumes: { discord: v ? 1 : 0 } } })}>Discord activé</Toggle>
          <Toggle checked={settings.audio.volumes.music > 0} onChange={(v) => set({ audio: { volumes: { music: v ? 1 : 0 } } })}>Musique activée</Toggle>
          <p className="note">La musique est coupée par défaut : elle peut faire bloquer ou démonétiser tes vidéos (droits d'auteur).</p>
        </>),
    },
    {
      title: 'Ton PC peut-il faire les clips pendant que tu joues ?',
      body: (
        <>
          <p>Sklip mesure la puissance de ton PC et te dit si faire les clips pendant le live risque de faire laguer ton jeu.</p>
          <PcTest settings={settings} setSettings={setSettings} />
          <div className="lbl" style={{ marginTop: 20 }}>Quand veux-tu que Sklip travaille ? (tu choisis)</div>
          <ModeChoice settings={settings} set={set} />
        </>),
    },
    {
      title: "C'est prêt ! 🎉",
      body: (
        <>
          <p>Tes réglages sont enregistrés. Tu peux les changer quand tu veux dans <b>Réglages</b>.</p>
          <p>À la fin de ton prochain live, ouvre <b>Montage</b> : des bulles te montreront en 1 minute comment ajuster tes clips et exporter.</p>
        </>),
    },
  ];
  const last = step === steps.length - 1;
  return (
    <div className="onboard">
      <div className="ob-card">
        <div className="ob-top">
          <div className="logo">Sk<span>lip</span></div>
          <div className="dots">{steps.map((_, i) => <span key={i} className={i === step ? 'on' : i < step ? 'done' : ''} />)}</div>
          <button className="link" onClick={() => finish(true)}>Passer le tuto</button>
        </div>
        <h1>{steps[step].title}</h1>
        <div className="ob-body">{steps[step].body}</div>
        <div className="ob-nav">
          {step > 0 ? <button className="btn ghost" onClick={() => setStep(step - 1)}>← Précédent</button> : <span />}
          {last ? <button className="btn" onClick={() => finish(false)}>Terminer</button>
            : <button className="btn" onClick={() => setStep(step + 1)}>{step === 0 ? "C'est parti" : 'Suivant →'}</button>}
        </div>
      </div>
    </div>
  );
}

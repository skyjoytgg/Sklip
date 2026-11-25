// Tes scènes OBS : jeu, discussion (Just Chatting) ou pause. Sklip devine, le streamer confirme ou corrige.
// Lu dans OBS en lecture seule : rien n'est modifié dans OBS.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';

const TYPES = [
  ['jeu', 'Jeu', 'Webcam en haut, jeu en bas'],
  ['discussion', 'Discussion', 'Webcam en grand'],
  ['pause', 'Pause', 'Pas de clips'],
];
const ICON = { jeu: 'kill', discussion: 'chat', pause: 'record' };

function Mini({ cam, type }) {
  return (
    <div className={'sc-mini t-' + type}>
      {type === 'jeu' && <span className="sc-game" />}
      {cam && <span className="sc-cam" style={{ left: `${cam.x * 100}%`, top: `${cam.y * 100}%`, width: `${cam.w * 100}%`, height: `${cam.h * 100}%` }} />}
    </div>
  );
}

export function SceneTypes({ settings, set }) {
  const [scenes, setScenes] = useState(undefined);
  const load = () => api.obsScenes().then(setScenes);
  useEffect(() => { load(); }, []);
  const choose = async (name, type) => {
    await set({ sceneTypes: { ...(settings.sceneTypes || {}), [name]: type } });
    load();
  };
  if (scenes === undefined) return <div className="note">Lecture des scènes d'OBS…</div>;
  if (!scenes) {
    return (
      <div className="banner">OBS n'est pas connecté : ouvre OBS (et son serveur WebSocket), puis
        <button className="link" style={{ marginLeft: 6 }} onClick={load}>réessaie</button>.</div>
    );
  }
  return (
    <div className="sc-list">
      {scenes.map((s) => (
        <div key={s.name} className="sc-row">
          <Mini cam={s.cam} type={s.type} />
          <div className="sc-name">
            <b>{s.name}</b>
            <div className="note">{s.chosen ? 'Choisi par toi' : 'Deviné par Sklip'}{s.cam ? '' : ' · pas de webcam dans cette scène'}</div>
          </div>
          <div className="sc-types">
            {TYPES.map(([id, label, hint]) => (
              <button key={id} className={'sc-type' + (s.type === id ? ' on t-' + id : '')} title={hint} onClick={() => choose(s.name, id)}>
                <Icon name={ICON[id]} size={14} /> {label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="note">Jeu : webcam en haut et jeu en bas dans les clips verticaux. Discussion : ta webcam en grand.
        Pause (« Je reviens », écran de fin…) : Sklip n'y fait pas de clips.</div>
    </div>
  );
}

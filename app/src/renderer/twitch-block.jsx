import { useEffect, useState } from 'react';
import { api } from './api.js';

export function TwitchBlock() {
  const [st, setSt] = useState({ connected: false });
  const [code, setCode] = useState(null);
  useEffect(() => {
    api.twitchStatus().then(setSt);
    return api.onTwitchStatus((s) => { setSt(s); setCode(null); });
  }, []);
  if (st.connected) {
    return (
      <div className="twitch on">
        <div><b>Connecté à Twitch</b> en tant que {st.user?.name}</div>
        <button className="btn ghost sm" onClick={async () => setSt(await api.twitchLogout())}>Se déconnecter</button>
      </div>);
  }
  if (code) {
    return (
      <div className="twitch">
        <div>Une page Twitch s'est ouverte. Vérifie que ce code s'affiche, puis clique sur <b>Activer</b> :
          <div className="code">{code.userCode}</div>
          <span className="note">En attente de ta validation…</span></div>
        <button className="btn ghost sm" onClick={() => { api.twitchCancelLogin(); setCode(null); }}>Annuler</button>
      </div>);
  }
  return (
    <div className="twitch">
      <div><b>Twitch</b><div className="note">Pour les raids, les viewers, le chat et les clips de tes viewers.</div>
        {st.error && <div className="bad">{st.error}</div>}</div>
      <button className="btn" onClick={async () => setCode(await api.twitchLogin())}>Se connecter avec Twitch</button>
    </div>);
}

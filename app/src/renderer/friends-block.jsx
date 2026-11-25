import { useEffect, useState } from 'react';
import { api } from './api.js';

const REASONS = { ace: 'un ace', clutch: 'un clutch', manuel: 'un clip' };
const when = (ms) => new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Réglages → Amis de confiance : juste les pseudos Twitch des potes. Le reste passe par le serveur Sklip. */
export function FriendsBlock({ settings, set }) {
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState([]);
  const [add, setAdd] = useState('');
  const friends = settings.friends || [];
  const refresh = () => { api.friendsStatus().then(setStatus); api.friendsPending().then(setPending); };
  useEffect(() => {
    refresh();
    const offs = [api.onFriendsEvent(refresh), api.onTwitchStatus(refresh)];
    return () => offs.forEach((off) => off && off());
  }, []);

  const setFriends = (list) => set({ friends: list });
  const addFriend = () => {
    const login = add.trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//, '');
    if (!login || friends.some((f) => f.login === login)) return;
    setFriends([...friends, { login, autoAccept: true }]);
    setAdd('');
  };

  return (
    <>
      <h3>Amis de confiance</h3>
      <p className="note">
        Quand tu fais un ace ou un clutch <b>en chat partagé</b> avec un pote, Sklip récupère <b>sa webcam</b> sur ces quelques secondes
        (son son est déjà sur ta piste Discord) et l'ajoute à ton clip. Ça marche dans les deux sens.
        Il faut juste que ton pote ait Sklip et que vous vous ajoutiez tous les deux. Rien d'autre à régler.
      </p>
      <ul className="note friendrules">
        <li>Ta webcam n'est envoyée que si ton Sklip t'a vu <b>en chat partagé</b> avec ce pote à ce moment-là.</li>
        <li>Seulement les quelques secondes du clip, jamais toute ta VOD, et jamais pendant ton live.</li>
        <li>Effacé du serveur Sklip dès que ton pote l'a récupéré (7 jours au plus tard).</li>
      </ul>
      {status && !status.ready && (
        <div className="banner">{status.reason === 'twitch'
          ? 'Connecte Twitch (au-dessus) pour utiliser les amis de confiance.'
          : "Le serveur Sklip des amis n'est pas encore en ligne dans cette version."}</div>
      )}
      {status && status.ready && status.offline && (
        <div className="banner">Serveur Sklip injoignable (pas d'internet ?). Tes demandes partiront toutes seules dès que ça revient.</div>
      )}
      {status && status.ready && (status.outbox > 0 || (status.waiting || []).length > 0) && (
        <div className="note friendwait">
          {status.outbox > 0 && <div>📤 {status.outbox} demande(s) pas encore envoyée(s)</div>}
          {(status.waiting || []).map((w, i) => (
            <div key={i}>⏳ En attente de <b>{w.to}</b>{w.reason ? ` (${w.reason})` : ''} : son Sklip répondra dès qu'il sera ouvert</div>
          ))}
        </div>
      )}
      <div className="field"><label>Tes potes</label>
        <div>
          {friends.map((f) => (
            <div className="row friend" key={f.login}>
              <b style={{ minWidth: 140 }}>{f.login}</b>
              <label className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={f.autoAccept !== false}
                  onChange={(e) => setFriends(friends.map((x) => (x.login === f.login ? { ...x, autoAccept: e.target.checked } : x)))} />
                Envoyer ma réaction sans me demander</label>
              <button className="link" onClick={() => setFriends(friends.filter((x) => x.login !== f.login))}>Retirer</button>
            </div>
          ))}
          <div className="row">
            <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="pseudo Twitch du pote" style={{ width: 200 }}
              onKeyDown={(e) => e.key === 'Enter' && addFriend()} />
            <button className="btn ghost sm" onClick={addFriend} disabled={!add.trim()}>Ajouter</button>
          </div>
        </div></div>
      {pending.length > 0 && (
        <div className="field"><label>Demandes reçues</label>
          <div>
            {pending.map((p) => (
              <div className="row friend" key={p.id}>
                <span><b>{p.from}</b> voudrait ta réaction sur {REASONS[p.reason] || 'un moment'} ({when(p.wall_start)})</span>
                <button className="btn sm" onClick={async () => { await api.friendsAccept(p.id); refresh(); }}>Envoyer</button>
                <button className="link" onClick={async () => { await api.friendsRefuse(p.id); refresh(); }}>Refuser</button>
              </div>
            ))}
          </div></div>
      )}
    </>
  );
}

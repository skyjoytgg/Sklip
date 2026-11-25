// Accueil : « Vérifier avant le live ». Un clic → OBS, scènes, overlays, disque, micro, Discord, Twitch, marqueurs.
import { useState } from 'react';
import { api } from './api.js';

const DOT = { ok: '✓', warn: '!', error: '✕', info: 'i' };

export function PrecheckCard() {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { setRes(await api.precheck()); } catch (e) { setRes({ rows: [], verdict: { level: 'error', text: String(e.message || e) } }); }
    setBusy(false);
  };
  return (
    <div className="pc-card">
      <div className="pc-head">
        <div>
          <h3>Avant le live</h3>
          <div className="note">Lance la vérification juste avant de démarrer ton live : OBS, scènes, micro, Discord, Twitch, marqueurs.</div>
        </div>
        <button className="btn" onClick={run} disabled={busy}>{busy ? 'Vérification…' : res ? 'Revérifier' : 'Vérifier avant le live'}</button>
      </div>
      {res && (
        <>
          <div className={'pc-verdict l-' + res.verdict.level}>{res.verdict.text}</div>
          <div className="pc-rows">
            {res.rows.map((r) => (
              <div key={r.id} className={'pc-row l-' + r.level}>
                <span className="pc-dot">{DOT[r.level]}</span>
                <b>{r.label}</b>
                <span className="note">{r.detail}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Durée des montages : 30 s à 5 min (1 min par défaut, demande de Sky du 26/11 : clips plus larges = montages plus longs).
import { DURATIONS, durationLabel } from './constants.js';

export function DurationPicker({ value, onChange }) {
  return (
    <div>
      <div className="themes">
        {DURATIONS.map((d) => (
          <button key={d} className={'chip' + (value === d ? ' on' : '')} onClick={() => onChange(d)}>
            {durationLabel(d)}{d === 60 ? ' (conseillé)' : ''}</button>))}
      </div>
      <div className="note" style={{ marginTop: 6 }}>
        {value <= 30 ? 'Une seule action par montage.' : value <= 60 ? '2 ou 3 actions, avec le contexte avant chacune.'
          : 'Un vrai résumé du live.'}
        {value > 180 ? ' En 9:16 : trop long pour YouTube Shorts (3 min max), OK pour TikTok.' : ''}
      </div>
    </div>);
}

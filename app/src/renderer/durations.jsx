// Durée des montages : 30 s à 5 min, réglée PAR THÈME (Sky, 26/11 : « un TikTok kills / multi-kills,
// un autre drôle / discussion, et un plus long Best-of »). Par défaut 1 min, Best-of 5 min.
import { DURATIONS, THEMES, durationLabel } from './constants.js';

export const DEFAULT_THEME_DURATIONS = { kills: 60, drole: 60, communaute: 60, discussion: 60, bestof: 300 };

export const themeDuration = (settings, th) =>
  ((settings.themeDurations || {})[th]) || DEFAULT_THEME_DURATIONS[th] || settings.targetDuration || 60;

export function DurationPicker({ value, onChange, advised = 60, compact }) {
  return (
    <div>
      <div className="themes">
        {DURATIONS.map((d) => (
          <button key={d} className={'chip' + (value === d ? ' on' : '')} onClick={() => onChange(d)}>
            {durationLabel(d)}{d === advised && !compact ? ' (conseillé)' : ''}</button>))}
      </div>
      {!compact && <div className="note" style={{ marginTop: 6 }}>
        {value <= 30 ? 'Une seule action par montage.' : value <= 60 ? '2 ou 3 actions, avec le contexte avant chacune.'
          : 'Un vrai résumé du live.'}
        {value > 180 ? ' En 9:16 : trop long pour YouTube Shorts (3 min max), OK pour TikTok.' : ''}
      </div>}
    </div>);
}

/** Une ligne par thème choisi : sa durée. */
export function ThemeDurations({ settings, set }) {
  const themes = THEMES.filter((t) => (settings.themes || []).includes(t.id));
  const change = (id, d) => set({ themeDurations: { ...DEFAULT_THEME_DURATIONS, ...(settings.themeDurations || {}), [id]: d } });
  if (!themes.length) return <div className="note">Choisis d'abord au moins un thème.</div>;
  return (
    <div className="theme-durations">
      {themes.map((t) => {
        const v = themeDuration(settings, t.id);
        return (
          <div key={t.id} className="td-row">
            <div className="td-name">{t.label}</div>
            <DurationPicker value={v} onChange={(d) => change(t.id, d)} compact />
            {v > 180 && <div className="note">En 9:16 : trop long pour YouTube Shorts (3 min max), OK pour TikTok.</div>}
          </div>);
      })}
      <div className="note">Conseillé : 1 min pour un TikTok (Kills, Drôle), 5 min pour le Best-of.</div>
    </div>);
}

/** Résumé pour l'accueil : « Kills 1 min · Best-of 5 min ». */
export function durationsSummary(settings) {
  const short = { kills: 'Kills', drole: 'Drôle', communaute: 'Commu', discussion: 'Discussion', bestof: 'Best-of' };
  return (settings.themes || []).map((th) => `${short[th] || th} ${durationLabel(themeDuration(settings, th))}`).join(' · ');
}

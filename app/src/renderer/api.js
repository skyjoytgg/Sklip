// Dans Electron : window.sklip (preload). Dans un navigateur : données factices pour l'aperçu.
const progressCbs = new Set();
const twitchCbs = new Set();
let twitchState = { connected: false };
const mock = (() => {
  let settings = {
    obs: { url: 'ws://127.0.0.1:4455', password: '', autoRecord: false },
    analysisMode: 'end_of_stream', themes: ['kills', 'drole'], targetDuration: 30, formats: ['9x16', '16x9'],
    audio: { captureEnabled: true }, markerHotkey: 'F9', retentionDays: 7,
  };
  const noop = () => () => {};
  return {
    getSettings: async () => settings,
    updateSettings: async (p) => {
      settings = { ...settings, ...p, obs: { ...settings.obs, ...(p.obs || {}) }, audio: { ...settings.audio, ...(p.audio || {}) } };
      return settings;
    },
    engine: async (command) => {
      // Aperçu : simule l'avancement d'un rendu.
      for (let i = 1; i <= 5; i++) {
        await new Promise((r) => setTimeout(r, 300));
        progressCbs.forEach((cb) => cb({ command, fraction: i / 5, message: i < 5 ? `Clip ${i}/4` : 'Terminé' }));
      }
      return { output: 'Sklip/Streams/2026-11-24_ranked-avec-les-potes/montages/sklip_kills_9x16.mp4' };
    },
    listStreams: async () => [
      { name: '2026-11-24_ranked-avec-les-potes', title: 'Ranked avec les potes', folder: '',
        stats: { kills: 87, aces: 1, raids: [{ channel: 'Kamel', viewers: 42 }], peak_viewers: 134 } },
    ],
    openVideo: async () => null,
    twitchStatus: async () => twitchState,
    twitchLogin: async () => {
      setTimeout(() => { twitchState = { connected: true, user: { name: 'Sky', login: 'sky' } }; twitchCbs.forEach((cb) => cb(twitchState)); }, 2500);
      return { userCode: 'WXYZ-1234', url: 'https://www.twitch.tv/activate' };
    },
    twitchCancelLogin: async () => {},
    twitchLogout: async () => { twitchState = { connected: false }; return twitchState; },
    twitchVideos: async () => [],
    onTwitchStatus: (cb) => { twitchCbs.add(cb); return () => twitchCbs.delete(cb); },
    onTwitchEvent: noop,
    openFolder: async () => {},
    onObsStatus: (cb) => { setTimeout(() => cb({ connected: true }), 0); return () => {}; },
    onObsState: noop, onObsEvent: noop, onObsError: noop,
    onEngineProgress: (cb) => { progressCbs.add(cb); return () => progressCbs.delete(cb); },
  };
})();

export const api = typeof window !== 'undefined' && window.sklip ? window.sklip : mock;

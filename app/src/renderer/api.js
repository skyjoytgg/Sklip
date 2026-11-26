// Dans Electron : window.sklip (preload). Dans un navigateur : données factices pour l'aperçu.
import { DEMO_SESSION, DEMO_JOURNAL, DEMO_LIVES, demoLive } from './demo-data.js';
const progressCbs = new Set();
const twitchCbs = new Set();
let twitchState = { connected: false };
const mock = (() => {
  let settings = {
    obs: { url: 'ws://127.0.0.1:4455', password: '', autoRecord: false },
    analysisMode: 'end_of_stream', themes: ['kills', 'drole'], targetDuration: 30, formats: ['9x16', '16x9'],
    audio: { captureEnabled: true, volumes: { game: 1, mic: 1, discord: 1, music: 0 } }, markerHotkey: 'F9', retentionDays: 7,
    cam: { x: 0, y: 0, w: 0.22, h: 0.3 }, friends: [{ login: 'kamel', autoAccept: true }], firstRunDone: false, editorTourDone: false, pcTest: null,
  };
  const merge = (a, b) => (b && typeof b === 'object' && !Array.isArray(b) && a && typeof a === 'object'
    ? Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, k in b ? merge(a[k], b[k]) : a[k]]))
    : (b === undefined ? a : b));
  const noop = () => () => {};
  return {
    getSettings: async () => settings,
    updateSettings: async (p) => {
      settings = merge(settings, p);
      return settings;
    },
    engine: async (command, params) => {
      if (command === 'transcribe') {   // Aperçu : faux sous-titres
        await new Promise((r) => setTimeout(r, 600));
        return { clips: Object.fromEntries(params.clips.map((c) => [c.id, [
          { start: c.start + 0.5, end: c.start + 0.9, text: 'Oh' }, { start: c.start + 0.9, end: c.start + 1.3, text: 'non' },
          { start: c.start + 1.3, end: c.start + 1.9, text: 'regarde!' }, { start: c.start + 3, end: c.start + 3.6, text: 'Il' },
          { start: c.start + 3.6, end: c.start + 4.1, text: 'est' }, { start: c.start + 4.1, end: c.start + 4.8, text: 'mort!' }]])) };
      }
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
    journalList: async () => [{ id: DEMO_JOURNAL.id, start: DEMO_JOURNAL.start, stop: DEMO_JOURNAL.stop, count: DEMO_JOURNAL.events.length, problems: 1 },
      { id: DEMO_JOURNAL.id - 2 * 86400e3, start: DEMO_JOURNAL.id - 2 * 86400e3, stop: DEMO_JOURNAL.id - 2 * 86400e3 + 3 * 3600e3, count: 9, problems: 0 }],
    journalGet: async () => DEMO_JOURNAL,
    onJournal: noop,
    obsScenes: async () => [
      { name: 'Just Chatting', guess: 'discussion', type: settings.sceneTypes?.['Just Chatting'] || 'discussion', chosen: !!settings.sceneTypes?.['Just Chatting'], cam: { x: 0.125, y: 0, w: 0.75, h: 1 }, full: true },
      { name: 'Valorant', guess: 'jeu', type: settings.sceneTypes?.Valorant || 'jeu', chosen: !!settings.sceneTypes?.Valorant, cam: { x: 0.026, y: 0.056, w: 0.224, h: 0.222 }, full: false, overlays: [{ name: 'Logo', zones: ['kill'], rect: { x: 0.448, y: 0.759, w: 0.104, h: 0.111 } }] },
      { name: 'Je reviens', guess: 'pause', type: settings.sceneTypes?.['Je reviens'] || 'pause', chosen: !!settings.sceneTypes?.['Je reviens'], cam: null, full: false },
      { name: 'Valo + grande cam', guess: 'discussion', type: settings.sceneTypes?.['Valo + grande cam'] || 'discussion', chosen: !!settings.sceneTypes?.['Valo + grande cam'], cam: { x: 0.55, y: 0.3, w: 0.45, h: 0.7 }, full: false },
    ],
    livesList: async () => DEMO_LIVES,
    liveGet: async (folder) => demoLive(folder),
    liveThumb: async (folder) => (typeof window !== 'undefined' && window.__demoThumbs ? window.__demoThumbs[folder] : null) || null,
    openVideo: async () => null,
    analyzeVideo: async () => ({ folder: 'demo' }),
    analysisStatus: async () => ({ running: false }),
    editorSession: async (_f, theme) => ({ ...DEMO_SESSION, theme: theme || 'kills', themes: ['kills', 'drole'] }),
    onAnalysisState: noop, onAnalysisDone: noop,
    saveSticker: async (_f, name) => `demo/${name}.png`,
    agentsList: async () => [{ uuid: '707eab51-4836-f488-046a-cda6bf494859', name: 'Viper' }, { uuid: 'a3bfb853-43b2-7238-a4f1-ad90e9e46bcc', name: 'Reyna' },
      { uuid: 'bb2a4828-46eb-8cd1-e765-15848195d751', name: 'Neon' }],
    agentPortrait: async (uuid) => (typeof window !== 'undefined' && window.__demoPortraits ? window.__demoPortraits[uuid] : null) || null,
    addMarker: async () => ({ at: Date.now() }),
    markerHotkeyOk: async () => true,
    onMarker: noop,
    bugReport: async () => 'Bureau/sklip-rapport.txt',
    openLogs: async () => {},
    testPc: async () => {
      // Aperçu : faux test d'un PC puissant.
      for (const [f, m] of [[0.05, 'Préparation de la vidéo de test'], [0.35, "Mesure de la vitesse d'analyse"], [0.85, "Recherche de l'encodeur vidéo"]]) {
        progressCbs.forEach((cb) => cb({ command: 'benchmark', fraction: f, message: m }));
        await new Promise((r) => setTimeout(r, 500));
      }
      settings.pcTest = { verdict: 'live', mode: 'live', projected: 62, cpu: 'AMD Ryzen 7 (aperçu)', cores: 16, ramGB: 32, gpus: ['AMD Radeon (aperçu)'],
        reasons: ["Valorant n'était pas ouvert : on a supposé qu'il prendrait ~55 % du processeur.", 'Analyse : 11.4× plus rapide que le temps réel.'] };
      return settings.pcTest;
    },
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
    obsCurrent: async () => ({ connected: true }),
    precheck: async () => ({ at: Date.now(), verdict: { level: 'warn', text: 'Prêt, 1 point à vérifier' }, rows: [
      { id: 'obs', label: 'OBS', level: 'ok', detail: 'Connecté (lecture seule : Sklip ne touche à rien).' },
      { id: 'scenes', label: 'Scènes OBS', level: 'ok', detail: 'Jeu : Valorant · Discussion : Just Chatting' },
      { id: 'ov', label: 'Overlay « Logo »', level: 'warn', detail: 'Dans « Valorant », il cache la bannière des kills : des moments peuvent être ratés.' },
      { id: 'disk', label: "Disque de l'enregistrement", level: 'ok', detail: '412 Go libres.' },
      { id: 'mic', label: 'Micro', level: 'ok', detail: 'Capté (essai de 2 secondes).' },
      { id: 'game', label: 'Son du jeu', level: 'info', detail: 'Valorant pas encore ouvert : Sklip le captera dès que tu le lances.' },
      { id: 'discord', label: 'Discord', level: 'ok', detail: 'Discord ouvert : son capté.' },
      { id: 'twitch', label: 'Twitch', level: 'ok', detail: 'Connecté : raids, chat, catégorie et clips des viewers.' },
      { id: 'markers', label: 'Marqueurs', level: 'ok', detail: 'Prêts : touche F9 et Stream Deck.' }] }),
    onObsState: noop, onObsEvent: noop, onObsError: noop,
    onEngineProgress: (cb) => { progressCbs.add(cb); return () => progressCbs.delete(cb); },
    friendsStatus: async () => ({ ready: true, login: 'sky' }),
    friendsForClip: async () => ['kamel'],
    friendsPending: async () => [{ id: 'kamel-sky-1', from: 'kamel', reason: 'ace', wall_start: Date.now() - 3600e3 }],
    friendsAccept: async () => {}, friendsRefuse: async () => {},
    friendsRequest: async () => 'demo', friendsCheck: async () => {},
    onFriendsEvent: noop,
  };
})();

export const api = typeof window !== 'undefined' && window.sklip ? window.sklip : mock;

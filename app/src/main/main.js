// Processus principal d'Electron : fenêtre, OBS (lecture seule), moteur, réglages.

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Notification, globalShortcut } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { ObsWatcher } = require('./obs-watcher');
const { runEngine } = require('./engine-bridge');
const { Settings } = require('./settings');
const { TwitchAuth, TwitchLive } = require('./twitch');
const tm = require('./twitch-moments');
const perf = require('./perf');
const { Logger } = require('./logger');
const pipeline = require('./pipeline');
const { Markers } = require('./markers');
const { LiveAnalyzer } = require('./live-analysis');
const { FriendService, PRESENCE_EVERY } = require('./friends');

let win = null;
let obs = null;
let settings = null;
let twitch = null;
let twitchLive = null;
let obsTimes = { recordStartedAt: null, recordStoppedAt: null };
let markers = [];          // appuis sur le raccourci marqueur pendant l'enregistrement : [{ at, source }]
let analysisRunning = null;
let markerService = null;
let audioCapture = null;
let liveAnalyzer = null;   // mode « pendant le stream »   // { folder, done: Promise<info> } pendant un enregistrement OBS
let friendService = null; // amis de confiance (réactions sur aces / clutchs)
let sharedChatTimer = null; // pendant l'enregistrement : relevé du chat partagé Twitch toutes les 2 min
let log = { info() {}, warn() {}, error() {} };   // remplacé par le vrai journal au démarrage

// Jetons Twitch chiffrés avec le coffre de Windows (safeStorage / DPAPI).
function tokenStore() {
  const file = path.join(app.getPath('userData'), 'twitch.bin');
  return {
    load() {
      try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(file))); } catch { return null; }
    },
    save(tokens) {
      if (!tokens) { fs.rmSync(file, { force: true }); return; }
      fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(tokens)));
    },
  };
}

function startTwitchLive() {
  if (twitchLive) twitchLive.stop();
  if (!twitch.isConnected()) return;
  twitchLive = new TwitchLive(twitch);
  twitchLive.on('streamOnline', (d) => send('twitch:event', { type: 'online', ...d }));
  twitchLive.on('raid', (r) => send('twitch:event', { type: 'raid', ...r }));
  twitchLive.on('marker', (m) => send('twitch:event', { type: 'marker', ...m }));
  twitchLive.on('error', (e) => { log.warn('Twitch :', e); send('twitch:error', { message: String(e && e.message || e) }); });
  twitchLive.on('streamOffline', (data) => onTwitchStreamEnded(data).catch((e) => send('twitch:error', { message: e.message })));
  twitchLive.start();
}

/** Fin du live : clips des viewers + conversion de tout en moments, sauvegardés pour l'analyse. */
async function onTwitchStreamEnded(data) {
  const s = settings.get();
  const clips = await twitch.getClips(twitch.tokens.user.id, new Date(data.startedAt).toISOString(),
    new Date(data.endedAt).toISOString()).catch(() => []);
  let moments = [
    ...tm.raidMoments(data.raids, data.startedAt),
    ...tm.viewerPeakMoments(data.viewers, data.startedAt, s.viewerPeak),
    ...tm.chatSpikeMoments(data.chat, data.startedAt, { keywords: s.chatKeywords }),
    ...tm.chatMarkerMoments(data.chat, data.startedAt),
    ...tm.viewerClipMoments(clips, data.startedAt),
  ];
  if (obsTimes.recordStartedAt) moments = tm.streamToRecordingTime(moments, data.startedAt, obsTimes.recordStartedAt);
  const dir = path.join(app.getPath('userData'), 'pending');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `twitch-${data.startedAt}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...data, clips, moments, recordStartedAt: obsTimes.recordStartedAt }, null, 2));
  send('twitch:event', { type: 'offline', file, moments: moments.length });
}

const engineLocation = () => ({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  devEngineDir: path.join(__dirname, '..', '..', '..', 'engine'),
});

const libraryRoot = () => settings.get().libraryRoot || path.join(app.getPath('documents'), 'Sklip');

/** Lance une commande du moteur (avec avancement envoyé à l'interface) et note les erreurs dans le journal. */
async function engine(command, params = {}) {
  log.info(`Moteur : ${command}`);
  const t0 = Date.now();
  try {
    const r = await runEngine(engineLocation(), command, params, (p) => send('engine:progress', { command, ...p }));
    log.info(`Moteur : ${command} terminé en ${Math.round((Date.now() - t0) / 1000)} s`);
    return r;
  } catch (e) {
    log.error(`Moteur : ${command} a échoué :`, e);
    throw e;
  }
}

const pendingDir = () => path.join(app.getPath('userData'), 'pending');

/**
 * Analyse complète d'une vidéo → dossier du stream (session.json) → l'éditeur peut l'ouvrir.
 * `rec` : instants de début/fin de l'enregistrement OBS (pour caler Twitch et les marqueurs), absent pour une vidéo choisie à la main.
 */
async function runAnalysis(video, rec = {}) {
  if (analysisRunning) throw new Error('Une analyse est déjà en cours.');
  const s = settings.get();
  const tw = rec.start ? pipeline.pickTwitchData(pipeline.readPendingTwitch(pendingDir()), rec.start, rec.stop || Date.now()) : null;
  const extras = pipeline.twitchExtras(tw, rec.start);
  const extraMoments = [...extras.moments, ...pipeline.markerMoments(rec.markers || [], rec.start)];
  const title = rec.title || pipeline.streamTitle(extras.title, rec.start ? new Date(rec.start) : new Date());
  analysisRunning = { video, startedAt: Date.now() };
  send('analysis:state', { running: true, video, title });
  try {
    const session = await engine('analyze', {
      video, root: libraryRoot(), title: rec.title === undefined && !rec.start ? path.parse(video).name : title,
      themes: s.themes, target: s.targetDuration, extra_moments: extraMoments, extra_stats: extras.stats,
      day: new Date(rec.start || Date.now()).toISOString().slice(0, 10), capture: rec.capture || undefined,
      record_started_at: rec.start ? rec.start / 1000 : undefined,
      partial_scans: rec.partialScans && rec.partialScans.length ? rec.partialScans : undefined,
    });
    settings.update({ lastSessionFolder: session.folder });
    if (friendService && rec.start) friendService.requestForSession(session).catch((e) => log.warn('Amis :', e));
    log.info(`Analyse terminée : ${session.moments.length} moments → ${session.folder}`);
    send('analysis:done', { folder: session.folder, title: session.title, stats: session.stats });
    if (Notification.isSupported() && (!win || !win.isFocused())) {
      new Notification({ title: 'Sklip : tes montages sont prêts', body: `${session.title} — ${session.stats.kills} kills, ${session.stats.multikills} multi-kills` }).show();
    }
    return { folder: session.folder };
  } finally {
    analysisRunning = null;
    send('analysis:state', { running: false });
  }
}

const capturesDir = () => path.join(app.getPath('userData'), 'captures');

/** Démarre la capture des pistes (jeu, micro, Discord, musique) par Sklip, en même temps que l'enregistrement OBS. */
function startAudioCapture() {
  const s = settings.get();
  if (!s.audio.captureEnabled || audioCapture) return;
  const folder = path.join(capturesDir(), new Date().toISOString().replace(/[:.]/g, '-'));
  log.info('Capture audio :', folder);
  const done = engine('capture', { folder, music_exe: s.audio.musicApp || undefined, game_exe: s.audio.gameApp || undefined })
    .catch((e) => { log.error('Capture audio :', e); return null; });
  audioCapture = { folder, done };
  send('capture:state', { running: true });
}

/** Arrête la capture (fichier « stop ») ; renvoie la promesse des infos de capture. */
function stopAudioCapture() {
  if (!audioCapture) return null;
  const { folder, done } = audioCapture;
  audioCapture = null;
  try { fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'stop'), ''); } catch (e) { log.error('Arrêt de la capture :', e); }
  send('capture:state', { running: false });
  return done;
}

/** Supprime les captures de Sklip plus vieilles que la durée choisie (jamais l'enregistrement OBS). */
function cleanupCaptures() {
  const dir = capturesDir();
  if (!fs.existsSync(dir)) return;
  const max = (settings.get().retentionDays || 7) * 86400e3;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try { if (Date.now() - fs.statSync(p).mtimeMs > max) fs.rmSync(p, { recursive: true, force: true }); } catch { /* fichier occupé */ }
  }
}

/** Fin d'un enregistrement OBS : analyse automatique (sauf en mode manuel). */
async function onRecordingFinished(e, capturePromise, livePromise) {
  const s = settings.get();
  const info = capturePromise ? await capturePromise : null;
  const live = livePromise ? await livePromise : null;
  if (s.analysisMode === 'manual' || !e.path) return;
  const rec = { start: obsTimes.recordStartedAt, stop: e.at, markers: [...markers],
    capture: info ? { info, record_started_at: obsTimes.recordStartedAt / 1000 } : null,
    partialScans: live && live.video && path.resolve(live.video) === path.resolve(e.path) ? live.chunks : [] };
  // Twitch prévient de la fin du live avec un peu de retard : on lui laisse le temps d'arriver.
  if (twitch && twitch.isConnected()) await new Promise((r) => setTimeout(r, 90 * 1000));
  await runAnalysis(e.path, rec);
}

/** Pendant l'enregistrement : toutes les 2 min, qui est dans le chat partagé Twitch (pour les réactions des potes). */
function startSharedChatWatch() {
  stopSharedChatWatch();
  const poll = async () => {
    if (!twitch || !twitch.isConnected() || !friendService) return;
    try {
      const logins = await twitch.getSharedChatLogins(twitch.tokens.user.id);
      if (logins.length) friendService.recordPresence(logins);
    } catch (e) { log.warn('Chat partagé :', e); }
  };
  poll();
  sharedChatTimer = setInterval(poll, PRESENCE_EVERY);
}

function stopSharedChatWatch() {
  clearInterval(sharedChatTimer);
  sharedChatTimer = null;
}

// SKLIP_DEV_LOGIN : seulement pour tester sur un PC avec le serveur local (jetons factices refusés en vrai).
const devLogin = () => (!app.isPackaged && process.env.SKLIP_DEV_LOGIN) || '';
const myLogin = () => devLogin() || (twitch && twitch.isConnected() ? twitch.tokens.user.login.toLowerCase() : '');

/** Adresse du mini-serveur Sklip (dossier relay/ du dépôt), dans config.json. */
function relayUrl() {
  if (process.env.SKLIP_RELAY_URL) return process.env.SKLIP_RELAY_URL;
  try { return require('../../config.json').relayUrl || ''; } catch { return ''; }
}

function startFriends() {
  friendService = new FriendService({
    getSettings: () => settings.get(), getLogin: myLogin, getToken: () => (devLogin() ? `dev:${devLogin()}` : twitch.accessToken()), relayUrl: relayUrl(),
    engine, log, dataDir: app.getPath('userData'),
    isRecording: () => !!(obsTimes.recordStartedAt && !obsTimes.recordStoppedAt),
    notify: (type, data) => {
      send('friends:event', { type, ...data });
      if (!Notification.isSupported()) return;
      if (type === 'reaction-request') new Notification({ title: 'Sklip : demande de réaction', body: `${data.from} voudrait ta réaction (${data.reason}). Ouvre Sklip → Réglages → Amis.` }).show();
      if (type === 'reaction-received' && data.status === 'ok') new Notification({ title: 'Sklip : réaction reçue', body: `La réaction de ${data.friend} est dans ton montage.` }).show();
    },
  });
  const tick = () => friendService.tick();
  setTimeout(tick, 5000);
  setInterval(tick, 60 * 1000);
}

function loadSession(folder) {
  return JSON.parse(fs.readFileSync(path.join(folder, 'session.json'), 'utf8'));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function startObs() {
  if (obs) obs.close();
  const { url, password, autoRecord } = settings.get().obs;
  obs = new ObsWatcher({ url, password, autoRecord });
  obs.on('connected', () => send('obs:status', { connected: true }));
  obs.on('disconnected', () => {
    send('obs:status', { connected: false });
    setTimeout(() => obs && !obs.identified && obs.connect(), 5000); // OBS fermé : on réessaie
  });
  obs.on('state', (s) => send('obs:state', s));
  obs.on('streamStarted', () => send('obs:event', { type: 'streamStarted' }));
  obs.on('streamStopped', () => send('obs:event', { type: 'streamStopped' }));
  obs.on('recordStarted', (e) => {
    obsTimes = { recordStartedAt: e.at, recordStoppedAt: null };
    markers = [];
    startSharedChatWatch();
    startAudioCapture();
    if (settings.get().analysisMode === 'live' && obs) {
      liveAnalyzer = new LiveAnalyzer({ engine, obs, log, dir: path.join(capturesDir(), `live-${e.at}`) });
      liveAnalyzer.start(e.at);
    }
  });
  obs.on('recordStopped', (e) => {
    obsTimes.recordStoppedAt = e.at;
    stopSharedChatWatch();
    if (e.path && friendService) friendService.addRecording(e.path, obsTimes.recordStartedAt, e.at);
    send('obs:event', { type: 'recordStopped', ...e });
    const capture = stopAudioCapture();
    const live = liveAnalyzer ? liveAnalyzer.stop() : null;
    liveAnalyzer = null;
    onRecordingFinished(e, capture, live).catch((err) => log.error('Analyse de fin de live :', err));
  });
  obs.on('error', (e) => { log.warn('OBS :', e); send('obs:error', { message: String(e && e.message || e) }); });
  obs.connect();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1000, minHeight: 640,
    backgroundColor: '#0e0e12', title: 'Sklip', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Erreurs de l'interface → journal.
  win.webContents.on('console-message', (e, level, message) => {
    const lvl = e && e.level !== undefined ? e.level : level;
    if (lvl === 'error' || lvl === 3) log.error('Interface :', (e && e.message) || message);
  });
  win.webContents.on('render-process-gone', (_e, d) => log.error('Interface plantée :', d));
}

function listStreams() {
  const dir = path.join(libraryRoot(), 'Streams');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().reverse().map((name) => {
    const folder = path.join(dir, name);
    let stats = null;
    try { stats = JSON.parse(fs.readFileSync(path.join(folder, 'stats.json'), 'utf8')); } catch { /* dossier incomplet */ }
    return { name, folder, hasSession: fs.existsSync(path.join(folder, 'session.json')), ...(stats || {}) };
  });
}

app.whenReady().then(() => {
  settings = new Settings(app.getPath('userData'));
  log = new Logger(path.join(app.getPath('userData'), 'logs'));
  cleanupCaptures();
  startFriends();
  log.info(`Démarrage de Sklip ${app.getVersion()}`);
  process.on('uncaughtException', (e) => log.error('Erreur non gérée :', e));
  process.on('unhandledRejection', (e) => log.error('Promesse rejetée :', e));

  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:update', (_e, patch) => {
    const s = settings.update(patch);
    if (patch.obs) startObs();
    if (patch.markerHotkey !== undefined) markerService.setHotkey(globalShortcut, s.markerHotkey);
    return s;
  });
  ipcMain.handle('engine:run', (_e, command, params) => engine(command, params));
  ipcMain.handle('log:report', () => {
    const out = log.report(app.getPath('desktop'), { version: app.getVersion(), settings: settings.get() });
    shell.showItemInFolder(out);
    return out;
  });
  ipcMain.handle('log:openFolder', () => shell.openPath(log.dir));
  ipcMain.handle('streams:list', () => listStreams());
  ipcMain.handle('analysis:start', (_e, video) => runAnalysis(video));
  ipcMain.handle('analysis:status', () => (analysisRunning ? { running: true, ...analysisRunning } : { running: false }));
  ipcMain.handle('project:save', (_e, folder, theme, project) => {
    if (!folder || !fs.existsSync(path.join(folder, 'session.json')) || !/^[\w-]+$/.test(theme)) return false;
    fs.writeFileSync(path.join(folder, `montage-${theme}.json`), JSON.stringify(project));
    return true;
  });
  ipcMain.handle('session:editor', (_e, folder, theme) => {
    const f = folder || settings.get().lastSessionFolder;
    if (!f || !fs.existsSync(path.join(f, 'session.json'))) return null;
    const es = pipeline.editorSession(loadSession(f), theme, { cam: settings.get().cam });
    es.channel = twitch && twitch.isConnected() ? twitch.tokens.user.login : '';
    try { es.reactions = JSON.parse(fs.readFileSync(path.join(f, 'reactions.json'), 'utf8')); } catch { es.reactions = []; }
    es.recordStartedAt = loadSession(f).record_started_at || null;
    try { es.project = JSON.parse(fs.readFileSync(path.join(f, `montage-${es.theme}.json`), 'utf8')); } catch { es.project = null; }
    return es;
  });
  ipcMain.handle('dialog:openVideo', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'],
      filters: [{ name: 'Vidéos', extensions: ['mkv', 'mp4', 'mov', 'flv'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('system:test', async () => {
    send('engine:progress', { command: 'benchmark', fraction: 0, message: 'Lecture des infos du PC' });
    const info = await perf.systemInfo();
    const bench = await engine('benchmark');
    const result = { ...info, ...bench, ...perf.verdict({ ...info, ...bench }), at: new Date().toISOString() };
    settings.update({ pcTest: result });
    return result;
  });
  ipcMain.handle('shell:openFolder', (_e, p) => shell.openPath(p));
  ipcMain.handle('friends:status', () => friendService.status());
  ipcMain.handle('friends:forClip', (_e, folder, clip) => friendService.friendsForClip(loadSession(folder), clip));
  ipcMain.handle('friends:pending', () => friendService.pending());
  ipcMain.handle('friends:accept', (_e, id) => friendService.accept(id));
  ipcMain.handle('friends:refuse', (_e, id) => friendService.refuse(id));
  ipcMain.handle('friends:request', (_e, folder, clip, to) => friendService.requestManual(loadSession(folder), clip, to));
  ipcMain.handle('friends:check', () => friendService.tick());

  twitch = new TwitchAuth({ store: tokenStore() });
  let loginAbort = null;
  ipcMain.handle('twitch:status', () => (twitch.isConnected() ? { connected: true, user: twitch.tokens.user } : { connected: false }));
  ipcMain.handle('twitch:login', async () => {
    const login = await twitch.startDeviceLogin();
    loginAbort = new AbortController();
    shell.openExternal(login.url);   // page Twitch officielle, code déjà rempli
    twitch.waitForLogin(login, { signal: loginAbort.signal })
      .then((user) => { send('twitch:status', { connected: true, user }); startTwitchLive(); })
      .catch((e) => send('twitch:status', { connected: false, error: e.message }));
    return { userCode: login.userCode, url: login.url };
  });
  ipcMain.handle('twitch:cancelLogin', () => loginAbort && loginAbort.abort());
  ipcMain.handle('twitch:logout', () => { if (twitchLive) twitchLive.stop(); twitch.logout(); return { connected: false }; });
  ipcMain.handle('twitch:videos', () => twitch.getVideos(twitch.tokens.user.id));

  createWindow();
  startObs();
  markerService = new Markers({
    log,
    onMarker: (m) => {
      // Un marqueur ne compte que pendant un enregistrement OBS (c'est lui qui sera analysé).
      const counted = !!(obs && obs.state.recording);
      if (counted) markers.push(m);
      log.info(`Marqueur (${m.source})${counted ? '' : ' ignoré : aucun enregistrement en cours'}`);
      send('marker:added', { ...m, counted, total: markers.length });
    },
  });
  markerService.setHotkey(globalShortcut, settings.get().markerHotkey);
  markerService.startHttp();
  ipcMain.handle('marker:add', () => markerService.add('appli'));
  ipcMain.handle('marker:hotkeyOk', () => !!markerService.hotkey);
  startTwitchLive();

  if (app.isPackaged) {
    // Mises à jour automatiques au lancement (GitHub Releases).
    try { require('electron-updater').autoUpdater.checkForUpdatesAndNotify(); } catch { /* hors ligne */ }
  }
});

app.on('will-quit', () => {
  if (markerService) markerService.stop(globalShortcut);
  stopAudioCapture();   // Sklip fermé pendant un live : la capture s'arrête proprement
});

app.on('window-all-closed', () => {
  if (obs) obs.close();
  if (twitchLive) twitchLive.stop();
  app.quit();
});

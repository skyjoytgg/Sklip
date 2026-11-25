// Processus principal d'Electron : fenêtre, OBS (lecture seule), moteur, réglages.

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { ObsWatcher } = require('./obs-watcher');
const { runEngine } = require('./engine-bridge');
const { Settings } = require('./settings');
const { TwitchAuth, TwitchLive } = require('./twitch');
const tm = require('./twitch-moments');
const perf = require('./perf');

let win = null;
let obs = null;
let settings = null;
let twitch = null;
let twitchLive = null;
let obsTimes = { recordStartedAt: null };

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
  twitchLive.on('error', (e) => send('twitch:error', { message: String(e && e.message || e) }));
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
  obs.on('recordStarted', (e) => { obsTimes.recordStartedAt = e.at; });
  obs.on('recordStopped', (e) => send('obs:event', { type: 'recordStopped', ...e }));
  obs.on('error', (e) => send('obs:error', { message: String(e && e.message || e) }));
  obs.connect();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1000, minHeight: 640,
    backgroundColor: '#0e0e12', title: 'Sklip', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function listStreams() {
  const dir = path.join(libraryRoot(), 'Streams');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().reverse().map((name) => {
    const folder = path.join(dir, name);
    let stats = null;
    try { stats = JSON.parse(fs.readFileSync(path.join(folder, 'stats.json'), 'utf8')); } catch { /* dossier incomplet */ }
    return { name, folder, ...(stats || {}) };
  });
}

app.whenReady().then(() => {
  settings = new Settings(app.getPath('userData'));

  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:update', (_e, patch) => {
    const s = settings.update(patch);
    if (patch.obs) startObs();
    return s;
  });
  ipcMain.handle('engine:run', (_e, command, params) =>
    runEngine(engineLocation(), command, params, (p) => send('engine:progress', { command, ...p })));
  ipcMain.handle('streams:list', () => listStreams());
  ipcMain.handle('dialog:openVideo', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'],
      filters: [{ name: 'Vidéos', extensions: ['mkv', 'mp4', 'mov', 'flv'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('system:test', async () => {
    send('engine:progress', { command: 'benchmark', fraction: 0, message: 'Lecture des infos du PC' });
    const info = await perf.systemInfo();
    const bench = await runEngine(engineLocation(), 'benchmark', {},
      (p) => send('engine:progress', { command: 'benchmark', ...p }));
    const result = { ...info, ...bench, ...perf.verdict({ ...info, ...bench }), at: new Date().toISOString() };
    settings.update({ pcTest: result });
    return result;
  });
  ipcMain.handle('shell:openFolder', (_e, p) => shell.openPath(p));

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
  startTwitchLive();

  if (app.isPackaged) {
    // Mises à jour automatiques au lancement (GitHub Releases).
    try { require('electron-updater').autoUpdater.checkForUpdatesAndNotify(); } catch { /* hors ligne */ }
  }
});

app.on('window-all-closed', () => {
  if (obs) obs.close();
  if (twitchLive) twitchLive.stop();
  app.quit();
});

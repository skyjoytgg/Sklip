// Processus principal d'Electron : fenêtre, OBS (lecture seule), moteur, réglages.

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Notification, globalShortcut, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { ObsWatcher } = require('./obs-watcher');
const { runEngine } = require('./engine-bridge');
const { Settings, themeTargets } = require('./settings');
const { TwitchAuth, TwitchLive } = require('./twitch');
const tm = require('./twitch-moments');
const perf = require('./perf');
const { Logger } = require('./logger');
const pipeline = require('./pipeline');
const { autoExport } = require('./auto-export');
const style = require('../renderer/style-model');
const { StyleStore } = require('./style-store');
let styleStoreInst = null;
const styleStore = () => (styleStoreInst = styleStoreInst || new StyleStore(path.join(app.getPath('userData'), 'style.json')));
const { Agents, cropTransparent } = require('./agents');
let agents = null;   // images des agents Valorant (vocal du jeu → agent en grand sur la vidéo)
const agentsService = () => (agents = agents || new Agents(path.join(app.getPath('userData'), 'agents'),
  { crop: (buf) => cropTransparent(nativeImage, buf) }));
const { Markers } = require('./markers');
const { LiveAnalyzer } = require('./live-analysis');
const { FriendService, PRESENCE_EVERY } = require('./friends');
const { LiveJournal, captureEvent } = require('./live-journal');
const lives = require('./lives');
const { readCam, readScenes, READ_ZONES } = require('./obs-scenes');
const { buildSegments, sameCam } = require('./segments');
const precheck = require('./precheck');

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
let sharedChatTimer = null; // pendant l'enregistrement : relevé du chat partagé Twitch toutes les minutes
let log = { info() {}, warn() {}, error() {} };   // remplacé par le vrai journal au démarrage
let journal = null;        // journal du live (frise de l'accueil)
let overlayWarned = new Set(); // overlays gênants déjà signalés dans le journal de ce live
let sceneLog = [];         // pendant l'enregistrement : scène OBS + webcam [{ at, scene, cam, full }]
let gameLog = [];          // pendant l'enregistrement : catégorie Twitch [{ at, game }]
const jadd = (...a) => journal && journal.add(...a);

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
  twitchLive.on('streamOnline', (d) => { jadd('twitch', 'Live Twitch détecté'); send('twitch:event', { type: 'online', ...d }); });
  twitchLive.on('raid', (r) => {
    jadd('twitch', `Raid de ${r.channel || '?'}`, { detail: r.viewers ? `${r.viewers} viewers` : '' });
    send('twitch:event', { type: 'raid', ...r });
  });
  twitchLive.on('marker', (m) => send('twitch:event', { type: 'marker', ...m }));
  twitchLive.on('error', (e) => { log.warn('Twitch :', e); send('twitch:error', { message: String(e && e.message || e) }); });
  twitchLive.on('streamOffline', (data) => {
    jadd('twitch', 'Fin du live Twitch');
    onTwitchStreamEnded(data).catch((e) => send('twitch:error', { message: e.message }));
  });
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
    const r = await runEngine(engineLocation(), command, params, (p) => {
      if (command === 'analyze' && analysisRunning) Object.assign(analysisRunning, { fraction: p.fraction, message: p.message });
      send('engine:progress', { command, ...p });
    });
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
  analysisRunning = { video, title, startedAt: Date.now(), fraction: 0 };
  send('analysis:state', { running: true, ...analysisRunning });
  const t0 = Date.now();
  if (rec.start) {
    const n = rec.partialScans ? rec.partialScans.length : 0;
    jadd('analysis', 'Analyse lancée', { detail: n ? `${n} morceau(x) déjà analysé(s) pendant le live` : '' });
  }
  // Icônes des agents (pour savoir qui parle dans le vocal du jeu) : sans connexion, l'analyse se fait sans.
  const agentsDir = await agentsService().ensureIcons().catch(() => null);
  try {
    const session = await engine('analyze', {
      video, root: libraryRoot(), title: rec.title === undefined && !rec.start ? path.parse(video).name : title,
      themes: s.themes, target: themeTargets(s), extra_moments: extraMoments, extra_stats: extras.stats,
      day: new Date(rec.start || Date.now()).toISOString().slice(0, 10), capture: rec.capture || undefined,
      record_started_at: rec.start ? rec.start / 1000 : undefined,
      partial_scans: rec.partialScans && rec.partialScans.length ? rec.partialScans : undefined,
      segments: rec.segments || undefined,
      chat: extras.chat && extras.chat.length ? extras.chat : undefined,
      agents_dir: agentsDir || undefined,
    });
    settings.update({ lastSessionFolder: session.folder });
    if (friendService && rec.start) friendService.requestForSession(session).catch((e) => log.warn('Amis :', e));
    log.info(`Analyse terminée : ${session.moments.length} moments → ${session.folder}`);
    if (rec.start) {
      const nClips = Object.values(session.clips || {}).reduce((n, c) => n + c.length, 0);
      jadd('analysis', `Analyse terminée : ${session.moments.length} moments, ${nClips} clips`,
        { detail: `en ${Math.max(1, Math.round((Date.now() - t0) / 60000))} min · ${session.title}` });
    }
    send('analysis:done', { folder: session.folder, title: session.title, stats: session.stats });
    // Option « exporter tout seul à la fin du live » : les montages sont prêts à poster (retouchables ensuite).
    const exporting = rec.start && s.autoExport ? runAutoExport(session) : null;
    if (!exporting && Notification.isSupported() && (!win || !win.isFocused())) {
      new Notification({ title: 'Sklip : tes montages sont prêts', body: `${session.title} — ${session.stats.kills} kills, ${session.stats.multikills} multi-kills` }).show();
    }
    return { folder: session.folder };
  } catch (e) {
    if (rec.start) jadd('analysis', "L'analyse a échoué", { detail: String((e && e.message) || e), level: 'error' });
    throw e;
  } finally {
    analysisRunning = null;
    send('analysis:state', { running: false });
  }
}

/** Export automatique après l'analyse d'un live (en arrière-plan, ne bloque pas la fin de l'analyse). */
function runAutoExport(session) {
  const s = settings.get();
  jadd('analysis', 'Export automatique des montages', { detail: `${(s.formats || []).join(' · ')}` });
  return autoExport(session, {
    engine, formats: s.formats, cam: s.cam, teaser: s.teaser !== false, log,
    style: s.learnStyle !== false ? style.profile(styleStore().all()) : null,
    channel: twitch && twitch.isConnected() ? twitch.tokens.user.login : '',
    onStep: (i, n, j) => send('analysis:state', { running: true, video: session.video, title: `Export ${i + 1}/${n} : ${j.theme} ${j.fmt.replace('x', ':')}`, startedAt: Date.now(), fraction: i / n }),
  }).then((done) => {
    send('analysis:state', { running: false });
    jadd('analysis', `${done.length} montage(s) exporté(s)`, { detail: session.title });
    send('analysis:done', { folder: session.folder, title: session.title, stats: session.stats });
    if (Notification.isSupported()) {
      new Notification({ title: 'Sklip : tes montages sont exportés', body: `${done.length} vidéo(s) prête(s) à poster — ${session.title}` }).show();
    }
    return done;
  }).catch((e) => { send('analysis:state', { running: false }); log.error('Export automatique :', e); });
}

/**
 * Réanalyse un live déjà analysé (nouvelle version de la détection, marges des clips…) dans le même dossier.
 * Reprend ce qui venait du live et ne peut plus être relu : Twitch (raids, chat, clips viewers), marqueurs,
 * pistes audio calées, passages OBS. L'image (le plus long) est en cache : quelques minutes au lieu d'une heure.
 * Les montages déjà retouchés sont mis de côté (.sklip/avant-reanalyse), jamais supprimés.
 */
async function reanalyze(folder) {
  if (analysisRunning) throw new Error('Une analyse est déjà en cours.');
  const old = loadSession(folder);
  if (!old || !old.video || !fs.existsSync(old.video)) throw new Error("La vidéo de ce live est introuvable (déplacée ou supprimée ?).");
  const s = settings.get();
  const LIVE_TYPES = ['raid', 'chat_spike', 'viewer_clip', 'viewer_peak', 'marker'];
  const extraMoments = (old.moments || []).filter((m) => LIVE_TYPES.includes(m.type))
    .map((m) => { const { boost, ...meta } = m.meta || {}; return { type: m.type, t: m.t, meta }; });
  analysisRunning = { video: old.video, title: old.title, startedAt: Date.now(), fraction: 0 };
  send('analysis:state', { running: true, ...analysisRunning });
  try {
    const keep = path.join(folder, '.sklip', 'avant-reanalyse');
    for (const f of fs.readdirSync(folder).filter((n) => /^montage-[\w-]+\.json$/.test(n))) {
      fs.mkdirSync(keep, { recursive: true });
      fs.renameSync(path.join(folder, f), path.join(keep, f));
    }
    fs.copyFileSync(path.join(folder, 'session.json'), path.join(folder, '.sklip', 'session-avant-reanalyse.json'));
    const agentsDir = await agentsService().ensureIcons().catch(() => null);
    const session = await engine('analyze', {
      video: old.video, root: libraryRoot(), folder, title: old.title,
      themes: s.themes, target: themeTargets(s), extra_moments: extraMoments,
      extra_stats: { peak_viewers: (old.stats || {}).peak_viewers, raids: (old.stats || {}).raids || [] },
      record_started_at: old.record_started_at || undefined,
      segments: (old.segments || []).some((x) => x.type) ? old.segments : undefined,
      chat: old.chat && old.chat.length ? old.chat : undefined,
      known_tracks: old.tracks || undefined, agents_dir: agentsDir || undefined,
    });
    log.info(`Réanalyse terminée : ${session.moments.length} moments → ${folder}`);
    send('analysis:done', { folder, title: session.title, stats: session.stats });
    return { folder };
  } finally {
    analysisRunning = null;
    send('analysis:state', { running: false });
  }
}

const capturesDir = () => path.join(app.getPath('userData'), 'captures');

/** Démarre la capture des pistes (jeu, micro, Discord, musique) par Sklip, en même temps que l'enregistrement OBS. */
function startAudioCapture() {
  const s = settings.get();
  if (!s.audio.captureEnabled) { jadd('audio', 'Capture des pistes audio désactivée (Réglages)', { level: 'warn' }); return; }
  if (audioCapture) return;
  const folder = path.join(capturesDir(), new Date().toISOString().replace(/[:.]/g, '-'));
  log.info('Capture audio :', folder);
  const done = engine('capture', { folder, music_exe: s.audio.musicApp || undefined, game_exe: s.audio.gameApp || undefined })
    .catch((e) => {
      log.error('Capture audio :', e);
      jadd('audio', 'La capture audio a planté', { detail: String((e && e.message) || e), level: 'error' });
      return null;
    });
  audioCapture = { folder, done };
  jadd('audio', 'Capture des pistes audio lancée');
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
  if (info) { const c = captureEvent(info); jadd('audio', c.label, c); }
  const live = livePromise ? await livePromise : null;
  if (!e.path) { jadd('analysis', "OBS n'a pas donné le fichier enregistré : analyse impossible", { level: 'error' }); return; }
  if (s.analysisMode === 'manual') { jadd('analysis', "Analyse en mode manuel : lance-la depuis l'accueil"); return; }
  const rec = { start: obsTimes.recordStartedAt, stop: e.at, markers: [...markers],
    capture: info ? { info, record_started_at: obsTimes.recordStartedAt / 1000 } : null,
    segments: e.segments && e.segments.length ? e.segments : null,
    partialScans: live && live.video && path.resolve(live.video) === path.resolve(e.path) ? live.chunks : [] };
  // Twitch prévient de la fin du live avec un peu de retard : on lui laisse le temps d'arriver.
  if (twitch && twitch.isConnected()) {
    jadd('analysis', 'Attente des infos Twitch (1 min 30)');
    await new Promise((r) => setTimeout(r, 90 * 1000));
  }
  await runAnalysis(e.path, rec);
}

const camText = (r) => (!r.cam ? 'pas de webcam dans cette scène' : r.full ? 'webcam en grand'
  : `webcam ${r.cam.y < 0.34 ? 'en haut' : r.cam.y > 0.5 ? 'en bas' : 'au milieu'} à ${r.cam.x + r.cam.w / 2 < 0.5 ? 'gauche' : 'droite'}`);

/** Scène OBS affichée et position de la webcam dedans (lecture seule), notées quand elles changent. */
async function trackScene() {
  if (!obs || !obs.identified || !obsTimes.recordStartedAt || obsTimes.recordStoppedAt) return;
  try {
    const r = await readCam(obs, settings.get().sceneTypes || {});
    if (r.type === 'jeu') {
      for (const o of r.overlays || []) {
        const key = `${r.scene}|${o.name}`;
        if (overlayWarned.has(key)) continue;
        overlayWarned.add(key);
        jadd('scene', `Overlay gênant : « ${o.name} »`, { level: 'warn',
          detail: `il cache ${o.zones.map((z) => READ_ZONES[z].label).join(' et ')} : des moments peuvent être ratés` });
      }
    }
    const last = sceneLog[sceneLog.length - 1];
    if (last && last.scene === r.scene && last.type === r.type && sameCam(last.cam, r.cam)) return;
    sceneLog.push({ at: Date.now(), ...r });
    const kind = { jeu: 'scène de jeu', discussion: 'scène de discussion', pause: 'pause : pas de clips ici' }[r.type];
    jadd('scene', `Scène OBS : ${r.scene}`, { detail: `${kind} · ${camText(r)}` });
  } catch (e) { log.warn('Scène OBS :', e); }
}

/** Catégorie Twitch (Valorant, Just Chatting…), notée quand elle change. */
async function trackGame() {
  if (!twitch || !twitch.isConnected() || !obsTimes.recordStartedAt || obsTimes.recordStoppedAt) return;
  try {
    const game = await twitch.getChannelGame(twitch.tokens.user.id);
    const last = gameLog[gameLog.length - 1];
    if (!game || (last && last.game === game)) return;
    gameLog.push({ at: Date.now(), game });
    jadd('game', `Catégorie Twitch : ${game}`);
  } catch (e) { log.warn('Catégorie Twitch :', e); }
}

/** Pendant l'enregistrement : chaque minute, qui est dans le chat partagé Twitch (pour les réactions des potes). */
function startSharedChatWatch() {
  stopSharedChatWatch();
  let before = new Set();
  let failed = false;
  const poll = async () => {
    trackScene();
    trackGame();
    if (!twitch || !twitch.isConnected() || !friendService) return;
    try {
      const logins = await twitch.getSharedChatLogins(twitch.tokens.user.id);
      if (logins.length) friendService.recordPresence(logins);
      const now = new Set(logins.map((l) => l.toLowerCase()));
      const trusted = new Set(friendService.friends().map((f) => f.login.toLowerCase()));
      for (const l of now) {
        if (!before.has(l)) {
          jadd('chat', `${l} en chat partagé`,
            { detail: trusted.has(l) ? 'ami de confiance : ses réactions sont possibles' : 'pas dans tes amis de confiance' });
        }
      }
      for (const l of before) if (!now.has(l)) jadd('chat', `${l} a quitté le chat partagé`);
      before = now;
      failed = false;
    } catch (e) {
      log.warn('Chat partagé :', e);
      if (!failed) jadd('chat', 'Chat partagé : Twitch ne répond pas', { detail: String((e && e.message) || e), level: 'warn' });
      failed = true;
    }
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
    if (obsTimes.recordStartedAt && !obsTimes.recordStoppedAt) jadd('record', 'Connexion à OBS perdue', { level: 'warn' });
    setTimeout(() => obs && !obs.identified && obs.connect(), 5000); // OBS fermé : on réessaie
  });
  obs.on('state', (s) => send('obs:state', s));
  // L'accueil suit l'enregistrement (« Enregistrement en cours ») sans attendre le prochain état complet.
  const pushState = () => send('obs:state', { ...obs.state });
  obs.on('recordStarted', pushState);
  obs.on('recordStopped', pushState);
  obs.on('sceneChanged', () => trackScene());
  obs.on('streamStarted', () => send('obs:event', { type: 'streamStarted' }));
  obs.on('streamStopped', () => send('obs:event', { type: 'streamStopped' }));
  obs.on('recordStarted', (e) => {
    obsTimes = { recordStartedAt: e.at, recordStoppedAt: null };
    markers = [];
    if (journal) journal.start(e.at);
    sceneLog = [];
    gameLog = [];
    overlayWarned = new Set();
    startSharedChatWatch();
    startAudioCapture();
    if (settings.get().analysisMode === 'live' && obs) {
      liveAnalyzer = new LiveAnalyzer({ engine, obs, log, dir: path.join(capturesDir(), `live-${e.at}`),
        onEvent: (label, level) => jadd('scan', label, { level }) });
      liveAnalyzer.start(e.at);
    }
  });
  obs.on('recordStopped', (e) => {
    obsTimes.recordStoppedAt = e.at;
    stopSharedChatWatch();
    if (journal) journal.stop(e.at, e.path ? path.basename(e.path) : '');
    const segments = buildSegments({ scenes: sceneLog, games: gameLog, start: obsTimes.recordStartedAt, stop: e.at });
    if (e.path && friendService) friendService.addRecording(e.path, obsTimes.recordStartedAt, e.at);
    send('obs:event', { type: 'recordStopped', ...e });
    const capture = stopAudioCapture();
    const live = liveAnalyzer ? liveAnalyzer.stop() : null;
    liveAnalyzer = null;
    onRecordingFinished({ ...e, segments }, capture, live).catch((err) => log.error('Analyse de fin de live :', err));
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

// Une seule fenêtre Sklip : un 2e lancement (double-clic de trop, démarrage auto + clic) ramène la fenêtre déjà
// ouverte au lieu d'en lancer une autre qui se disputerait OBS, la capture audio et les mêmes fichiers.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

app.whenReady().then(() => {
  if (!app.hasSingleInstanceLock()) return;
  settings = new Settings(app.getPath('userData'));
  log = new Logger(path.join(app.getPath('userData'), 'logs'));
  journal = new LiveJournal({ dir: path.join(app.getPath('userData'), 'journal'), log, onChange: (j) => send('journal:update', j) });
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
  ipcMain.handle('journal:list', () => journal.list());
  ipcMain.handle('journal:get', (_e, id) => journal.get(id));
  const streamsDir = () => path.join(libraryRoot(), 'Streams');
  const inLibrary = (folder) => folder && path.resolve(folder).startsWith(path.resolve(streamsDir()) + path.sep);
  // État d'OBS au moment où la fenêtre s'ouvre (OBS a souvent été connecté avant qu'elle soit prête).
  ipcMain.handle('obs:current', () => (obs ? { connected: !!obs.identified, ...obs.state } : { connected: false }));
  ipcMain.handle('obs:scenes', async () => {
    if (!obs || !obs.identified) return null;
    try { return await readScenes(obs, settings.get().sceneTypes || {}); } catch (e) { log.warn('Scènes OBS :', e); return null; }
  });
  ipcMain.handle('lives:list', () => lives.listLives(streamsDir()));
  ipcMain.handle('lives:get', (_e, folder) => (inLibrary(folder)
    ? lives.liveDetail(folder, { journals: journal.list(), getJournal: (id) => journal.get(id) }) : null));
  // Miniature (data URL) : créée la première fois à partir de l'enregistrement (seulement lu).
  ipcMain.handle('lives:thumb', async (_e, folder) => {
    if (!inLibrary(folder)) return null;
    const out = path.join(folder, 'thumb.jpg');
    if (!fs.existsSync(out)) {
      const session = lives.readJson(path.join(folder, 'session.json'));
      if (!session || !session.video || !fs.existsSync(session.video)) return null;
      try { await engine('thumb', { video: session.video, t: lives.thumbTime(session), out }); } catch { return null; }
    }
    try { return `data:image/jpeg;base64,${fs.readFileSync(out).toString('base64')}`; } catch { return null; }
  });
  ipcMain.handle('analysis:start', (_e, video) => runAnalysis(video));
  ipcMain.handle('analysis:again', (_e, folder) => {
    if (!inLibrary(folder)) throw new Error('Dossier hors de la bibliothèque Sklip');
    return reanalyze(folder);
  });
  ipcMain.handle('analysis:status', () => (analysisRunning ? { running: true, ...analysisRunning } : { running: false }));
  ipcMain.handle('project:save', (_e, folder, theme, project) => {
    if (!folder || !fs.existsSync(path.join(folder, 'session.json')) || !/^[\w-]+$/.test(theme)) return false;
    fs.writeFileSync(path.join(folder, `montage-${theme}.json`), JSON.stringify(project));
    // Apprendre la façon de monter : ce montage retouché comparé à ce que Sklip avait proposé.
    if (settings.get().learnStyle !== false && project && project.edited) {
      try { styleStore().record(`${folder}|${theme}`, style.observe((loadSession(folder).clips || {})[theme] || [], project)); }
      catch (e) { log.warn('Habitudes de montage :', e); }
    }
    return true;
  });
  ipcMain.handle('style:get', () => style.profile(styleStore().all()));
  ipcMain.handle('style:reset', () => { styleStore().reset(); return style.profile({}); });
  ipcMain.handle('agents:list', async () => { await agentsService().ensureIcons().catch(() => null); return agentsService().list(); });
  ipcMain.handle('agents:portrait', (_e, uuid) => agentsService().portrait(uuid).catch(() => null));
  // Image posée sur la vidéo à l'export (bulle du chat…) : PNG dessiné par l'éditeur, rangé dans le dossier du stream.
  ipcMain.handle('sticker:save', (_e, folder, name, dataUrl) => {
    if (!folder || !fs.existsSync(path.join(folder, 'session.json')) || !/^[\w-]{1,80}$/.test(String(name))) return null;
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
    if (!m || m[1].length > 8e6) return null;
    const dir = path.join(folder, '.sklip', 'stickers');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
    return file;
  });
  ipcMain.handle('session:editor', (_e, folder, theme) => editorFor(folder, theme));
  // Menu « Durée » de l'éditeur (Sky 26/11) : refait les clips du thème pour 30 s / 1 min / 3 min / 5 min.
  // L'ancien montage retouché n'est pas effacé : renommé montage-<thème>.avant-duree.json.
  ipcMain.handle('session:retarget', async (_e, folder, theme, seconds) => {
    const f = folder || settings.get().lastSessionFolder;
    if (!f || !fs.existsSync(path.join(f, 'session.json'))) return null;
    await engine('retarget', { folder: f, theme, target: Number(seconds) });
    const saved = path.join(f, `montage-${theme}.json`);
    if (fs.existsSync(saved)) fs.renameSync(saved, path.join(f, `montage-${theme}.avant-duree.json`));
    return editorFor(f, theme);
  });
  function editorFor(folder, theme) {
    const f = folder || settings.get().lastSessionFolder;
    if (!f || !fs.existsSync(path.join(f, 'session.json'))) return null;
    const es = pipeline.editorSession(loadSession(f), theme, { cam: settings.get().cam });
    es.channel = twitch && twitch.isConnected() ? twitch.tokens.user.login : '';
    try { es.reactions = JSON.parse(fs.readFileSync(path.join(f, 'reactions.json'), 'utf8')); } catch { es.reactions = []; }
    es.recordStartedAt = loadSession(f).record_started_at || null;
    try { es.project = JSON.parse(fs.readFileSync(path.join(f, `montage-${es.theme}.json`), 'utf8')); } catch { es.project = null; }
    es.style = settings.get().learnStyle !== false ? style.profile(styleStore().all()) : null;
    return es;
  }
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
      if (counted) {
        markers.push(m);
        const where = { raccourci: 'raccourci clavier', streamdeck: 'Stream Deck', appli: 'bouton de Sklip' }[m.source] || m.source;
        jadd('marker', `Marqueur (${where})`, { at: m.at });
      }
      log.info(`Marqueur (${m.source})${counted ? '' : ' ignoré : aucun enregistrement en cours'}`);
      send('marker:added', { ...m, counted, total: markers.length });
    },
  });
  markerService.setHotkey(globalShortcut, settings.get().markerHotkey);
  markerService.startHttp();
  ipcMain.handle('marker:add', () => markerService.add('appli'));
  ipcMain.handle('marker:hotkeyOk', () => !!markerService.hotkey);
  // « Vérifier avant le live » (voir precheck.js) : tout est lu, seul le micro est essayé 2 secondes.
  ipcMain.handle('precheck:run', async () => {
    const rows = await precheck.runPrecheck({
      settings: settings.get(),
      obsConnected: !!(obs && obs.identified),
      scenes: () => readScenes(obs, settings.get().sceneTypes || {}),
      recordDir: async () => (await obs.request('GetRecordDirectory')).recordDirectory,
      freeBytes: async (dir) => { const st = await fs.promises.statfs(dir); return st.bavail * st.bsize; },
      micTest: async () => {
        const folder = path.join(app.getPath('temp'), `sklip-micro-${Date.now()}`);
        try {
          const info = await engine('capture', { folder, disabled: ['game', 'discord', 'music'], max_seconds: 2 });
          const mic = info && info.tracks && info.tracks.mic;
          return { ok: !!(mic && mic.source && !mic.error), error: mic && mic.error };
        } finally { fs.rmSync(folder, { recursive: true, force: true }); }
      },
      running: () => new Promise((resolve) => require('node:child_process').execFile('tasklist', ['/fo', 'csv', '/nh'],
        { windowsHide: true, maxBuffer: 8 << 20 }, (err, out) => resolve(new Set(err ? [] : out.split(/\r?\n/)
          .map((l) => (l.split('","')[0] || '').replace(/^"/, '').toLowerCase()).filter(Boolean))))),
      twitchConnected: !!(twitch && twitch.isConnected()),
      hotkey: markerService.hotkey,
      streamDeck: !!(markerService.server && markerService.server.listening),
    });
    return { rows, verdict: precheck.verdict(rows), at: Date.now() };
  });
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

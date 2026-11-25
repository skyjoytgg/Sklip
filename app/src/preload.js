// Expose à l'interface une API limitée et sûre (window.sklip).
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('sklip', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  engine: (command, params) => ipcRenderer.invoke('engine:run', command, params),
  listStreams: () => ipcRenderer.invoke('streams:list'),
  openVideo: () => ipcRenderer.invoke('dialog:openVideo'),
  testPc: () => ipcRenderer.invoke('system:test'),
  openFolder: (p) => ipcRenderer.invoke('shell:openFolder', p),
  twitchStatus: () => ipcRenderer.invoke('twitch:status'),
  twitchLogin: () => ipcRenderer.invoke('twitch:login'),
  twitchCancelLogin: () => ipcRenderer.invoke('twitch:cancelLogin'),
  twitchLogout: () => ipcRenderer.invoke('twitch:logout'),
  twitchVideos: () => ipcRenderer.invoke('twitch:videos'),
  onTwitchStatus: on('twitch:status'),
  onTwitchEvent: on('twitch:event'),
  onObsStatus: on('obs:status'),
  onObsState: on('obs:state'),
  onObsEvent: on('obs:event'),
  onObsError: on('obs:error'),
  onEngineProgress: on('engine:progress'),
});

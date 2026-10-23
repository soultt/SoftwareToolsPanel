'use strict';

const { contextBridge, ipcRenderer, webUtils, clipboard } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('api', {
  state: () => invoke('app:state'),

  pickFiles: () => invoke('app:pick-files'),
  addPaths: (paths, groupId) => invoke('app:add-paths', { paths, groupId }),
  scan: () => invoke('app:scan'),
  importApps: (items, groupId) => invoke('app:import', { items, groupId }),
  update: (id, patch) => invoke('app:update', { id, patch }),
  remove: (ids) => invoke('app:remove', { ids }),
  reorder: (ids, visibleIds) => invoke('app:reorder', { ids, visibleIds }),
  launch: (id, admin) => invoke('app:launch', { id, admin }),
  reveal: (id) => invoke('app:reveal', { id }),
  targetOf: (id) => invoke('app:copy-path', { id }),
  pickIcon: (id) => invoke('app:pick-icon', { id }),
  resetIcon: (id) => invoke('app:reset-icon', { id }),

  addGroup: (name) => invoke('group:add', { name }),
  renameGroup: (id, name) => invoke('group:update', { id, name }),
  removeGroup: (id) => invoke('group:remove', { id }),
  moveGroup: (id, dir) => invoke('group:move', { id, dir }),
  assignGroup: (ids, groupId) => invoke('group:assign', { ids, groupId }),

  saveSettings: (patch) => invoke('settings:update', patch),
  pickWallpaper: () => invoke('dialog:pick-wallpaper'),
  exportConfig: () => invoke('config:export'),
  importConfig: () => invoke('config:import'),
  openDataDir: () => invoke('data:open-dir'),
  resetData: () => invoke('data:reset'),

  win: {
    minimize: () => invoke('window:min'),
    toggleMaximize: () => invoke('window:max'),
    close: () => invoke('window:close'),
    onState: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on('window:state', listener);
      return () => ipcRenderer.removeListener('window:state', listener);
    }
  },

  on: (channel, cb) => {
    const allowed = new Set(['ui:open-scan', 'ui:open-settings', 'icons:updated']);
    if (!allowed.has(channel)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (_) {
      return file && file.path ? file.path : '';
    }
  },

  copyText: (text) => {
    try {
      clipboard.writeText(String(text || ''));
      return true;
    } catch (_) {
      return false;
    }
  }
});

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { cleanName } = require('./library');

const DEFAULT_GROUPS = [
  { id: 'g_common', name: '常用' },
  { id: 'g_dev', name: '开发' },
  { id: 'g_office', name: '办公' },
  { id: 'g_media', name: '影音' },
  { id: 'g_other', name: '其他' }
];

const DEFAULT_SETTINGS = {
  skin: 'midnight',
  accent: '',
  wallpaper: '',
  wallpaperOpacity: 0.5,
  cardSize: 'md',
  view: 'grid',
  launchMode: 'single',
  animations: true,
  acrylic: false,
  alwaysOnTop: false,
  closeToTray: true,
  autoLaunch: false,
  showPath: true,
  hotkeyEnabled: true,
  hotkey: 'Control+Alt+Space',
  lastView: 'all',
  sidebarCollapsed: false,
  groupByHeader: true
};

function uid() {
  return crypto.randomUUID();
}

function defaults() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    groups: DEFAULT_GROUPS.map((g) => ({ ...g })),
    apps: [],
    settings: { ...DEFAULT_SETTINGS },
    window: { width: 1200, height: 800, x: null, y: null },
    recent: []
  };
}

class Store {
  constructor() {
    this.data = defaults();
    this.file = null;
    this.iconsDir = null;
    this.timer = null;
  }

  init() {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'panel.json');
    this.iconsDir = path.join(dir, 'icons');
    fs.mkdirSync(this.iconsDir, { recursive: true });
    this.load();
    return this;
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = this.migrate(parsed);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // keep a backup of a corrupted profile instead of silently dropping it
        try {
          fs.copyFileSync(this.file, `${this.file}.broken-${Date.now()}`);
        } catch (_) {}
      }
      this.data = defaults();
      this.save(true);
    }
  }

  migrate(input) {
    const base = defaults();
    const data = { ...base, ...(input || {}) };
    data.settings = { ...base.settings, ...(input && input.settings) };
    data.window = { ...base.window, ...(input && input.window) };
    if (!Array.isArray(data.groups) || data.groups.length === 0) data.groups = base.groups;
    if (!Array.isArray(data.apps)) data.apps = [];
    if (!Array.isArray(data.recent)) data.recent = [];
    data.apps = data.apps
      .filter((a) => a && a.id && a.path)
      .map((a) => ({
        id: a.id,
        name: cleanName(a.name, a.path) || path.basename(a.path).replace(/\.[^.]+$/, ''),
        path: a.path,
        target: a.target || a.path,
        args: a.args || '',
        cwd: a.cwd || '',
        kind: a.kind || 'file',
        groupId: a.groupId || data.groups[0].id,
        favorite: !!a.favorite,
        admin: !!a.admin,
        icon: a.icon || '',
        note: a.note || '',
        addedAt: a.addedAt || new Date().toISOString(),
        launchCount: a.launchCount || 0,
        lastLaunchAt: a.lastLaunchAt || null
      }));
    const known = new Set(data.groups.map((g) => g.id));
    for (const a of data.apps) {
      if (!known.has(a.groupId)) a.groupId = data.groups[0].id;
    }
    return data;
  }

  get() {
    return this.data;
  }

  get settings() {
    return this.data.settings;
  }

  save(immediate = false) {
    const write = () => {
      this.timer = null;
      try {
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
        fs.renameSync(tmp, this.file);
      } catch (err) {
        console.error('保存配置失败:', err);
      }
    };
    if (immediate) {
      if (this.timer) clearTimeout(this.timer);
      write();
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(write, 250);
  }

  /* ---------- helpers ---------- */

  saveIcon(buffer, appId) {
    try {
      const name = `${appId}.png`;
      fs.writeFileSync(path.join(this.iconsDir, name), buffer);
      return name;
    } catch (err) {
      console.error('保存图标失败:', err);
      return '';
    }
  }

  iconPath(appEntry) {
    if (!appEntry || !appEntry.icon) return null;
    if (path.isAbsolute(appEntry.icon)) return fs.existsSync(appEntry.icon) ? appEntry.icon : null;
    const p = path.join(this.iconsDir, appEntry.icon);
    return fs.existsSync(p) ? p : null;
  }

  removeIconFile(appEntry) {
    if (!appEntry || !appEntry.icon || path.isAbsolute(appEntry.icon)) return;
    try {
      fs.unlinkSync(path.join(this.iconsDir, appEntry.icon));
    } catch (_) {}
  }

  findApp(id) {
    return this.data.apps.find((a) => a.id === id) || null;
  }

  findGroup(id) {
    return this.data.groups.find((g) => g.id === id) || null;
  }

  addApp(entry) {
    const item = {
      id: uid(),
      name: cleanName(entry.name, entry.path) || '未命名',
      path: entry.path,
      target: entry.target || entry.path,
      args: entry.args || '',
      cwd: entry.cwd || '',
      kind: entry.kind || 'file',
      groupId: entry.groupId || this.data.groups[0].id,
      favorite: false,
      admin: !!entry.admin,
      icon: '',
      note: entry.note || '',
      addedAt: new Date().toISOString(),
      launchCount: 0,
      lastLaunchAt: null
    };
    this.data.apps.push(item);
    return item;
  }

  touch(id) {
    const a = this.findApp(id);
    if (!a) return;
    a.launchCount += 1;
    a.lastLaunchAt = new Date().toISOString();
    this.data.recent = [id, ...this.data.recent.filter((x) => x !== id)].slice(0, 30);
    this.save();
  }
}

module.exports = new Store();

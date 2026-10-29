'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.setName('SoftwareToolsPanel');
app.setAppUserModelId('com.softwaretoolspanel.app');

// 便携模式：已打包时 exe 同级存在 portable.dat 或传入 --portable，数据保存在 \Data
const portableFlag = process.argv.includes('--portable');
const portableMarker = path.join(path.dirname(process.execPath), 'portable.dat');
const isPortable = portableFlag || (app.isPackaged && fs.existsSync(portableMarker));
if (isPortable) {
  try {
    app.setPath('userData', path.join(path.dirname(process.execPath), 'Data'));
  } catch (err) {
    console.error('无法切换到便携数据目录:', err);
  }
}

const store = require('./store');
const library = require('./library');
const hires = require('./hires');

const ICON_FILE = path.join(__dirname, '..', '..', 'build', 'icon.png');
const isWin11 = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22000;

let win = null;
let tray = null;
let quitting = false;
let wallpaperCache = { file: '', dataUrl: '' };

/* ------------------------------------------------------------------ */
/* 窗口                                                                */
/* ------------------------------------------------------------------ */

function createWindow() {
  const bounds = store.get().window || {};
  const settings = store.settings;

  win = new BrowserWindow({
    width: bounds.width || 1200,
    height: bounds.height || 800,
    x: typeof bounds.x === 'number' ? bounds.x : undefined,
    y: typeof bounds.y === 'number' ? bounds.y : undefined,
    minWidth: 900,
    minHeight: 580,
    frame: false,
    show: false,
    title: '软件集合面板',
    backgroundColor: settings.acrylic && isWin11 ? '#00000000' : '#0b0d16',
    backgroundMaterial: settings.acrylic && isWin11 ? 'acrylic' : 'none',
    icon: fs.existsSync(ICON_FILE) ? ICON_FILE : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
    setTimeout(() => upgradeIconsSoon(), 1200);
  });

  const persistBounds = debounce(() => {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
    const b = win.getBounds();
    store.get().window = { width: b.width, height: b.height, x: b.x, y: b.y };
    store.save();
  }, 600);

  win.on('resize', persistBounds);
  win.on('move', persistBounds);

  win.on('maximize', () => send('window:state', { maximized: true }));
  win.on('unmaximize', () => send('window:state', { maximized: false }));

  win.on('close', (e) => {
    if (!quitting && store.settings.closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    win = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (win && url !== win.webContents.getURL()) e.preventDefault();
  });

  win.setAlwaysOnTop(!!store.settings.alwaysOnTop);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function showWindow() {
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* 后台把 32px 图标升级为 256px 系统大图标 */
const upgradeIconsSoon = debounce(async (force = false) => {
  try {
    const map = await hires.upgradeIcons(store, { force });
    if (map && Object.keys(map).length) send('icons:updated', map);
  } catch (err) {
    console.warn('高分辨率图标升级失败:', err.message);
  }
}, 1500);

/* ------------------------------------------------------------------ */
/* 托盘 & 快捷键                                                        */
/* ------------------------------------------------------------------ */

function trayImage() {
  if (fs.existsSync(ICON_FILE)) {
    const img = nativeImage.createFromPath(ICON_FILE);
    if (!img.isEmpty()) return img.resize({ width: 20, height: 20 });
  }
  return nativeImage.createEmpty();
}

function createTray() {
  try {
    tray = new Tray(trayImage());
    tray.setToolTip('软件集合面板');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示面板', click: showWindow },
        { label: '隐藏面板', click: () => win && win.hide() },
        { type: 'separator' },
        { label: '扫描开始菜单…', click: () => { showWindow(); send('ui:open-scan'); } },
        { label: '设置与皮肤…', click: () => { showWindow(); send('ui:open-settings'); } },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            quitting = true;
            app.quit();
          }
        }
      ])
    );
    tray.on('click', () => {
      if (!win) return createWindow();
      if (win.isVisible() && win.isFocused()) win.hide();
      else showWindow();
    });
  } catch (err) {
    console.error('创建托盘图标失败:', err);
  }
}

function applyHotkey() {
  globalShortcut.unregisterAll();
  const s = store.settings;
  if (!s.hotkeyEnabled || !s.hotkey) return;
  try {
    const ok = globalShortcut.register(s.hotkey, () => {
      if (!win) return createWindow();
      if (win.isVisible() && win.isFocused()) win.hide();
      else showWindow();
    });
    if (!ok) console.warn('全局快捷键被占用:', s.hotkey);
  } catch (err) {
    console.warn('注册全局快捷键失败:', err.message);
  }
}

function applyAutoLaunch() {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!store.settings.autoLaunch,
      path: process.execPath,
      args: app.isPackaged ? [] : [path.resolve(__dirname, '..', '..')]
    });
  } catch (err) {
    console.warn('设置开机自启失败:', err.message);
  }
}

/* ------------------------------------------------------------------ */
/* 数据组装                                                            */
/* ------------------------------------------------------------------ */

function iconDataFor(appEntry) {
  const p = store.iconPath(appEntry);
  if (!p) return '';
  try {
    return `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
  } catch (_) {
    return '';
  }
}

function wallpaperData() {
  const file = store.settings.wallpaper;
  if (!file || !fs.existsSync(file)) return '';
  if (wallpaperCache.file === file && wallpaperCache.dataUrl) return wallpaperCache.dataUrl;
  try {
    const stat = fs.statSync(file);
    let dataUrl;
    if (stat.size > 6 * 1024 * 1024) {
      const img = nativeImage.createFromPath(file);
      const jpg = img.isEmpty() ? Buffer.alloc(0) : img.resize({ quality: 'good' }).toJPEG(88);
      dataUrl = jpg.length ? `data:image/jpeg;base64,${jpg.toString('base64')}` : '';
    } else {
      const ext = path.extname(file).toLowerCase().replace('.', '') || 'png';
      const mime = ext === 'jpg' ? 'jpeg' : ext;
      dataUrl = `data:image/${mime};base64,${fs.readFileSync(file).toString('base64')}`;
    }
    wallpaperCache = { file, dataUrl };
    return dataUrl;
  } catch (_) {
    return '';
  }
}

function publicState() {
  const data = store.get();
  const icons = {};
  for (const a of data.apps) icons[a.id] = iconDataFor(a);
  return {
    groups: data.groups,
    apps: data.apps,
    settings: data.settings,
    recent: data.recent,
    icons,
    wallpaper: wallpaperData(),
    meta: {
      version: app.getVersion(),
      isWin11,
      isPortable,
      dataDir: app.getPath('userData'),
      hotkeyOk: store.settings.hotkeyEnabled ? globalShortcut.isRegistered(store.settings.hotkey) : true
    }
  };
}

/* ------------------------------------------------------------------ */
/* 导入 / 图标                                                          */
/* ------------------------------------------------------------------ */

/* 面板自身不可添加到面板中（按精确路径或已知产品 exe 名判断） */
const SELF_EXE_NAMES = new Set(['softwaretoolspanel.exe', '软件集合面板.exe']);

function isSelf(p) {
  if (!p) return false;
  const s = String(p);
  try {
    if (path.resolve(s).toLowerCase() === path.resolve(process.execPath).toLowerCase()) return true;
  } catch (_) { /* 非法路径忽略 */ }
  return SELF_EXE_NAMES.has(path.basename(s).toLowerCase());
}

async function buildAppFromFile(file, opts = {}) {
  const info = library.describeFile(file);
  const entry = store.addApp({
    name: opts.name || info.name,
    path: file,
    target: info.target,
    args: opts.args != null ? opts.args : info.args,
    cwd: info.cwd,
    kind: info.kind,
    groupId: opts.groupId,
    admin: opts.admin
  });
  const png = await library.extractIconBuffer(info.iconSource || file);
  if (png) {
    const name = store.saveIcon(png, entry.id);
    if (name) entry.icon = name;
  }
  return entry;
}

function saveDataUrlIcon(appId, dataUrl) {
  const m = /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return '';
  return store.saveIcon(Buffer.from(m[2], 'base64'), appId);
}

function duplicateOf(pathOrTarget) {
  const norm = String(pathOrTarget || '').toLowerCase();
  return store.get().apps.find(
    (a) => a.path.toLowerCase() === norm || String(a.target || '').toLowerCase() === norm
  );
}

/* ------------------------------------------------------------------ */
/* 自动分组：按名称 / 路径关键词归入默认分类                            */
/* ------------------------------------------------------------------ */

const AUTO_GROUP_RULES = [
  {
    ids: ['g_dev'],
    names: ['开发', '编程', 'dev', 'development'],
    re: /(visual studio|vs ?code|vscode|git(hub|lab)?|node(\.exe)?|npm|yarn|pnpm|python|anaconda|conda|jupyter|spyder|java|jdk|jre|jetbrains|intellij|\bidea\b|pycharm|webstorm|phpstorm|clion|goland|rider|datagrip|android studio|docker|postman|apifox|navicat|mysql|redis|sqlite|mongodb|\bssms\b|azure data|xshell|finalshell|putty|mobaxterm|terminal|powershell|\bcmd\b|命令提示|eclipse|unity|unreal|sublime|notepad\+\+|beyond compare|wireshark|fiddler|dev-?c\+\+|maven|gradle|hbuilder|flutter|dart|rust|golang|\bsvn\b|tortoisegit|wsl|virtualbox|vmware|开发|编程)/i
  },
  {
    ids: ['g_media'],
    names: ['影音', '媒体', 'media'],
    re: /(music|player|video|potplayer|\bvlc\b|\bobs\b|剪映|premiere|after effects|audition|音乐|视频|播放|酷狗|网易云|qq音乐|爱奇艺|优酷|腾讯视频|哔哩哔哩|bilibili|格式工厂|录屏|媒体|影音|foobar|kmplayer|mpc-hc|handbrake|blender|photoshop|illustrator|figma|美图|修图|剪辑|抖音|快手|画图|mspaint)/i
  },
  {
    ids: ['g_office'],
    names: ['办公', 'office'],
    re: /(office|word|excel|powerpoint|onenote|outlook|\bwps\b|\bpdf\b|acrobat|foxit|微信|wechat|qq(?!音乐)|钉钉|dingtalk|飞书|feishu|lark|邮箱|mail|便签|sticky|笔记|notes|notion|obsidian|印象笔记|百度网盘|阿里云盘|onedrive|dropbox|压缩|7-zip|winrar|bandizip|企业微信|teams|slack|zoom|腾讯会议|会议|日历|calendar|记账|财务|打印|print|xmind|mindmaster|visio|project|办公)/i
  },
  {
    ids: ['g_common'],
    names: ['常用', 'common'],
    re: /(chrome|edge|firefox|浏览器|browser|360|安全|火绒|管家|杀毒|antivirus|截图|snip|记事本|notepad|计算器|calc|资源管理器|explorer|控制面板|任务管理器|taskmgr|驱动|driver|迅雷|\bidm\b|工具|toolbox|download|下载)/i
  }
];

function groupByHint(rule) {
  const groups = store.get().groups;
  return groups.find((g) => rule.ids.includes(g.id)) ||
    groups.find((g) => rule.names.includes(String(g.name || '').trim().toLowerCase())) ||
    null;
}

function autoGroupFor(item) {
  // 只按用户看到的名称 / 开始菜单文件夹判断，避免被 System32\cmd.exe 之类的目标路径带偏
  const text = `${item.name || ''} ${item.folder || ''}`.trim() ||
    `${item.target || item.path || ''}`;
  for (const rule of AUTO_GROUP_RULES) {
    if (!rule.re.test(text)) continue;
    const group = groupByHint(rule);
    if (group) return group.id;
  }
  const other = groupByHint({ ids: ['g_other'], names: ['其他', 'other', 'others'] });
  return other ? other.id : store.get().groups[0].id;
}

function resolveGroupId(groupId, item) {
  if (groupId === 'auto') return autoGroupFor(item || {});
  if (groupId && store.findGroup(groupId)) return groupId;
  return store.get().groups[0].id;
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle('app:state', () => publicState());

  ipcMain.handle('app:pick-files', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '选择要添加的软件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '程序与快捷方式', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd', 'msc', 'appref-ms'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (res.canceled) return { canceled: true, files: [] };
    return { canceled: false, files: res.filePaths };
  });

  ipcMain.handle('app:add-paths', async (_e, { paths = [], groupId } = {}) => {
    const added = [];
    const skipped = [];
    for (const raw of paths) {
      const p = String(raw || '').trim();
      if (!p) continue;

      // 网址快捷方式
      if (/^https?:\/\//i.test(p)) {
        if (duplicateOf(p)) {
          skipped.push({ path: p, reason: '该网址已存在' });
          continue;
        }
        let name = p;
        try {
          name = new URL(p).hostname.replace(/^www\./, '');
        } catch (_) {}
        const entry = store.addApp({ name, path: p, target: p, kind: 'url', groupId: resolveGroupId(groupId, { name, path: p, target: p }) });
        added.push(entry.id);
        continue;
      }

      if (!fs.existsSync(p)) {
        skipped.push({ path: raw, reason: '文件不存在' });
        continue;
      }
      let stat;
      try {
        stat = fs.statSync(p);
      } catch (_) {
        skipped.push({ path: raw, reason: '无法访问' });
        continue;
      }
      if (stat.isDirectory()) {
        skipped.push({ path: raw, reason: '不能添加文件夹' });
        continue;
      }
      if (!library.LAUNCHABLE.has(path.extname(p).toLowerCase())) {
        skipped.push({ path: raw, reason: '不支持的文件类型' });
        continue;
      }
      const info = library.describeFile(p);
      if (isSelf(p) || isSelf(info.target)) {
        skipped.push({ path: raw, reason: '不能把面板自身添加到面板中' });
        continue;
      }
      const dup = duplicateOf(info.target) || duplicateOf(p);
      if (dup) {
        skipped.push({ path: raw, reason: `已存在：${dup.name}` });
        continue;
      }
      const entry = await buildAppFromFile(p, { groupId: resolveGroupId(groupId, info) });
      added.push(entry.id);
    }
    store.save(true);
    if (added.length) upgradeIconsSoon();
    return { added, skipped };
  });

  ipcMain.handle('app:scan', async () => {
    const list = await library.scanStartMenu();
    const existing = new Set();
    for (const a of store.get().apps) {
      existing.add(String(a.target || '').toLowerCase());
      existing.add(String(a.path || '').toLowerCase());
    }
    return list
      .filter((item) => !isSelf(item.target) && !isSelf(item.path))
      .map((item) => ({
        ...item,
        exists: existing.has(String(item.target).toLowerCase()) || existing.has(String(item.path).toLowerCase())
      }));
  });

  ipcMain.handle('app:import', async (_e, { items = [], groupId } = {}) => {
    const added = [];
    for (const item of items) {
      if (!item || !item.path) continue;
      if (isSelf(item.target) || isSelf(item.path)) continue;
      if (duplicateOf(item.target) || duplicateOf(item.path)) continue;
      const entry = store.addApp({
        name: item.name,
        path: item.path,
        target: item.target || item.path,
        args: item.args || '',
        cwd: item.cwd || '',
        kind: item.kind || 'lnk',
        groupId: resolveGroupId(groupId, item)
      });
      if (item.icon && String(item.icon).startsWith('data:')) {
        const name = saveDataUrlIcon(entry.id, item.icon);
        if (name) entry.icon = name;
      } else {
        const png = await library.extractIconBuffer(item.target || item.path);
        if (png) {
          const name = store.saveIcon(png, entry.id);
          if (name) entry.icon = name;
        }
      }
      added.push(entry.id);
    }
    store.save(true);
    if (added.length) upgradeIconsSoon();
    return { added };
  });

  ipcMain.handle('app:update', (_e, { id, patch = {} } = {}) => {
    const a = store.findApp(id);
    if (!a) return null;
    const allowed = ['name', 'args', 'cwd', 'groupId', 'favorite', 'admin', 'note', 'path', 'target', 'kind'];
    for (const key of allowed) {
      if (key in patch && patch[key] !== undefined && patch[key] !== null) a[key] = patch[key];
    }
    if (patch.name != null) a.name = library.cleanName(patch.name, a.path);
    if (patch.path && patch.path !== a.path && fs.existsSync(patch.path)) {
      const info = library.describeFile(patch.path);
      a.target = info.target;
      if (patch.keepArgs !== true && patch.args === undefined) a.args = info.args;
      if (!a.cwd) a.cwd = info.cwd;
      a.kind = info.kind;
    }
    store.save(true);
    return a;
  });

  ipcMain.handle('app:remove', (_e, { ids = [] } = {}) => {
    const set = new Set(ids);
    const removed = [];
    store.get().apps = store.get().apps.filter((a) => {
      if (set.has(a.id)) {
        store.removeIconFile(a);
        removed.push(a.id);
        return false;
      }
      return true;
    });
    store.get().recent = store.get().recent.filter((id) => !set.has(id));
    store.save(true);
    return { removed };
  });

  ipcMain.handle('app:reorder', (_e, { ids = [], visibleIds = [] } = {}) => {
    const apps = store.get().apps;
    const order = new Map(ids.map((id, i) => [id, i]));
    const visible = new Set(visibleIds);
    const slots = [];
    apps.forEach((a, i) => {
      if (visible.has(a.id)) slots.push(i);
    });
    const sorted = apps
      .filter((a) => visible.has(a.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    slots.forEach((slot, i) => {
      apps[slot] = sorted[i];
    });
    store.save();
    return true;
  });

  ipcMain.handle('app:launch', async (_e, { id, admin } = {}) => {
    const a = store.findApp(id);
    if (!a) return { ok: false, error: '软件不存在' };
    try {
      await library.launch(admin ? { ...a, admin: true } : a);
      store.touch(id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('app:reveal', (_e, { id } = {}) => {
    const a = store.findApp(id);
    if (!a) return false;
    return library.reveal(a);
  });

  ipcMain.handle('app:copy-path', (_e, { id } = {}) => {
    const a = store.findApp(id);
    if (!a) return '';
    return library.buildEntry(a).target || a.path;
  });

  ipcMain.handle('app:pick-icon', async (_e, { id } = {}) => {
    const a = store.findApp(id);
    if (!a) return '';
    const res = await dialog.showOpenDialog(win, {
      title: '选择图标图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'ico', 'jpg', 'jpeg', 'webp', 'svg'] }]
    });
    if (res.canceled || !res.filePaths[0]) return '';
    const file = res.filePaths[0];
    const img = nativeImage.createFromPath(file);
    let buf = null;
    if (!img.isEmpty()) {
      buf = path.extname(file).toLowerCase() === '.ico'
        ? img.resize({ width: 128, height: 128 }).toPNG()
        : img.resize({ width: 128, height: 128, quality: 'best' }).toPNG();
    } else {
      try {
        buf = fs.readFileSync(file);
      } catch (_) {
        buf = null;
      }
    }
    if (!buf) return '';
    store.removeIconFile(a);
    const name = store.saveIcon(buf, a.id);
    a.icon = name;
    store.save(true);
    return iconDataFor(a);
  });

  ipcMain.handle('app:reset-icon', async (_e, { id } = {}) => {
    const a = store.findApp(id);
    if (!a) return '';
    store.removeIconFile(a);
    a.icon = '';
    const png = await library.extractIconBuffer(a.target || a.path);
    if (png) {
      const name = store.saveIcon(png, a.id);
      if (name) a.icon = name;
    }
    store.save(true);
    return iconDataFor(a);
  });

  /* ---------- 分组 ---------- */
  ipcMain.handle('group:add', (_e, { name } = {}) => {
    const clean = String(name || '').trim() || '新分组';
    const g = { id: `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: clean };
    store.get().groups.push(g);
    store.save(true);
    return g;
  });

  ipcMain.handle('group:update', (_e, { id, name } = {}) => {
    const g = store.findGroup(id);
    if (!g) return null;
    if (name && String(name).trim()) g.name = String(name).trim();
    store.save(true);
    return g;
  });

  ipcMain.handle('group:remove', (_e, { id } = {}) => {
    const groups = store.get().groups;
    if (groups.length <= 1) return { ok: false, error: '至少保留一个分组' };
    const idx = groups.findIndex((g) => g.id === id);
    if (idx < 0) return { ok: false, error: '分组不存在' };
    const fallback = groups.find((g) => g.id !== id);
    for (const a of store.get().apps) if (a.groupId === id) a.groupId = fallback.id;
    groups.splice(idx, 1);
    store.save(true);
    return { ok: true, fallback: fallback.id };
  });

  ipcMain.handle('group:move', (_e, { id, dir } = {}) => {
    const groups = store.get().groups;
    const i = groups.findIndex((g) => g.id === id);
    const j = i + (dir > 0 ? 1 : -1);
    if (i < 0 || j < 0 || j >= groups.length) return false;
    [groups[i], groups[j]] = [groups[j], groups[i]];
    store.save(true);
    return true;
  });

  ipcMain.handle('group:assign', (_e, { ids = [], groupId } = {}) => {
    if (!store.findGroup(groupId)) return false;
    for (const a of store.get().apps) if (ids.includes(a.id)) a.groupId = groupId;
    store.save(true);
    return true;
  });

  /* ---------- 设置 ---------- */
  ipcMain.handle('settings:update', (_e, patch = {}) => {
    const s = store.settings;
    const before = { ...s };
    Object.assign(s, patch);
    store.get().settings = s;
    store.save(true);

    if ('alwaysOnTop' in patch && win) win.setAlwaysOnTop(!!patch.alwaysOnTop);
    if ('hotkey' in patch || 'hotkeyEnabled' in patch) applyHotkey();
    if ('autoLaunch' in patch) applyAutoLaunch();
    if ('acrylic' in patch && win && isWin11) {
      try {
        win.setBackgroundMaterial(patch.acrylic ? 'acrylic' : 'none');
        win.setBackgroundColor(patch.acrylic ? '#00000000' : '#0b0d16');
      } catch (err) {
        console.warn(err.message);
      }
    }
    if ('wallpaper' in patch && before.wallpaper !== patch.wallpaper) {
      wallpaperCache = { file: '', dataUrl: '' };
    }
    return { settings: s, wallpaper: wallpaperData() };
  });

  ipcMain.handle('dialog:pick-wallpaper', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '选择背景图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }]
    });
    if (res.canceled || !res.filePaths[0]) return null;
    store.settings.wallpaper = res.filePaths[0];
    store.save(true);
    wallpaperCache = { file: '', dataUrl: '' };
    return { wallpaper: res.filePaths[0], dataUrl: wallpaperData() };
  });

  ipcMain.handle('config:export', async () => {
    const res = await dialog.showSaveDialog(win, {
      title: '导出面板配置',
      defaultPath: `软件面板配置-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false };
    const payload = {
      type: 'software-tools-panel',
      version: 1,
      exportedAt: new Date().toISOString(),
      groups: store.get().groups,
      apps: store.get().apps.map((a) => {
        let icon = '';
        try {
          const p = store.iconPath(a);
          if (p) icon = `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
        } catch (_) {}
        return { ...a, icon };
      }),
      settings: store.settings
    };
    fs.writeFileSync(res.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, path: res.filePath };
  });

  ipcMain.handle('config:import', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '导入面板配置',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false };
    try {
      const raw = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
      if (!raw || !Array.isArray(raw.groups) || !Array.isArray(raw.apps)) throw new Error('文件格式不正确');
      const data = store.get();
      data.groups = raw.groups;
      data.apps = raw.apps.map((a) => ({ ...a, icon: '' }));
      data.settings = { ...data.settings, ...(raw.settings || {}) };
      for (const a of data.apps) {
        if (a.icon && String(a.icon).startsWith('data:')) {
          const name = saveDataUrlIcon(a.id, a.icon);
          a.icon = name;
        }
      }
      store.save(true);
      wallpaperCache = { file: '', dataUrl: '' };
      return { ok: true, state: publicState() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('data:open-dir', () => shell.openPath(app.getPath('userData')));

  ipcMain.handle('data:reset', () => {
    try {
      for (const f of fs.readdirSync(store.iconsDir)) {
        try {
          fs.unlinkSync(path.join(store.iconsDir, f));
        } catch (_) {}
      }
    } catch (_) {}
    store.data = {
      ...store.data,
      apps: [],
      recent: [],
      groups: [
        { id: 'g_common', name: '常用' },
        { id: 'g_dev', name: '开发' },
        { id: 'g_office', name: '办公' },
        { id: 'g_media', name: '影音' },
        { id: 'g_other', name: '其他' }
      ]
    };
    store.save(true);
    return { ok: true, state: publicState() };
  });

  /* ---------- 窗口 ---------- */
  ipcMain.handle('window:min', () => win && win.minimize());
  ipcMain.handle('window:max', () => {
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle('window:close', () => {
    if (!win) return;
    if (store.settings.closeToTray) win.hide();
    else win.close();
  });
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    store.init();
    registerIpc();
    createWindow();
    createTray();
    applyHotkey();
    applyAutoLaunch();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !store.settings.closeToTray) app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    globalShortcut.unregisterAll();
    store.save(true);
  });
}

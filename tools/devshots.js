'use strict';

/**
 * 开发用截图/自检脚本（不参与正式功能）
 * 用法：npx electron tools/devshots.js  → 输出到 shots/
 */

const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots');
fs.mkdirSync(OUT, { recursive: true });

// 独立的数据目录，避免污染真实配置
app.setPath('userData', path.join(os.tmpdir(), 'stp-devhots'));
app.setName('SoftwareToolsPanel');

const store = require('../src/main/store');
const library = require('../src/main/library');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEMO = [
  ['记事本', 'C:\\Windows\\System32\\notepad.exe', 'g_common'],
  ['计算器', 'C:\\Windows\\System32\\calc.exe', 'g_common'],
  ['命令提示符', 'C:\\Windows\\System32\\cmd.exe', 'g_dev'],
  ['PowerShell', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'g_dev'],
  ['画图', 'C:\\Windows\\System32\\mspaint.exe', 'g_media'],
  ['资源管理器', 'C:\\Windows\\explorer.exe', 'g_office'],
  ['注册表编辑器', 'C:\\Windows\\regedit.exe', 'g_other'],
  ['任务管理器', 'C:\\Windows\\System32\\Taskmgr.exe', 'g_other'],
  ['字符映射表', 'C:\\Windows\\System32\\charmap.exe', 'g_other'],
  ['写字板', 'C:\\Windows\\write.exe', 'g_office'],
  ['放大镜', 'C:\\Windows\\System32\\Magnify.exe', 'g_other'],
  ['截图工具', 'C:\\Windows\\System32\\SnippingTool.exe', 'g_common']
];

async function seed() {
  const data = store.get();
  if (data.apps.length) return;
  let i = 0;
  for (const [name, target, gid] of DEMO) {
    if (!fs.existsSync(target)) continue;
    const entry = store.addApp({ name, path: target, target, kind: 'exe', groupId: gid });
    entry.favorite = i % 4 === 0;
    entry.launchCount = Math.floor(Math.random() * 20);
    entry.lastLaunchAt = new Date(Date.now() - i * 3600_000).toISOString();
    const png = await library.extractIconBuffer(target);
    if (png) {
      const file = store.saveIcon(png, entry.id);
      if (file) entry.icon = file;
    }
    i++;
  }
  data.recent = data.apps.slice(0, 6).map((a) => a.id);
  store.save(true);
}

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
  console.log('shot:', name, img.getSize());
}

async function main() {
  await app.whenReady();
  store.init();
  await seed();

  // 复用临时配置目录时，先把影响截图的设置复位，保证每次输出一致
  Object.assign(store.settings, { skin: 'midnight', accent: '', wallpaper: '', cardSize: 'md', view: 'grid' });
  store.save(true);

  // 顺便自检开始菜单扫描
  const t0 = Date.now();
  const scanned = await library.scanStartMenu();
  console.log(`scan: ${scanned.length} 个快捷方式，用时 ${Date.now() - t0}ms`);

  // 升级为 256px 图标
  const hires = require('../src/main/hires');
  const t1 = Date.now();
  const upgraded = await hires.upgradeIcons(store, { force: true });
  console.log(`hires: ${Object.keys(upgraded).length} 个图标，用时 ${Date.now() - t1}ms`);
  console.log('scan sample:', scanned.slice(0, 8).map((s) => `${s.name} -> ${s.target}`).join('\n  '));
  const withIcon = scanned.filter((s) => s.icon).length;
  console.log(`scan: ${withIcon}/${scanned.length} 个带图标`);

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    frame: false,
    show: true,
    backgroundColor: '#0b0d16',
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // 复用主进程的 IPC 需要 main.js 的注册逻辑；这里直接内联最小集合
  const { ipcMain } = require('electron');
  ipcMain.handle('app:state', () => {
    const d = store.get();
    const icons = {};
    for (const a of d.apps) {
      const p = store.iconPath(a);
      if (p) icons[a.id] = `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
    }
    return {
      groups: d.groups,
      apps: d.apps,
      settings: d.settings,
      recent: d.recent,
      icons,
      wallpaper: '',
      meta: {
        version: app.getVersion(),
        isWin11: Number(os.release().split('.')[2]) >= 22000,
        isPortable: false,
        dataDir: app.getPath('userData'),
        hotkeyOk: true
      }
    };
  });
  ipcMain.handle('app:scan', async () => {
    const list = await library.scanStartMenu();
    return list.map((item) => ({ ...item, exists: false }));
  });
  ipcMain.handle('settings:update', (_e, patch = {}) => {
    Object.assign(store.settings, patch);
    store.save(true);
    return { settings: store.settings, wallpaper: '' };
  });
  ipcMain.handle('window:min', () => {});
  ipcMain.handle('window:max', () => false);
  ipcMain.handle('window:close', () => {});

  await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('[renderer]', message);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => console.log('did-fail-load', code, desc));
  await sleep(1200);

  await shot(win, '01-midnight');

  // 浅色皮肤
  await win.webContents.executeJavaScript(`document.querySelector('.skin-tile[data-key="sakura"]')?.click()`);
  await sleep(800);
  await shot(win, '02-sakura');

  // 打开设置抽屉
  await win.webContents.executeJavaScript(`openSettings()`);
  await sleep(600);
  await shot(win, '03-settings');

  // 深色 + 列表视图
  await win.webContents.executeJavaScript(`closeSettings(); document.querySelector('.skin-tile[data-key="aurora"]')?.click();`);
  await sleep(700);
  await win.webContents.executeJavaScript(`document.querySelector('#viewSeg [data-viewmode="list"]').click()`);
  await sleep(600);
  await shot(win, '04-list');

  // 右键菜单
  await win.webContents.executeJavaScript(`document.querySelector('#viewSeg [data-viewmode="grid"]').click()`);
  await sleep(400);
  await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card');
    const r = card.getBoundingClientRect();
    openAppMenu(card.dataset.id, r.left + 40, r.top + 40);
  })()`);
  await sleep(500);
  await shot(win, '05-menu');

  // 扫描开始菜单弹窗
  await win.webContents.executeJavaScript(`closeMenu(); document.querySelector('#btnScanTop').click();`);
  await sleep(3500);
  await shot(win, '06-scan');

  // 深色皮肤 + 设置抽屉
  await win.webContents.executeJavaScript(`closeModal(); document.querySelector('.skin-tile[data-key="midnight"]').click(); openSettings();`);
  await sleep(900);
  await shot(win, '07-settings-dark');

  // 大卡片 + 深空夜航
  await win.webContents.executeJavaScript(`closeSettings(); document.querySelector('.skin-tile[data-key="midnight"]').click(); [...document.querySelectorAll('#sizeSeg button')].find(b => b.dataset.size === 'lg').click();`);
  await sleep(900);
  await shot(win, '09-large');

  // 霜白 + 小卡片
  await win.webContents.executeJavaScript(`document.querySelector('.skin-tile[data-key="frost"]').click(); [...document.querySelectorAll('#sizeSeg button')].find(b => b.dataset.size === 'sm').click();`);
  await sleep(900);
  await shot(win, '10-frost');

  // 空状态（清空视图数据，仅用于截图）
  await win.webContents.executeJavaScript(`closeSettings(); S.apps=[]; S.recent=[]; S.view='all'; renderNav(); renderGrid();`);
  await sleep(700);
  await shot(win, '08-empty');

  app.exit(0);
}

main().catch((err) => {
  console.error(err);
  app.exit(1);
});

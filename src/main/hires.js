'use strict';

/**
 * 高分辨率图标（256px）提取
 * 通过 PowerShell + IShellItemImageFactory 获取系统真实大图标，
 * 失败时静默保留 Electron 提供的 32px 图标。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { nativeImage } = require('electron');

const SCRIPT_SOURCE = path.join(__dirname, '..', '..', 'resources', 'icon-extract.ps1');
let scriptPathCache = '';

function scriptPath() {
  if (scriptPathCache) return scriptPathCache;
  // 打包进 asar 后无法直接执行脚本，复制到临时目录
  try {
    const src = fs.readFileSync(SCRIPT_SOURCE, 'utf8');
    if (SCRIPT_SOURCE.includes('app.asar')) {
      const tmp = path.join(os.tmpdir(), 'stp-icon-extract.ps1');
      fs.writeFileSync(tmp, src, 'utf8');
      scriptPathCache = tmp;
    } else {
      scriptPathCache = SCRIPT_SOURCE;
    }
  } catch (_) {
    scriptPathCache = SCRIPT_SOURCE;
  }
  return scriptPathCache;
}

function iconSize(file) {
  try {
    const img = nativeImage.createFromPath(file);
    return img.isEmpty() ? 0 : img.getSize().width;
  } catch (_) {
    return 0;
  }
}

function runScript(jsonPath, timeout = 45000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath(), '-JsonPath', jsonPath],
        { windowsHide: true, stdio: 'ignore' }
      );
    } catch (_) {
      return resolve(false);
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_) {}
      resolve(false);
    }, timeout);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/**
 * 为缺少大图标的条目补全 256px 图标
 * @returns {Promise<Object>} { appId: dataUrl }
 */
async function upgradeIcons(store, { force = false, limit = 80 } = {}) {
  if (process.platform !== 'win32') return {};

  const jobs = [];
  for (const a of store.get().apps) {
    if (jobs.length >= limit) break;
    if (a.kind === 'url') continue;
    const current = store.iconPath(a);
    if (!force && current && iconSize(current) >= 96) continue;
    const src = a.target || a.path;
    if (!src || !fs.existsSync(src)) continue;
    jobs.push({ id: a.id, src, out: path.join(store.iconsDir, `${a.id}.png`) });
  }
  if (!jobs.length) return {};

  const jsonPath = path.join(os.tmpdir(), `stp-icons-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`);
  try {
    fs.writeFileSync(jsonPath, JSON.stringify(jobs), 'utf8');
  } catch (_) {
    return {};
  }

  await runScript(jsonPath);
  try {
    fs.unlinkSync(jsonPath);
  } catch (_) {}

  const result = {};
  for (const job of jobs) {
    if (!fs.existsSync(job.out)) continue;
    if (iconSize(job.out) < 96) continue;
    const a = store.findApp(job.id);
    if (!a) continue;
    a.icon = path.basename(job.out);
    try {
      result[job.id] = `data:image/png;base64,${fs.readFileSync(job.out).toString('base64')}`;
    } catch (_) {}
  }
  if (Object.keys(result).length) store.save(true);
  return result;
}

module.exports = { upgradeIcons, iconSize };

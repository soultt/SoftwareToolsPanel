'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, shell, nativeImage } = require('electron');

const LAUNCHABLE = new Set(['.exe', '.lnk', '.url', '.bat', '.cmd', '.ps1', '.appref-ms', '.msc', '.jar']);

const SKIP_NAME = /^(卸载|uninstall|remove|repair|修复|readme|read me|license|许可|帮助|help|website|homepage|官网|官方网站|documentation|文档|changelog|更新日志|release notes)$/i;
const SKIP_NAME_LOOSE = /(帮助|说明|手册|readme|help|manual|website|homepage|官网|访问|关于\s|release notes|更新日志|检查更新|更新程序|升级程序|卸载|uninstall)/i;
const SKIP_TARGET_EXT = /\.(chm|hlp|pdf|txt|rtf|docx?|xlsx?|pptx?)$/i;
const SKIP_PATH = /[\\/](uninstall|uninst|卸载)[^\\/]*$/i;

/* ------------------------------------------------------------------ *
 * 图标：带内存缓存，返回 dataURL
 * ------------------------------------------------------------------ */
const iconCache = new Map();

async function extractIcon(file, size = 'large') {
  const key = `${file}|${size}`;
  if (iconCache.has(key)) return iconCache.get(key);
  let dataUrl = '';
  try {
    const img = await app.getFileIcon(file, { size });
    if (img && !img.isEmpty()) dataUrl = img.toDataURL();
  } catch (_) {}
  iconCache.set(key, dataUrl);
  return dataUrl;
}

async function extractIconBuffer(file) {
  try {
    const img = await app.getFileIcon(file, { size: 'large' });
    if (!img || img.isEmpty()) return null;
    const png = img.toPNG();
    return png && png.length ? png : null;
  } catch (_) {
    return null;
  }
}

async function extractIconFromBinary(file) {
  try {
    const img = nativeImage.createFromPath(file);
    if (img && !img.isEmpty()) return img.toPNG();
  } catch (_) {}
  return extractIconBuffer(file);
}

/* ------------------------------------------------------------------ *
 * 快捷方式解析
 * ------------------------------------------------------------------ */
function resolveLnk(lnkPath) {
  try {
    const s = shell.readShortcutLink(lnkPath);
    return {
      target: s.target || '',
      args: s.args || '',
      cwd: s.workingDirectory || '',
      icon: s.icon || '',
      iconIndex: s.iconIndex || 0,
      description: s.description || ''
    };
  } catch (_) {
    return null;
  }
}

function resolveUrlFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(/^\s*URL\s*=\s*(.+)$/im);
    return m ? m[1].trim() : '';
  } catch (_) {
    return '';
  }
}

/* 显示名称里需要去掉的程序后缀（如 WeChat.exe -> WeChat） */
const NAME_SUFFIX = /\.(lnk|url|appref-ms|exe|com|bat|cmd|ps1|msc|jar|vbs)$/i;

function cleanName(name, fallback) {
  let n = String(name || '')
    .replace(NAME_SUFFIX, '')
    .replace(/\s*-\s*快捷方式$/i, '')
    .replace(/\s*快捷方式$/i, '')
    .replace(/\s*-\s*Shortcut$/i, '')
    .replace(/\s*Shortcut$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n) n = path.basename(fallback || '未命名').replace(/\.[^.]+$/, '');
  return n;
}

function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.url') return 'url';
  if (ext === '.lnk') return 'lnk';
  if (ext === '.exe') return 'exe';
  if (ext === '.bat' || ext === '.cmd') return 'bat';
  if (ext === '.ps1') return 'ps1';
  if (ext === '.appref-ms') return 'clickonce';
  return 'file';
}

function describeFile(file) {
  const kind = kindOf(file);
  const out = {
    path: file,
    kind,
    name: cleanName(path.basename(file), file),
    target: file,
    args: '',
    cwd: '',
    iconSource: file
  };
  if (kind === 'lnk') {
    const s = resolveLnk(file);
    if (s) {
      out.target = s.target || file;
      out.args = s.args;
      out.cwd = s.cwd;
      out.iconSource = s.icon && fs.existsSync(s.icon) ? s.icon : s.target || file;
      if (s.description && !out.name) out.name = s.description;
    }
  } else if (kind === 'url') {
    out.target = resolveUrlFile(file);
  } else if (kind === 'exe' || kind === 'file') {
    out.cwd = path.dirname(file);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 扫描开始菜单
 * ------------------------------------------------------------------ */
function startMenuRoots() {
  const roots = [];
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  const appData = process.env.APPDATA || '';
  roots.push(path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  if (appData) roots.push(path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  return roots.filter((r) => {
    try {
      return fs.statSync(r).isDirectory();
    } catch (_) {
      return false;
    }
  });
}

function walk(dir, acc, depth = 0) {
  if (depth > 7) return acc;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/^(windows 管理工具|windows administrative tools|startup|启动)$/i.test(entry.name)) continue;
      walk(full, acc, depth + 1);
    } else if (/\.(lnk|url)$/i.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

async function scanStartMenu() {
  const files = [];
  for (const root of startMenuRoots()) walk(root, files);

  const found = [];
  const seen = new Set();

  for (const file of files) {
    const info = describeFile(file);
    const name = info.name;

    if (!name || SKIP_NAME.test(name)) continue;
    if (SKIP_NAME_LOOSE.test(name)) continue;
    if (SKIP_PATH.test(info.target)) continue;
    if (info.target && SKIP_TARGET_EXT.test(info.target)) continue;

    // 网页快捷方式里，过滤掉厂商首页 / 下载 / 更新之类的入口
    if (info.kind === 'url' && /(首页|主页|官网|访问|关于|下载|更新|帮助|支持|反馈|论坛|文档|手册|指南|教程|参考|home\b|website|support|download|update|forum|docs?\b)/i.test(name)) {
      continue;
    }

    // 过滤掉指向系统内部的杂项（帮助文件、设置代理等），但保留常用系统工具
    const lowerTarget = String(info.target).toLowerCase();
    if (info.kind === 'lnk' && !lowerTarget) continue;
    if (/\\windows\\(system32|syswow64)\\/.test(lowerTarget) && !/cmd|powershell|regedit|notepad|calc|mspaint|taskmgr|control|explorer/.test(lowerTarget)) {
      continue;
    }
    if (info.kind === 'lnk' && info.target && !fs.existsSync(info.target) && !/^[a-z]+:/.test(info.target)) {
      // 目标已不存在（软件已卸载）
      continue;
    }

    const key = `${lowerTarget}|${info.args}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    found.push({
      key,
      name,
      path: file,
      target: info.target,
      args: info.args,
      cwd: info.cwd,
      kind: info.kind,
      // .lnk 本身在部分 Windows / Electron 组合下只能取到通用快捷方式图标，
      // 优先用快捷方式指向的目标（或自定义图标位置）来提取真实图标。
      iconSource: info.iconSource || info.target || info.path,
      folder: path.basename(path.dirname(file))
    });
  }

  found.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  // 并行补图标（限制并发，避免卡顿）
  const limit = 6;
  let cursor = 0;
  const workers = new Array(Math.min(limit, found.length)).fill(0).map(async () => {
    while (cursor < found.length) {
      const item = found[cursor++];
      const sources = [...new Set([item.iconSource, item.target, item.path].filter(Boolean))]
        .filter((src) => !/^[a-z]+:\/\//i.test(src));
      for (const src of sources) {
        item.icon = await extractIcon(src);
        if (item.icon) break;
      }
    }
  });
  await Promise.all(workers);

  return found;
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */
function splitArgs(str) {
  const out = [];
  if (!str) return out;
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(str))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function buildEntry(appEntry) {
  let target = appEntry.target || appEntry.path;
  let args = appEntry.args || '';
  let cwd = appEntry.cwd || '';
  const kind = appEntry.kind || kindOf(target);

  if (kind === 'lnk' || /\.lnk$/i.test(target)) {
    const s = resolveLnk(target);
    if (s && s.target) {
      args = [s.args, args].filter(Boolean).join(' ');
      cwd = cwd || s.cwd;
      target = s.target;
    }
  }
  if (!cwd && target && path.isAbsolute(target)) cwd = path.dirname(target);
  return { target, args, cwd, kind };
}

/* 按 Windows 命令行规则为参数加引号，Start-Process 会把它们拼成一条命令行 */
function quoteWinArg(value) {
  const s = String(value == null ? '' : value);
  if (!s) return '""';
  if (!/[\s"]/.test(s)) return s;
  return `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

/* 以管理员身份启动：UAC 由系统弹出，不隐藏目标程序窗口 */
function launchElevated(target, args, cwd) {
  const ext = path.extname(target).toLowerCase();
  let file = target;
  let argList = splitArgs(args);

  if (ext === '.bat' || ext === '.cmd') {
    file = 'cmd.exe';
    argList = ['/c', target, ...argList];
  } else if (ext === '.ps1') {
    file = 'powershell.exe';
    argList = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', target, ...argList];
  } else if (ext === '.jar') {
    file = 'javaw.exe';
    argList = ['-jar', target, ...argList];
  }

  let cmd = `$ErrorActionPreference='Stop'; Start-Process -FilePath ${psQuote(file)}`;
  if (cwd && fs.existsSync(cwd)) cmd += ` -WorkingDirectory ${psQuote(cwd)}`;
  if (argList.length) {
    cmd += ` -ArgumentList ${psQuote(argList.map(quoteWinArg).join(' '))}`;
  }
  // 只用 windowsHide 隐藏 PowerShell 控制台；不要 detach / 隐藏目标进程，
  // 否则 UAC 弹窗或被提权的程序可能不可见，看起来像“启动失败”
  cmd += ' -Verb RunAs';

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd
      ], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      });
    } catch (err) {
      reject(err);
      return;
    }

    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      // PowerShell 的报错在中文系统上多为 GBK，Node 按 UTF-8 读会乱码；
      // 因此只挑选纯 ASCII 的可读行作为附加信息，其余给统一提示。
      const text = stderr.trim();
      if (/cancel|取消|1223/i.test(text)) return reject(new Error('已取消管理员授权'));
      const detail = text
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/^Start-Process\s*[:：]\s*/i, ''))
        .find((line) => line.length > 6 && line.length < 160 &&
          /^[\x20-\x7E]+$/.test(line) &&
          !/^(?:\+|At line\b|CategoryInfo\b|FullyQualifiedErrorId\b|Exception\b|TargetObject\b|~)/i.test(line));
      reject(new Error(detail
        ? `以管理员身份启动失败：${detail}`
        : '以管理员身份启动失败，请确认程序路径有效，或稍后重试'));
    });
  });
}

async function launch(appEntry) {
  const { target, args, cwd, kind } = buildEntry(appEntry);

  if (kind === 'url' || /^https?:|^mailto:/i.test(target)) {
    await shell.openExternal(target);
    return { ok: true };
  }

  if (!target) throw new Error('未找到可执行路径');
  if (path.isAbsolute(target) && !fs.existsSync(target)) throw new Error('程序不存在或路径无效');

  const ext = path.extname(target).toLowerCase();

  if (appEntry.admin) {
    await launchElevated(target, args, cwd);
    return { ok: true };
  }

  let file = target;
  let argv = splitArgs(args);
  if (ext === '.bat' || ext === '.cmd') {
    file = 'cmd.exe';
    argv = ['/c', target, ...argv];
  } else if (ext === '.ps1') {
    file = 'powershell.exe';
    argv = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', target, ...argv];
  } else if (ext === '.jar') {
    file = 'javaw.exe';
    argv = ['-jar', target, ...argv];
  }

  try {
    const child = spawn(file, argv, {
      cwd: cwd && fs.existsSync(cwd) ? cwd : undefined,
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.on('error', (err) => {
      console.error('启动失败，尝试使用系统关联打开:', err.message);
      shell.openPath(target).catch(() => {});
    });
    child.unref();
  } catch (err) {
    const msg = await shell.openPath(target);
    if (msg) throw new Error(msg);
  }
  return { ok: true };
}

function reveal(appEntry) {
  const { target } = buildEntry(appEntry);
  const p = target || appEntry.path;
  if (p && fs.existsSync(p)) {
    shell.showItemInFolder(p);
    return true;
  }
  return false;
}

function isInstalledShortcut(appEntry) {
  try {
    const { target } = buildEntry(appEntry);
    return !!(target && fs.existsSync(target));
  } catch (_) {
    return false;
  }
}

module.exports = {
  LAUNCHABLE,
  extractIcon,
  extractIconBuffer,
  extractIconFromBinary,
  describeFile,
  resolveLnk,
  scanStartMenu,
  launch,
  reveal,
  buildEntry,
  isInstalledShortcut,
  kindOf,
  cleanName
};

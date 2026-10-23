'use strict';

/**
 * 构建全部产物：
 *   1. 免安装版目录   dist/软件集合面板-win32-x64/
 *   2. 免安装版压缩包 dist/软件集合面板-免安装版-<ver>.zip
 *   3. 安装包         dist/软件集合面板-安装程序-<ver>.exe
 * 用法：
 *   npm run dist              构建全部
 *   npm run dist:portable     仅构建免安装版（目录 + zip）
 *
 * 不依赖网络：直接复制本地 electron 运行时，用 resedit 写入图标与版本信息，
 * 安装包由系统自带 csc.exe（.NET Framework 4.x）编译 tools/installer.cs 生成，
 * 压缩使用 Windows 自带 tar（libarchive）。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const APP_NAME = '软件集合面板';   // 中文显示名（版本信息、说明文本）
const APP_ID = 'SoftwareToolsPanel'; // 英文构建名（目录、exe、安装路径）
const DIST = path.join(root, 'dist');
const OUT = path.join(DIST, `${APP_ID}-win32-x64`);
const ELECTRON_DIST = path.join(root, 'node_modules', 'electron', 'dist');
const portableOnly = process.argv.includes('--portable-only');

function copyDir(from, to) {
  fs.cpSync(from, to, {
    recursive: true,
    filter: (src) => !/[\\/](\.git|shots|dist|node_modules)([\\/]|$)/.test(src)
  });
}

async function stampExe(exePath) {
  const icoPath = path.join(root, 'build', 'icon.ico');
  try {
    const R = await import('resedit');
    const exe = R.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
    const res = R.NtExecutableResource.from(exe);

    if (fs.existsSync(icoPath)) {
      const ico = R.Data.IconFile.from(fs.readFileSync(icoPath));
      const groups = R.Resource.IconGroupEntry.fromEntries(res.entries);
      const targets = groups.length ? groups : [{ id: 1, lang: 1033 }];
      for (const g of targets) {
        R.Resource.IconGroupEntry.replaceIconsForResource(
          res.entries,
          g.id != null ? g.id : 1,
          g.lang != null ? g.lang : 1033,
          ico.icons.map((i) => i.data)
        );
      }
    }

    let [vi] = R.Resource.VersionInfo.fromEntries(res.entries);
    const lang = 1033;
    if (!vi) vi = R.Resource.VersionInfo.createEmpty();
    vi.setStringValues(
      { lang, codepage: 1200 },
      {
        ProductName: APP_NAME,
        FileDescription: `${APP_NAME} - 软件启动面板`,
        CompanyName: 'SoftwareToolsPanel',
        LegalCopyright: `Copyright © ${new Date().getFullYear()} SoftwareToolsPanel`,
        OriginalFilename: `${APP_ID}.exe`,
        InternalName: 'SoftwareToolsPanel',
        FileVersion: pkg.version,
        ProductVersion: pkg.version
      },
      true
    );
    vi.setFileVersion(pkg.version, lang);
    vi.setProductVersion(pkg.version, lang);
    vi.outputToResourceEntries(res.entries);

    res.outputResource(exe);
    fs.writeFileSync(exePath, Buffer.from(exe.generate()));
    console.log('✓ 已写入图标与版本信息');
  } catch (err) {
    console.warn('! 写入 exe 图标/版本信息失败（不影响功能）:', err.message);
  }
}

/* ---------------- 安装包构建（本地 csc + tar，无网络依赖） ---------------- */

function findCsc() {
  const windir = process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function zipDir(srcDir, zipPath) {
  const res = spawnSync('tar', ['--format', 'zip', '-cf', zipPath, '-C', srcDir, '.'], { encoding: 'utf8' });
  if (res.status !== 0 || !fs.existsSync(zipPath)) {
    throw new Error(`tar 打包失败: ${res.stderr || (res.error && res.error.message)}`);
  }
}

function compileInstaller({ out, resource, versionFile }) {
  const csc = findCsc();
  if (!csc) throw new Error('未找到 csc.exe（.NET Framework 4.x）');
  const args = [
    '/nologo', '/target:winexe', '/optimize+',
    `/out:${out}`,
    `/win32icon:${path.join(root, 'build', 'icon.ico')}`,
    '/r:System.IO.Compression.dll',
    '/r:Microsoft.CSharp.dll'
  ];
  if (resource) args.push(`/resource:${resource},payload`);
  args.push(path.join(__dirname, 'installer.cs'), versionFile);
  const res = spawnSync(csc, args, { encoding: 'utf8', windowsVerbatimArguments: false });
  if (res.status !== 0 || !fs.existsSync(out)) {
    throw new Error(`csc 编译失败:\n${res.stdout || ''}${res.stderr || ''}`);
  }
}

function writeVersionFile() {
  const file = path.join(DIST, '_version.g.cs');
  const v = pkg.version;
  const content = [
    'using System.Reflection;',
    `[assembly: AssemblyTitle("${APP_NAME} Setup")]`,
    `[assembly: AssemblyDescription("安装 ${APP_NAME}")]`,
    `[assembly: AssemblyProduct("${APP_NAME}")]`,
    '[assembly: AssemblyCompany("SoftwareToolsPanel")]',
    `[assembly: AssemblyVersion("${v}.0")]`,
    `[assembly: AssemblyFileVersion("${v}.0")]`,
    ''
  ].join('\r\n');
  fs.writeFileSync(file, '\uFEFF' + content, 'utf8');
  return file;
}

async function main() {
  if (!fs.existsSync(path.join(ELECTRON_DIST, 'electron.exe'))) {
    console.error('未找到 electron 运行时，请先执行：npm install');
    process.exit(1);
  }

  const started = Date.now();
  console.log('清理 dist …');
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  console.log('复制 Electron 运行时 …');
  fs.cpSync(ELECTRON_DIST, OUT, { recursive: true });

  const srcExe = path.join(OUT, 'electron.exe');
  const exePath = path.join(OUT, `${APP_ID}.exe`);
  fs.renameSync(srcExe, exePath);

  console.log('写入应用文件 …');
  const appDir = path.join(OUT, 'resources', 'app');
  fs.mkdirSync(appDir, { recursive: true });
  copyDir(path.join(root, 'src'), path.join(appDir, 'src'));
  copyDir(path.join(root, 'resources'), path.join(appDir, 'resources'));
  fs.mkdirSync(path.join(appDir, 'build'), { recursive: true });
  fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(appDir, 'build', 'icon.png'));

  const runtimePkg = {
    name: pkg.name,
    productName: APP_ID,
    version: pkg.version,
    description: pkg.description,
    main: 'src/main/main.js',
    author: pkg.author,
    license: pkg.license
  };
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(runtimePkg, null, 2), 'utf8');

  // 移除 Electron 默认示例应用
  fs.rmSync(path.join(OUT, 'resources', 'default_app.asar'), { force: true });

  // 只保留需要的语言包，减小体积
  const keepLocales = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak', 'en-GB.pak']);
  const localesDir = path.join(OUT, 'locales');
  if (fs.existsSync(localesDir)) {
    for (const f of fs.readdirSync(localesDir)) {
      if (!keepLocales.has(f)) fs.rmSync(path.join(localesDir, f), { force: true });
    }
  }

  await stampExe(exePath);

  // 便携模式：数据存到 exe 同级 Data 目录
  fs.writeFileSync(path.join(OUT, 'portable.dat'), '', 'utf8');
  fs.writeFileSync(
    path.join(OUT, '使用说明.txt'),
    [
      '软件集合面板（免安装版）',
      '==========================',
      '',
      '双击「SoftwareToolsPanel.exe」启动。',
      '',
      '· 配置、图标和皮肤设置保存在本目录的 Data 文件夹里，整个文件夹可以拷到 U 盘使用。',
      '· 想改用系统用户目录（%APPDATA%\\SoftwareToolsPanel）保存配置，删除本目录的 portable.dat 即可。',
      '· 首次使用点左下角「扫描已安装软件」，可一键把开始菜单里的程序加进来。',
      '· 也可以直接拖入 .exe / .lnk / .url / .bat 文件；右键卡片可编辑、移动分组或删除。',
      '· 右下角「皮肤与设置」：9 套皮肤、强调色、背景图、卡片尺寸、开机自启等。',
      '',
      '快捷键',
      '  Ctrl+K            搜索',
      '  Ctrl+N            添加软件',
      '  Ctrl+,            皮肤与设置',
      '  Ctrl+Alt+Space    显示 / 隐藏面板',
      '',
      '提示：面板只记录程序路径，不会移动或卸载你的软件。'
    ].join('\r\n'),
    'utf8'
  );

  const size = (() => {
    let total = 0;
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else total += fs.statSync(p).size;
      }
    };
    walk(OUT);
    return (total / 1024 / 1024).toFixed(0);
  })();

  const mb = (p) => (fs.statSync(p).size / 1024 / 1024).toFixed(0);

  // ---- 产物 2：免安装版 zip ----
  const portableZip = path.join(DIST, `${APP_ID}-Portable-${pkg.version}.zip`);
  console.log('\n生成免安装版 zip …');
  zipDir(OUT, portableZip);

  // ---- 产物 3：安装包 ----
  const setupExe = path.join(DIST, `${APP_ID}-Setup-${pkg.version}.exe`);
  if (portableOnly) {
    console.log('（--portable-only：跳过安装包构建）');
  } else {
    const versionFile = writeVersionFile();
    const uninstTmp = path.join(DIST, '_Uninstall.exe');

    console.log('编译卸载器 …');
    compileInstaller({ out: uninstTmp, versionFile });

    // 卸载器随载荷进入安装目录；免安装版不含卸载器，打包后即移除
    fs.copyFileSync(uninstTmp, path.join(OUT, 'Uninstall.exe'));
    const payloadZip = path.join(DIST, '_payload.zip');
    console.log('生成安装包载荷 zip …');
    zipDir(OUT, payloadZip);
    fs.rmSync(path.join(OUT, 'Uninstall.exe'), { force: true });

    console.log('编译安装包（内嵌载荷，约需数秒）…');
    compileInstaller({ out: setupExe, resource: payloadZip, versionFile });

    fs.rmSync(payloadZip, { force: true });
    fs.rmSync(uninstTmp, { force: true });
    fs.rmSync(versionFile, { force: true });
  }

  console.log(`\n✓ 构建完成，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  免安装版目录  ${OUT}（约 ${size} MB）`);
  console.log(`  免安装版 zip  ${portableZip}（${mb(portableZip)} MB）`);
  if (!portableOnly) console.log(`  安装包        ${setupExe}（${mb(setupExe)} MB）`);
}

main().catch((err) => {
  console.error('打包失败:', err);
  process.exit(1);
});

'use strict';

/**
 * 打包为 Windows 免安装版（x64）
 * 用法：npm run dist
 * 输出：dist/软件集合面板-win32-x64/
 *
 * 不依赖网络：直接复制本地 electron 运行时，再用 resedit 写入图标与版本信息。
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const APP_NAME = '软件集合面板';
const DIST = path.join(root, 'dist');
const OUT = path.join(DIST, `${APP_NAME}-win32-x64`);
const ELECTRON_DIST = path.join(root, 'node_modules', 'electron', 'dist');

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
        OriginalFilename: `${APP_NAME}.exe`,
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
  const exePath = path.join(OUT, `${APP_NAME}.exe`);
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
    productName: APP_NAME,
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
      '双击「软件集合面板.exe」启动。',
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

  console.log(`\n✓ 打包完成，用时 ${((Date.now() - started) / 1000).toFixed(1)}s，约 ${size} MB`);
  console.log('输出目录:', OUT);
  console.log('启动文件:', exePath);
}

main().catch((err) => {
  console.error('打包失败:', err);
  process.exit(1);
});

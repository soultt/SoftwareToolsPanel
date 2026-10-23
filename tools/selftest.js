'use strict';

/**
 * 核心功能自检（不依赖界面）
 * 用法：npx electron tools/selftest.js
 */

const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.setPath('userData', path.join(os.tmpdir(), 'stp-selftest'));
app.setName('SoftwareToolsPanel');

const store = require('../src/main/store');
const library = require('../src/main/library');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;

function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
}

async function main() {
  await app.whenReady();
  // 清空测试档案
  try {
    fs.rmSync(path.join(os.tmpdir(), 'stp-selftest'), { recursive: true, force: true });
  } catch (_) {}
  store.init();

  console.log('data dir:', app.getPath('userData'));

  /* 1. 图标质量 */
  const png = await library.extractIconBuffer('C:\\Windows\\System32\\notepad.exe');
  const img = nativeImage.createFromBuffer(png || Buffer.alloc(0));
  check('提取 exe 图标', !!png && !img.isEmpty(), `${img.getSize().width}x${img.getSize().height}`);

  /* 2. 添加快捷方式 / exe */
  const exePaths = ['C:\\Windows\\System32\\notepad.exe', 'C:\\Windows\\System32\\whoami.exe', 'C:\\Windows\\System32\\calc.exe'];
  for (const p of exePaths) {
    if (!fs.existsSync(p)) {
      console.log('跳过不存在的文件', p);
      continue;
    }
    const info = library.describeFile(p);
    const entry = store.addApp({ name: info.name, path: p, target: info.target, kind: info.kind, groupId: store.get().groups[0].id });
    const iconBuf = await library.extractIconBuffer(info.target);
    if (iconBuf) entry.icon = store.saveIcon(iconBuf, entry.id);
  }
  check('添加 exe（3 个）', store.get().apps.length === 3, `实际 ${store.get().apps.length}`);

  /* 3. 重复检测 */
  const dup = store.get().apps.find((a) => a.target.toLowerCase() === exePaths[0].toLowerCase());
  check('重复路径可识别', !!dup);

  /* 4. 启动（whoami 自行退出） */
  const who = store.get().apps.find((a) => /whoami/i.test(a.target));
  if (who) {
    const res = await library.launch(who);
    await sleep(900);
    check('启动程序', res && res.ok);
    store.touch(who.id);
    check('记录启动次数', store.findApp(who.id).launchCount === 1);
  }

  /* 5. 收藏 + 重命名 + 备注 */
  const target = store.get().apps[0];
  target.favorite = true;
  target.name = '我的记事本';
  store.save(true);
  store.load();
  const reloaded = store.findApp(target.id);
  check('持久化收藏/重命名', !!reloaded && reloaded.favorite === true && reloaded.name === '我的记事本');

  /* 6. 排序：把最后一个移到第一位 */
  const ids = store.get().apps.map((a) => a.id);
  const rotated = [ids[ids.length - 1], ...ids.slice(0, -1)];
  const appsArr = store.get().apps;
  const order = new Map(rotated.map((id, i) => [id, i]));
  const sorted = appsArr.slice().sort((a, b) => order.get(a.id) - order.get(b.id));
  store.get().apps = sorted;
  store.save(true);
  store.load();
  check('排序持久化', store.get().apps[0].id === rotated[0]);

  /* 7. 分组移动 */
  const gid = store.get().groups[1].id;
  store.get().apps[0].groupId = gid;
  store.save(true);
  store.load();
  check('移动到分组', store.get().apps[0].groupId === gid);

  /* 8. 高分辨率图标 */
  const hires = require('../src/main/hires');
  const upgraded = await hires.upgradeIcons(store, { force: true });
  const upgradedId = Object.keys(upgraded)[0];
  check('升级 256px 图标', !!upgradedId, `${Object.keys(upgraded).length} 个`);
  if (upgradedId) {
    const a = store.findApp(upgradedId);
    check('图标尺寸 >= 128', hires.iconSize(store.iconPath(a)) >= 128, `${hires.iconSize(store.iconPath(a))}px`);
  }

  /* 9. 扫描 + 导入（含图标） */  const scanned = await library.scanStartMenu();
  check('扫描开始菜单', scanned.length > 0, `${scanned.length} 项`);
  check('扫描结果带图标', scanned.slice(0, 5).every((s) => s.icon && s.icon.startsWith('data:image')));

  const sample = scanned.find((s) => !/卸载|uninstall/i.test(s.name)) || scanned[0];
  const before = store.get().apps.length;
  const imp = store.addApp({ name: sample.name, path: sample.path, target: sample.target, args: sample.args, cwd: sample.cwd, kind: sample.kind, groupId: gid });
  const buf = Buffer.from(String(sample.icon).split(',')[1] || '', 'base64');
  if (buf.length) imp.icon = store.saveIcon(buf, imp.id);
  store.save(true);
  check('导入扫描结果', store.get().apps.length === before + 1);
  check('图标文件已落地', !!store.iconPath(imp), String(store.iconPath(imp)));

  /* 9. 启动参数解析 */
  check('参数解析', JSON.stringify(library.buildEntry({ path: 'C:\\x.exe', target: 'C:\\x.exe', args: '--a "b c"' })) !== '');
  const built = library.buildEntry({ path: 'C:\\x.exe', target: 'C:\\x.exe', args: '--a "b c"', kind: 'exe' });
  check('buildEntry 保留参数', built.args === '--a "b c"', built.args);

  /* 10. 删除 + 图标清理 */
  const victim = store.get().apps[0];
  const victimIcon = store.iconPath(victim);
  store.removeIconFile(victim);
  store.get().apps = store.get().apps.filter((a) => a.id !== victim.id);
  store.save(true);
  check('删除软件', !store.findApp(victim.id));
  check('删除图标文件', !victimIcon || !fs.existsSync(victimIcon));

  console.log(failed === 0 ? '\n全部自检通过 ✅' : `\n${failed} 项失败 ❌`);
  app.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  app.exit(1);
});

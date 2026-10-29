'use strict';

/* ============================================================
   软件集合面板 —— 渲染层
   ============================================================ */

const SKINS = [
  { id: 'midnight', name: '深空夜航', desc: '靛蓝玻璃 · 冷调' },
  { id: 'graphite', name: '石墨极简', desc: '中性灰 · 克制' },
  { id: 'aurora', name: '极光森林', desc: '荧光绿 · 通透' },
  { id: 'ocean', name: '深海', desc: '蔚蓝 · 沉静' },
  { id: 'sakura', name: '樱花微光', desc: '浅粉 · 温柔' },
  { id: 'frost', name: '霜白', desc: '冷白 · 干净' },
  { id: 'paper', name: '暖纸', desc: '米色 · 手作感' },
  { id: 'cyber', name: '赛博霓虹', desc: '洋红霓虹 · 锐利' },
  { id: 'gold', name: '暗夜鎏金', desc: '黑金 · 质感' }
];

const ACCENTS = ['#6c8cff', '#a678ff', '#3ddc97', '#45b8ff', '#ec6ba8', '#f59e0b', '#ff5d5d', '#22d3ee', '#c8d0dc'];

const S = {
  groups: [],
  apps: [],
  settings: {},
  icons: {},
  wallpaper: '',
  meta: {},
  recent: [],
  view: 'all',
  query: '',
  ready: false
};

/* ---------------- DOM ---------------- */
const $ = (sel) => document.querySelector(sel);
const gridEl = $('#grid');
const navEl = $('#nav');
const emptyEl = $('#empty');
const scrollEl = $('#scroll');
const searchEl = $('#search');
const menuEl = $('#menu');
const overlayEl = $('#overlay');
const drawerEl = $('#drawer');
const toastsEl = $('#toasts');
const dropMask = $('#dropMask');
const wallEl = $('#wall');

/* ---------------- 小工具 ---------------- */
function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function svgIcon(name, cls = 'ic') {
  return `<svg class="${cls}"><use href="#${name}"/></svg>`;
}

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function hueOf(str) {
  let hash = 0;
  for (let i = 0; i < String(str).length; i++) hash = (hash * 31 + str.charCodeAt(i)) % 360;
  return hash;
}

function dirName(p) {
  const parts = String(p || '').split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts[parts.length - 1] || '';
}

function compactPath(p) {
  let s = String(p || '');
  const home = s.match(/^[A-Za-z]:\\Users\\[^\\]+/);
  if (home) s = s.replace(home[0], '~');
  return s;
}

function prettyHotkey(str) {
  return String(str || '')
    .replace(/Control|CommandOrControl|CmdOrCtrl/gi, 'Ctrl')
    .replace(/\+/g, ' + ');
}

function findApp(id) {
  return S.apps.find((a) => a.id === id) || null;
}

function groupName(id) {
  const g = S.groups.find((x) => x.id === id);
  return g ? g.name : '未分组';
}

function activeGroupId() {
  if (S.view.startsWith('group:')) {
    const id = S.view.slice(6);
    if (S.groups.some((g) => g.id === id)) return id;
  }
  return S.groups[0] ? S.groups[0].id : null;
}

/* ---------------- 提示 ---------------- */
function toast(message, type = 'ok', ms = 2200) {
  const el = h('div', { class: `toast ${type === 'error' ? 'error' : ''}` });
  el.innerHTML = `${svgIcon(type === 'error' ? 'i-info' : 'i-check')}<span>${esc(message)}</span>`;
  toastsEl.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }, ms);
}

/* ---------------- 设置持久化 ---------------- */
async function saveSettings(patch, opts = {}) {
  try {
    const res = await api.saveSettings(patch);
    if (res && res.settings) S.settings = res.settings;
    if (res && typeof res.wallpaper === 'string' && (('wallpaper' in patch) || opts.wall)) S.wallpaper = res.wallpaper;
    applyTheme();
    if (opts.render) renderGrid();
    syncSettingsUI();
    return true;
  } catch (err) {
    toast(`保存设置失败：${err.message}`, 'error');
    return false;
  }
}

/* ---------------- 主题 / 皮肤 ---------------- */
function wallpaperFraction(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  const frac = n > 1 ? n / 100 : n;
  return Math.min(1, Math.max(0.05, frac));
}

function applyTheme() {
  const s = S.settings || {};
  const html = document.documentElement;

  html.dataset.skin = s.skin || 'midnight';
  html.dataset.size = s.cardSize || 'md';
  html.dataset.view = s.view === 'list' ? 'list' : 'grid';
  html.dataset.anim = s.animations === false ? 'off' : 'on';
  html.classList.toggle('acrylic', !!(s.acrylic && S.meta.isWin11));

  if (s.accent) html.style.setProperty('--accent', s.accent);
  else html.style.removeProperty('--accent');

  const hasWall = !!S.wallpaper;
  document.body.classList.toggle('has-wall', hasWall);
  if (hasWall) {
    wallEl.style.backgroundImage = `url("${S.wallpaper}")`;
    // wallpaperOpacity 存的是 0~1 的小数，不能当成百分比再除以 100
    wallEl.style.opacity = String(wallpaperFraction(s.wallpaperOpacity));
  } else {
    wallEl.style.backgroundImage = '';
  }

  const icon = $('#viewModeIcon');
  if (icon) icon.setAttribute('href', s.view === 'list' ? '#i-list' : '#i-grid');
}

/* ---------------- 数据 ---------------- */
function applyState(state) {
  S.groups = state.groups || [];
  S.apps = state.apps || [];
  S.settings = state.settings || {};
  S.icons = state.icons || {};
  S.wallpaper = state.wallpaper || '';
  S.meta = state.meta || {};
  S.recent = state.recent || [];

  if (!S.groups.length) S.groups = [{ id: 'g_other', name: '其他' }];

  const valid = (v) =>
    v === 'all' || v === 'favorites' || v === 'recent' || (v && v.startsWith('group:') && S.groups.some((g) => `group:${g.id}` === v));
  if (!valid(S.view)) S.view = valid(S.settings.lastView) ? S.settings.lastView : 'all';

  applyTheme();
  renderNav();
  renderGrid();
  syncSettingsUI();
  S.ready = true;
}

async function refresh() {
  try {
    const st = await api.state();
    applyState(st);
  } catch (err) {
    toast(`刷新失败：${err.message}`, 'error');
  }
}

/* ---------------- 视图数据 ---------------- */
function currentGroupId() {
  return S.view.startsWith('group:') ? S.view.slice(6) : null;
}

function visibleApps() {
  let list = S.apps.slice();
  if (S.view === 'favorites') list = list.filter((a) => a.favorite);
  else if (S.view === 'recent') {
    const map = new Map(S.apps.map((a) => [a.id, a]));
    list = S.recent.map((id) => map.get(id)).filter(Boolean).slice(0, 30);
  } else if (S.view.startsWith('group:')) {
    const gid = S.view.slice(6);
    list = list.filter((a) => a.groupId === gid);
  }
  const q = S.query.trim().toLowerCase();
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean);
    list = list.filter((a) => {
      const hay = `${a.name} ${a.target} ${a.path} ${a.note || ''} ${groupName(a.groupId)}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  return list;
}

/* ---------------- 分组导航 ---------------- */
function navButton({ view, icon, label, count, groupId }) {
  const btn = h('button', {
    class: `nav-item ${S.view === view ? 'active' : ''}`,
    dataset: groupId ? { view, group: groupId } : { view },
    title: label
  });
  btn.innerHTML = `${svgIcon(icon)}<span class="label">${esc(label)}</span><span class="count">${count}</span>`;
  return btn;
}

function renderNav() {
  const favCount = S.apps.filter((a) => a.favorite).length;
  navEl.innerHTML = '';

  navEl.appendChild(navButton({ view: 'all', icon: 'i-apps', label: '全部软件', count: S.apps.length }));
  navEl.appendChild(navButton({ view: 'favorites', icon: 'i-star', label: '收藏', count: favCount }));
  navEl.appendChild(navButton({ view: 'recent', icon: 'i-clock', label: '最近启动', count: S.recent.length }));
  navEl.appendChild(h('div', { class: 'group-sep' }));

  for (const g of S.groups) {
    const count = S.apps.filter((a) => a.groupId === g.id).length;
    const btn = navButton({ view: `group:${g.id}`, icon: 'i-folder', label: g.name, count, groupId: g.id });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openGroupMenu(g.id, e.clientX, e.clientY);
    });
    navEl.appendChild(btn);
  }

  const active = navEl.querySelector('.nav-item.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function navTitle() {
  if (S.view === 'all') return '全部软件';
  if (S.view === 'favorites') return '收藏';
  if (S.view === 'recent') return '最近启动';
  return groupName(currentGroupId());
}

/* ---------------- 卡片 ---------------- */
function canReorder() {
  return !S.query.trim() && S.view !== 'recent';
}

function iconMarkup(a) {
  const data = S.icons[a.id];
  if (data) {
    return `<img src="${data}" alt="" draggable="false" onerror="this.style.display='none'" />`;
  }
  const letter = (a.name || '?').trim().charAt(0).toUpperCase();
  return `<span class="letter" style="--hue:${hueOf(a.name)}">${esc(letter)}</span>`;
}

function cardEl(a, index) {
  const card = h('article', {
    class: `card${a.favorite ? ' is-fav' : ''}`,
    dataset: { id: a.id },
    tabindex: '0',
    draggable: canReorder()
  });
  card.style.animationDelay = `${Math.min(index * 16, 260)}ms`;

  const sub = S.settings.showPath === false
    ? groupName(a.groupId)
    : S.settings.view === 'list'
      ? compactPath(a.target || a.path)
      : `${groupName(a.groupId)} · ${dirName(a.target || a.path) || '本地'}`;

  card.innerHTML = `
    <div class="card-icon">${iconMarkup(a)}</div>
    <div class="card-text">
      <div class="card-name">${esc(a.name)}</div>
      <div class="card-sub">${esc(sub)}</div>
    </div>
    <div class="card-tools">
      <button class="mini-btn" data-act="favorite" title="${a.favorite ? '取消收藏' : '收藏'}">${svgIcon('i-star')}</button>
      <button class="mini-btn" data-act="menu" title="更多操作">${svgIcon('i-more')}</button>
    </div>`;
  card.title = `${a.name}\n${a.target || a.path}`;
  return card;
}

function renderGrid() {
  const list = visibleApps();
  gridEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  list.forEach((a, i) => frag.appendChild(cardEl(a, i)));
  gridEl.appendChild(frag);

  // 标题 / 计数
  $('#viewTitle').textContent = S.query.trim() ? `搜索：${S.query.trim()}` : navTitle();
  $('#viewCount').textContent = `${list.length}${S.query.trim() ? ` / ${S.apps.length}` : ''}`;

  // 空状态
  const isEmpty = list.length === 0;
  emptyEl.hidden = !isEmpty;
  gridEl.hidden = isEmpty;
  if (isEmpty) {
    const title = $('#emptyTitle');
    const text = $('#emptyText');
    const actions = document.querySelector('.empty-actions');
    if (S.query.trim()) {
      title.textContent = '没有找到匹配的软件';
      text.textContent = `试试其他关键词，或者清空搜索框查看全部 ${S.apps.length} 个软件。`;
      actions.hidden = true;
    } else if (S.view === 'favorites') {
      title.textContent = '还没有收藏的软件';
      text.textContent = '在卡片上点星标，或在右键菜单里选择「加入收藏」，常用软件就会集中在这里。';
      actions.hidden = true;
    } else if (S.view === 'recent') {
      title.textContent = '还没有启动记录';
      text.textContent = '从面板启动软件后，这里会自动记录最近使用过的程序。';
      actions.hidden = true;
    } else if (S.view.startsWith('group:')) {
      title.textContent = '这个分组还是空的';
      text.textContent = '把其他分组的卡片拖到这里，或者添加新的软件到这个分组。';
      actions.hidden = false;
    } else {
      title.textContent = '面板还是空的';
      text.textContent = '把桌面上的 .exe / .lnk 拖进来，或者一键扫描开始菜单里已安装的软件。';
      actions.hidden = false;
    }
  }

  updateStatus();
}

function updateStatus() {
  const left = $('#statusLeft');
  const right = $('#statusRight');
  if (S.query.trim()) left.textContent = '按 Esc 清空搜索';
  else if (S.view === 'recent') left.textContent = '按启动时间倒序排列，最多显示 30 条记录';
  else if (S.view === 'favorites') left.textContent = '右键卡片可以取消收藏或直接运行';
  else if (S.view.startsWith('group:')) left.textContent = '拖动卡片可以排序，拖到上方其他分组即可移动';
  else left.textContent = '单击卡片即可启动 · 右键卡片编辑 / 移动 / 删除';

  const hotkey = S.settings.hotkeyEnabled ? ` · 显隐 ${prettyHotkey(S.settings.hotkey)}` : '';
  right.textContent = `${S.apps.length} 个软件 · ${S.groups.length} 个分组${hotkey}`;
}

/* ---------------- 启动 ---------------- */
async function launchApp(id, card, admin = false) {
  const a = findApp(id);
  if (!a) return;
  if (card) {
    card.classList.add('launched');
    setTimeout(() => card.classList.remove('launched'), 640);
  }
  const res = await api.launch(id, admin);
  if (res && res.ok) {
    a.launchCount = (a.launchCount || 0) + 1;
    a.lastLaunchAt = new Date().toISOString();
    S.recent = [id, ...S.recent.filter((x) => x !== id)].slice(0, 30);
    if (S.view === 'recent') renderGrid();
    toast(`已启动 ${a.name}`);
  } else {
    toast(`启动失败：${(res && res.error) || '未知错误'}`, 'error', 3200);
  }
}

async function toggleFavorite(id) {
  const a = findApp(id);
  if (!a) return;
  a.favorite = !a.favorite;
  await api.update(id, { favorite: a.favorite });
  renderNav();
  renderGrid();
  toast(a.favorite ? `已收藏 ${a.name}` : `已取消收藏 ${a.name}`, 'ok', 1500);
}

/* ---------------- 事件绑定：卡片 ---------------- */
gridEl.addEventListener('click', (e) => {
  const actBtn = e.target.closest('[data-act]');
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;

  if (actBtn) {
    e.preventDefault();
    e.stopPropagation();
    if (actBtn.dataset.act === 'favorite') toggleFavorite(id);
    else {
      const r = actBtn.getBoundingClientRect();
      openAppMenu(id, r.right - 4, r.bottom + 6);
    }
    return;
  }
  if (S.settings.launchMode !== 'double') launchApp(id, card);
});

gridEl.addEventListener('dblclick', (e) => {
  if (S.settings.launchMode !== 'double') return;
  const card = e.target.closest('.card');
  if (!card || e.target.closest('[data-act]')) return;
  launchApp(card.dataset.id, card);
});

gridEl.addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  e.preventDefault();
  openAppMenu(card.dataset.id, e.clientX, e.clientY);
});

gridEl.addEventListener('keydown', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  const cards = [...gridEl.querySelectorAll('.card')];
  const idx = cards.indexOf(card);

  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    launchApp(id, card);
  } else if (e.key === 'Delete') {
    e.preventDefault();
    confirmRemoveApp(id);
  } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    e.preventDefault();
    const r = card.getBoundingClientRect();
    openAppMenu(id, r.left + 20, r.top + 30);
  } else if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
    e.preventDefault();
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = cards[Math.min(cards.length - 1, Math.max(0, idx + step))];
    if (next) next.focus();
  }
});

/* ---------------- 菜单 ---------------- */
let menuCloseTimer = null;

function closeMenu() {
  if (menuEl.hidden) return;
  menuEl.hidden = true;
  menuEl.innerHTML = '';
}

function openMenu(x, y, items) {
  clearTimeout(menuCloseTimer);
  menuEl.innerHTML = '';

  for (const item of items) {
    if (!item) continue;
    if (item.sep) {
      menuEl.appendChild(h('div', { class: 'menu-sep' }));
      continue;
    }
    if (item.head) {
      menuEl.appendChild(h('div', { class: 'menu-head', text: item.head }));
      continue;
    }
    const btn = h('button', { class: `menu-item${item.danger ? ' danger' : ''}${item.active ? ' active' : ''}` });
    btn.disabled = !!item.disabled;
    btn.innerHTML = `
      ${item.icon ? svgIcon(item.icon) : '<span class="dot"></span>'}
      <span class="label">${esc(item.label)}</span>
      ${item.tail ? `<span class="tail">${esc(item.tail)}</span>` : ''}`;
    btn.addEventListener('click', () => {
      closeMenu();
      if (item.action) item.action();
    });
    menuEl.appendChild(btn);
  }

  menuEl.hidden = false;
  menuEl.style.left = '0px';
  menuEl.style.top = '0px';
  const rect = menuEl.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 10));
  const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 10));
  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
  menuEl.scrollTop = 0;
}

document.addEventListener('mousedown', (e) => {
  if (!menuEl.hidden && !e.target.closest('#menu')) closeMenu();
}, true);

window.addEventListener('blur', closeMenu);
scrollEl.addEventListener('scroll', closeMenu, { passive: true });
window.addEventListener('resize', closeMenu);

function openAppMenu(id, x, y) {
  const a = findApp(id);
  if (!a) return;
  const others = S.groups.filter((g) => g.id !== a.groupId);

  const items = [
    { icon: 'i-play', label: '启动', tail: 'Enter', action: () => launchApp(id) },
    { icon: 'i-shield', label: '以管理员身份启动', action: () => launchApp(id, null, true) },
    {
      icon: 'i-folder',
      label: '打开文件所在位置',
      action: async () => {
        const ok = await api.reveal(id);
        if (!ok) toast('找不到文件，可能已被移动或删除', 'error', 3000);
      }
    },
    {
      icon: 'i-copy',
      label: '复制程序路径',
      action: async () => {
        const p = await api.targetOf(id);
        if (p && api.copyText(p)) toast('路径已复制到剪贴板');
      }
    },
    { sep: true },
    { icon: 'i-edit', label: '编辑信息…', action: () => openEditor(id) },
    {
      icon: 'i-image',
      label: '更换图标…',
      action: async () => {
        const dataUrl = await api.pickIcon(id);
        if (dataUrl) {
          S.icons[id] = dataUrl;
          renderGrid();
          toast('图标已更新');
        }
      }
    },
    {
      icon: 'i-refresh',
      label: '恢复默认图标',
      action: async () => {
        const dataUrl = await api.resetIcon(id);
        S.icons[id] = dataUrl || '';
        renderGrid();
        toast('已恢复默认图标', 'ok', 1500);
      }
    },
    { sep: true },
    { icon: 'i-star', label: a.favorite ? '取消收藏' : '加入收藏', active: a.favorite, tail: a.favorite ? '已收藏' : '', action: () => toggleFavorite(id) },
    { sep: true },
    { head: others.length ? '移动到分组' : '分组' }
  ];

  for (const g of S.groups) {
    items.push({
      icon: 'i-folder',
      label: g.name,
      active: g.id === a.groupId,
      tail: g.id === a.groupId ? '当前' : '',
      action: async () => {
        if (g.id === a.groupId) return;
        await api.assignGroup([id], g.id);
        a.groupId = g.id;
        renderNav();
        renderGrid();
        toast(`已移动到「${g.name}」`);
      }
    });
  }

  items.push({ sep: true });
  items.push({ icon: 'i-trash', label: '从面板移除', danger: true, action: () => confirmRemoveApp(id) });

  openMenu(x, y, items);
}

function openGroupMenu(groupId, x, y) {
  const g = S.groups.find((x2) => x2.id === groupId);
  if (!g) return;
  const index = S.groups.findIndex((x2) => x2.id === groupId);

  openMenu(x, y, [
    {
      icon: 'i-edit',
      label: '重命名分组…',
      action: () => promptRenameGroup(groupId)
    },
    { icon: 'i-plus', label: '新建分组…', action: () => promptNewGroup() },
    { sep: true },
    {
      icon: 'i-move',
      label: '上移',
      disabled: index === 0,
      action: async () => {
        await api.moveGroup(groupId, -1);
        renderNav();
      }
    },
    {
      icon: 'i-move',
      label: '下移',
      disabled: index === S.groups.length - 1,
      action: async () => {
        await api.moveGroup(groupId, 1);
        renderNav();
      }
    },
    { sep: true },
    {
      icon: 'i-trash',
      label: '删除分组',
      danger: true,
      disabled: S.groups.length <= 1,
      action: () => {
        const count = S.apps.filter((a) => a.groupId === groupId).length;
        confirmDialog({
          title: `删除分组「${g.name}」？`,
          message: count ? `组内的 ${count} 个软件会被移动到其他分组，不会被删除。` : '这个分组目前是空的。',
          confirmText: '删除分组',
          danger: true,
          onOk: async () => {
            const res = await api.removeGroup(groupId);
            if (!res.ok) return toast(res.error || '删除失败', 'error');
            S.view = 'all';
            await refresh();
            toast('分组已删除');
          }
        });
      }
    }
  ]);
}

/* ---------------- 弹窗 ---------------- */
let activeModal = null;

function closeModal() {
  if (!activeModal) return;
  overlayEl.hidden = true;
  overlayEl.innerHTML = '';
  activeModal = null;
}

function openModal({ title, subtitle, body, footer = [], size = '', onMount }) {
  closeModal();
  const modal = h('div', { class: `modal ${size}` });

  const head = h('div', { class: 'modal-head' });
  head.innerHTML = `<div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>`;
  const closeBtn = h('button', { class: 'icon-btn', title: '关闭' });
  closeBtn.innerHTML = svgIcon('i-close');
  closeBtn.addEventListener('click', closeModal);
  head.appendChild(closeBtn);

  const bodyEl = h('div', { class: 'modal-body' });
  if (body instanceof Node) bodyEl.appendChild(body);
  else bodyEl.innerHTML = body || '';

  const footEl = h('div', { class: 'modal-foot' });
  for (const item of footer) {
    if (!item) continue;
    if (item.spacer) footEl.appendChild(h('div', { class: 'spacer', text: item.spacer }));
    else footEl.appendChild(item);
  }

  modal.append(head, bodyEl);
  if (footer.length) modal.appendChild(footEl);
  overlayEl.innerHTML = '';
  overlayEl.appendChild(modal);
  overlayEl.hidden = false;

  activeModal = { modal, bodyEl, footEl, close: closeModal };
  if (onMount) onMount(activeModal);
  return activeModal;
}

overlayEl.addEventListener('mousedown', (e) => {
  if (e.target === overlayEl) closeModal();
});

function confirmDialog({ title, message, detail, confirmText = '确定', cancelText = '取消', danger = false, icon = 'i-info', onOk }) {
  const body = h('div', { class: 'confirm' });
  const art = h('div', { class: `confirm-art${danger ? ' danger' : ''}` });
  art.innerHTML = svgIcon(icon);
  const copy = h('div', { class: 'confirm-copy' });
  copy.appendChild(h('p', { class: 'confirm-text', text: message }));
  if (detail) copy.appendChild(h('p', { class: 'confirm-detail', text: detail }));
  body.append(art, copy);

  const cancel = h('button', { class: 'btn ghost', text: cancelText });
  const ok = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, text: confirmText });

  const m = openModal({ title, body, footer: [cancel, ok], size: 'small' });

  cancel.addEventListener('click', closeModal);
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    try {
      await onOk();
    } finally {
      ok.disabled = false;
      closeModal();
    }
  });
  setTimeout(() => ok.focus(), 30);
  return m;
}

function confirmRemoveApp(id) {
  const a = findApp(id);
  if (!a) return;
  confirmDialog({
    title: `从面板移除「${a.name}」？`,
    message: '只会从面板中移除此快捷方式。',
    detail: '不会卸载或删除磁盘上的软件。',
    confirmText: '移除',
    danger: true,
    icon: 'i-trash',
    onOk: async () => {
      const res = await api.remove([id]);
      if (res && res.removed && res.removed.length) {
        S.apps = S.apps.filter((x) => x.id !== id);
        S.recent = S.recent.filter((x) => x !== id);
        delete S.icons[id];
        renderNav();
        renderGrid();
        toast('已从面板移除');
      }
    }
  });
}

/* ---------------- 添加软件 ---------------- */
function openAddDialog() {
  const body = h('div', { class: 'add-options' });

  const makeOption = (icon, title, desc, onClick) => {
    const btn = h('button', { class: 'add-option' });
    btn.innerHTML = `<span class="add-icon">${svgIcon(icon)}</span>
      <span class="add-text"><strong>${esc(title)}</strong><em>${esc(desc)}</em></span>
      <span class="add-arrow">${svgIcon('i-chevron')}</span>`;
    btn.addEventListener('click', onClick);
    return btn;
  };

  body.appendChild(
    makeOption('i-folder', '选择程序或快捷方式', '浏览 .exe / .lnk / .url / .bat，可一次选择多个', async () => {
      const res = await api.pickFiles();
      if (res.canceled) return;
      closeModal();
      await addPaths(res.files);
    })
  );
  body.appendChild(
    makeOption('i-scan', '扫描开始菜单', '自动列出已安装的软件，勾选后批量导入', () => {
      closeModal();
      openScanModal();
    })
  );
  body.appendChild(
    makeOption('i-edit', '手动填写信息', '自定义名称、启动参数、工作目录与管理员权限', () => {
      closeModal();
      openEditor(null);
    })
  );

  const hint = h('p', { class: 'add-hint' });
  hint.innerHTML = `${svgIcon('i-info')}<span>也可以直接把文件或快捷方式拖进面板窗口，会添加到当前分组。</span>`;
  body.appendChild(hint);

  openModal({ title: '添加软件', subtitle: '把常用程序收进同一个面板', body, size: '' });
}

async function addPaths(paths, groupId) {
  if (!paths || !paths.length) return;
  try {
    const res = await api.addPaths(paths, groupId || activeGroupId());
    if (res.added && res.added.length) {
      await refresh();
      toast(`已添加 ${res.added.length} 个软件`);
    }
    if (res.skipped && res.skipped.length) {
      const reason = res.skipped[0].reason;
      const more = res.skipped.length > 1 ? `（共 ${res.skipped.length} 个）` : '';
      toast(`有文件未添加：${reason}${more}`, res.added.length ? 'ok' : 'error', 3200);
    }
  } catch (err) {
    toast(`添加失败：${err.message}`, 'error', 3200);
  }
}

/* ---------------- 扫描开始菜单 ---------------- */
async function openScanModal() {
  const state = { items: [], selected: new Set(), query: '', hideExisting: true, groupId: activeGroupId() };

  const body = h('div', { class: 'scan-body' });
  body.innerHTML = `<div class="loading-row"><span class="spinner"></span><span>正在读取开始菜单…</span></div>`;

  const importBtn = h('button', { class: 'btn primary', text: '导入 0 个', disabled: true });
  const cancelBtn = h('button', { class: 'btn ghost', text: '取消' });
  const counter = h('div', { class: 'spacer', text: '正在扫描…' });
  const m = openModal({
    title: '扫描开始菜单',
    subtitle: '勾选需要加入面板的软件',
    body,
    size: 'wide',
    footer: [counter, cancelBtn, importBtn]
  });

  cancelBtn.addEventListener('click', closeModal);

  const refreshFooter = () => {
    const count = state.selected.size;
    importBtn.textContent = `导入 ${count} 个`;
    importBtn.disabled = count === 0;
    const dest = state.groupId === 'auto' ? '自动分组' : `导入到「${groupName(state.groupId)}」`;
    counter.textContent = `已选 ${count} 个${state.groupId ? ` · ${dest}` : ''}`;
  };

  importBtn.addEventListener('click', async () => {
    const picked = state.items.filter((it) => state.selected.has(it.key));
    if (!picked.length) return;
    importBtn.disabled = true;
    importBtn.textContent = '导入中…';
    try {
      const res = await api.importApps(picked, state.groupId);
      await refresh();
      closeModal();
      toast(`已导入 ${(res.added || []).length} 个软件`);
    } catch (err) {
      toast(`导入失败：${err.message}`, 'error');
      importBtn.disabled = false;
      refreshFooter();
    }
  });

  let items = [];
  try {
    items = await api.scan();
  } catch (err) {
    body.innerHTML = `<div class="scan-empty">读取开始菜单失败：${esc(err.message)}</div>`;
    return;
  }
  state.items = items;

  if (!items.length) {
    body.innerHTML = `<div class="scan-empty">没有在开始菜单中找到可添加的软件。<br/>可以试试「手动填写信息」直接指定程序路径。</div>`;
    counter.textContent = '未找到软件';
    return;
  }

  const tools = h('div', { class: 'scan-tools' });
  const searchInput = h('input', { class: 'text-input', placeholder: '筛选名称或路径…', type: 'text' });
  const selectAllBtn = h('button', { class: 'btn tiny', text: '全选' });
  const clearBtn = h('button', { class: 'btn tiny ghost', text: '清空' });
  const hideBtn = h('button', { class: 'btn tiny scan-toggle' });
  const groupOptions = [
    { value: 'auto', label: '自动分组（按类型）', hint: '按类型自动归入对应分组', auto: true },
    ...S.groups.map((g) => ({ value: g.id, label: g.name, hint: '' }))
  ];

  const groupWrap = h('div', { class: 'scan-group' });
  groupWrap.appendChild(h('span', { class: 'scan-group-label', text: '导入到' }));

  const selectBtn = h('button', { class: 'scan-select', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' });
  const selectVal = h('span', { class: 'scan-select-value', text: '导入到…' });
  const chev = h('span', { class: 'scan-chev' });
  chev.innerHTML = svgIcon('i-chevron');
  selectBtn.append(selectVal, chev);
  groupWrap.appendChild(selectBtn);

  const menuEl = h('div', { class: 'scan-menu', role: 'listbox', hidden: true });
  const optEls = [];
  for (const opt of groupOptions) {
    const btn = h('button', {
      class: `scan-opt${opt.auto ? ' auto' : ''}`,
      type: 'button',
      dataset: { value: opt.value },
      role: 'option',
      'aria-selected': 'false'
    });
    btn.innerHTML = `<span class="opt-ic">${svgIcon(opt.auto ? 'i-apps' : 'i-folder')}</span>
      <span class="opt-text"><strong>${esc(opt.label)}</strong>${opt.hint ? `<em>${esc(opt.hint)}</em>` : ''}</span>
      ${svgIcon('i-check', 'ic opt-check')}`;
    btn.addEventListener('click', () => {
      state.groupId = opt.value;
      syncGroup();
      closeMenu();
      refreshFooter();
    });
    optEls.push(btn);
    menuEl.appendChild(btn);
  }
  groupWrap.appendChild(menuEl);

  const syncGroup = () => {
    const cur = groupOptions.find((o) => o.value === state.groupId) || groupOptions[0];
    state.groupId = cur.value;
    selectVal.textContent = cur.label;
    groupWrap.classList.toggle('is-auto', cur.value === 'auto');
    for (const el of optEls) {
      const on = el.dataset.value === state.groupId;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  };
  const closeMenu = () => {
    if (menuEl.hidden) return;
    menuEl.hidden = true;
    selectBtn.setAttribute('aria-expanded', 'false');
    groupWrap.classList.remove('is-open');
  };
  const openGroupMenuList = () => {
    menuEl.hidden = false;
    selectBtn.setAttribute('aria-expanded', 'true');
    groupWrap.classList.add('is-open');
    const active = menuEl.querySelector('.scan-opt.is-active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  };
  selectBtn.addEventListener('click', () => (menuEl.hidden ? openGroupMenuList() : closeMenu()));

  const onDocDown = (e) => {
    if (!document.body.contains(groupWrap)) {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onGroupMenuKey, true);
      return;
    }
    if (!groupWrap.contains(e.target)) closeMenu();
  };
  const onGroupMenuKey = (e) => {
    if (e.key !== 'Escape' || menuEl.hidden) return;
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
    selectBtn.focus();
  };
  document.addEventListener('mousedown', onDocDown);
  document.addEventListener('keydown', onGroupMenuKey, true);
  syncGroup();

  const syncHideBtn = () => {
    hideBtn.classList.toggle('active', state.hideExisting);
    hideBtn.setAttribute('aria-pressed', state.hideExisting ? 'true' : 'false');
    hideBtn.innerHTML = `${svgIcon(state.hideExisting ? 'i-eye-off' : 'i-eye')}<span>${state.hideExisting ? '隐藏已添加' : '显示已添加'}</span>`;
  };
  syncHideBtn();

  tools.append(searchInput, selectAllBtn, clearBtn, hideBtn, groupWrap);

  const listEl = h('div', { class: 'scan-list' });
  const rows = [];

  for (const item of items) {
    const row = h('div', {
      class: `scan-row${item.exists ? ' is-exists' : ''}`,
      dataset: { key: item.key },
      title: item.target || item.path
    });
    row.innerHTML = `
      <span class="cb">${svgIcon('i-check')}</span>
      <span class="scan-icon">${item.icon ? `<img src="${item.icon}" alt="" />` : esc((item.name || '?').charAt(0).toUpperCase())}</span>
      <span class="scan-meta">
        <span class="scan-name">${esc(item.name)}</span>
        <span class="scan-path">${esc(compactPath(item.target || item.path))}</span>
      </span>
      ${item.exists ? '<span class="scan-badge">已添加</span>' : item.folder ? `<span class="scan-badge">${esc(item.folder)}</span>` : ''}`;

    if (!item.exists) {
      row.addEventListener('click', () => {
        if (state.selected.has(item.key)) state.selected.delete(item.key);
        else state.selected.add(item.key);
        row.classList.toggle('is-checked', state.selected.has(item.key));
        refreshFooter();
      });
    }
    rows.push({ item, row });
    listEl.appendChild(row);
  }

  body.innerHTML = '';
  body.append(tools, listEl);
  refreshFooter();

  const applyFilter = () => {
    const q = state.query.trim().toLowerCase();
    let shown = 0;
    for (const { item, row } of rows) {
      const hidden = (state.hideExisting && item.exists) ||
        (q && !`${item.name} ${item.target} ${item.path}`.toLowerCase().includes(q));
      row.style.display = hidden ? 'none' : '';
      if (!hidden) shown++;
    }
    if (!shown) {
      if (!listEl.querySelector('.scan-empty')) {
        listEl.appendChild(h('div', { class: 'scan-empty', text: '没有匹配的项，试试其他关键词。' }));
      }
    } else {
      const tip = listEl.querySelector('.scan-empty');
      if (tip) tip.remove();
    }
  };
  applyFilter();

  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    applyFilter();
  });

  selectAllBtn.addEventListener('click', () => {
    for (const { item, row } of rows) {
      if (item.exists || row.style.display === 'none') continue;
      state.selected.add(item.key);
      row.classList.add('is-checked');
    }
    refreshFooter();
  });

  clearBtn.addEventListener('click', () => {
    state.selected.clear();
    rows.forEach(({ row }) => row.classList.remove('is-checked'));
    refreshFooter();
  });

  hideBtn.addEventListener('click', () => {
    state.hideExisting = !state.hideExisting;
    syncHideBtn();
    applyFilter();
  });

  searchInput.focus();
  refreshFooter();
}

/* ---------------- 编辑软件 ---------------- */
function field(labelText, input, hint) {
  const wrap = h('div', { class: 'field' });
  wrap.appendChild(h('label', { text: labelText }));
  wrap.appendChild(input);
  if (hint) wrap.appendChild(h('span', { class: 'hint', text: hint }));
  return wrap;
}

function openEditor(appId) {
  const isNew = !appId;
  const a = isNew
    ? { name: '', path: '', args: '', cwd: '', groupId: activeGroupId(), admin: false, note: '' }
    : findApp(appId);
  if (!a) return;

  const nameInput = h('input', { class: 'text-input', value: a.name || '', placeholder: '显示名称' });
  const pathInput = h('input', { class: 'text-input', value: a.target || a.path || '', placeholder: 'C:\\Program Files\\App\\app.exe' });
  const argsInput = h('input', { class: 'text-input', value: a.args || '', placeholder: '可选，例如 --silent' });
  const cwdInput = h('input', { class: 'text-input', value: a.cwd || '', placeholder: '可选，默认程序所在目录' });
  const noteInput = h('input', { class: 'text-input', value: a.note || '', placeholder: '可选，例如「内网工具」' });
  const groupSelect = h('select', { class: 'text-input' });
  for (const g of S.groups) {
    const opt = h('option', { value: g.id, text: g.name });
    if (g.id === a.groupId) opt.selected = true;
    groupSelect.appendChild(opt);
  }
  const adminToggle = h('input', { type: 'checkbox' });
  adminToggle.checked = !!a.admin;

  const browseBtn = h('button', { class: 'btn tiny', text: '浏览…' });
  browseBtn.addEventListener('click', async () => {
    const res = await api.pickFiles();
    if (res.canceled || !res.files[0]) return;
    const file = res.files[0];
    pathInput.value = file;
    if (!nameInput.value.trim()) {
      const base = file.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
      nameInput.value = base;
    }
    if (!cwdInput.value.trim()) {
      const parts = file.split(/[\\/]/);
      parts.pop();
      cwdInput.value = parts.join('\\');
    }
  });

  const pathRow = h('div', { class: 'field-row' });
  pathRow.append(pathInput, browseBtn);

  const body = h('div');
  body.append(
    field('名称', nameInput),
    field('程序路径', pathRow, isNew ? '支持 .exe / .lnk / .url / .bat / .ps1，也可填写网址。' : '修改路径后会重新读取图标与启动参数。'),
    field('启动参数', argsInput),
    field('工作目录', cwdInput),
    field('备注（仅面板显示）', noteInput)
  );

  const groupField = h('div', { class: 'field' });
  groupField.appendChild(h('label', { text: '所属分组' }));
  groupField.appendChild(groupSelect);
  body.appendChild(groupField);

  const adminRow = h('label', { class: 'check-row' });
  adminRow.append(adminToggle, h('span', { text: '以管理员身份运行（启动时弹出 UAC 确认）' }));
  body.appendChild(adminRow);

  const cancel = h('button', { class: 'btn ghost', text: '取消' });
  const save = h('button', { class: 'btn primary', text: isNew ? '添加' : '保存' });
  const m = openModal({
    title: isNew ? '手动添加软件' : `编辑「${a.name}」`,
    subtitle: isNew ? '填写程序信息后加入面板' : '修改名称、参数或分组',
    body,
    footer: [cancel, save]
  });

  cancel.addEventListener('click', closeModal);

  const doSave = async () => {
    const name = nameInput.value.trim();
    const target = pathInput.value.trim();
    if (!target) {
      pathInput.focus();
      toast('请填写程序路径', 'error', 1800);
      return;
    }
    save.disabled = true;
    try {
      if (isNew) {
        const normalized = target.startsWith('http://') || target.startsWith('https://') ? target : target;
        const res = await api.addPaths([normalized], groupSelect.value);
        if (res.skipped && res.skipped.length) {
          toast(res.skipped[0].reason, 'error', 3000);
          save.disabled = false;
          return;
        }
        const newId = (res.added || [])[0];
        if (newId) {
          await api.update(newId, {
            name: name || undefined,
            args: argsInput.value,
            cwd: cwdInput.value,
            groupId: groupSelect.value,
            admin: adminToggle.checked,
            note: noteInput.value
          });
        }
        await refresh();
        closeModal();
        toast('已添加到面板');
      } else {
        await api.update(appId, {
          name: name || a.name,
          path: target,
          keepArgs: true,
          args: argsInput.value,
          cwd: cwdInput.value,
          groupId: groupSelect.value,
          admin: adminToggle.checked,
          note: noteInput.value
        });
        await refresh();
        closeModal();
        toast('已保存');
      }
    } catch (err) {
      toast(`保存失败：${err.message}`, 'error', 3000);
      save.disabled = false;
    }
  };

  save.addEventListener('click', doSave);
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      doSave();
    }
  });

  setTimeout(() => (isNew ? nameInput : nameInput).focus(), 40);
  return m;
}

/* ---------------- 分组增删改 ---------------- */
function promptNewGroup() {
  const input = h('input', { class: 'text-input', placeholder: '例如：设计工具、游戏' });
  const body = h('div');
  body.appendChild(field('分组名称', input));

  const cancel = h('button', { class: 'btn ghost', text: '取消' });
  const ok = h('button', { class: 'btn primary', text: '创建' });
  openModal({ title: '新建分组', body, footer: [cancel, ok], size: 'small' });

  const submit = async () => {
    const name = input.value.trim();
    if (!name) return input.focus();
    const g = await api.addGroup(name);
    await refresh();
    S.view = `group:${g.id}`;
    renderNav();
    renderGrid();
    closeModal();
    toast(`已创建分组「${name}」`);
  };
  cancel.addEventListener('click', closeModal);
  ok.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  setTimeout(() => input.focus(), 40);
}

function promptRenameGroup(groupId) {
  const g = S.groups.find((x) => x.id === groupId);
  if (!g) return;
  const input = h('input', { class: 'text-input', value: g.name });
  const body = h('div');
  body.appendChild(field('分组名称', input));

  const cancel = h('button', { class: 'btn ghost', text: '取消' });
  const ok = h('button', { class: 'btn primary', text: '保存' });
  openModal({ title: '重命名分组', body, footer: [cancel, ok], size: 'small' });

  const submit = async () => {
    const name = input.value.trim();
    if (!name) return input.focus();
    await api.renameGroup(groupId, name);
    await refresh();
    closeModal();
    toast('分组已重命名');
  };
  cancel.addEventListener('click', closeModal);
  ok.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  setTimeout(() => {
    input.focus();
    input.select();
  }, 40);
}

/* ---------------- 拖拽 ---------------- */
let dragId = null;

function getAfterElement(x, y) {
  const cards = [...gridEl.querySelectorAll('.card:not(.dragging)')];
  let best = null;
  let bestDist = Infinity;
  for (const el of cards) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = Math.hypot(x - cx, (y - cy) * 1.15);
    if (d < bestDist) {
      bestDist = d;
      best = el;
    }
  }
  if (!best) return null;
  const r = best.getBoundingClientRect();
  return x > r.left + r.width / 2 ? best.nextElementSibling : best;
}

function applyLocalOrder(ids) {
  const set = new Set(ids);
  const slots = [];
  S.apps.forEach((a, i) => {
    if (set.has(a.id)) slots.push(i);
  });
  const map = new Map(S.apps.map((a) => [a.id, a]));
  const seq = ids.map((id) => map.get(id)).filter(Boolean);
  slots.forEach((slot, i) => {
    if (seq[i]) S.apps[slot] = seq[i];
  });
}

gridEl.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.card');
  if (!card || !canReorder()) {
    e.preventDefault();
    return;
  }
  dragId = card.dataset.id;
  card.classList.add('dragging');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  }
});

gridEl.addEventListener('dragover', (e) => {
  if (!dragId) return;
  e.preventDefault();
  const dragging = gridEl.querySelector('.card.dragging');
  if (!dragging) return;
  const after = getAfterElement(e.clientX, e.clientY);
  if (!after) {
    if (gridEl.lastElementChild !== dragging) gridEl.appendChild(dragging);
  } else if (after !== dragging && after !== dragging.nextElementSibling) {
    gridEl.insertBefore(dragging, after);
  }
});

gridEl.addEventListener('dragend', async () => {
  const dragging = gridEl.querySelector('.card.dragging');
  if (!dragId || !dragging) {
    dragId = null;
    return;
  }
  const ids = [...gridEl.querySelectorAll('.card')].map((c) => c.dataset.id);
  dragging.classList.remove('dragging');
  dragId = null;
  applyLocalOrder(ids);
  try {
    await api.reorder(ids, ids);
  } catch (err) {
    toast('排序保存失败', 'error');
  }
});

/* 拖到左侧分组 => 移动 */
navEl.addEventListener('dragover', (e) => {
  if (!dragId) return;
  const item = e.target.closest('.nav-item[data-group]');
  if (!item) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  navEl.querySelectorAll('.nav-item.drop-active').forEach((n) => n.classList.remove('drop-active'));
  item.classList.add('drop-active');
});

navEl.addEventListener('dragleave', (e) => {
  const item = e.target.closest('.nav-item');
  if (item) item.classList.remove('drop-active');
});

navEl.addEventListener('drop', async (e) => {
  const item = e.target.closest('.nav-item[data-group]');
  if (!dragId || !item) return;
  e.preventDefault();
  const gid = item.dataset.group;
  const id = dragId;
  dragId = null;
  navEl.querySelectorAll('.nav-item.drop-active').forEach((n) => n.classList.remove('drop-active'));
  const a = findApp(id);
  if (!a || a.groupId === gid) return;
  await api.assignGroup([id], gid);
  await refresh();
  toast(`已移动到「${groupName(gid)}」`);
});

/* ---------------- 系统文件拖入 ---------------- */
let dragDepth = 0;

function hasFiles(e) {
  return e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
}

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || dragId) return;
  e.preventDefault();
  dragDepth++;
  dropMask.hidden = false;
});

window.addEventListener('dragover', (e) => {
  if (!hasFiles(e) || dragId) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});

window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e) || dragId) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropMask.hidden = true;
});

window.addEventListener('drop', async (e) => {
  if (!hasFiles(e) || dragId) return;
  e.preventDefault();
  dragDepth = 0;
  dropMask.hidden = true;
  const files = [...(e.dataTransfer.files || [])].map((f) => api.pathForFile(f)).filter(Boolean);
  if (!files.length) return;
  await addPaths(files);
});

/* ---------------- 设置抽屉 ---------------- */
function openSettings() {
  syncSettingsUI();
  drawerEl.hidden = false;
}

function closeSettings() {
  drawerEl.hidden = true;
}

function buildSkinGridOnce() {
  const grid = $('#skinGrid');
  if (grid.dataset.built === '1') return;
  grid.dataset.built = '1';
  for (const skin of SKINS) {
    const tile = h('button', { class: 'skin-tile', dataset: { key: skin.id }, title: skin.name });
    tile.innerHTML = `
      <span class="skin-swatch" data-skin="${skin.id}"></span>
      <span class="skin-info"><strong>${esc(skin.name)}</strong><span>${esc(skin.desc)}</span></span>
      <span class="tick">${svgIcon('i-check')}</span>`;
    tile.addEventListener('click', async () => {
      S.settings.skin = skin.id;
      applyTheme();
      syncSettingsUI();
      await saveSettings({ skin: skin.id });
      toast(`已切换皮肤：${skin.name}`, 'ok', 1500);
    });
    grid.appendChild(tile);
  }
  $('#skinHint').textContent = `${SKINS.length} 套内置皮肤`;
}

function buildAccentRowOnce() {
  const row = $('#accentRow');
  if (row.dataset.built === '1') return;
  row.dataset.built = '1';
  for (const color of ACCENTS) {
    const b = h('button', { class: 'swatch', title: color, dataset: { color } });
    b.style.background = color;
    b.addEventListener('click', async () => {
      S.settings.accent = color;
      applyTheme();
      syncSettingsUI();
      await saveSettings({ accent: color });
    });
    row.appendChild(b);
  }
}

function syncSettingsUI() {
  const s = S.settings;
  buildSkinGridOnce();
  buildAccentRowOnce();

  if (!S.ready) return;

  document.querySelectorAll('.skin-tile').forEach((t) => t.classList.toggle('active', t.dataset.key === (s.skin || 'midnight')));

  const accent = (s.accent || '').toLowerCase();
  document.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('active', b.dataset.color.toLowerCase() === accent));

  const custom = $('#accentCustom');
  if (custom) {
    custom.value = /^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : '#6c8cff';
  }

  const wallName = $('#wallName');
  if (wallName) {
    wallName.textContent = s.wallpaper ? String(s.wallpaper).split(/[\\/]/).pop() : '未设置';
    wallName.title = s.wallpaper || '';
  }
  const op = $('#wallOpacity');
  if (op) {
    const val = Math.round(wallpaperFraction(s.wallpaperOpacity) * 100);
    op.value = String(val);
    $('#wallOpacityVal').textContent = `${val}%`;
  }

  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('active', (b.dataset.viewmode || 'grid') === (s.view || 'grid')));
  document.querySelectorAll('#launchSeg button').forEach((b) => b.classList.toggle('active', (b.dataset.launch || 'single') === (s.launchMode || 'single')));
  document.querySelectorAll('#sizeSeg button').forEach((b) => b.classList.toggle('active', (b.dataset.size || 'md') === (s.cardSize || 'md')));

  const setCheck = (id, value) => {
    const el = $(`#${id}`);
    if (el) el.checked = !!value;
  };
  setCheck('setShowPath', s.showPath !== false);
  setCheck('setAnim', s.animations !== false);
  setCheck('setTop', s.alwaysOnTop);
  setCheck('setTray', s.closeToTray);
  setCheck('setAuto', s.autoLaunch);
  setCheck('setAcrylic', s.acrylic && S.meta.isWin11);
  setCheck('setHotkey', s.hotkeyEnabled);

  const acrylic = $('#setAcrylic');
  if (acrylic) {
    acrylic.disabled = !S.meta.isWin11;
    $('#acrylicHint').textContent = S.meta.isWin11 ? 'Windows 11 亚克力效果' : '当前系统不支持（需要 Windows 11）';
  }

  renderHotkeyBox(s);
  const hotkeyState = $('#hotkeyState');
  if (hotkeyState) {
    hotkeyState.textContent = s.hotkeyEnabled ? `当前：${prettyHotkey(s.hotkey)}${S.meta.hotkeyOk === false ? '（被占用）' : ''}` : '已关闭';
  }

  $('#versionText').textContent = `版本 ${S.meta.version || '1.0.0'} · 数据目录：${S.meta.dataDir || ''}${S.meta.isPortable ? ' · 便携模式' : ''}`;
}

function bindSettingsEvents() {
  $('#drawerClose').addEventListener('click', closeSettings);
  $('#btnSettingsTop').addEventListener('click', () => openSettings());
  $('#btnScanTop').addEventListener('click', () => openScanModal());
  $('#btnNewGroup').addEventListener('click', () => promptNewGroup());
  $('#btnAdd').addEventListener('click', openAddDialog);
  $('#emptyScan').addEventListener('click', openScanModal);
  $('#emptyAdd').addEventListener('click', openAddDialog);

  // 视图切换
  $('#btnViewMode').addEventListener('click', async () => {
    const next = S.settings.view === 'list' ? 'grid' : 'list';
    S.settings.view = next;
    applyTheme();
    renderGrid();
    await saveSettings({ view: next });
  });

  document.querySelectorAll('#viewSeg button').forEach((b) => {
    b.addEventListener('click', async () => {
      S.settings.view = b.dataset.viewmode;
      applyTheme();
      renderGrid();
      syncSettingsUI();
      await saveSettings({ view: b.dataset.viewmode });
    });
  });

  document.querySelectorAll('#sizeSeg button').forEach((b) => {
    b.addEventListener('click', async () => {
      S.settings.cardSize = b.dataset.size;
      applyTheme();
      syncSettingsUI();
      await saveSettings({ cardSize: b.dataset.size });
    });
  });

  document.querySelectorAll('#launchSeg button').forEach((b) => {
    b.addEventListener('click', async () => {
      S.settings.launchMode = b.dataset.launch;
      syncSettingsUI();
      await saveSettings({ launchMode: b.dataset.launch });
      toast(b.dataset.launch === 'double' ? '已切换为双击启动' : '已切换为单击启动', 'ok', 1500);
    });
  });

  // 开关
  const bindSwitch = (id, key, after) => {
    const el = $(`#${id}`);
    if (!el) return;
    el.addEventListener('change', async () => {
      const val = el.checked;
      S.settings[key] = val;
      if (after) after(val);
      await saveSettings({ [key]: val });
      syncSettingsUI();
    });
  };

  bindSwitch('setShowPath', 'showPath', () => renderGrid());
  bindSwitch('setAnim', 'animations', () => applyTheme());
  bindSwitch('setTop', 'alwaysOnTop');
  bindSwitch('setTray', 'closeToTray');
  bindSwitch('setAuto', 'autoLaunch');
  bindSwitch('setAcrylic', 'acrylic', () => applyTheme());
  bindSwitch('setHotkey', 'hotkeyEnabled', async () => {
    await refresh();
  });

  // 强调色
  $('#accentReset').addEventListener('click', async () => {
    S.settings.accent = '';
    applyTheme();
    syncSettingsUI();
    await saveSettings({ accent: '' });
  });

  $('#accentCustom').addEventListener('input', (e) => {
    S.settings.accent = e.target.value;
    applyTheme();
  });
  $('#accentCustom').addEventListener('change', async (e) => {
    await saveSettings({ accent: e.target.value });
  });

  // 背景图
  $('#btnWall').addEventListener('click', async () => {
    const res = await api.pickWallpaper();
    if (!res) return;
    S.wallpaper = res.dataUrl || '';
    S.settings.wallpaper = res.wallpaper;
    applyTheme();
    syncSettingsUI();
    toast('背景图已更新', 'ok', 1600);
  });

  $('#btnWallClear').addEventListener('click', async () => {
    S.wallpaper = '';
    await saveSettings({ wallpaper: '' }, { wall: true });
    syncSettingsUI();
    toast('已移除背景图', 'ok', 1500);
  });

  const op = $('#wallOpacity');
  op.addEventListener('input', () => {
    const val = Number(op.value) / 100;
    S.settings.wallpaperOpacity = val;
    wallEl.style.opacity = String(val);
    $('#wallOpacityVal').textContent = `${op.value}%`;
  });
  op.addEventListener('change', async () => {
    await saveSettings({ wallpaperOpacity: Number(op.value) / 100 });
  });

  // 快捷键：监听键盘录入（点一下 → 直接按下组合键）
  const hkBox = $('#hotkeyCapture');
  hkBox.addEventListener('click', () => {
    if (hkListening) return stopHotkeyListen();
    hkListening = true;
    hkBox.classList.add('is-listening');
    hkBox.setAttribute('aria-pressed', 'true');
    $('#hotkeyValue').textContent = '请按下组合键…';
    $('#hotkeyTip').textContent = 'Esc 取消';
    document.addEventListener('keydown', onHotkeyKeydown, true);
  });

  // 数据
  $('#btnExport').addEventListener('click', async () => {
    const res = await api.exportConfig();
    if (res && res.ok) toast('配置已导出', 'ok', 2000);
  });
  $('#btnImport').addEventListener('click', async () => {
    const res = await api.importConfig();
    if (res && res.ok && res.state) {
      applyState(res.state);
      toast('配置已导入', 'ok', 2000);
    } else if (res && res.error) {
      toast(`导入失败：${res.error}`, 'error', 3000);
    }
  });
  $('#btnOpenDir').addEventListener('click', () => api.openDataDir());
  $('#btnReset').addEventListener('click', () => {
    confirmDialog({
      title: '清空面板？',
      message: '所有软件记录、分组和已缓存的图标都会被移除。',
      detail: '软件本身不会被卸载，磁盘上的程序不受影响。此操作不可撤销。',
      confirmText: '清空面板',
      danger: true,
      icon: 'i-trash',
      onOk: async () => {
        const res = await api.resetData();
        if (res && res.ok && res.state) {
          applyState(res.state);
          toast('面板已清空');
        } else {
          toast('清空失败，请稍后再试', 'error', 3000);
        }
      }
    });
  });
}

/* ---------------- 搜索 ---------------- */
const applyQuery = debounce(() => {
  S.query = searchEl.value;
  renderGrid();
  closeMenu();
}, 60);

searchEl.addEventListener('input', applyQuery);
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchEl.value = '';
    S.query = '';
    renderGrid();
    searchEl.blur();
  } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
    const first = gridEl.querySelector('.card');
    if (first) {
      e.preventDefault();
      first.focus();
    }
  }
});

/* ---------------- 窗口控制 ---------------- */
function bindChrome() {
  document.querySelectorAll('[data-win]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.win;
      if (action === 'min') api.win.minimize();
      else if (action === 'max') api.win.toggleMaximize();
      else if (action === 'close') api.win.close();
    });
  });

  api.win.onState(({ maximized }) => {
    const use = $('#maxIcon use');
    if (use) use.setAttribute('href', maximized ? '#i-restore' : '#i-max');
  });
}

/* ---------------- 全局快捷键：监听键盘录入 ---------------- */
let hkListening = false;

function renderHotkeyBox(s = S.settings) {
  const box = $('#hotkeyCapture');
  if (!box || hkListening) return;
  $('#hotkeyValue').textContent = s && s.hotkey ? prettyHotkey(s.hotkey) : '未设置';
  $('#hotkeyTip').textContent = '点击录入';
  box.classList.remove('is-listening');
  box.setAttribute('aria-pressed', 'false');
}

function hotkeyKeyName(e) {
  const k = e.key;
  if (k === ' ') return 'Space';
  if (k.startsWith('Arrow')) return k.slice(5);
  if (/^[a-z]$/i.test(k)) return k.toUpperCase();
  if (/^[0-9]$/.test(k)) return k;
  if (/^F([1-9]|1[0-2])$/.test(k)) return k;
  const named = { Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown' };
  if (named[k]) return named[k];
  const punct = { ';': ';', ',': ',', '.': '.', '/': '/', '\\': '\\', '-': '-', '=': '=', '[': '[', ']': ']', '`': '`' };
  return punct[k] || null;
}

function stopHotkeyListen() {
  if (!hkListening) return;
  hkListening = false;
  document.removeEventListener('keydown', onHotkeyKeydown, true);
  renderHotkeyBox();
  const box = $('#hotkeyCapture');
  if (box) box.blur();
}

async function onHotkeyKeydown(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.repeat) return;

  const valueEl = $('#hotkeyValue');
  const tipEl = $('#hotkeyTip');

  if (e.key === 'Escape') return stopHotkeyListen();

  if (e.key === 'Delete' || e.key === 'Backspace') {
    stopHotkeyListen();
    S.settings.hotkey = '';
    renderHotkeyBox();
    await saveSettings({ hotkey: '' });
    await refresh();
    toast('快捷键已清除', 'ok', 1600);
    return;
  }

  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');

  // 只按了修饰键：继续等待主按键
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) {
    valueEl.textContent = mods.length ? `${prettyHotkey(mods.join('+'))} + …` : '请按下组合键…';
    tipEl.textContent = 'Esc 取消';
    return;
  }

  const main = hotkeyKeyName(e);
  if (!main) {
    toast('这个按键暂不支持，请换一个试试', 'error');
    valueEl.textContent = '请按下组合键…';
    return;
  }
  if (!mods.length && !/^F([1-9]|1[0-2])$/.test(main)) {
    toast('请搭配 Ctrl / Alt / Shift 使用', 'error');
    valueEl.textContent = '请按下组合键…';
    return;
  }

  const combo = [...mods, main].join('+');
  hkListening = false;
  document.removeEventListener('keydown', onHotkeyKeydown, true);
  S.settings.hotkey = combo;
  renderHotkeyBox();
  $('#hotkeyCapture').blur();

  await saveSettings({ hotkey: combo });
  await refresh();
  toast(S.meta.hotkeyOk === false ? '快捷键可能已被其他程序占用' : `快捷键已生效：${prettyHotkey(combo)}`, S.meta.hotkeyOk === false ? 'error' : 'ok');
}

/* ---------------- 全局快捷键 ---------------- */
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  if (e.key === 'Escape') {
    if (!menuEl.hidden) return closeMenu();
    if (!drawerEl.hidden) return closeSettings();
    if (!overlayEl.hidden) return closeModal();
    if (document.activeElement === searchEl) {
      searchEl.value = '';
      S.query = '';
      renderGrid();
      searchEl.blur();
    }
    return;
  }

  if (mod && (e.key === 'k' || e.key === 'K' || e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    searchEl.focus();
    searchEl.select();
    return;
  }
  if (mod && e.key === ',') {
    e.preventDefault();
    openSettings();
    return;
  }
  if (mod && (e.key === 'n' || e.key === 'N')) {
    e.preventDefault();
    openAddDialog();
  }
});

/* ---------------- 分组切换 ---------------- */
navEl.addEventListener('click', (e) => {
  const item = e.target.closest('.nav-item');
  if (!item || !item.dataset.view) return;
  S.view = item.dataset.view;
  searchEl.value = '';
  S.query = '';
  renderNav();
  renderGrid();
  scrollEl.scrollTop = 0;
  saveSettings({ lastView: S.view });
});

/* ---------------- 初始化 ---------------- */
async function init() {
  bindChrome();
  bindSettingsEvents();

  try {
    const st = await api.state();
    S.view = st.settings && st.settings.lastView ? st.settings.lastView : 'all';
    applyState(st);
  } catch (err) {
    toast(`初始化失败：${err.message}`, 'error', 4000);
  }

  api.on('ui:open-scan', () => openScanModal());
  api.on('ui:open-settings', () => openSettings());

  // 后台补全大图标后就地替换，不打断当前操作
  api.on('icons:updated', (map) => {
    if (!map || typeof map !== 'object') return;
    Object.assign(S.icons, map);
    for (const [id, url] of Object.entries(map)) {
      const c = gridEl.querySelector(`.card[data-id="${id}"]`);
      if (!c || !url) continue;
      const box = c.querySelector('.card-icon');
      if (box) box.innerHTML = `<img src="${url}" alt="" draggable="false" />`;
    }
  });

  // 拖拽文件时避免 Electron 直接导航到文件
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
}

init();

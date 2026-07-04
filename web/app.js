/* 免費停車場 — 台灣聯通 & 車麻吉免停場站速查 */
'use strict';

const BRAND_META = {
  utg: { label: '台灣聯通', cls: 'badge-utg', sourceUrl: 'https://www.taiwan-parking.com.tw/#/parking-lots' },
  carmochi: { label: '車麻吉', cls: 'badge-cm', sourceUrl: 'https://help.carmochi.com/cityparking/available' },
};
const CITY_ORDER = ['基隆市','台北市','新北市','桃園市','新竹縣市','苗栗縣','台中市','彰化縣','南投縣','雲林縣','嘉義縣市','台南市','高雄市','屏東縣','宜蘭縣','花蓮縣','台東縣','澎湖縣'];
const FAV_KEY = 'parking-favs-v1';
const HOME_KEY = 'parking-home-city-v1';
const LIST_PAGE = 60;

const state = {
  lots: [],
  meta: null,
  brand: 'all',
  // 首次進入時選擇的所在縣市，之後每次開啟預設帶入（存在裝置上）
  city: localStorage.getItem(HOME_KEY) || null,
  district: null,
  tab: 'map',
  loc: null,
  locStatus: 'idle', // idle | pending | on | off
  favs: loadFavs(),
  expanded: null,
  favExpanded: null,
  selectedId: null,
  listLimit: LIST_PAGE,
};

let map = null;
let cluster = null;
const markers = new Map();

const $ = (sel) => document.querySelector(sel);

/* ---------- utils ---------- */

function loadFavs() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY)) ?? []; } catch { return []; }
}
function saveFavs() { localStorage.setItem(FAV_KEY, JSON.stringify(state.favs)); }
function isFav(id) { return state.favs.some((f) => f.id === id); }

function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function fmtDist(m) {
  if (m == null || !Number.isFinite(m)) return '';
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function gmapUrl(lot) {
  // 座標未知（地址待確認）時退而求其次：用名稱＋縣市讓 Google 自己搜尋
  if (lot.lat == null) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lot.city + lot.name)}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${lot.lat},${lot.lng}`;
}

const I = {
  nav: '<svg viewBox="0 0 24 24"><path d="M12 3l7 18-7-4-7 4z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2-5.6-3.2L6.4 20l1.3-6.2L3 9.5l6.3-.7z"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M11 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-5M13 4h7v7M20 4L11 13"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4M13.5 6.5l4 4"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  loc: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 4.5l-8 14A2 2 0 0 0 4 21.5h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
};

/* ---------- 小P 情境插圖（inline SVG，零網路成本） ---------- */

// 統一小P：全站同一份幾何造型（見 icon.svg / index.html），只換手上的道具
function mascotSvg(prop) {
  return `<svg viewBox="26 2 72 94" aria-hidden="true">
    <rect x="34" y="24" width="15" height="50" rx="7.5" fill="#1D9E75"/>
    <circle cx="55" cy="40" r="21" fill="#1D9E75"/>
    <circle cx="57" cy="38" r="11" fill="#FFFFFF"/>
    <circle cx="53" cy="36" r="2.6" fill="#04342C"/><circle cx="61" cy="36" r="2.6" fill="#04342C"/>
    <path d="M52.5 41.5 Q57 46 61.5 41.5" fill="none" stroke="#04342C" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="41" cy="79" r="7.5" fill="#04342C" stroke="#FFFFFF" stroke-width="2.5"/>
    <circle cx="60" cy="79" r="7.5" fill="#04342C" stroke="#FFFFFF" stroke-width="2.5"/>
    ${prop}</svg>`;
}
const MASCOT = {
  star: mascotSvg('<path d="M84 9 Q86.2 18.8 96 21 Q86.2 23.2 84 33 Q81.8 23.2 72 21 Q81.8 18.8 84 9 Z" fill="#EF9F27"/>'),
  search: mascotSvg('<circle cx="82" cy="20" r="9" fill="none" stroke="#888780" stroke-width="2.5"/><path d="M88.5 26.5 L95 33" fill="none" stroke="#888780" stroke-width="3" stroke-linecap="round"/>'),
  broken: mascotSvg('<circle cx="78" cy="18" r="3" fill="#D3D1C7"/><circle cx="85" cy="12" r="4" fill="#B4B2A9"/><circle cx="92" cy="7" r="4.5" fill="#D3D1C7"/>'),
};
const emptyHtml = (svg, title, sub) => `<div class="empty">${svg}<p class="empty-title">${title}</p><p>${sub}</p></div>`;

/* ---------- data ---------- */

async function loadData() {
  const res = await fetch('data/parking-lots.json');
  const data = await res.json();
  state.lots = data.lots;
  state.meta = data.meta;
  // 顯示資料管線最後一次成功建置的時間（builtAt），非來源官方頁的編輯日
  const d = data.meta.builtAt.slice(0, 10).replace(/-0?/g, '/').slice(2);
  $('#data-date').textContent = `資料更新 20${d}`;
}

function filteredLots() {
  return state.lots.filter((l) => {
    if (state.brand !== 'all' && !l.brands.includes(state.brand)) return false;
    if (state.city && l.city !== state.city) return false;
    if (state.district && l.district !== state.district) return false;
    return true;
  });
}

function withDistance(lots) {
  if (!state.loc) return lots.map((l) => ({ ...l, dist: null }));
  return lots
    .map((l) => ({ ...l, dist: l.lat ? haversine(state.loc, l) : Infinity }))
    .sort((a, b) => a.dist - b.dist);
}

/* ---------- card rendering ---------- */

function badgesHtml(lot) {
  return lot.brands.map((b) => `<span class="badge ${BRAND_META[b].cls}">${BRAND_META[b].label}</span>`).join('');
}

function cardHtml(lot, opts = {}) {
  const { fav = null, inSheet = false } = opts;
  // 清單與常用皆為手風琴：一次只展開一張
  const expanded = inSheet || (fav ? state.favExpanded === lot.id : state.expanded === lot.id);
  const stale = fav && !state.lots.some((l) => l.id === fav.id);
  const topLeft = stale
    ? `<span class="badge badge-warn">${I.warn} 已不在最新官方名單</span>`
    : `<div class="badges">${badgesHtml(lot)}</div>`;
  const noteRow = expanded && lot.note
    ? `<div class="detail-note">${I.info}<span>${esc(lot.note)}</span></div>` : '';
  const extra = [];
  if (expanded && lot.maxHeight) extra.push(`限高 ${lot.maxHeight}m`);
  if (expanded && lot.totalSpace) extra.push(`約 ${lot.totalSpace} 格`);
  const srcBrand = lot.brands[0];
  const starOn = isFav(lot.id);
  const starAction = fav
    ? `<button data-act="label">${I.pen}備註</button><button data-act="unfav">${I.del}移除</button>`
    : `<button data-act="star" class="${starOn ? 'on' : ''}">${I.star}${starOn ? '已收藏' : '收藏'}</button>`;
  const detail = expanded ? `
    <div class="card-detail">
      ${noteRow}
      ${extra.length ? `<div class="detail-note">${I.info}<span>${extra.join('・')}</span></div>` : ''}
      <div class="detail-actions">
        ${starAction}
        <button data-act="copy">${I.copy}複製地址</button>
        <a href="${BRAND_META[srcBrand].sourceUrl}" target="_blank" rel="noopener">${I.ext}官方來源</a>
      </div>
      <div class="detail-meta">來源：${lot.brands.map((b) => BRAND_META[b].label).join('、')}官方名單 · 以現場標示為準</div>
    </div>` : '';
  return `
  <article class="card" data-id="${lot.id}" ${fav ? 'data-fav="1"' : ''}>
    <div class="card-top">${topLeft}</div>
    <div class="card-main" data-act="expand">
      <div class="card-info">
        <p class="card-name">${esc(lot.name)}</p>
        <p class="card-addr">${esc(lot.address)}</p>
        ${fav?.label ? `<p class="card-label">${I.pen} ${esc(fav.label)}</p>` : ''}
        ${stale ? `<p class="card-warn-text">前往前請再確認現場標示</p>` : ''}
        ${lot.geoPending ? `<p class="card-warn-text">地址待確認，暫無法定位</p>` : ''}
      </div>
      <div class="nav-go">
        <button data-act="go" aria-label="${lot.geoPending ? '搜尋位置' : '導航'}">${lot.geoPending ? I.search : I.nav}</button>
        <span class="dist ${lot.dist != null && lot.dist < 800 ? 'near' : ''}">${fmtDist(lot.dist)}</span>
      </div>
    </div>
    ${detail}
  </article>`;
}

/* ---------- views ---------- */

function renderStatus() {
  const el = $('#status-row');
  const n = filteredLots().length;
  const parts = [`${n} 個場站`];
  if (state.city) parts.push(state.city + (state.district ? ` ${state.district}` : ''));
  let tail = '';
  if (state.loc) parts.push('依距離近到遠');
  else if (state.locStatus === 'pending') parts.push('定位中…');
  else tail = `<button id="loc-retry">開啟定位看距離</button>`;
  el.innerHTML = `${I.loc}<span>${parts.join(' · ')}</span>${tail}`;
}

function renderList() {
  const el = $('#list');
  const lots = withDistance(filteredLots());
  if (!lots.length) {
    el.innerHTML = emptyHtml(MASCOT.search, '小P在這個範圍找不到場站', '兩家通路的免停名單會隨合作狀況變動');
    return;
  }
  let html = '';
  if (state.loc) {
    const shown = lots.slice(0, state.listLimit);
    html = shown.map((l) => cardHtml(l)).join('');
    if (lots.length > state.listLimit) html += `<button class="load-more">顯示更多（還有 ${lots.length - state.listLimit} 個）</button>`;
  } else {
    const byCity = new Map();
    for (const l of lots) {
      if (!byCity.has(l.city)) byCity.set(l.city, []);
      byCity.get(l.city).push(l);
    }
    for (const city of CITY_ORDER) {
      const group = byCity.get(city);
      if (!group) continue;
      // 未開定位：組內依行政區→名稱排序，順序穩定可預期
      group.sort((a, b) => (a.district ?? '').localeCompare(b.district ?? '', 'zh-Hant') || a.name.localeCompare(b.name, 'zh-Hant'));
      html += `<div class="group-head">${city}（${group.length}）</div>`;
      html += group.map((l) => cardHtml(l)).join('');
    }
  }
  el.innerHTML = html;
}

function renderFavs() {
  const el = $('#fav-list');
  if (!state.favs.length) {
    el.innerHTML = emptyHtml(MASCOT.star, '還沒有收藏', '展開停車場卡片點「收藏」，小P幫你記住常去的地方');
    return;
  }
  const favLots = state.favs.map((f) => {
    const live = state.lots.find((l) => l.id === f.id);
    return { fav: f, lot: live ?? f };
  });
  let rows = favLots.map(({ fav, lot }) => ({
    fav,
    lot: { ...lot, dist: state.loc && lot.lat ? haversine(state.loc, lot) : null },
  }));
  if (state.loc) rows.sort((a, b) => (a.lot.dist ?? 1e12) - (b.lot.dist ?? 1e12));
  el.innerHTML = rows.map(({ fav, lot }) => cardHtml(lot, { fav })).join('');
}

function render() {
  renderStatus();
  if (state.tab === 'list') renderList();
  if (state.tab === 'fav') renderFavs();
  if (state.tab === 'map') { renderMarkers(); renderSheet(); }
}

/* ---------- map ---------- */

function initMap() {
  if (map) return;
  map = L.map('map', { zoomControl: false }).setView([23.7, 121], 8);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);
  cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 46 });
  map.addLayer(cluster);
  map.on('click', () => selectLot(null));
  if (state.loc) map.setView([state.loc.lat, state.loc.lng], 15);
}

function pinIcon(lot, selected) {
  const cls = lot.brands.includes('utg') ? 'pin-utg' : 'pin-cm';
  return L.divIcon({
    className: '',
    html: `<div class="lot-pin ${cls} ${selected ? 'sel' : ''}">P</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

let locMarker = null;
let lastFitKey = null;
function renderMarkers() {
  if (!map) return;
  cluster.clearLayers();
  markers.clear();
  for (const lot of filteredLots()) {
    if (!lot.lat) continue;
    const m = L.marker([lot.lat, lot.lng], { icon: pinIcon(lot, lot.id === state.selectedId) });
    m.on('click', () => selectLot(lot.id));
    markers.set(lot.id, m);
    cluster.addLayer(m);
  }
  // 篩選條件變更時把視野帶到結果範圍；有定位且看全台時以定位為中心
  const fitKey = `${state.brand}|${state.city}|${state.district}`;
  if (fitKey !== lastFitKey && cluster.getLayers().length) {
    lastFitKey = fitKey;
    if (state.loc && !state.city) {
      map.setView([state.loc.lat, state.loc.lng], 15);
    } else {
      map.fitBounds(cluster.getBounds().pad(0.1), { maxZoom: 16 });
    }
  }
  if (state.loc) {
    if (locMarker) locMarker.remove();
    locMarker = L.circleMarker([state.loc.lat, state.loc.lng], {
      radius: 7, color: '#fff', weight: 2.5, fillColor: '#378add', fillOpacity: 1,
    }).addTo(map);
  }
}

function selectLot(id) {
  // 再點同一個 pin ＝ 收起資訊卡
  if (id && id === state.selectedId) id = null;
  const prev = state.selectedId;
  state.selectedId = id;
  for (const changed of [prev, id]) {
    const lot = state.lots.find((l) => l.id === changed);
    const m = markers.get(changed);
    if (lot && m) m.setIcon(pinIcon(lot, changed === id));
  }
  renderSheet();
}

function renderSheet() {
  const sheet = $('#sheet');
  const lot = state.lots.find((l) => l.id === state.selectedId);
  if (!lot) { sheet.hidden = true; sheet.style.transform = ''; return; }
  const withD = { ...lot, dist: state.loc && lot.lat ? haversine(state.loc, lot) : null };
  $('#sheet-body').innerHTML = cardHtml(withD, { inSheet: true });
  sheet.hidden = false;
}

/* ---------- location ---------- */

function requestLocation(pan = false) {
  if (!navigator.geolocation) { state.locStatus = 'off'; renderStatus(); return; }
  state.locStatus = 'pending';
  renderStatus();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      state.locStatus = 'on';
      state.listLimit = LIST_PAGE;
      if (map && pan) map.setView([state.loc.lat, state.loc.lng], 15);
      render();
    },
    () => { state.loc = null; state.locStatus = 'off'; render(); },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
  );
}

/* ---------- favorites ---------- */

let snackTimer = null;
function showSnackbar(text, undo) {
  const bar = $('#snackbar');
  const btn = $('#snackbar-action');
  $('#snackbar-text').textContent = text;
  btn.hidden = !undo;
  if (undo) btn.onclick = () => { undo(); bar.hidden = true; clearTimeout(snackTimer); };
  bar.hidden = false;
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => { bar.hidden = true; }, undo ? 4000 : 2000);
}

function toggleFav(lot) {
  const idx = state.favs.findIndex((f) => f.id === lot.id);
  if (idx >= 0) {
    const removed = state.favs.splice(idx, 1)[0];
    saveFavs();
    render();
    showSnackbar(`小P忘掉「${removed.name}」了`, () => {
      state.favs.splice(idx, 0, removed);
      saveFavs();
      render();
    });
  } else {
    const { id, brands, name, city, district, address, lat, lng, note } = lot;
    state.favs.push({ id, brands, name, city, district, address, lat, lng, note, label: '', savedAt: Date.now() });
    saveFavs();
    render();
    showSnackbar('小P記住了！');
  }
}

/* ---------- picker (縣市 → 行政區) ---------- */

function updateCityChip() {
  $('#city-chip').innerHTML = `${esc(state.district ?? state.city ?? '全台')}<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>`;
}

function openPicker(firstRun = false) {
  const picker = $('#picker');
  const grid = $('#picker-grid');
  const hint = $('#picker-hint');
  const cities = CITY_ORDER.filter((c) => state.lots.some((l) => l.city === c));

  const showCities = () => {
    $('#picker-title').textContent = '選擇縣市';
    $('#picker-title').hidden = firstRun;
    $('#picker-greeting').hidden = !firstRun;
    hint.hidden = true;
    grid.innerHTML = [`<button data-city="">全台</button>`]
      .concat(cities.map((c) => `<button data-city="${c}" class="${state.city === c ? 'sel' : ''}">${c}</button>`))
      .join('');
  };
  const showDistricts = (city) => {
    const districts = [...new Set(state.lots.filter((l) => l.city === city).map((l) => l.district).filter(Boolean))].sort();
    $('#picker-title').textContent = city;
    $('#picker-title').hidden = false;
    $('#picker-greeting').hidden = true;
    grid.innerHTML = [`<button data-district="">全部</button>`]
      .concat(districts.map((d) => `<button data-district="${d}" class="${state.district === d ? 'sel' : ''}">${d}</button>`))
      .join('');
  };

  grid.onclick = (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.city !== undefined) {
      state.city = btn.dataset.city || null;
      state.district = null;
      if (firstRun || !state.city) close();
      else showDistricts(state.city);
    } else if (btn.dataset.district !== undefined) {
      state.district = btn.dataset.district || null;
      close();
    }
  };
  const close = () => {
    if (firstRun) localStorage.setItem(HOME_KEY, state.city ?? '');
    picker.hidden = true;
    hint.hidden = true;
    $('#picker-greeting').hidden = true;
    $('#picker-title').hidden = false;
    updateCityChip();
    state.listLimit = LIST_PAGE;
    render();
  };
  picker.onclick = (e) => { if (e.target === picker) close(); };
  showCities();
  picker.hidden = false;
}

/* ---------- events ---------- */

function onCardAction(e) {
  const actEl = e.target.closest('[data-act]');
  if (!actEl) return;
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  const isFavCard = card.dataset.fav === '1';
  const lot = state.lots.find((l) => l.id === id) ?? state.favs.find((f) => f.id === id);
  if (!lot) return;
  const act = actEl.dataset.act;

  if (act === 'go') {
    window.open(gmapUrl(lot), '_blank');
  } else if (act === 'star') {
    toggleFav(lot);
    // 收藏成功的彈跳回饋（重新渲染後對新按鈕觸發一次 CSS 動畫）
    document.querySelectorAll(`.card[data-id="${id}"] [data-act="star"]`).forEach((b) => b.classList.add('pop'));
  } else if (act === 'unfav') {
    toggleFav(lot);
  } else if (act === 'copy') {
    navigator.clipboard?.writeText(`${lot.name} ${lot.address}`);
    showSnackbar('小P抄好地址了！');
  } else if (act === 'label') {
    const fav = state.favs.find((f) => f.id === id);
    const label = prompt('備註（例如：公司附近）', fav?.label ?? '');
    if (label !== null && fav) { fav.label = label.trim(); saveFavs(); render(); }
  } else if (act === 'expand') {
    if (isFavCard) {
      state.favExpanded = state.favExpanded === id ? null : id;
      renderFavs();
    } else {
      state.expanded = state.expanded === id ? null : id;
      renderList();
    }
  }
}

/* ---------- settings（加入主畫面／清除快取） ---------- */

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e; // 存起來，等使用者從設定觸發
});

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

const SHARE_ICON = '<svg viewBox="0 0 24 24"><path d="M12 3v13M8 7l4-4 4 4M6 12v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7"/></svg>';

function setupSettings() {
  const modal = $('#settings');
  const installRow = $('#install-row');
  const hint = $('#install-hint');

  $('#settings-btn').addEventListener('click', () => {
    hint.hidden = true;
    if (isStandalone()) {
      installRow.disabled = true;
      installRow.querySelector('b').textContent = '已加入主畫面';
      installRow.querySelector('small').textContent = '你已經從主畫面開啟小P帶路';
    }
    $('#settings-meta').textContent = `${$('#data-date').textContent}｜小P帶路`;
    modal.hidden = false;
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

  installRow.addEventListener('click', async () => {
    if (isStandalone()) return;
    if (deferredInstall) {
      deferredInstall.prompt();
      const { outcome } = await deferredInstall.userChoice;
      deferredInstall = null;
      if (outcome === 'accepted') modal.hidden = true;
      return;
    }
    // 無原生安裝提示（多為 iOS Safari）→ 顯示手動步驟
    hint.innerHTML = isIOS()
      ? `在 Safari 底部點「分享」${SHARE_ICON}，下滑選「加入主畫面」即可。`
      : `在瀏覽器選單開啟「加入主畫面／安裝應用程式」即可。`;
    hint.hidden = !hint.hidden;
  });

  $('#refresh-row').addEventListener('click', async () => {
    $('#refresh-row').querySelector('b').textContent = '清除中…';
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } finally {
      location.reload();
    }
  });
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.nav-item').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  $('#view-map').hidden = tab !== 'map';
  $('#view-list').hidden = tab !== 'list';
  $('#view-fav').hidden = tab !== 'fav';
  $('#page-title').textContent = '小P帶路';
  if (tab === 'map') {
    initMap();
    setTimeout(() => map.invalidateSize(), 50);
  }
  render();
}

async function main() {
  try {
    await loadData();
  } catch {
    $('#list').innerHTML = emptyHtml(MASCOT.broken, '小P拋錨了，資料載入失敗', location.protocol === 'file:'
      ? '請透過本地伺服器開啟（file:// 無法讀取資料）：<code>python3 -m http.server 8642 --directory web</code> 再開 http://localhost:8642'
      : '請檢查網路連線後重新整理');
    return;
  }

  document.querySelectorAll('.chip[data-brand]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.brand = chip.dataset.brand;
      document.querySelectorAll('.chip[data-brand]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      state.listLimit = LIST_PAGE;
      render();
    });
  });
  $('#city-chip').addEventListener('click', () => openPicker(false));
  updateCityChip();
  $('#list').addEventListener('click', (e) => {
    if (e.target.closest('.load-more')) { state.listLimit += LIST_PAGE; renderList(); return; }
    onCardAction(e);
  });
  $('#fav-list').addEventListener('click', onCardAction);
  $('#sheet-body').addEventListener('click', onCardAction);
  $('#sheet-close').addEventListener('click', () => selectLot(null));
  $('#locate-btn').addEventListener('click', () => requestLocation(true));
  $('#status-row').addEventListener('click', (e) => {
    if (e.target.closest('#loc-retry')) requestLocation(state.tab === 'map');
  });
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  setupSettings();

  // 蓋板下滑關閉：內容捲到頂端時往下拖，超過門檻收起、否則彈回
  const sheet = $('#sheet');
  let dragStartY = null, dragDy = 0;
  sheet.addEventListener('touchstart', (e) => {
    if (sheet.scrollTop > 0) { dragStartY = null; return; }
    dragStartY = e.touches[0].clientY;
    dragDy = 0;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (dragStartY == null) return;
    dragDy = e.touches[0].clientY - dragStartY;
    if (dragDy > 0) {
      e.preventDefault();
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${dragDy}px)`;
    }
  }, { passive: false });
  sheet.addEventListener('touchend', () => {
    if (dragStartY == null) return;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dragDy > 72) selectLot(null);
    dragStartY = null;
    dragDy = 0;
  });

  switchTab('map');
  requestLocation();

  // 首次使用：先選所在縣市，之後每次開啟預設顯示該地區
  if (localStorage.getItem(HOME_KEY) === null) openPicker(true);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js');
  }
}

main();

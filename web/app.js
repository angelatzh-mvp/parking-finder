/* 免費停車場 — 台灣聯通 & 車麻吉 & 嘟嘟房 & 24TPS 免停場站速查 */
'use strict';

const BRAND_META = {
  utg: { label: '台灣聯通', cls: 'badge-utg', sourceUrl: 'https://www.taiwan-parking.com.tw/#/parking-lots' },
  carmochi: { label: '車麻吉', cls: 'badge-cm', sourceUrl: 'https://help.carmochi.com/cityparking/available' },
  dodohome: { label: '嘟嘟房', cls: 'badge-dodo', sourceUrl: 'https://www.dodohome.com.tw/p2_map.aspx' },
  tps: { label: '24TPS', cls: 'badge-tps', sourceUrl: 'http://www.24tps.com.tw/OtherServiceADV/CreditCardParkList.aspx' },
};
const CITY_ORDER = ['基隆市','台北市','新北市','桃園市','新竹縣市','苗栗縣','台中市','彰化縣','南投縣','雲林縣','嘉義縣市','台南市','高雄市','屏東縣','宜蘭縣','花蓮縣','台東縣','澎湖縣'];
const FAV_KEY = 'parking-favs-v1';
const HOME_KEY = 'parking-home-city-v1';
const BRANDS_KEY = 'parking-brands-v1';
const LIST_PAGE = 60;

// 商業化推廣（分潤導流）。未來多筆時 pill 升級為「好康」清單入口，結構沿用。
const OFFER = {
  id: 'starbucks-klook-egift',
  pill: '星巴克91折',
  // 優惠券線條圖示；fill:none/stroke:currentColor 沿用全域規則，繼承 pill 綠字、背景透明
  pillIcon: '<svg class="offer-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9a2 2 0 0 0 0 6v2a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-2a2 2 0 0 1 0-6V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z"/><path d="M14 6v12" stroke-dasharray="1.5 2"/></svg>',
  image: 'img/offer-starbucks.jpg',
  title: '星巴克飲料券 · 91 折起',
  subtitle: '電子票券，買了隨時能用 — 自己喝、送人都方便',
  tiers: [
    { name: '星巴克 TWD110 星享飲料券', price: 100, face: 110, save: 10 },
    { name: '星巴克 TWD155 星享飲料券', price: 145, face: 155, save: 10 },
    { name: '星巴克 TWD175 星享飲料券', price: 160, face: 175, save: 15 },
  ],
  cta: '到 Klook 買 ›',
  note: '透過此連結購買，小P會獲得一點回饋，幫助小Ｐ帶路持續營運 💚　（由 Klook 提供，將開啟外部頁面）',
  url: 'https://onelink.one/s/osdDH',
};

// 品牌篩選：null＝全部（含日後新增品牌）；否則為選取的品牌陣列（至少一個）。
function loadBrands() {
  const raw = localStorage.getItem(BRANDS_KEY);
  if (!raw || raw === 'all') return null;
  try {
    const arr = JSON.parse(raw).filter((b) => b in BRAND_META);
    return arr.length ? arr : null;
  } catch { return null; }
}

const state = {
  lots: [],
  meta: null,
  // 停車場品牌篩選偏好，記在裝置上
  brands: loadBrands(),
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

const ALL_BRANDS = () => Object.keys(BRAND_META);
function isAllBrands() { return !state.brands || state.brands.length >= ALL_BRANDS().length; }
function brandSelected(b) { return !state.brands || state.brands.includes(b); }
function saveBrands() {
  localStorage.setItem(BRANDS_KEY, isAllBrands() ? 'all' : JSON.stringify(state.brands));
}
// 切換單一品牌（維持至少一個），全選時內部值歸零為 null
function toggleBrand(b) {
  let sel = state.brands ? [...state.brands] : ALL_BRANDS();
  if (sel.includes(b)) {
    if (sel.length === 1) return; // 至少保留一個
    sel = sel.filter((x) => x !== b);
  } else {
    sel.push(b);
  }
  state.brands = sel.length >= ALL_BRANDS().length ? null : sel;
  saveBrands();
}

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

// 蓋板下滑關閉：捲到頂端時往下拖，超過門檻呼叫 onClose、否則彈回。所有蓋板共用同一邏輯。
function enableSwipeClose(scrollEl, onClose) {
  if (!scrollEl) return;
  let startY = null, dy = 0;
  scrollEl.addEventListener('touchstart', (e) => {
    if (scrollEl.scrollTop > 0) { startY = null; return; }
    startY = e.touches[0].clientY;
    dy = 0;
  }, { passive: true });
  scrollEl.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = e.touches[0].clientY - startY;
    if (dy > 0) {
      e.preventDefault();
      scrollEl.style.transition = 'none';
      scrollEl.style.transform = `translateY(${dy}px)`;
    }
  }, { passive: false });
  scrollEl.addEventListener('touchend', () => {
    if (startY == null) return;
    scrollEl.style.transition = '';
    scrollEl.style.transform = '';
    if (dy > 72) onClose();
    startY = null;
    dy = 0;
  });
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
  report: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
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
    if (state.brands && !l.brands.some((b) => state.brands.includes(b))) return false;
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
        <button data-act="report">${I.report}回報錯誤</button>
      </div>
      <div class="detail-meta">來源：${lot.brands.map((b) => BRAND_META[b].label).join('、')}官方名單 · 以現場標示為準</div>
    </div>` : '';
  return `
  <article class="card" data-id="${lot.id}" ${fav ? 'data-fav="1"' : ''}>
    <div class="card-top">${topLeft}</div>
    <div class="card-main" data-act="expand">
      <div class="card-info">
        <p class="card-name">${esc(lot.name)}</p>
        ${lot.address
          ? `<p class="card-addr">${esc(lot.address)}</p>`
          : `<p class="card-addr card-addr-missing">${I.warn}<span>無提供地址，請自行向業者確認位置</span></p>`}
        ${fav?.label ? `<p class="card-label">${I.pen} ${esc(fav.label)}</p>` : ''}
        ${stale ? `<p class="card-warn-text">前往前請再確認現場標示</p>` : ''}
      </div>
      <div class="nav-go">
        <button data-act="go" aria-label="${lot.lat == null ? '搜尋位置' : '導航'}">${lot.lat == null ? I.search : I.nav}</button>
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
  const PIN_CLS = { utg: 'pin-utg', carmochi: 'pin-cm', dodohome: 'pin-dodo', tps: 'pin-tps' };
  const primary = ['utg', 'carmochi', 'dodohome', 'tps'].find((b) => lot.brands.includes(b)) || 'utg';
  const cls = PIN_CLS[primary];
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
  const fitKey = `${state.brands ? state.brands.join(',') : 'all'}|${state.city}|${state.district}`;
  if (fitKey !== lastFitKey && cluster.getLayers().length) {
    lastFitKey = fitKey;
    if (state.loc && !state.city) {
      map.setView([state.loc.lat, state.loc.lng], 15);
    } else {
      map.fitBounds(cluster.getBounds().pad(0.1), { maxZoom: 16 });
    }
  }
  updateLocMarker();
}

// 目前位置：脈動藍點＋GPS 精度圈，位置更新時只移動標記、不重建
let locAccuracy = null;
function updateLocMarker() {
  if (!map || !state.loc) return;
  const pos = [state.loc.lat, state.loc.lng];
  if (!locMarker) {
    locMarker = L.marker(pos, {
      icon: L.divIcon({
        className: '',
        html: '<div class="user-loc"><span class="user-loc-pulse"></span><span class="user-loc-dot"></span></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
      zIndexOffset: 1000,
      interactive: false,
      keyboard: false,
    }).addTo(map);
    locAccuracy = L.circle(pos, {
      radius: state.loc.accuracy ?? 0,
      color: '#378add', weight: 1, opacity: 0.35,
      fillColor: '#378add', fillOpacity: 0.08,
      interactive: false,
    }).addTo(map);
  } else {
    locMarker.setLatLng(pos);
    locAccuracy.setLatLng(pos);
    locAccuracy.setRadius(state.loc.accuracy ?? 0);
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

// 定位鍵的視覺狀態：轉圈（pending）/ 驚嘆號（error），讓使用者知道 App 有在反應
function setLocIcon(status) {
  const btn = $('#locate-btn');
  if (!btn) return;
  btn.classList.toggle('is-pending', status === 'pending');
  btn.classList.toggle('is-error', status === 'error');
}

function requestLocation(pan = false) {
  if (!navigator.geolocation) { state.locStatus = 'off'; renderStatus(); return; }
  state.locStatus = 'pending';
  setLocIcon('pending');
  renderStatus();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      state.locStatus = 'on';
      state.listLimit = LIST_PAGE;
      setLocIcon('ok');
      if (map && pan) map.setView([state.loc.lat, state.loc.lng], 15);
      render();
      startLocWatch();
    },
    (err) => {
      state.loc = null; state.locStatus = 'off';
      setLocIcon('error');
      render();
      handleLocError(err, pan);
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
  );
}

// 把 error code 轉成看得懂、可行動的回饋：權限問題 → 教學卡；其餘暫時性問題 → 可重試的 toast
function handleLocError(err, pan = false) {
  if (err && err.code === 1) { // PERMISSION_DENIED
    openLocHelp();
    return;
  }
  const msg = err && err.code === 3 // TIMEOUT
    ? '定位逾時，可能訊號較弱'
    : '暫時定不到位置，請到空曠處再試'; // POSITION_UNAVAILABLE / 其他
  showSnackbar(msg, { label: '重試', onAction: () => requestLocation(pan) });
}

// 依瀏覽器給對應的重設步驟（denied 時系統不會再跳詢問，只能引導去設定）
function openLocHelp() {
  const steps = isIOS()
    ? (/crios|fxios|edgios/i.test(navigator.userAgent)
      ? ['點網址列左側的「ᴀA」或選單，找到網站設定', '把「位置」改成「允許」', '回到這裡點下方「重新整理」']
      : ['點網址列左側的「ᴀA」', '選「網站設定」', '把「位置」改成「允許」', '回到這裡點下方「重新整理」'])
    : ['點網址列左側的鎖頭 🔒 圖示', '找到「位置／location」權限', '改成「允許」', '回到這裡點下方「重新整理」'];
  $('#loc-help-steps').innerHTML = steps.map((s) => `<li>${s}</li>`).join('');
  $('#loc-help').hidden = false;
}

// 進場先體檢定位權限：denied 直接引導、不讓使用者撞牆；granted/prompt 才正常請求
async function checkLocPermission() {
  if (!navigator.permissions || !navigator.permissions.query) return null;
  try {
    const st = await navigator.permissions.query({ name: 'geolocation' });
    if (st.onchange !== undefined) {
      st.onchange = () => { if (st.state === 'granted') requestLocation(); };
    }
    return st.state; // granted | prompt | denied
  } catch { return null; }
}

// 首次定位成功後持續追蹤：藍點即時跟著走；移動超過 150m 才重算距離排序（省電）
let locWatchId = null;
function startLocWatch() {
  if (locWatchId != null || !navigator.geolocation.watchPosition) return;
  let lastRenderLoc = state.loc;
  locWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      state.loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      updateLocMarker();
      if (lastRenderLoc && haversine(lastRenderLoc, state.loc) > 150) {
        lastRenderLoc = state.loc;
        render();
      }
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 15000 },
  );
}

/* ---------- favorites ---------- */

let snackTimer = null;
// opts 可為 function（＝復原鍵，向下相容）或物件 { label, onAction, timeout }
function showSnackbar(text, opts) {
  const bar = $('#snackbar');
  const btn = $('#snackbar-action');
  const cfg = typeof opts === 'function' ? { label: '復原', onAction: opts, timeout: 4000 } : (opts || {});
  $('#snackbar-text').textContent = text;
  const hasAction = typeof cfg.onAction === 'function';
  btn.hidden = !hasAction;
  if (hasAction) {
    btn.textContent = cfg.label || '復原';
    btn.onclick = () => { bar.hidden = true; clearTimeout(snackTimer); cfg.onAction(); };
  }
  bar.hidden = false;
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => { bar.hidden = true; }, cfg.timeout || (hasAction ? 4000 : 2000));
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

const CHEVRON = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
function updateBrandChip() {
  let label;
  if (isAllBrands()) label = '全部品牌';
  else if (state.brands.length === 1) label = BRAND_META[state.brands[0]].label;
  else label = `${state.brands.length} 個品牌`;
  const chip = $('#brand-chip');
  chip.innerHTML = `${esc(label)}${CHEVRON}`;
  chip.setAttribute('aria-pressed', String(!isAllBrands())); // 非全選時高亮，提示已套用篩選
}

function openBrandPicker() {
  const picker = $('#brand-picker');
  const list = $('#brand-list');
  const check = '<svg class="chk" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>';
  const dotCls = (b) => BRAND_META[b].cls.replace('badge-', 'dot-');
  const paint = () => {
    const rows = [`<button class="brand-opt brand-all ${isAllBrands() ? 'sel' : ''}" data-brand="all"><span class="brand-opt-label">全部品牌</span>${check}</button>`];
    for (const b of ALL_BRANDS()) {
      rows.push(`<button class="brand-opt ${brandSelected(b) ? 'sel' : ''}" data-brand="${b}"><span class="brand-opt-label"><span class="dot ${dotCls(b)}"></span>${esc(BRAND_META[b].label)}</span>${check}</button>`);
    }
    list.innerHTML = rows.join('');
  };
  list.onclick = (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.brand === 'all') { state.brands = null; saveBrands(); }
    else toggleBrand(btn.dataset.brand);
    paint();
    updateBrandChip();
    state.listLimit = LIST_PAGE;
    render();
  };
  const close = () => { picker.hidden = true; };
  picker.onclick = (e) => { if (e.target === picker) close(); };
  paint();
  picker.hidden = false;
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
    // 匿名事件統計：導航點擊＝產品目標達成（無地址場站以 nav-search 區分）
    window.goatcounter?.count?.({ path: lot.lat == null ? 'nav-search' : 'nav-click', event: true });
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
  } else if (act === 'report') {
    openReport(lot);
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

/* ---------- 分享 ---------- */

// 分享出去的連結帶 ?ref=share，GoatCounter 會把這些訪客歸到「share」來源
const SHARE_URL = location.origin + location.pathname.replace(/index\.html$/, '') + '?ref=share';
const SHARE_TEXT = '我都用「小Ｐ帶路」找信用卡免費停車場 🅿️\n全台 900+ 場站，開網頁就能用、免下載';
const FLAG = '<path d="M82 6V30" stroke="#04342C" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M82 7 L97 11 L82 16 Z" fill="#EF9F27"/>';
const CONFETTI = '<circle cx="32" cy="12" r="2.6" fill="#EF9F27"/><circle cx="30" cy="42" r="2" fill="#378ADD"/><rect x="68" y="40" width="5" height="5" rx="1" fill="#1D9E75"/><circle cx="94" cy="46" r="2.2" fill="#EF9F27"/><circle cx="40" cy="6" r="1.8" fill="#1D9E75"/>';
const MASCOT_FLAG = mascotSvg(FLAG);
const MASCOT_CELEBRATE = mascotSvg(FLAG + CONFETTI);
// 回報道謝：小P 手邊冒出愛心＋彩帶
const HEART = '<path d="M84 31 C74 23 76 13 84 18 C92 13 94 23 84 31 Z" fill="#E8607D"/>';
const MASCOT_THANKS = mascotSvg(HEART + CONFETTI);

// QR 產生器 lazy-load（56KB，只在開分享時載入）
let qrLibPromise = null;
function ensureQR() {
  if (window.qrcode) return Promise.resolve();
  if (!qrLibPromise) {
    qrLibPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'qrcode.min.js';
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  return qrLibPromise;
}

// 自繪 QR：明確填色＋關掉描邊，避免被全域 svg 樣式（fill:none/stroke）影響
function qrSvg(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const m = 2;
  const total = n + m * 2;
  let cells = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) cells += `<rect x="${c + m}" y="${r + m}" width="1" height="1"/>`;
    }
  }
  return `<svg viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff" stroke="none"/><g fill="#1a1a18" stroke="none">${cells}</g></svg>`;
}

function openShare() {
  $('#settings').hidden = true;
  $('#share-invite').hidden = false;
  $('#share-done').hidden = true;
  $('#share-hero').innerHTML = MASCOT_FLAG;
  $('#share-native').hidden = !navigator.share;
  $('#share').hidden = false;
  window.goatcounter?.count?.({ path: 'share-open', event: true });
  ensureQR()
    .then(() => { $('#share-qr').innerHTML = qrSvg(SHARE_URL); })
    .catch(() => { $('#share-qr').closest('.share-qr-wrap').hidden = true; });
}

function onShareSuccess() {
  window.goatcounter?.count?.({ path: 'share-done', event: true });
  if (!localStorage.getItem('shared-before')) {
    // 第一次：小P 舉旗＋彩帶的慶祝畫面
    localStorage.setItem('shared-before', '1');
    $('#share-invite').hidden = true;
    $('#share-done-hero').innerHTML = MASCOT_CELEBRATE;
    $('#share-done').hidden = false;
  } else {
    $('#share').hidden = true;
    showSnackbar('分享成功！謝謝你，又有朋友要少繳停車費了！');
  }
}

function setupShare() {
  $('#share-row').addEventListener('click', openShare);
  $('#share').addEventListener('click', (e) => { if (e.target.id === 'share') $('#share').hidden = true; });
  $('#share-native').addEventListener('click', async () => {
    try {
      await navigator.share({ text: SHARE_TEXT, url: SHARE_URL });
      onShareSuccess();
    } catch { /* 使用者取消分享，不動作 */ }
  });
  $('#share-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(`${SHARE_TEXT}\n${SHARE_URL}`); } catch { /* 忽略 */ }
    onShareSuccess();
  });
}

/* ---------- 回報／建議（mailto，無後端） ---------- */

const REPORT_TO = 'angela.tzh@gmail.com';
let pendingReportLot = null;

// 依情境預填信件：帶場站入口自動填名稱／地址／id，一般入口給勾選式引導
function reportMailto(lot) {
  const subject = lot ? `[小Ｐ帶路] 場站回報 — ${lot.name}` : '[小Ｐ帶路] 問題回報／建議';
  const body = (lot ? [
    `場站：${lot.name}（${lot.city}）`,
    `地址：${lot.address || '（未提供）'}`,
    '',
    '──── 以下請幫小P填寫 ────',
    '問題類型（地址錯／位置錯／已無免停／已歇業／其他）：',
    '補充說明：',
    '',
    `（系統資訊，請保留）id: ${lot.id} · src: ${lot.brands.join(',')}`,
  ] : [
    '想回報什麼呢？（可留下想說的）',
    '・找不到某個停車場',
    '・某站資訊有誤',
    '・App 使用問題',
    '・功能建議',
    '',
    '內容：',
  ]).join('\n');
  return `mailto:${REPORT_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function openReport(lot = null) {
  pendingReportLot = lot;
  $('#settings').hidden = true;
  $('#report-invite').hidden = false;
  $('#report-done').hidden = true;
  const ctx = $('#report-context');
  ctx.textContent = lot ? `正在回報：${lot.name}` : '';
  ctx.hidden = !lot;
  $('#report').hidden = false;
  window.goatcounter?.count?.({ path: 'report-open', event: true });
}

// mailto 無法確認實際寄出 → 道謝時機＝使用者點了回報、我們把信開起來（與分享一致）
function onReportSent() {
  window.goatcounter?.count?.({ path: 'report-sent', event: true });
  if (!localStorage.getItem('reported-before')) {
    // 第一次：小P 比愛心＋彩帶的道謝畫面
    localStorage.setItem('reported-before', '1');
    $('#report-invite').hidden = true;
    $('#report-done-hero').innerHTML = MASCOT_THANKS;
    $('#report-done').hidden = false;
  } else {
    $('#report').hidden = true;
    showSnackbar('謝謝你的回報！小P會把資料修得更準 💚');
  }
}

function setupReport() {
  $('#report-row').addEventListener('click', () => openReport(null));
  $('#report').addEventListener('click', (e) => { if (e.target.id === 'report') $('#report').hidden = true; });
  $('#report-send').addEventListener('click', () => {
    window.location.href = reportMailto(pendingReportLot);
    onReportSent();
  });
}

// 商業化好康：pill → 圖文彈窗 → 主 CTA 才外連。四段漏斗埋點供後續分析。
function setupOffer() {
  const chip = $('#offer-chip');
  const modal = $('#offer');
  if (!chip || !modal) return;

  chip.innerHTML = `${OFFER.pillIcon}<span>${esc(OFFER.pill)}</span>`;
  window.goatcounter?.count?.({ path: `offer-pill-view-${OFFER.id}`, event: true });

  $('#offer-img').src = OFFER.image;
  $('#offer-title').textContent = OFFER.title;
  $('#offer-sub').textContent = OFFER.subtitle;
  $('#offer-note').textContent = OFFER.note;
  $('#offer-tiers').innerHTML = OFFER.tiers.map((t) => `
    <div class="offer-tier">
      <span class="t-name">${esc(t.name)}</span>
      <span class="t-price">NT$${t.price}</span>
      <span class="t-save">省 $${t.save}</span>
    </div>`).join('');
  const cta = $('#offer-cta');
  cta.textContent = OFFER.cta;
  cta.href = OFFER.url;

  let ctaClicked = false;
  const closeModal = () => {
    if (!ctaClicked) window.goatcounter?.count?.({ path: `offer-modal-dismiss-${OFFER.id}`, event: true });
    modal.hidden = true;
  };

  chip.addEventListener('click', () => {
    ctaClicked = false;
    window.goatcounter?.count?.({ path: `offer-pill-click-${OFFER.id}`, event: true });
    modal.hidden = false;
  });
  cta.addEventListener('click', () => {
    ctaClicked = true;
    window.goatcounter?.count?.({ path: `offer-modal-cta-${OFFER.id}`, event: true });
    modal.hidden = true;
  });
  $('#offer-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  enableSwipeClose(modal.querySelector('.modal-sheet'), closeModal);
}

// 桌機軟性提示：手機體驗更好，可掃碼帶走；一次關閉後不再出現
function setupDesktopHint() {
  const isDesktop = window.matchMedia('(min-width: 820px)').matches && !window.matchMedia('(pointer: coarse)').matches;
  if (!isDesktop || isStandalone() || localStorage.getItem('desktop-hint-off')) return;
  const bar = $('#desktop-hint');
  bar.hidden = false;
  $('#desktop-hint-close').addEventListener('click', () => {
    bar.hidden = true;
    localStorage.setItem('desktop-hint-off', '1');
    if (map) setTimeout(() => map.invalidateSize(), 60);
  });
  $('#desktop-hint-qr').addEventListener('click', openShare);
  if (map) setTimeout(() => map.invalidateSize(), 60);
}

function setupSettings() {
  const modal = $('#settings');
  const installRow = $('#install-row');
  const hint = $('#install-hint');

  $('#settings-btn').addEventListener('click', () => {
    hint.hidden = true;
    if (isStandalone()) {
      installRow.disabled = true;
      installRow.querySelector('b').textContent = '已加入主畫面';
      installRow.querySelector('small').textContent = '你已經從主畫面開啟小Ｐ帶路';
    }
    $('#settings-meta').textContent = `${$('#data-date').textContent}｜小Ｐ帶路`;
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
  $('#page-title').textContent = '小Ｐ帶路';
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

  $('#brand-chip').addEventListener('click', openBrandPicker);
  updateBrandChip();
  $('#city-chip').addEventListener('click', () => openPicker(false));
  updateCityChip();
  $('#list').addEventListener('click', (e) => {
    if (e.target.closest('.load-more')) { state.listLimit += LIST_PAGE; renderList(); return; }
    onCardAction(e);
  });
  $('#fav-list').addEventListener('click', onCardAction);
  $('#sheet-body').addEventListener('click', onCardAction);
  $('#sheet-close').addEventListener('click', () => selectLot(null));
  $('#locate-btn').addEventListener('click', () => {
    // 已有位置就立即置中，不必等 GPS 重新回應；同時在背景刷新
    if (state.loc && map) map.setView([state.loc.lat, state.loc.lng], 16);
    requestLocation(!state.loc);
  });
  $('#status-row').addEventListener('click', (e) => {
    if (e.target.closest('#loc-retry')) requestLocation(state.tab === 'map');
  });
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  setupSettings();
  setupShare();
  setupReport();
  setupOffer();

  // 所有蓋板統一下滑關閉行為（共用 enableSwipeClose）
  enableSwipeClose($('#sheet'), () => selectLot(null));
  enableSwipeClose($('#settings .modal-sheet'), () => { $('#settings').hidden = true; });
  enableSwipeClose($('#share .modal-sheet'), () => { $('#share').hidden = true; });
  enableSwipeClose($('#report .modal-sheet'), () => { $('#report').hidden = true; });
  enableSwipeClose($('#loc-help .modal-sheet'), () => { $('#loc-help').hidden = true; });
  enableSwipeClose($('#picker .picker-sheet'), () => $('#picker').click());
  enableSwipeClose($('#brand-picker .picker-sheet'), () => { $('#brand-picker').hidden = true; });

  switchTab('map');
  setupDesktopHint();

  // 定位權限自我檢測：已拒絕就先給教學卡，不讓使用者點了半天沒反應
  checkLocPermission().then((perm) => {
    if (perm === 'denied') { state.locStatus = 'off'; setLocIcon('error'); renderStatus(); openLocHelp(); }
    else requestLocation();
  });

  // loc-help 教學卡：重新整理 / 關閉 / 點背景關閉
  $('#loc-help-reload').addEventListener('click', () => location.reload());
  $('#loc-help-dismiss').addEventListener('click', () => { $('#loc-help').hidden = true; });
  $('#loc-help').addEventListener('click', (e) => { if (e.target.id === 'loc-help') $('#loc-help').hidden = true; });

  // iOS Safari 對 permissions onchange 支援不穩：切回 App 時，若使用者已在設定裡開啟，重新嘗試
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !state.loc && !$('#loc-help').hidden) {
      checkLocPermission().then((perm) => { if (perm === 'granted') { $('#loc-help').hidden = true; requestLocation(state.tab === 'map'); } });
    }
  });

  // 首次使用：先選所在縣市，之後每次開啟預設顯示該地區
  if (localStorage.getItem(HOME_KEY) === null) openPicker(true);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js');
  }
}

main();

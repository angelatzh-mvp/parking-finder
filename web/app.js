/* 免費停車場 — 台灣聯通 & 車麻吉免停場站速查 */
'use strict';

const BRAND_META = {
  utg: { label: '台灣聯通', cls: 'badge-utg', sourceUrl: 'https://www.taiwan-parking.com.tw/#/parking-lots' },
  carmochi: { label: '車麻吉', cls: 'badge-cm', sourceUrl: 'https://help.carmochi.com/cityparking/available' },
};
const CITY_ORDER = ['基隆市','台北市','新北市','桃園市','新竹縣市','苗栗縣','台中市','彰化縣','南投縣','雲林縣','嘉義縣市','台南市','高雄市','屏東縣','宜蘭縣','花蓮縣','台東縣','澎湖縣'];
const FAV_KEY = 'parking-favs-v1';
const LIST_PAGE = 60;

const state = {
  lots: [],
  meta: null,
  brand: 'all',
  city: null,
  district: null,
  tab: 'list',
  loc: null,
  favs: loadFavs(),
  expanded: new Set(),
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
  if (m == null) return '';
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function gmapUrl(lot) {
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
};

/* ---------- data ---------- */

async function loadData() {
  const res = await fetch('data/parking-lots.json');
  const data = await res.json();
  state.lots = data.lots;
  state.meta = data.meta;
  const d = (data.meta.sources.carmochi.updatedAt ?? data.meta.builtAt).slice(0, 10).replace(/-0?/g, '/').slice(2);
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
  const expanded = inSheet || state.expanded.has(lot.id);
  const stale = fav && !state.lots.some((l) => l.id === fav.id);
  const starBtn = !fav && !inSheet
    ? `<button class="star-btn ${isFav(lot.id) ? 'on' : ''}" data-act="star" aria-label="收藏">${I.star}</button>`
    : (inSheet ? `<button class="star-btn ${isFav(lot.id) ? 'on' : ''}" data-act="star" aria-label="收藏">${I.star}</button>` : '');
  const topLeft = stale
    ? `<span class="badge badge-warn">${I.warn} 已不在最新官方名單</span>`
    : `<div class="badges">${badgesHtml(lot)}</div>`;
  const noteRow = expanded && lot.note
    ? `<div class="detail-note">${I.info}<span>${esc(lot.note)}</span></div>` : '';
  const extra = [];
  if (expanded && lot.maxHeight) extra.push(`限高 ${lot.maxHeight}m`);
  if (expanded && lot.totalSpace) extra.push(`約 ${lot.totalSpace} 格`);
  const srcBrand = lot.brands[0];
  const detail = expanded ? `
    <div class="card-detail">
      ${noteRow}
      ${extra.length ? `<div class="detail-note">${I.info}<span>${extra.join('・')}</span></div>` : ''}
      <div class="detail-actions">
        <button data-act="copy">${I.copy}複製地址</button>
        <a href="${BRAND_META[srcBrand].sourceUrl}" target="_blank" rel="noopener">${I.ext}官方來源</a>
        ${fav ? `<button data-act="label">${I.pen}備註</button><button data-act="unfav">${I.del}移除</button>` : ''}
      </div>
      <div class="detail-meta">來源：${lot.brands.map((b) => BRAND_META[b].label).join('、')}官方名單 · 以現場標示為準</div>
    </div>` : '';
  return `
  <article class="card" data-id="${lot.id}" ${fav ? 'data-fav="1"' : ''}>
    <div class="card-top">${topLeft}${starBtn}</div>
    <div class="card-main" data-act="expand">
      <div class="card-info">
        <p class="card-name">${esc(lot.name)}</p>
        <p class="card-addr">${esc(lot.address)}</p>
        ${fav?.label ? `<p class="card-label">${I.pen} ${esc(fav.label)}</p>` : ''}
        ${stale ? `<p class="card-warn-text">前往前請再確認現場標示</p>` : ''}
      </div>
      <div class="nav-go">
        <button data-act="go" aria-label="導航">${I.nav}</button>
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
  if (state.loc) parts.push('依距離排序');
  if (state.city) parts.push(state.city + (state.district ? ` ${state.district}` : ''));
  el.innerHTML = `${I.loc}<span>${parts.join(' · ')}</span>`;
}

function renderList() {
  const el = $('#list');
  const lots = withDistance(filteredLots());
  if (!lots.length) {
    el.innerHTML = `<div class="empty">小P在這個範圍找不到場站。<br>兩家通路的免停名單會隨合作狀況變動。</div>`;
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
      html += `<div class="group-head">${city}（${group.length}）</div>`;
      html += group.map((l) => cardHtml(l)).join('');
    }
  }
  el.innerHTML = html;
}

function renderFavs() {
  const el = $('#fav-list');
  if (!state.favs.length) {
    el.innerHTML = `<div class="empty">還沒有收藏。<br>在清單或地圖點 ☆，讓小P記住你常去的停車場。</div>`;
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
  if (state.tab === 'map') renderMarkers();
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
  const prev = state.selectedId;
  state.selectedId = id;
  for (const changed of [prev, id]) {
    const lot = state.lots.find((l) => l.id === changed);
    const m = markers.get(changed);
    if (lot && m) m.setIcon(pinIcon(lot, changed === id));
  }
  const sheet = $('#sheet');
  if (!id) { sheet.hidden = true; return; }
  const lot = state.lots.find((l) => l.id === id);
  const withD = { ...lot, dist: state.loc && lot.lat ? haversine(state.loc, lot) : null };
  $('#sheet-body').innerHTML = cardHtml(withD, { inSheet: true });
  sheet.hidden = false;
}

/* ---------- location ---------- */

function requestLocation(pan = false) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      state.listLimit = LIST_PAGE;
      if (map && pan) map.setView([state.loc.lat, state.loc.lng], 15);
      render();
    },
    () => { state.loc = null; render(); },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
  );
}

/* ---------- favorites ---------- */

let snackTimer = null;
function showSnackbar(text, undo) {
  const bar = $('#snackbar');
  $('#snackbar-text').textContent = text;
  bar.hidden = false;
  $('#snackbar-action').onclick = () => { undo(); bar.hidden = true; clearTimeout(snackTimer); };
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => { bar.hidden = true; }, 4000);
}

function toggleFav(lot) {
  const idx = state.favs.findIndex((f) => f.id === lot.id);
  if (idx >= 0) {
    const removed = state.favs.splice(idx, 1)[0];
    saveFavs();
    render();
    showSnackbar(`已移除「${removed.name}」`, () => {
      state.favs.splice(idx, 0, removed);
      saveFavs();
      render();
    });
  } else {
    const { id, brands, name, city, district, address, lat, lng, note } = lot;
    state.favs.push({ id, brands, name, city, district, address, lat, lng, note, label: '', savedAt: Date.now() });
    saveFavs();
    render();
  }
}

/* ---------- picker (縣市 → 行政區) ---------- */

function openPicker() {
  const picker = $('#picker');
  const grid = $('#picker-grid');
  const cities = CITY_ORDER.filter((c) => state.lots.some((l) => l.city === c));

  const showCities = () => {
    $('#picker-title').textContent = '選擇縣市';
    grid.innerHTML = [`<button data-city="">全台</button>`]
      .concat(cities.map((c) => `<button data-city="${c}" class="${state.city === c ? 'sel' : ''}">${c}</button>`))
      .join('');
  };
  const showDistricts = (city) => {
    const districts = [...new Set(state.lots.filter((l) => l.city === city).map((l) => l.district).filter(Boolean))].sort();
    $('#picker-title').textContent = city;
    grid.innerHTML = [`<button data-district="">全部</button>`]
      .concat(districts.map((d) => `<button data-district="${d}" class="${state.district === d ? 'sel' : ''}">${d}</button>`))
      .join('');
  };

  grid.onclick = (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.city !== undefined) {
      if (!btn.dataset.city) {
        state.city = null; state.district = null; close();
      } else {
        state.city = btn.dataset.city; state.district = null;
        showDistricts(state.city);
      }
    } else if (btn.dataset.district !== undefined) {
      state.district = btn.dataset.district || null;
      close();
    }
  };
  const close = () => {
    picker.hidden = true;
    $('#city-chip').innerHTML = `${esc(state.district ?? state.city ?? '全台')}<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>`;
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
  } else if (act === 'unfav') {
    toggleFav(lot);
  } else if (act === 'copy') {
    navigator.clipboard?.writeText(`${lot.name} ${lot.address}`);
    showSnackbar('已複製地址', () => {});
  } else if (act === 'label') {
    const fav = state.favs.find((f) => f.id === id);
    const label = prompt('備註（例如：公司附近）', fav?.label ?? '');
    if (label !== null && fav) { fav.label = label.trim(); saveFavs(); render(); }
  } else if (act === 'expand') {
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    if (isFavCard) renderFavs(); else renderList();
  }
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.nav-item').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  $('#view-map').hidden = tab !== 'map';
  $('#view-list').hidden = tab !== 'list';
  $('#view-fav').hidden = tab !== 'fav';
  $('#page-title').textContent = tab === 'fav' ? '常用停車場' : '小P帶路';
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
    $('#list').innerHTML = `<div class="empty">小P載入資料失敗了。<br>${
      location.protocol === 'file:'
        ? '請透過本地伺服器開啟（file:// 無法讀取資料）：<br><code>python3 -m http.server 8642 --directory web</code><br>再開 http://localhost:8642'
        : '請檢查網路連線後重新整理。'
    }</div>`;
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
  $('#city-chip').addEventListener('click', openPicker);
  $('#list').addEventListener('click', (e) => {
    if (e.target.closest('.load-more')) { state.listLimit += LIST_PAGE; renderList(); return; }
    onCardAction(e);
  });
  $('#fav-list').addEventListener('click', onCardAction);
  $('#sheet-body').addEventListener('click', onCardAction);
  $('#locate-btn').addEventListener('click', () => requestLocation(true));
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  render();
  requestLocation();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js');
  }
}

main();

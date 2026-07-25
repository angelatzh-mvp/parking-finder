/* 免費停車場 — 台灣聯通 & 車麻吉 & 嘟嘟房 & 24TPS & ViVi PARK & 銓營 免停場站速查 */
'use strict';

// 兩種折抵機制：swipe＝帶實體卡離場過卡；appbind＝先在該品牌 App 綁卡、出場車牌辨識自動折抵。
const REDEEM_TYPE = {
  swipe: { tag: '實體卡過卡折抵', prepLabel: '記得帶卡' },
  appbind: { tag: 'App 綁卡自動折抵', prepLabel: '出發前' },
};
// 所有品牌統一附這句免責，避免各家寫法不一致。
const REDEEM_DISCLAIMER = '免費時數與次數由發卡銀行決定，實際優惠以各行公告與現場標示為準。';

const BRAND_META = {
  utg: {
    label: '台灣聯通', cls: 'badge-utg', sourceUrl: 'https://www.taiwan-parking.com.tw/#/parking-lots',
    redeem: {
      type: 'swipe', prep: '帶一張符合資格的實體信用卡',
      steps: ['離場前於自動繳費機以信用卡過卡', '或交由現場人員過卡確認'],
      banks: '多家銀行，實際卡別依各發卡行公告',
    },
  },
  carmochi: {
    label: '車麻吉', cls: 'badge-cm', sourceUrl: 'https://help.carmochi.com/cityparking/creditcard',
    redeem: {
      type: 'appbind', prep: '先在車麻吉 App 綁定信用卡',
      steps: ['App 綁定信用卡', '開啟「卡友免費停車自動折抵」', '出場時車牌辨識、自動折抵免過卡'],
      banks: '台新、中信、上海、聯邦、兆豐',
      note: '每卡每日折抵 1 次；實際適用場站以車麻吉 App 標示為準',
    },
  },
  dodohome: {
    label: '嘟嘟房', cls: 'badge-dodo', sourceUrl: 'https://www.dodohome.com.tw/p3_dodocard.aspx',
    redeem: {
      type: 'swipe', prep: '帶一張符合資格的實體信用卡',
      steps: ['離場前於自動繳費機以信用卡過卡', '或交由現場人員過卡確認'],
      banks: '中信、台新、玉山、富邦、一銀、永豐、兆豐等 20+ 家',
      note: '各家銀行合作場站名單不同，非每站都適用',
    },
  },
  tps: {
    label: '24TPS', cls: 'badge-tps', sourceUrl: 'http://www.24tps.com.tw/OtherServiceADV/CreditCardParkList.aspx',
    redeem: {
      type: 'swipe', prep: '帶一張符合資格的實體信用卡',
      steps: ['離場前於自動繳費機以信用卡過卡', '或交由現場人員過卡確認'],
      banks: '多家銀行，實際卡別依各發卡行公告',
      note: '正卡持卡人每人每日 1 次、每日最高 3 小時，不與其他優惠併用',
    },
  },
  vivipark: {
    label: 'ViVi PARK', cls: 'badge-vivi', sourceUrl: 'https://vivi-park.com/Activity_Detail.aspx?News_ID=173',
    redeem: {
      type: 'appbind', prep: '先在 ViVi PARK App 綁定「停車專用」折抵信用卡',
      steps: ['App「我的 → 設定」新增停車專用折抵信用卡', '進出場自動折抵'],
      banks: '國泰世華、中信、星展、聯邦、一銀、彰銀、兆豐、華南、上海、合庫、台中銀（11 家）',
      note: '綁定前請先向發卡行確認你的卡是否符合折抵資格',
    },
  },
  parkinsys: {
    label: '銓營', cls: 'badge-pks', sourceUrl: 'https://www.parkinsys.com.tw/product.php?id=1&md=1',
    redeem: {
      type: 'swipe', prep: '帶一張符合資格的實體信用卡',
      steps: ['離場前於自動繳費機或現場人員過卡'],
      banks: null, // 官方僅標示「提供折抵服務」，未公開合作銀行
      note: '官方僅標示「提供折抵服務」，合作銀行與細則未公開',
    },
  },
};
const CITY_ORDER = ['基隆市','台北市','新北市','桃園市','新竹縣市','苗栗縣','台中市','彰化縣','南投縣','雲林縣','嘉義縣市','台南市','高雄市','屏東縣','宜蘭縣','花蓮縣','台東縣','澎湖縣'];
const FAV_KEY = 'parking-favs-v1';
const HOME_KEY = 'parking-home-city-v1';
const BRANDS_KEY = 'parking-brands-v1';
const LIST_PAGE = 60;

// 商業化推廣（分潤導流）。兩檔商品進站時隨機擇一呈現（A/B 測分潤成效）。
// 兩種版型共用同一 modal：飯店＝折扣券 hero＋優惠碼；星巴克＝圖片 hero＋票券價目。
// 埋點一律帶 offer.id，兩檔的曝光／點擊／導流可各自分開統計。
const OFFERS = [
  {
    id: 'klook-hotel-96',
    pill: '全球飯店96折',
    // 床鋪線條圖示；fill:none/stroke:currentColor 沿用全域規則，繼承 pill 綠字、背景透明
    pillIcon: '<svg class="offer-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7v11M3 13h18v5M21 13a5 5 0 0 0-5-5H8a5 5 0 0 0-5 5"/></svg>',
    // 折扣券風格 hero（取代圖片）：品牌／折數／說明三段
    badge: { brand: '🏨 Klook 全球飯店', num: '96', unit: '折', tag: '折抵 4% · 無低消門檻' },
    title: '全球飯店訂房 96 折',
    subtitle: '出國訂房透過 Klook，結帳輸入優惠碼再折 4%，全球飯店皆適用、無低消門檻',
    code: 'HOTEL96202607',
    // 重點資訊列（label／value）；沿用 offer-tier 版型
    facts: [
      { k: '折扣額度', v: '折抵 4%，無低消門檻' },
      { k: '最高折抵', v: 'TWD 1,000' },
      { k: '使用限制', v: '不適用「延後付款」訂單' },
      { k: '領取／使用期限', v: '2026/07/31 23:59 前' },
    ],
    cta: '到 Klook 訂房 ›',
    note: '透過此連結訂房，小P會獲得一點回饋，幫助小Ｐ帶路持續營運 💚　（由 Klook 提供，將開啟外部頁面）',
    url: 'https://vbtrax.com/track/clicks/3731/c627c2bc9b0524d7fa88ec23d62e9e452d6a49c163b2a0f90467b10471401de3c021e7e5593c99616c?t=https%253A%252F%252Fwww.klook.com%252Fzh-TW%252Fpromotion%252Fprogram%252F1374254901%252F',
  },
  {
    id: 'starbucks-klook-egift',
    pill: '星巴克91折',
    // 優惠券線條圖示
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
  },
];
// 進站隨機擇一（每次載入重新抽），供 pill 與 modal 共用
const OFFER = OFFERS[Math.floor(Math.random() * OFFERS.length)];

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
  card: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
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
  // 顯示資料管線最後一次成功建置的時間（builtAt）。builtAt 是 UTC，須以台北時區換算日期，
  // 否則凌晨建置（台北 00:00–08:00）會落在前一天 UTC，顯示成早一天（與 SEO 頁 dataDate 一致）。
  const p = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(data.meta.builtAt))
    .reduce((o, x) => (o[x.type] = x.value, o), {});
  $('#data-date').textContent = `資料更新 ${p.year}/${p.month}/${p.day}`;
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

/* ---------- 信用卡折抵說明（每品牌一段，掛在 BRAND_META.redeem） ---------- */

function redeemBlockHtml(b) {
  const m = BRAND_META[b], r = m.redeem, t = REDEEM_TYPE[r.type];
  const steps = r.steps.map((s) => `<li>${esc(s)}</li>`).join('');
  const banks = r.banks
    ? esc(r.banks)
    : '<span class="rb-none">官方未公開，請以各站現場標示為準</span>';
  const note = r.note ? `<p class="redeem-note">${I.info}<span>${esc(r.note)}</span></p>` : '';
  const prepCls = r.type === 'appbind' ? 'redeem-prep prep-app' : 'redeem-prep';
  return `
  <section class="redeem-block">
    <div class="redeem-bhead"><span class="badge ${m.cls}">${m.label}</span><span class="redeem-tag">${t.tag}</span></div>
    <div class="${prepCls}">${I.card}<span><b>${t.prepLabel}</b>　${esc(r.prep)}</span></div>
    <ol class="redeem-steps">${steps}</ol>
    <div class="redeem-banks"><span class="rb-label">支援銀行</span><span>${banks}</span></div>
    ${note}
    <p class="redeem-disc">${REDEEM_DISCLAIMER}</p>
    <a class="redeem-src" href="${m.sourceUrl}" target="_blank" rel="noopener noreferrer">官方說明${I.ext}</a>
  </section>`;
}

function openRedeemSheet(lot) {
  $('#redeem-body').innerHTML = lot.brands.map(redeemBlockHtml).join('');
  $('#redeem').hidden = false;
  window.goatcounter?.count?.({ path: 'redeem-open', event: true });
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
      <button class="redeem-btn" data-act="redeem">${I.card}<span>如何用信用卡折抵？</span>${I.chev}</button>
      <div class="detail-meta">來源：${lot.brands.map((b) => BRAND_META[b].label).join('、')}官方名單 · 以現場標示為準</div>
    </div>` : '';
  const selCls = !inSheet && lot.id === state.selectedId ? ' card-selected' : '';
  return `
  <article class="card${selCls}" data-id="${lot.id}" ${fav ? 'data-fav="1"' : ''}>
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

// 桌機（split-view）分流：寬螢幕且非觸控才進桌機版；觸控平板一律走手機 UI
const DESKTOP_MQ = window.matchMedia('(min-width: 1024px) and (pointer: fine)');
const isDesktop = () => DESKTOP_MQ.matches;

// 深連結：從網址參數還原篩選／選取（供 SEO 落地頁導流與分享回訪）
function parseUrlState() {
  const p = new URLSearchParams(location.search);
  const city = p.get('city');
  if (city && CITY_ORDER.includes(city)) state.city = city;
  const district = p.get('district');
  if (district) state.district = district;
  const brand = p.get('brand');
  if (brand) {
    const all = ALL_BRANDS();
    const wanted = brand.split(',').map((s) => s.trim()).filter((b) => all.includes(b));
    if (wanted.length) state.brands = wanted.length >= all.length ? null : wanted;
  }
  // lot 先暫存，待 marker 就緒後再 selectLot（觸發飛入＋詳情，避免 toggle 掉）
  const lot = p.get('lot');
  if (lot) state._pendingLot = lot;
  return { hadCity: !!(city && CITY_ORDER.includes(city)) };
}

// 操作後把當前狀態寫回網址（replaceState，可分享、可回訪）
let _lastUrl = '';
function syncUrl() {
  const p = new URLSearchParams();
  if (state.city) p.set('city', state.city);
  if (state.district) p.set('district', state.district);
  if (state.brands && state.brands.length) p.set('brand', state.brands.join(','));
  if (state.selectedId) p.set('lot', state.selectedId);
  const qs = p.toString();
  const url = location.pathname + (qs ? '?' + qs : '');
  if (url === _lastUrl) return;
  _lastUrl = url;
  history.replaceState(null, '', url);
}

function render() {
  if (isDesktop()) renderDesktop();
  else renderMobile();
  syncUrl();
}

// 手機版 render：維持原有分頁式行為
function renderMobile() {
  renderStatus();
  if (state.tab === 'list') renderList();
  if (state.tab === 'fav') renderFavs();
  if (state.tab === 'map') { renderMarkers(); renderSheet(); }
}

// 桌機版 render：地圖恆顯，左欄依分段顯示清單或常用（詳情 sheet 於 Phase 2 移入左欄）
function renderDesktop() {
  renderStatus();
  renderMarkers();
  if (state.tab === 'fav') renderFavs();
  else renderList();
  renderSheet();
}

/* ---------- map ---------- */

function initMap() {
  if (map) return;
  map = L.map('map', { zoomControl: false }).setView([23.7, 121], 8);
  // 桌機顯示縮放按鈕（手機靠雙指縮放，以 CSS 隱藏）；滾輪縮放為 Leaflet 預設
  L.control.zoom({ position: 'topright' }).addTo(map);
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
  const PIN_CLS = { utg: 'pin-utg', carmochi: 'pin-cm', dodohome: 'pin-dodo', tps: 'pin-tps', vivipark: 'pin-vivi', parkinsys: 'pin-pks' };
  const primary = ['utg', 'carmochi', 'dodohome', 'tps', 'vivipark', 'parkinsys'].find((b) => lot.brands.includes(b)) || 'utg';
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
  // 桌機：清單與地圖雙向連動——高亮對應卡片、地圖飛入該場站
  if (isDesktop()) {
    highlightListCard(id);
    if (id) flyToLot(id);
  }
  renderSheet();
  syncUrl();
}

// 桌機：把清單中對應卡片高亮並捲入視野（詳情覆蓋清單時仍先就位，返回即見）
function highlightListCard(id) {
  document.querySelectorAll('.card.card-selected').forEach((c) => c.classList.remove('card-selected'));
  if (!id) return;
  const card = document.querySelector(`#list .card[data-id="${id}"], #fav-list .card[data-id="${id}"]`);
  if (card) {
    card.classList.add('card-selected');
    card.scrollIntoView({ block: 'nearest' });
  }
}

// 桌機：地圖飛到場站；若在叢集內先展開再置中
function flyToLot(id) {
  if (!map) return;
  const lot = state.lots.find((l) => l.id === id);
  if (!lot || lot.lat == null) return;
  const m = markers.get(id);
  if (m && typeof cluster.zoomToShowLayer === 'function') {
    cluster.zoomToShowLayer(m, () => map.panTo([lot.lat, lot.lng], { animate: true }));
  } else {
    map.flyTo([lot.lat, lot.lng], Math.max(map.getZoom(), 15), { duration: 0.4 });
  }
}

// 詳情呈現：手機走底部 sheet、桌機走左欄面板
function renderSheet() {
  if (isDesktop()) renderDetailPanel();
  else renderMobileSheet();
}

function renderMobileSheet() {
  const sheet = $('#sheet');
  const lot = state.lots.find((l) => l.id === state.selectedId);
  if (!lot) { sheet.hidden = true; sheet.style.transform = ''; return; }
  const withD = { ...lot, dist: state.loc && lot.lat ? haversine(state.loc, lot) : null };
  $('#sheet-body').innerHTML = cardHtml(withD, { inSheet: true });
  sheet.hidden = false;
}

// 桌機詳情：覆蓋左欄清單，關閉回清單（清單留在 DOM，捲動位置自然保留）
function renderDetailPanel() {
  const panel = $('#detail-panel');
  const lot = state.lots.find((l) => l.id === state.selectedId) ?? state.favs.find((f) => f.id === state.selectedId);
  if (!lot) { panel.hidden = true; $('#detail-panel-body').innerHTML = ''; return; }
  const withD = { ...lot, dist: state.loc && lot.lat ? haversine(state.loc, lot) : null };
  $('#detail-panel-body').innerHTML = cardHtml(withD, { inSheet: true });
  panel.hidden = false;
  panel.scrollTop = 0;
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
  } else if (act === 'redeem') {
    openRedeemSheet(lot);
  } else if (act === 'expand') {
    // 詳情視圖（sheet／左欄面板）內的卡片本身即為展開態，點內文不再切換
    if (e.target.closest('#sheet-body, #detail-panel-body')) return;
    // 桌機：點清單卡片＝選取（飛入地圖＋開左欄詳情），取代手風琴展開
    if (isDesktop()) { selectLot(id); return; }
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
  chip.setAttribute('aria-label', `${OFFER.pill}優惠`);
  window.goatcounter?.count?.({ path: `offer-pill-view-${OFFER.id}`, event: true });

  // 通用欄位
  $('#offer-title').textContent = OFFER.title;
  $('#offer-sub').textContent = OFFER.subtitle;
  $('#offer-note').textContent = OFFER.note;

  // Hero：圖片型（星巴克）或折扣券型（飯店），依 offer 欄位擇一顯示
  const imgHero = $('#offer-hero-img');
  const badgeHero = $('#offer-badge');
  if (OFFER.image) {
    imgHero.hidden = false; badgeHero.hidden = true;
    $('#offer-img').src = OFFER.image;
  } else {
    badgeHero.hidden = false; imgHero.hidden = true;
    $('#offer-badge-brand').textContent = OFFER.badge.brand;
    $('#offer-badge-num').innerHTML = `${esc(OFFER.badge.num)}<small>${esc(OFFER.badge.unit)}</small>`;
    $('#offer-badge-tag').textContent = OFFER.badge.tag;
  }

  // 內容列：折抵型顯示 label／value 資訊列並附優惠碼；票券型顯示價目表
  const codeBox = $('#offer-code');
  if (OFFER.facts) {
    $('#offer-tiers').innerHTML = OFFER.facts.map((f) => `
      <div class="offer-tier">
        <span class="t-name">${esc(f.k)}</span>
        <span class="t-val">${esc(f.v)}</span>
      </div>`).join('');
  } else {
    $('#offer-tiers').innerHTML = OFFER.tiers.map((t) => `
      <div class="offer-tier">
        <span class="t-name">${esc(t.name)}</span>
        <span class="t-price">NT$${t.price}</span>
        <span class="t-save">省 $${t.save}</span>
      </div>`).join('');
  }

  const cta = $('#offer-cta');
  cta.textContent = OFFER.cta;
  cta.href = OFFER.url;

  // 優惠碼區塊：僅折抵型有碼，顯示並綁定一鍵複製；成功後短暫顯示「已複製」並埋點
  if (OFFER.code) {
    codeBox.hidden = false;
    $('#offer-code-val').textContent = OFFER.code;
    const copyBtn = $('#offer-code-copy');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(OFFER.code);
      } catch {
        const r = document.createRange(); r.selectNode($('#offer-code-val'));
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        try { document.execCommand('copy'); } catch {}
        sel.removeAllRanges();
      }
      copyBtn.textContent = '已複製';
      copyBtn.classList.add('copied');
      window.goatcounter?.count?.({ path: `offer-code-copy-${OFFER.id}`, event: true });
      setTimeout(() => { copyBtn.textContent = '複製'; copyBtn.classList.remove('copied'); }, 1600);
    });
  } else {
    codeBox.hidden = true;
  }

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
  if (isDesktop()) {
    // 桌機：地圖恆顯，左欄依分段顯示清單或常用（tab==='map' 視為清單）
    const showFav = tab === 'fav';
    $('#view-map').hidden = false;
    $('#view-list').hidden = showFav;
    $('#view-fav').hidden = !showFav;
    document.querySelectorAll('.panel-tab').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.tab === 'fav') === showFav)));
    initMap();
    setTimeout(() => map.invalidateSize(), 50);
  } else {
    $('#view-map').hidden = tab !== 'map';
    $('#view-list').hidden = tab !== 'list';
    $('#view-fav').hidden = tab !== 'fav';
    if (tab === 'map') {
      initMap();
      setTimeout(() => map.invalidateSize(), 50);
    }
  }
  $('#page-title').textContent = '小Ｐ帶路';
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

  // 深連結：資料就緒後即套用網址參數，覆蓋 localStorage 預設
  const { hadCity } = parseUrlState();

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
  $('#detail-panel-body').addEventListener('click', onCardAction);
  $('#detail-back').addEventListener('click', () => selectLot(null));
  $('#locate-btn').addEventListener('click', () => {
    // 已有位置就立即置中，不必等 GPS 重新回應；同時在背景刷新
    if (state.loc && map) map.setView([state.loc.lat, state.loc.lng], 16);
    requestLocation(!state.loc);
  });
  $('#status-row').addEventListener('click', (e) => {
    if (e.target.closest('#loc-retry')) requestLocation(state.tab === 'map');
  });
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  document.querySelectorAll('.panel-tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  // 跨桌機／手機斷點時重套當前分頁的顯示規則並重算地圖尺寸（完整狀態保留於 Phase 4）
  DESKTOP_MQ.addEventListener('change', () => switchTab(state.tab));
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
  const redeem = $('#redeem');
  $('#redeem-close').addEventListener('click', () => { redeem.hidden = true; });
  redeem.addEventListener('click', (e) => { if (e.target === redeem) redeem.hidden = true; });
  enableSwipeClose(redeem.querySelector('.modal-sheet'), () => { redeem.hidden = true; });
  enableSwipeClose($('#picker .picker-sheet'), () => $('#picker').click());
  enableSwipeClose($('#brand-picker .picker-sheet'), () => { $('#brand-picker').hidden = true; });

  switchTab('map');
  setupDesktopHint();

  // Esc：先關最上層蓋板，其次收起詳情（桌機鍵盤操作慣例）
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const overlays = ['#brand-picker', '#picker', '#offer', '#loc-help', '#report', '#share', '#settings'];
    for (const sel of overlays) {
      const el = $(sel);
      if (el && !el.hidden) { el.hidden = true; return; }
    }
    if (state.selectedId) selectLot(null);
  });

  // 深連結帶 lot：marker 就緒後選取（飛入地圖＋開詳情）
  if (state._pendingLot) {
    const pending = state._pendingLot;
    state._pendingLot = null;
    if (state.lots.some((l) => l.id === pending)) selectLot(pending);
  }

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

  // 首次使用：先選所在縣市，之後每次開啟預設顯示該地區（網址已帶 city 時略過）
  if (localStorage.getItem(HOME_KEY) === null && !hadCity) openPicker(true);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js');
  }
}

main();

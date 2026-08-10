// 產生「給搜尋引擎看的」靜態落地頁（階段一 SEO）。
// 讀 data/parking-lots.json，輸出到 web/ 底下：
//   web/parking/index.html                 總覽（全台）
//   web/parking/{縣市}/index.html           縣市頁（各行政區索引＋品牌分布＋FAQ）
//   web/parking/{縣市}/{行政區}.html         行政區頁（該區完整場站清單，長尾主力）
//   web/parking/brand/{品牌key}.html         品牌頁（該品牌場站，依縣市分組）
//   web/sitemap.xml                          給 Google Search Console 提交
//   web/robots.txt
//
// 設計原則：
//   - 純靜態、零 JS 依賴、樣式內嵌 → 爬蟲直接讀得到內容、載入快、與 App 本體解耦。
//   - 每頁有真實文字內容（場站名／地址／品牌／車位）＋麵包屑＋內部連結＋schema.org 結構化資料。
//   - 城市頁與行政區頁內容分工，避免近似重複：城市頁做索引、行政區頁放完整清單。
//   - 所有導回 App 的 CTA 帶 ?ref=seo，GoatCounter 可歸因「SEO→App」。
//   - 不動 App 核心；本檔只「新增檔案」。

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const OUT = join(WEB, 'parking');
const SITE = 'https://park-park-go.com';

const BRAND_META = {
  utg: { label: '台灣聯通', bg: '#e6f1fb', text: '#0c447c', desc: '台灣聯通是全台據點最多的停車場品牌之一，多處據點配合信用卡消費免費停車優惠。' },
  carmochi: { label: '車麻吉', bg: '#faeeda', text: '#633806', desc: '車麻吉整合多家都會區停車場，提供綁定信用卡的免費／折抵停車服務。' },
  dodohome: { label: '嘟嘟房', bg: '#fbe6ef', text: '#7a1f47', desc: '嘟嘟房（東京都嘟嘟房）在雙北、台中等地有大量據點配合信用卡優免停車。' },
  tps: { label: '24TPS', bg: '#ece8fa', text: '#362a6e', desc: '24TPS 永固停車場多處據點適用信用卡優惠停車服務。' },
  vivipark: { label: 'ViVi PARK', bg: '#e0f4f8', text: '#07505f', desc: 'ViVi PARK 於全台各地經營停車場，可透過綁定 App 的信用卡享折抵停車。' },
  parkinsys: { label: '銓營', bg: '#f8e8e2', text: '#6e2a17', desc: '銓營（詮營）經營之部分停車場提供信用卡折抵停車。' },
};

// ---------- 工具 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = (s) => encodeURIComponent(s);
const toHalf = (s) => String(s ?? '').replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));

// 從地址重新推導行政區。上游資料集有數百筆 district 被填成「縣市名」（如台北市）而非真正的行政區，
// 但地址裡有正確資訊。這裡以地址為準，與 build-dataset.mjs 的 districtOf 同邏輯：
// 1. 先剝掉開頭縣市前綴（含髒資料「高雄區苓雅區…」的「高雄區」）——僅在剝完後仍以行政區開頭時才剝，
//    以免吃掉「南投市／斗六市」等本身就是行政區的縣轄市。
// 2. 直轄市／市的行政區一律以「區」結尾，故先抓第一個「區」：「前鎮區／新市區」不會被截成「前鎮／新市」，
//    「中山區市民大道／大甲區鎮政路」也不會被貪婪多吃成「中山區市／大甲區鎮」。找不到區才退回鄉／鎮／市。
const CITY_NAME_SEO = '台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|連江';
function realDistrict(l) {
  let a = toHalf(l.address || '').replace(/臺/g, '台').trim();
  const stripped = a.replace(new RegExp(`^(?:${CITY_NAME_SEO})[市縣區]`), '');
  if (stripped !== a && /^.{1,3}[區鄉鎮市]/.test(stripped)) a = stripped;
  let d = a.match(/^([一-鿿]{1,3}?區)/)?.[1] ?? a.match(/^([一-鿿]{1,3}?[鄉鎮市])/)?.[1] ?? '';
  if (!d && l.district && l.district !== l.city) d = l.district;
  if (d === l.city) d = ''; // 「等於縣市名」一律視為無效
  return d;
}
// 場站在 Google 地圖的連結：有座標走導航、無座標退化為名稱搜尋（與 App navUrl 邏輯一致）
const mapUrl = (l) => (l.lat != null
  ? `https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}`
  : `https://www.google.com/maps/search/?api=1&query=${enc(l.city + l.name)}`);

const dataDate = (iso) => {
  try {
    const p = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(iso)).reduce((o, x) => (o[x.type] = x.value, o), {});
    return `${p.year}-${p.month}-${p.day}`;
  } catch { return ''; }
};

const brandBadges = (brands) => brands.filter((b) => BRAND_META[b])
  .map((b) => `<span class="badge" style="background:${BRAND_META[b].bg};color:${BRAND_META[b].text}">${BRAND_META[b].label}</span>`).join('');

// ---------- 版型 ----------
const CSS = `
:root{--text:#1a1a18;--text-2:#5f5e5a;--text-3:#8a8983;--border:#e8e6e0;--surface:#fff;--surface-1:#f7f6f3;--accent:#0f6e56;--brand:#1d9e75;--accent-bg:#e1f5ee}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang TC","Noto Sans TC",sans-serif;color:var(--text);line-height:1.65;background:var(--surface)}
.wrap{max-width:760px;margin:0 auto;padding:0 20px 64px}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
header.top{background:var(--accent-bg);border-bottom:1px solid var(--border)}
header.top .wrap{padding-top:16px;padding-bottom:16px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;color:var(--text)}
.brand svg{width:34px;height:34px;flex:none}
nav.crumb{font-size:13px;color:var(--text-2);margin:14px 0 4px}
nav.crumb a{color:var(--text-2)}
h1{font-size:24px;line-height:1.35;margin:10px 0 6px}
h2{font-size:19px;margin:34px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--accent-bg)}
p.lead{color:var(--text-2);margin:8px 0 18px}
.cta{display:inline-block;background:var(--brand);color:#fff;font-weight:700;padding:11px 20px;border-radius:999px;margin:8px 0 4px}
.cta:hover{text-decoration:none;opacity:.92}
.badge{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:6px;margin-right:5px;white-space:nowrap}
ul.grid{list-style:none;padding:0;margin:14px 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
ul.grid a{display:flex;justify-content:space-between;align-items:center;gap:6px;background:var(--surface-1);border:1px solid var(--border);border-radius:10px;padding:10px 12px;color:var(--text)}
ul.grid a:hover{border-color:var(--brand);text-decoration:none}
ul.grid .n{color:var(--text-3);font-size:13px}
ul.lots{list-style:none;padding:0;margin:14px 0}
ul.lots li{border:1px solid var(--border);border-radius:12px;padding:13px 15px;margin-bottom:10px;background:var(--surface)}
ul.lots .name{font-weight:600;font-size:16px}
ul.lots .addr{color:var(--text-2);font-size:14px;margin:3px 0 6px}
ul.lots .meta{color:var(--text-3);font-size:13px;margin-top:6px}
ul.lots ol li{border:0;padding:1px 0;margin:0;background:none;border-radius:0}
ul.lots .go{font-size:14px;font-weight:600}
details{border:1px solid var(--border);border-radius:12px;padding:4px 15px;margin-bottom:10px;background:var(--surface-1)}
details summary{font-weight:600;cursor:pointer;padding:11px 0}
details p{margin:0 0 14px;color:var(--text-2)}
footer{margin-top:40px;padding-top:20px;border-top:1px solid var(--border);color:var(--text-3);font-size:13px}
footer a{color:var(--text-3)}
.note{background:var(--accent-bg);border-radius:12px;padding:12px 16px;font-size:14px;color:var(--text-2);margin:16px 0}
.note.warn{background:#faeeda;color:#854f0b}
.note.warn a{color:#6b3e05;text-decoration:underline}
ul.tips{margin:12px 0 4px;padding-left:22px;color:var(--text-2)}
ul.tips li{margin:5px 0}
.tblwrap{overflow-x:auto;margin:12px 0}
table.tiers{width:100%;border-collapse:collapse;font-size:13px}
table.tiers th,table.tiers td{border:1px solid var(--border);padding:7px 9px;text-align:left;vertical-align:top}
table.tiers th{background:var(--surface-1);font-weight:600;white-space:nowrap}
`;

const LOGO = '<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="24" fill="#E1F5EE"/><rect x="34" y="24" width="15" height="50" rx="7.5" fill="#1D9E75"/><circle cx="55" cy="40" r="21" fill="#1D9E75"/><circle cx="57" cy="38" r="11" fill="#fff"/><circle cx="53" cy="36" r="2.6" fill="#04342C"/><circle cx="61" cy="36" r="2.6" fill="#04342C"/><path d="M52.5 41.5 Q57 46 61.5 41.5" fill="none" stroke="#04342C" stroke-width="2.4" stroke-linecap="round"/><circle cx="41" cy="79" r="7.5" fill="#04342C" stroke="#fff" stroke-width="2.5"/><circle cx="60" cy="79" r="7.5" fill="#04342C" stroke="#fff" stroke-width="2.5"/></svg>';

// depth＝此頁相對 web/ 的目錄深度，用來組回 App 與資產的相對路徑
function page({ title, description, canonical, crumb, h1, lead, body, jsonLd, appHref, ctaHref = appHref, builtAt }) {
  const ld = jsonLd.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n');
  return `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="小Ｐ帶路">
<meta property="og:image" content="${SITE}/icon-512.png">
<meta name="twitter:card" content="summary">
<link rel="icon" href="${SITE}/icon.svg" type="image/svg+xml">
<style>${CSS}</style>
${ld}
</head>
<body>
<header class="top"><div class="wrap">
<a class="brand" href="${appHref}">${LOGO}<span>小Ｐ帶路｜信用卡免費停車</span></a>
</div></header>
<div class="wrap">
<nav class="crumb">${crumb}</nav>
<h1>${esc(h1)}</h1>
<p class="lead">${lead}</p>
<a class="cta" href="${ctaHref}">📍 開啟小Ｐ帶路，地圖找最近的免費停車場</a>
${body}
<footer>
<p>資料整合自台灣聯通、車麻吉、嘟嘟房、24TPS、ViVi PARK、銓營官方名單${builtAt ? `，最後更新 ${builtAt}` : ''}。優惠須符合各發卡銀行條件（多為消費滿額或綁定 App 折抵），並非無條件免費，實際以停車場現場公告與各銀行規定為準。</p>
<p><a href="${appHref}">回小Ｐ帶路首頁</a> · <a href="${SITE}/parking/">全台免費停車場總覽</a></p>
</footer>
</div>
</body>
</html>`;
}

const breadcrumbLd = (items) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
});
// 場站 → schema.org（座標存在才附 geo）
const facilityLd = (l) => {
  const o = { '@type': 'ParkingFacility', name: l.name,
    address: { '@type': 'PostalAddress', addressCountry: 'TW', addressRegion: l.city, streetAddress: l.address || undefined } };
  if (l.lat != null) o.geo = { '@type': 'GeoCoordinates', latitude: l.lat, longitude: l.lng };
  return o;
};
const itemListLd = (lots) => ({
  '@context': 'https://schema.org', '@type': 'ItemList', numberOfItems: lots.length,
  itemListElement: lots.map((l, i) => ({ '@type': 'ListItem', position: i + 1, item: facilityLd(l) })),
});
const faqLd = (qa) => ({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});

const FAQ = [
  ['信用卡免費停車是真的免費嗎？', '這些場站配合信用卡優惠停車，但通常需符合條件（例如當月消費滿額、或以指定 App 綁定信用卡折抵），並非無條件免費。實際優惠內容以各發卡銀行公告與停車場現場標示為準。'],
  ['支援哪些信用卡？', '各停車場品牌配合的銀行不同，常見包含國泰世華、中信、星展、聯邦、玉山等。請以你持有信用卡的權益說明或各停車場公告為準。'],
  ['資料多久更新一次？', '小Ｐ帶路每週自動抓取各停車場品牌官方名單並更新，頁面會顯示最後更新日期。'],
  ['要下載 App 嗎？', '不用。小Ｐ帶路是網頁版（PWA），手機瀏覽器開啟即可用，也能「加入主畫面」像 App 一樣使用、離線查詢。'],
];
const faqHtml = (qa) => '<h2>常見問題</h2>' + qa.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n');

// ---------- 主流程 ----------
const ds = JSON.parse(readFileSync(join(ROOT, 'data', 'parking-lots.json'), 'utf8'));
const lots = ds.lots;
const builtAt = dataDate(ds.meta?.builtAt);

// 每次重建：清掉舊的 parking/ 再產，避免資料變動後殘留孤兒頁
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const write = (rel, html) => { const f = join(WEB, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, html); };

// 分組
const cities = new Map(); // city -> lots
for (const l of lots) {
  if (!cities.has(l.city)) cities.set(l.city, []);
  cities.get(l.city).push(l);
}
const cityOrder = [...cities.entries()].sort((a, b) => b[1].length - a[1].length).map(([c]) => c);
const brandCounts = {};
for (const l of lots) for (const b of l.brands) brandCounts[b] = (brandCounts[b] || 0) + 1;

const cityUrl = (c) => `${SITE}/parking/${enc(c)}/`;
const distUrl = (c, d) => `${SITE}/parking/${enc(c)}/${enc(d)}.html`;
const brandUrl = (b) => `${SITE}/parking/brand/${b}.html`;
const HUB = `${SITE}/parking/`;
// ref 供 GoatCounter 歸因；extra（city／district／brand）讓 CTA 深連結進已篩選的 App
const APP = (ref, extra = {}) => {
  const p = new URLSearchParams({ ref });
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return `${SITE}/?${p.toString()}`;
};

const sitemap = [];
const addUrl = (loc) => sitemap.push(loc);

// 場站清單 HTML（行政區頁／品牌頁用）
const lotsHtml = (arr) => '<ul class="lots">' + arr.map((l) => `<li>
<div class="name">${esc(l.name)}</div>
<div>${brandBadges(l.brands)}</div>
${l.address ? `<div class="addr">${esc(l.address)}</div>` : '<div class="addr">（地址待確認，建議依名稱在地圖搜尋）</div>'}
<a class="go" href="${mapUrl(l)}" target="_blank" rel="noopener">在 Google 地圖開啟導航 →</a>
${(l.totalSpace || l.maxHeight) ? `<div class="meta">${l.totalSpace ? `車位約 ${l.totalSpace} 格` : ''}${l.totalSpace && l.maxHeight ? '｜' : ''}${l.maxHeight ? `限高 ${l.maxHeight} 公尺` : ''}</div>` : ''}
</li>`).join('\n') + '</ul>';

// ===== 地標周邊停車場（POI 叢集）：先算「有足夠場站」的地標，供 hub 內鏈與下方生頁 =====
const distM = (a, b, c, d) => {
  const R = 6371000, rad = (x) => x * Math.PI / 180;
  const s = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const fmtDist = (m) => (m < 1000 ? `約 ${Math.round(m / 10) * 10} 公尺` : `約 ${(m / 1000).toFixed(1)} 公里`);
const POI_RADIUS = 1500, POI_MIN = 4, POI_CAP = 20;
// 座標為各地標概略中心點；city 需與資料集縣市名一致（供 ?city= 深連結）。
const POIS = [
  // Tier 1
  { name: '台北101', city: '台北市', lat: 25.0340, lng: 121.5645 },
  { name: '台北車站', city: '台北市', lat: 25.0478, lng: 121.5170 },
  { name: '西門町', city: '台北市', lat: 25.0421, lng: 121.5075 },
  { name: '內湖科技園區', city: '台北市', lat: 25.0797, lng: 121.5745 },
  { name: '南港展覽館', city: '台北市', lat: 25.0557, lng: 121.6176 },
  { name: '台中歌劇院', city: '台中市', lat: 24.1626, lng: 120.6403 },
  { name: '勤美誠品', city: '台中市', lat: 24.1519, lng: 120.6647 },
  { name: '板橋大遠百', city: '新北市', lat: 25.0138, lng: 121.4637 },
  { name: '駁二', city: '高雄市', lat: 22.6205, lng: 120.2820 },
  // Tier 2
  { name: '六合夜市', city: '高雄市', lat: 22.6320, lng: 120.3016 },
  { name: '瑞豐夜市', city: '高雄市', lat: 22.6668, lng: 120.3060 },
  { name: '饒河夜市', city: '台北市', lat: 25.0510, lng: 121.5776 },
  { name: '逢甲夜市', city: '台中市', lat: 24.1786, lng: 120.6465 },
  { name: '一中街', city: '台中市', lat: 24.1495, lng: 120.6844 },
  { name: '中壢SOGO', city: '桃園市', lat: 24.9530, lng: 121.2255 },
  { name: '台北東區', city: '台北市', lat: 25.0417, lng: 121.5436 },
  { name: '台中車站', city: '台中市', lat: 24.1369, lng: 120.6857 },
  { name: '北投', city: '台北市', lat: 25.1321, lng: 121.4986 },
  { name: '大安森林公園', city: '台北市', lat: 25.0296, lng: 121.5350 },
  // Tier 3 觀光地標（低競爭縣市，GSC 數據顯示小城市/觀光區最先排上；只取「有場站的具體地標」，
  // 避免整城型與行政區頁自我競爭；city 用資料集正式縣市名以利 ?city= 深連結）
  { name: '嘉義文化路夜市', city: '嘉義縣市', lat: 23.4790, lng: 120.4490 },
  { name: '台東鐵花村', city: '台東縣', lat: 22.7560, lng: 121.1440 },
  { name: '台南神農街', city: '台南市', lat: 22.9970, lng: 120.1970 },
  { name: '安平老街', city: '台南市', lat: 23.0010, lng: 120.1610 },
  { name: '羅東夜市', city: '宜蘭縣', lat: 24.6759, lng: 121.7695 },
  { name: '淡水老街', city: '新北市', lat: 25.1697, lng: 121.4392 },
  { name: '花蓮東大門夜市', city: '花蓮縣', lat: 23.9760, lng: 121.6060 },
];
const geoLots = lots.filter((l) => l.lat != null);
const poiData = POIS.map((poi) => {
  const near = geoLots.map((l) => ({ l, m: distM(poi.lat, poi.lng, l.lat, l.lng) }))
    .filter((x) => x.m <= POI_RADIUS).sort((a, b) => a.m - b.m);
  return { ...poi, near };
}).filter((p) => p.near.length >= POI_MIN); // 場站太少的地標不生頁（避免薄頁）
const nearUrl = (name) => `${SITE}/parking/near/${enc(name)}.html`;

// 銀行 × 停車頁。配合品牌與明細均以各銀行官方停車優惠頁核實。
const BANK_VERIFIED = '2026-08-07'; // 人工查證日期（顯示於頁面，供使用者判斷時效）
const bankUrl = (b) => `${SITE}/parking/bank/${enc(b)}.html`;
const BANK_BRANDS = {
  台新: ['utg', 'carmochi', 'dodohome', 'tps'],
  中信: ['utg', 'carmochi', 'dodohome', 'tps', 'parkinsys'],
  國泰世華: ['utg', 'dodohome', 'tps', 'vivipark', 'parkinsys'],
  玉山: ['utg', 'dodohome', 'tps'],
  富邦: ['utg', 'dodohome'],
};
const BANK_OFFICIAL = {
  台新: 'https://www.taishinbank.com.tw/TSB/personal/credit/intro/rights/parking/right0301/',
  中信: 'https://www.ctbcbank.com/twrbo/zh_tw/cc_index/cc_additional/cc_add_index/cc_add_urbanpark.html',
  國泰世華: 'https://www.cathay-cube.com.tw/cathaybk/personal/event/overview/credit-card/bonus/product/parkingfee',
  玉山: 'https://www.esunbank.com/zh-tw/personal/credit-card/benefit/parking-discount',
  富邦: 'https://www.fubon.com/banking/Personal/credit_card/local_parking/local_parking.htm',
};
// 各銀行明細（整理自上方官方頁，2026-08-07 查證）。tiers＝卡別×門檻×免費時數×適用品牌。
const BANK_DATA = {
  台新: {
    intro: '台新依卡別而定，最低「任刷一筆」、一般卡「當期帳單滿 NT$12,000」即可享免費停車。',
    tiers: [
      { card: '環球無限卡', threshold: '任刷一筆', free: '每日 4 小時（每期上限 80 小時）', brands: '台灣聯通·車麻吉·嘟嘟房·24TPS' },
      { card: '卓富無限卡', threshold: '任刷一筆', free: '每日 4 小時（每期 60 小時）', brands: '台灣聯通·車麻吉·嘟嘟房·24TPS' },
      { card: '昇恆昌／Mercedes-Benz 無限卡', threshold: '任刷一筆', free: '每日 4 小時（每期 40 小時）', brands: '台灣聯通·車麻吉·嘟嘟房·24TPS' },
      { card: '新光三越無限卡', threshold: '當期滿 12,000', free: '每日 3 小時（每期 40 小時）', brands: '台灣聯通·車麻吉' },
      { card: '財富／尊爵／國泰航空等世界卡', threshold: '當期滿 12,000', free: '每日 2 小時（每期 40 小時）', brands: '台灣聯通·車麻吉' },
      { card: '御璽／鈦金／白金／金／普卡', threshold: '當期滿 12,000', free: '每日 2 小時（每期 10 小時）', brands: '台灣聯通' },
    ],
    method: '出場時以實體信用卡於自動繳費機過卡感應；車麻吉須先在 App 綁卡並開「自動折抵」（新增車牌後隔日中午生效）。',
    notes: ['每卡每日限 1 次，正附卡分開計算', '限汽車，不含機車與 eTag', '不適用行動支付（Apple／Google Pay），須用實體卡', '學費、代繳、eTag 儲值、年費等不計入消費門檻'],
  },
  中信: {
    intro: '中信達標門檻擇一：前 1 個月新增消費滿 NT$20,000（或前 3 個月 10 萬、前 12 個月 60 萬），次月起享優惠；約 900 個指定場站。',
    tiers: [
      { card: '一般指定卡（鼎極卡／商務卡等）', threshold: '前 1 月滿 20,000（或前 3 月 10 萬／前 12 月 60 萬）', free: '每日 1 次、每次 2 小時（每月 10 次）', brands: '台灣聯通·車麻吉·嘟嘟房·24TPS·詮營' },
      { card: 'LEXUS 商務世界卡', threshold: '同上', free: '台灣聯通每日 4 小時（每月無上限）；其他場 2 小時（月 10 次）', brands: '台灣聯通·車麻吉·嘟嘟房·24TPS·詮營' },
      { card: '華航鼎尊／ANA 無限／LEXUS（加碼）', threshold: '前 1 月滿 50,000', free: '加碼 5 次（共 15 次）', brands: '同上' },
    ],
    method: '出場以實體卡於自動繳費機或現場人員過卡；或用車麻吉 App 綁卡結帳。',
    notes: ['不適用行動支付、eTag', '限四輪車，機車不適用', '每日限一家停車場', '正附卡合併計次；持多張本行卡以最高等級為準'],
  },
  國泰世華: {
    intro: '國泰世華採「小樹點(信用卡)」折抵，非消費滿額型：一般卡 33／35 點折抵 1 小時、每日最高 3 小時。',
    tiers: [
      { card: '一般信用卡', threshold: '以小樹點折抵', free: '33 點／1 小時', brands: '24TPS·詮營·ViVi PARK' },
      { card: '一般信用卡', threshold: '以小樹點折抵', free: '35 點／1 小時', brands: '嘟嘟房·台灣聯通' },
      { card: '世界卡（亞洲萬里通世界卡除外）', threshold: '以小樹點折抵', free: '20 點／1 小時', brands: '嘟嘟房·台灣聯通' },
    ],
    method: '限實體信用卡於繳費機過卡折抵（以小樹點扣點）。',
    notes: ['每人每日 1 次、每日最高 3 小時', '限實體卡，不適用行動支付與第三方支付', '已申辦 eTag 智慧停車者不適用', '機車計次不適用'],
  },
  玉山: {
    intro: '玉山有兩種：當月新增消費滿 NT$5,000 享每日 1 次 2 小時免費；或以玉山 e-Points 每 40 點折抵 1 小時（每次最高 3 小時）。',
    tiers: [
      { card: '消費滿額（世界卡／無限卡／商務卡等）', threshold: '當月新增滿 5,000', free: '每日 1 次、每次 2 小時', brands: '嘟嘟房·台灣聯通·24TPS' },
      { card: '紅利折抵（e-Points）', threshold: '以點數折抵', free: '40 點／1 小時（每次最高 3 小時）', brands: '嘟嘟房·24TPS' },
    ],
    method: '離場前於繳費機或票亭以實體卡過卡。',
    notes: ['適用卡別與會員資格依玉山公告', '部分聯名卡另有賣場免費停車'],
  },
  富邦: {
    intro: '台北富邦以紅利點數或哩程折抵：多數卡 1,200 點／小時、部分商務卡 175 哩／小時。',
    tiers: [
      { card: '尊御世界卡', threshold: '滿 10,000（智富／恆富）或 20,000', free: '每日最高 3 小時（1,200 點／時）', brands: '嘟嘟房·台灣聯通' },
      { card: '世界卡／無限卡', threshold: '滿 20,000', free: '每日最高 2 小時（1,200 點／時）', brands: '嘟嘟房·台灣聯通' },
      { card: '鈦金／富利生活鈦金／采盟等', threshold: '無特定門檻', free: '每日最高 1 小時（1,200 點／時）', brands: '嘟嘟房·台灣聯通' },
      { card: '商務卡／a miles 航空白金', threshold: '無門檻', free: '每日最高 3 小時（175 哩／時）', brands: '嘟嘟房·台灣聯通' },
    ],
    method: '實體卡於繳費機過卡，以富邦紅利點數（1,200 點／時）或哩程（175 哩／時）折抵。',
    notes: ['每日限 1 次、限一家停車場、每期上限 10 次', '不足 1 小時以 1 小時計', '限實體卡'],
  },
};

// 區域（開車族看大範圍；離島僅澎湖 1 站，併入南部、不單獨開頁）。city 名須與資料集一致。
const REGIONS = {
  北部: ['基隆市', '台北市', '新北市', '桃園市', '新竹縣市', '宜蘭縣'],
  中部: ['苗栗縣', '台中市', '彰化縣', '南投縣', '雲林縣'],
  南部: ['嘉義縣市', '台南市', '高雄市', '屏東縣', '澎湖縣'],
  東部: ['花蓮縣', '台東縣'],
};
const regionUrl = (r) => `${SITE}/parking/region/${enc(r)}.html`;
// 反查：某品牌由哪些（已收錄）銀行涵蓋，供「辦哪張卡」建議
const BRAND_TO_BANKS = {};
for (const [bk, bks] of Object.entries(BANK_BRANDS)) for (const b of bks) (BRAND_TO_BANKS[b] = BRAND_TO_BANKS[b] || []).push(bk);
// 各卡的門檻／時數摘要（給推薦用；ease 越大＝越好達標，覆蓋度相同時排前面）
const BANK_REC = {
  台新: { thr: '當期帳單滿 NT$12,000（環球等無限卡可任刷一筆）', free: '每日 2–4 小時（依卡別）', ease: 2 },
  中信: { thr: '前 1 個月新增消費滿 NT$20,000', free: '每日 2 小時、每月 10 次', ease: 1 },
  國泰世華: { thr: '免消費門檻，以小樹點折抵（一般卡 33／35 點抵 1 小時）', free: '每日最高 3 小時', ease: 4 },
  玉山: { thr: '當月新增消費滿 NT$5,000（或 e-Points 40 點抵 1 小時）', free: '每日 2 小時', ease: 3 },
  富邦: { thr: '多數卡免門檻，以紅利點數／哩程折抵', free: '每日最高 1–3 小時', ease: 3 },
};

// 「在某地區想免費停車，辦哪張卡？」——依該地區「這張卡能用的免停場站數」排序推薦，並標門檻供評估
// （縣市／區域／全台層級用，不做到行政區）
function cardAdviceHtml(areaLots, areaName, appCta) {
  const total = areaLots.length;
  const bc = {};
  for (const l of areaLots) for (const b of l.brands) bc[b] = (bc[b] || 0) + 1;
  const label = (b) => BRAND_META[b].label;
  const distStr = Object.entries(bc).sort((a, b) => b[1] - a[1]).map(([b, n]) => `${label(b)} ${n}`).join('、');
  // 每家：這張卡在這區能用的場站數（站點任一品牌被此卡涵蓋即算）＋此卡在這區實際可用的品牌
  const ranked = Object.keys(BANK_BRANDS).map((bank) => {
    const bset = BANK_BRANDS[bank];
    return {
      bank,
      n: areaLots.filter((l) => l.brands.some((b) => bset.includes(b))).length,
      coveredBrands: bset.filter((b) => bc[b]),
    };
  }).sort((a, b) => b.n - a.n || BANK_REC[b.bank].ease - BANK_REC[a.bank].ease);
  const rows = ranked.map((r, i) => {
    const rec = BANK_REC[r.bank];
    const pct = total ? Math.round((r.n / total) * 100) : 0;
    return `<li>
<div class="name">${i + 1}. ${esc(r.bank)}信用卡 <span class="meta" style="display:inline;margin-left:6px;color:var(--accent);font-weight:600">涵蓋 ${r.n} 站（約 ${pct}%）</span></div>
<div class="addr">在${esc(areaName)}可停：${r.coveredBrands.map(label).join('、')}</div>
<div class="meta"><b>門檻</b>：${esc(rec.thr)}｜${esc(rec.free)}</div>
<a class="go" href="${bankUrl(r.bank)}">看${esc(r.bank)}各卡別完整條件 →</a>
</li>`;
  }).join('\n');
  const exclusive = [];
  if (bc.carmochi) exclusive.push(`車麻吉（${bc.carmochi} 站）只有 <b>台新／中信</b> 能停`);
  if (bc.vivipark) exclusive.push(`ViVi PARK（${bc.vivipark} 站）只有 <b>國泰世華</b> 能停`);
  if (bc.parkinsys) exclusive.push(`詮營（${bc.parkinsys} 站）需 <b>中信／國泰世華</b>`);
  return `
<h2>在${esc(areaName)}想免費停車，該辦哪張卡？</h2>
<div class="note">💳 依這區 <b>${total}</b> 個免停場站的<b>覆蓋度</b>排序如下，門檻一併列出供你評估值不值得辦。這區品牌分布：${esc(distStr)}。</div>
<ul class="lots">${rows}</ul>
${exclusive.length ? `<p>💡 <b>差異關鍵</b>：${exclusive.join('；')}——你住家／常去地點附近若多這些品牌，優先選對應的卡。</p>` : ''}
<p style="margin-top:8px">不確定附近是哪些品牌？先 <a href="${appCta}">開地圖看${esc(areaName)}的免費停車場</a>，確認後再挑卡最準。</p>`;
}

// ===== 1) 總覽 hub =====
{
  const total = lots.length;
  const brandLine = Object.entries(brandCounts).sort((a, b) => b[1] - a[1])
    .map(([b, n]) => `${BRAND_META[b]?.label ?? b}（${n}）`).join('、');
  const body = `
<div class="note">收錄全台 <b>${total}</b> 處配合信用卡優惠的停車場，涵蓋 ${cityOrder.length} 個縣市、${Object.keys(brandCounts).length} 大品牌：${esc(brandLine)}。點縣市查看該區完整名單。</div>
<p style="margin:14px 0"><b>新手先看：</b><a href="guide/">信用卡免費停車完整攻略</a>　·　<a href="credit-card/">六大品牌怎麼折抵</a></p>
<h2>依縣市瀏覽</h2>
<ul class="grid">${cityOrder.map((c) => `<li><a href="${enc(c)}/">${esc(c)}<span class="n">${cities.get(c).length}</span></a></li>`).join('')}</ul>
<h2>依區域瀏覽</h2>
<ul class="grid">${Object.entries(REGIONS).map(([r, cs]) => { const n = cs.filter((c) => cities.has(c)).reduce((s, c) => s + cities.get(c).length, 0); return n ? `<li><a href="region/${enc(r)}.html">${esc(r)}<span class="n">${n}</span></a></li>` : ''; }).join('')}</ul>
<h2>依停車場品牌瀏覽</h2>
<ul class="grid">${Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).map(([b, n]) => `<li><a href="brand/${b}.html">${esc(BRAND_META[b]?.label ?? b)}<span class="n">${n}</span></a></li>`).join('')}</ul>
${poiData.length ? `<h2>熱門地點附近停車</h2>
<ul class="grid">${poiData.map((p) => `<li><a href="near/${enc(p.name)}.html">${esc(p.name)}<span class="n">${p.near.length}</span></a></li>`).join('')}</ul>` : ''}
<h2>依信用卡銀行查</h2>
<ul class="grid">${Object.keys(BANK_BRANDS).map((b) => `<li><a href="bank/${enc(b)}.html">${esc(b)}信用卡停車</a></li>`).join('')}</ul>
${cardAdviceHtml(lots, '全台', APP('cardpick'))}
${faqHtml(FAQ)}`;
  write('parking/index.html', page({
    title: `全台免費停車場地圖｜信用卡優惠 ${total} 處一次查｜小Ｐ帶路`,
    description: `整合台灣聯通、車麻吉、嘟嘟房、ViVi PARK 等 ${total} 處可用信用卡免費／折抵的停車場，依縣市、品牌快速查，開網頁免下載、地圖找離你最近的。`,
    canonical: HUB, appHref: APP('seo'), builtAt,
    crumb: `<a href="${APP('seo')}">小Ｐ帶路</a> › 全台免費停車場`,
    h1: `全台信用卡免費停車場一覽`,
    lead: `一次查遍台灣聯通、車麻吉、嘟嘟房、24TPS、ViVi PARK、銓營配合信用卡優惠的免費停車場，共 ${total} 處。`,
    body,
    jsonLd: [breadcrumbLd([{ name: '小Ｐ帶路', url: APP('seo') }, { name: '全台免費停車場', url: HUB }]), faqLd(FAQ)],
  }));
  addUrl(HUB);
}

// ===== 2) 縣市頁 + 3) 行政區頁 =====
for (const city of cityOrder) {
  const cl = cities.get(city);
  // 依行政區分組
  const dists = new Map();
  for (const l of cl) {
    const d = realDistrict(l);
    if (!dists.has(d)) dists.set(d, []);
    dists.get(d).push(l);
  }
  const distOrder = [...dists.entries()].sort((a, b) => b[1].length - a[1].length);
  const cityBrandCounts = {};
  for (const l of cl) for (const b of l.brands) cityBrandCounts[b] = (cityBrandCounts[b] || 0) + 1;
  const namedDists = distOrder.filter(([d]) => d);

  // --- 縣市頁（索引） ---
  const distGrid = namedDists.length
    ? `<h2>${esc(city)}各行政區</h2><ul class="grid">${namedDists.map(([d, arr]) => `<li><a href="${enc(d)}.html">${esc(d)}<span class="n">${arr.length}</span></a></li>`).join('')}</ul>`
    : '';
  // 無行政區的場站（若有）直接列在城市頁
  const noDist = dists.get('') || [];
  const noDistBlock = noDist.length ? `<h2>其他（未分類行政區）</h2>${lotsHtml(noDist)}` : '';
  const cityBrandLine = Object.entries(cityBrandCounts).sort((a, b) => b[1] - a[1])
    .map(([b, n]) => `${BRAND_META[b]?.label ?? b} ${n} 處`).join('、');
  const cityBody = `
<div class="note">${esc(city)}共有 <b>${cl.length}</b> 處配合信用卡優惠的停車場，分布於 ${namedDists.length} 個行政區。品牌分布：${esc(cityBrandLine)}。</div>
${distGrid}
${noDistBlock}
${cardAdviceHtml(cl, city, APP('cardpick', { city }))}
${faqHtml(FAQ)}`;
  write(`parking/${city}/index.html`, page({
    title: `${city}免費停車場｜信用卡優惠 ${cl.length} 處一次查｜小Ｐ帶路`,
    description: `${city}共 ${cl.length} 處可用信用卡免費／折抵的停車場，涵蓋${namedDists.slice(0, 5).map(([d]) => d).join('、')}等行政區，附地址與一鍵導航，開網頁免下載、查離你最近的免費停車位。`,
    canonical: cityUrl(city), appHref: APP('seo'), ctaHref: APP('seo', { city }), builtAt,
    crumb: `<a href="${APP('seo')}">小Ｐ帶路</a> › <a href="${HUB}">全台</a> › ${esc(city)}`,
    h1: `${city}信用卡免費停車場`,
    lead: `${city}地區台灣聯通、車麻吉、嘟嘟房、ViVi PARK 等配合信用卡免費停車的場站，共 ${cl.length} 處，點行政區看完整清單。`,
    body: cityBody,
    jsonLd: [breadcrumbLd([{ name: '小Ｐ帶路', url: APP('seo') }, { name: '全台', url: HUB }, { name: city, url: cityUrl(city) }])],
  }));
  addUrl(cityUrl(city));

  // --- 行政區頁（完整清單，長尾主力） ---
  for (const [d, arr] of namedDists) {
    const dBrand = {};
    for (const l of arr) for (const b of l.brands) dBrand[b] = (dBrand[b] || 0) + 1;
    const dBrandLine = Object.entries(dBrand).sort((a, b) => b[1] - a[1]).map(([b, n]) => `${BRAND_META[b]?.label ?? b} ${n} 處`).join('、');
    const body = `
<div class="note">${esc(city)}${esc(d)}共有 <b>${arr.length}</b> 處信用卡優惠停車場。${dBrandLine ? `品牌分布：${esc(dBrandLine)}。` : ''}以下為完整清單，點「導航」直接開 Google 地圖。</div>
${lotsHtml(arr)}
<p style="margin-top:24px"><a href="./">← 回${esc(city)}其他行政區</a></p>`;
    write(`parking/${city}/${d}.html`, page({
      title: `${city}${d}免費停車場｜信用卡優惠 ${arr.length} 處一次看｜小Ｐ帶路`,
      description: `${city}${d}可用信用卡免費／折抵的停車場共 ${arr.length} 處，含地址、車位與一鍵導航，找離你最近的免費停車位、免下載。`,
      canonical: distUrl(city, d), appHref: APP('seo'), ctaHref: APP('seo', { city, district: d }), builtAt,
      crumb: `<a href="${APP('seo')}">小Ｐ帶路</a> › <a href="${HUB}">全台</a> › <a href="${cityUrl(city)}">${esc(city)}</a> › ${esc(d)}`,
      h1: `${city}${d}信用卡免費停車場`,
      lead: `${city}${d}配合信用卡優惠的免費停車場，共 ${arr.length} 處，附地址與導航。`,
      body,
      jsonLd: [
        breadcrumbLd([{ name: '小Ｐ帶路', url: APP('seo') }, { name: '全台', url: HUB }, { name: city, url: cityUrl(city) }, { name: d, url: distUrl(city, d) }]),
        itemListLd(arr),
      ],
    }));
    addUrl(distUrl(city, d));
  }
}

// ===== 4) 品牌頁 =====
for (const [brand, meta] of Object.entries(BRAND_META)) {
  const bl = lots.filter((l) => l.brands.includes(brand));
  if (!bl.length) continue;
  const byCity = new Map();
  for (const l of bl) { if (!byCity.has(l.city)) byCity.set(l.city, []); byCity.get(l.city).push(l); }
  const cityBlocks = [...byCity.entries()].sort((a, b) => b[1].length - a[1].length).map(([c, arr]) =>
    `<h2>${esc(c)}（${arr.length} 處）</h2>${lotsHtml(arr)}`).join('\n');
  const body = `
<div class="note">${esc(meta.desc)} 目前收錄 <b>${bl.length}</b> 處配合信用卡優惠的${esc(meta.label)}停車場，分布於 ${byCity.size} 個縣市。</div>
${cityBlocks}`;
  write(`parking/brand/${brand}.html`, page({
    title: `${meta.label}免費停車場一覽｜信用卡優惠 ${bl.length} 處｜小Ｐ帶路`,
    description: `${meta.label}配合信用卡免費／折抵的停車場共 ${bl.length} 處，依縣市分類、附地址與一鍵導航，開網頁免下載查詢。`,
    canonical: brandUrl(brand), appHref: APP('seo'), ctaHref: APP('seo', { brand }), builtAt,
    crumb: `<a href="${APP('seo')}">小Ｐ帶路</a> › <a href="${HUB}">全台</a> › ${esc(meta.label)}`,
    h1: `${meta.label}信用卡免費停車場`,
    lead: `${meta.label}配合信用卡優惠停車的據點，共 ${bl.length} 處，依縣市分類。`,
    body,
    jsonLd: [breadcrumbLd([{ name: '小Ｐ帶路', url: APP('seo') }, { name: '全台', url: HUB }, { name: meta.label, url: brandUrl(brand) }])],
  }));
  addUrl(brandUrl(brand));
}

// ===== 5) 信用卡折抵方式說明頁 =====
{
  // 與 web/app.js 的 BRAND_META.redeem 同步；兩種機制：swipe＝帶實體卡過卡、appbind＝先綁 App 車牌自動折抵。
  const REDEEM = {
    utg: { type: 'swipe', banks: '多家銀行，實際卡別依各發卡行公告', steps: ['離場前於自動繳費機以信用卡過卡', '或交由現場人員過卡確認'] },
    carmochi: { type: 'appbind', banks: '台新、中信、上海、聯邦、兆豐', steps: ['App 綁定信用卡', '開啟「卡友免費停車自動折抵」', '出場時車牌辨識、自動折抵免過卡'], note: '每卡每日折抵 1 次；實際適用場站以車麻吉 App 標示為準' },
    dodohome: { type: 'swipe', banks: '中信、台新、玉山、富邦、一銀、永豐、兆豐等 20+ 家', steps: ['離場前於自動繳費機以信用卡過卡', '或交由現場人員過卡確認'], note: '各家銀行合作場站名單不同，非每站都適用' },
    tps: { type: 'swipe', banks: '多家銀行，實際卡別依各發卡行公告', steps: ['離場前於自動繳費機以信用卡過卡', '或交由現場人員過卡確認'], note: '正卡持卡人每人每日 1 次、每日最高 3 小時，不與其他優惠併用' },
    vivipark: { type: 'appbind', banks: '國泰世華、中信、星展、聯邦、一銀、彰銀、兆豐、華南、上海、合庫、台中銀（11 家）', steps: ['App「我的 → 設定」新增停車專用折抵信用卡', '進出場自動折抵'], note: '綁定前請先向發卡行確認你的卡是否符合折抵資格' },
    parkinsys: { type: 'swipe', banks: null, steps: ['離場前於自動繳費機或現場人員過卡'], note: '官方僅標示「提供折抵服務」，合作銀行與細則未公開' },
  };
  const SRC = {
    utg: 'https://www.taiwan-parking.com.tw/', carmochi: 'https://help.carmochi.com/cityparking/creditcard',
    dodohome: 'https://www.dodohome.com.tw/p3_dodocard.aspx', tps: 'http://www.24tps.com.tw/OtherServiceADV/CreditCardParkList.aspx',
    vivipark: 'https://vivi-park.com/Activity_Detail.aspx?News_ID=173', parkinsys: 'https://www.parkinsys.com.tw/product.php?id=1&md=1',
  };
  const TYPE_LABEL = { swipe: '實體卡過卡折抵', appbind: 'App 綁卡自動折抵' };
  const order = ['utg', 'carmochi', 'dodohome', 'tps', 'vivipark', 'parkinsys'].filter((b) => brandCounts[b]);
  const brandCards = order.map((b) => {
    const r = REDEEM[b], m = BRAND_META[b];
    return `<li>
<div class="name">${brandBadges([b])}${esc(m.label)}<span class="meta" style="display:inline;margin-left:6px">${TYPE_LABEL[r.type]}</span></div>
<ol style="margin:8px 0;padding-left:20px;color:var(--text-2)">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
<div class="meta"><b>支援銀行</b>：${r.banks ? esc(r.banks) : '官方未公開，請以各站現場標示為準'}</div>
${r.note ? `<div class="meta">${esc(r.note)}</div>` : ''}
<a class="go" href="${SRC[b]}" target="_blank" rel="noopener">官方說明 →</a>
</li>`;
  }).join('\n');
  const REDEEM_FAQ = [
    ['信用卡免費停車要先準備什麼？', '分兩種：台灣聯通、嘟嘟房、24TPS、銓營只要帶一張符合資格的實體信用卡，離場前過卡即可；車麻吉、ViVi PARK 則要出發前先在該品牌 App 綁定信用卡，出場才會自動折抵，務必事先綁好。'],
    ['哪些停車場要下載 App 才能折抵？', '車麻吉與 ViVi PARK 屬「App 綁卡自動折抵」，需先在其 App 綁定信用卡並開啟自動折抵；台灣聯通、嘟嘟房、24TPS、銓營以實體卡過卡即可，不必安裝 App。'],
    ['免費停幾小時、幾次？', '免費時數與次數都由發卡銀行依你的卡別與當期消費決定，各家不同。小Ｐ帶路不代表銀行條件，請以各發卡行公告與停車場現場標示為準。'],
    ['銓營支援哪些銀行？', '銓營（詮營）官方僅在場站標示「提供折抵服務」，未公開合作銀行清單與折抵細則，建議以各站現場公告為準。'],
  ];
  const body = `
<div class="note">小Ｐ帶路收錄的停車場，信用卡折抵分成兩種方式。<b>免費時數與次數都由發卡銀行決定</b>（多為當期消費滿額或綁定 App），並非無條件免費，實際以各發卡行公告與現場標示為準。</div>
<h2>兩種折抵方式</h2>
<ul class="lots">
<li><div class="name">A. 實體卡過卡折抵</div><div class="addr">台灣聯通、嘟嘟房、24TPS、銓營</div><div class="meta">帶一張符合資格的實體信用卡，離場前於自動繳費機過卡、或交由現場人員過卡確認即可折抵。<b>免安裝、免事前綁定</b>，記得帶卡就好。</div></li>
<li><div class="name">B. App 綁卡自動折抵</div><div class="addr">車麻吉、ViVi PARK</div><div class="meta"><b>出發前</b>先在該品牌 App 綁定信用卡，出場時車牌辨識自動折抵、免過卡。務必事先綁好卡，並先向發卡行確認你的卡是否符合資格。</div></li>
</ul>
<h2>各品牌折抵方式</h2>
<ul class="lots">${brandCards}</ul>
${faqHtml(REDEEM_FAQ)}`;
  const CCURL = `${SITE}/parking/credit-card/`;
  write('parking/credit-card/index.html', page({
    title: '信用卡免費停車怎麼折抵？六大停車品牌折抵方式一次看｜小Ｐ帶路',
    description: '台灣聯通、車麻吉、嘟嘟房、24TPS、ViVi PARK、銓營的信用卡折抵方式整理：哪些帶卡過卡、哪些要先綁 App、各支援哪些銀行，一次看懂。',
    canonical: CCURL, appHref: APP('seo'), builtAt,
    crumb: `<a href="${APP('seo')}">小Ｐ帶路</a> › <a href="${HUB}">全台</a> › 信用卡折抵方式`,
    h1: '信用卡免費停車怎麼折抵？',
    lead: '六大停車品牌的信用卡折抵方式整理——哪些帶卡過卡、哪些要先綁 App、各支援哪些銀行，出發前先看懂。',
    body,
    jsonLd: [
      breadcrumbLd([{ name: '小Ｐ帶路', url: APP('seo') }, { name: '全台', url: HUB }, { name: '信用卡折抵方式', url: CCURL }]),
      faqLd(REDEEM_FAQ),
    ],
  }));
  addUrl(CCURL);
}

// ===== 6) 支柱頁：信用卡免費停車完整攻略（懶人包，pillar-cluster 樞紐） =====
{
  const GUIDE = `${SITE}/parking/guide/`;
  const CC = `${SITE}/parking/credit-card/`;
  const total = lots.length;
  const brandGrid = Object.entries(brandCounts).sort((a, b) => b[1] - a[1])
    .map(([b, n]) => `<li><a href="${brandUrl(b)}">${esc(BRAND_META[b]?.label ?? b)}<span class="n">${n}</span></a></li>`).join('');
  const cityGrid = cityOrder.map((c) => `<li><a href="${cityUrl(c)}">${esc(c)}<span class="n">${cities.get(c).length}</span></a></li>`).join('');
  const GUIDE_FAQ = [
    ['信用卡免費停車是真的免費嗎？', '是「有條件的免費」，通常需當期消費滿額、或以指定 App 綁定信用卡折抵，並非無條件。實際以各發卡銀行公告與停車場現場標示為準。'],
    ['我需要下載哪個 App 嗎？', '看品牌：車麻吉、ViVi PARK 需先在其 App 綁卡自動折抵；台灣聯通、嘟嘟房、24TPS、銓營帶實體卡過卡即可。查「哪裡有免費停車場」用小Ｐ帶路網頁就好，免下載。'],
    ['小Ｐ帶路和車麻吉 App 差在哪？', '車麻吉只查得到自家場站；小Ｐ帶路把台灣聯通、車麻吉、嘟嘟房、24TPS、ViVi PARK、銓營六大品牌整合成一張地圖，一次看完、還免安裝。'],
    ['支援哪些信用卡？', '各品牌配合的銀行不同，常見有台新、中信、玉山、聯邦、國泰世華等。請以你持卡的權益說明為準，或見各品牌折抵說明。'],
    ['資料多久更新？', '小Ｐ帶路每週自動抓取各品牌官方場站名單更新，頁面會顯示最後更新日期。'],
  ];
  const body = `
<div class="note">開車進市區最痛的兩件事：找不到車位、停車費好貴。其實用對信用卡，全台有 <b>${total}</b> 處停車場可以免費或折抵停車——難處是它們散在六大品牌、各綁不同 App。這篇一次講清楚<b>怎麼免費、哪些場站能用</b>，並教你一鍵查到離你最近的免費停車場。</div>

<h2>信用卡免費停車是什麼？真的免費嗎？</h2>
<p>先講實話：是「<b>有條件的免費</b>」，不是無條件。常見機制是用指定信用卡消費、或把卡綁進停車場 App，達到條件後停車費被折抵或免收。只要用得上，一次省下數十到上百元，一年下來很有感。</p>

<h2>哪些停車場可以用信用卡免費停？（六大品牌）</h2>
<p>目前全台配合信用卡優惠停車的主要有這六大品牌，涵蓋雙北、桃園、台中、台南、高雄等都會區。點品牌看完整場站清單：</p>
<ul class="grid">${brandGrid}</ul>

<h2>兩種優惠型態：滿額型 vs 綁卡折抵型</h2>
<p><b>① 消費滿額型：</b>當期帳單刷滿一定金額（依卡別而定），次期享免費停車時數（常見每次約 2 小時、每日 1 次，每期有上限）。<br>
<b>② 綁卡／綁 App 折抵型：</b>把指定信用卡綁進停車場 App（如車麻吉、ViVi PARK），出場時自動折抵。</p>
<div class="note">各品牌是「帶卡過卡」還是「先綁 App」、支援哪些銀行都不同 👉 <a href="${CC}">看六大品牌信用卡折抵方式</a>（出發前先看，才不會到現場才發現卡沒綁）。</div>

<h2>怎麼找到「離我最近」的免費停車場？</h2>
<p>搞懂規則後，真正麻煩的是：這些場站散在六個品牌、各自的 App，Google 地圖也不會幫你篩「哪些能信用卡免費停」。臨時要停車，總不能開六個 App 一個一個找。</p>
<p>這就是我把六大品牌、全台 ${total} 個信用卡免費停車場整合成<b>一張地圖</b>的原因——「小Ｐ帶路」：📍 定位找最近、🔍 依縣市／品牌篩選、🧭 一鍵導航＋收藏、📱 免下載開網頁就能用。</p>
<a class="cta" href="${APP('seo')}">📍 開啟小Ｐ帶路，查離我最近的免費停車場</a>

<h2>各縣市免費停車場快速查</h2>
<ul class="grid">${cityGrid}</ul>

${faqHtml(GUIDE_FAQ)}`;
  write('parking/guide/index.html', page({
    title: '信用卡免費停車攻略 2026｜六大品牌+全台場站地圖｜小Ｐ帶路',
    description: '信用卡免費停車怎麼用、哪些停車場品牌配合、門檻與時數一次搞懂，還能用地圖查離你最近的免費停車場，免下載開網頁就能用。',
    canonical: GUIDE, appHref: APP('seo'), builtAt,
    crumb: `<a href="${APP('seo')}">小Ｐ帶路</a> › <a href="${HUB}">全台</a> › 信用卡免費停車攻略`,
    h1: '信用卡免費停車完整攻略：六大品牌、怎麼免費、全台場站地圖',
    lead: `用對信用卡，全台 ${total} 處停車場可以免費停。這篇一次搞懂怎麼免費、哪些場站能用，並教你查到離你最近的免費停車場。`,
    body,
    jsonLd: [
      breadcrumbLd([{ name: '小Ｐ帶路', url: APP('seo') }, { name: '全台', url: HUB }, { name: '信用卡免費停車攻略', url: GUIDE }]),
      faqLd(GUIDE_FAQ),
    ],
  }));
  addUrl(GUIDE);
}

// ===== 7) 地標周邊停車場頁（POI 叢集） =====
for (const poi of poiData) {
  const shown = poi.near.slice(0, POI_CAP);
  const deepCta = APP('near', { city: poi.city, lot: shown[0].l.id }); // 送回 App 核心：篩該市＋飛到最近的一站
  const cityFilter = APP('near', { city: poi.city });
  const CC = `${SITE}/parking/credit-card/`;
  const listHtml = '<ul class="lots">' + shown.map(({ l, m }) => `<li>
<div class="name">${esc(l.name)}<span class="meta" style="display:inline;margin-left:8px;color:var(--accent);font-weight:600">${fmtDist(m)}</span></div>
<div>${brandBadges(l.brands)}</div>
${l.address ? `<div class="addr">${esc(l.address)}</div>` : ''}
<a class="go" href="${mapUrl(l)}" target="_blank" rel="noopener">在 Google 地圖開啟導航 →</a>
${(l.totalSpace || l.maxHeight) ? `<div class="meta">${l.totalSpace ? `車位約 ${l.totalSpace} 格` : ''}${l.totalSpace && l.maxHeight ? '｜' : ''}${l.maxHeight ? `限高 ${l.maxHeight} 公尺` : ''}</div>` : ''}
</li>`).join('\n') + '</ul>';
  const POI_FAQ = [
    [`${poi.name}附近這些停車場是免費的嗎？`, '不是無條件免費。它們是配合信用卡優惠的停車場，能否免費或折抵，取決於你持有的信用卡與是否達到發卡銀行門檻（多為當期消費滿額，或需先在該品牌 App 綁卡）。實際以各發卡行公告與現場標示為準。'],
    ['我要怎麼知道我的信用卡適不適用？', '請查你信用卡的權益說明，或參考各品牌的信用卡折抵方式與支援銀行清單。'],
    ['一定要下載 App 嗎？', '查「附近哪裡有」用小Ｐ帶路網頁即可，免下載。折抵部分：車麻吉、ViVi PARK 需先在其 App 綁卡；台灣聯通、嘟嘟房、24TPS、銓營帶實體卡過卡即可。'],
  ];
  const body = `
<div class="note warn">⚠️ <b>提醒</b>：以下是<b>配合信用卡優惠</b>的停車場，<b>並非無條件免費</b>。能不能免費／折抵，取決於你<b>持有的信用卡</b>與是否達到該銀行<b>門檻</b>（多為當期消費滿額，或需先綁定 App）。各品牌怎麼折抵、支援哪些銀行 👉 <a href="${CC}">看信用卡折抵方式</a>。</div>
<div class="note">${esc(poi.name)}周邊約 1.5 公里內，收錄 <b>${poi.near.length}</b> 個配合信用卡優惠的停車場，最近的僅 ${fmtDist(shown[0].m)}。以下依距離排序：</div>
${listHtml}
<h2>在地圖上看 ${esc(poi.name)} 周邊、找離你最近的</h2>
<p>上面是靜態速查清單。打開小Ｐ帶路的地圖，你可以做更多：</p>
<ul class="tips">
<li>📍 <b>開啟定位</b>，自動把離你最近的排在最前面</li>
<li>🧭 <b>一鍵導航</b>直接開到停車場入口</li>
<li>⭐ 把常去的收進「<b>常用</b>」，下次一秒叫出</li>
<li>📱 <b>免下載</b>，可「加入主畫面」像 App 一樣用、離線也能查</li>
</ul>
<p>而且不只 ${esc(poi.name)}——全台 <b>${lots.length}</b> 個信用卡優惠停車場都在同一張地圖，隨走隨查。</p>
<a class="cta" href="${deepCta}">📍 開地圖看 ${esc(poi.name)} 周邊停車場 →</a>
<h2>${esc(poi.city)}其他信用卡免費停車場</h2>
<p>看 <a href="${cityUrl(poi.city)}">${esc(poi.city)}全部信用卡免費停車場</a>，或回 <a href="${HUB}">全台總覽</a>、讀 <a href="${SITE}/parking/guide/">信用卡免費停車攻略</a>。</p>
${faqHtml(POI_FAQ)}`;
  write(`parking/near/${poi.name}.html`, page({
    title: `${poi.name}附近停車場推薦｜信用卡免費／折抵的 ${poi.near.length} 個｜小Ｐ帶路`,
    description: `${poi.name}附近 ${poi.near.length} 個配合信用卡優惠（免費／折抵）的停車場，依距離排序、含地址與導航。注意：須符合各發卡行條件，非無條件免費。`,
    canonical: nearUrl(poi.name), appHref: cityFilter, ctaHref: deepCta, builtAt,
    crumb: `<a href="${cityFilter}">小Ｐ帶路</a> › <a href="${HUB}">全台</a> › <a href="${cityUrl(poi.city)}">${esc(poi.city)}</a> › ${esc(poi.name)}周邊`,
    h1: `${poi.name} 附近的信用卡優惠停車場`,
    lead: `${poi.name}周邊配合信用卡免費／折抵的停車場共 ${poi.near.length} 個，依距離排序。提醒：非無條件免費，須符合你持卡的優惠條件。`,
    body,
    jsonLd: [
      breadcrumbLd([{ name: '小Ｐ帶路', url: cityFilter }, { name: '全台', url: HUB }, { name: poi.city, url: cityUrl(poi.city) }, { name: `${poi.name}周邊`, url: nearUrl(poi.name) }]),
      itemListLd(shown.map((x) => x.l)),
      faqLd(POI_FAQ),
    ],
  }));
  addUrl(nearUrl(poi.name));
}

// ===== 8) 銀行 × 停車頁（配合品牌以各銀行官方頁核實；卡別條件與折抵方式一律導回官方＋折抵頁） =====
for (const [bank, brandKeys] of Object.entries(BANK_BRANDS)) {
  const CC = `${SITE}/parking/credit-card/`;
  const d = BANK_DATA[bank];
  const official = BANK_OFFICIAL[bank];
  const brandNames = brandKeys.map((b) => BRAND_META[b].label).join('、');
  const deepCta = APP('bank', { brand: brandKeys.join(',') });
  const tierRows = d.tiers.map((t) => `<tr><td>${esc(t.card)}</td><td>${esc(t.threshold)}</td><td>${esc(t.free)}</td><td>${esc(t.brands)}</td></tr>`).join('');
  const notesList = d.notes.map((n) => `<li>${esc(n)}</li>`).join('');
  const BANK_FAQ = [
    [`${bank}哪張信用卡可以免費停車？`, `${d.intro}詳細卡別與免費時數見本頁表格；實際以 ${bank} 官方公告為準。`],
    [`用 ${bank} 卡停車要下載 App 嗎？`, `多數帶實體卡於離場前過卡即可；車麻吉等少數品牌需先在其 App 綁卡自動折抵。各品牌操作見信用卡折抵方式。`],
    [`${bank}停車優惠每日幾次、幾小時？`, `多為每日 1 次，免費時數依卡別 1～4 小時不等（見表格），並有每月次數上限；以 ${bank} 官方公告與現場標示為準。`],
  ];
  const body = `
<div class="note warn">⚠️ <b>提醒</b>：${esc(bank)} 的停車優惠<b>並非無條件免費</b>——須符合下表的消費門檻，或以紅利點數／哩程折抵，實際權益依你的卡別與當期條件而定。</div>
<p class="lead" style="margin-top:0">${esc(d.intro)}</p>
<h2>${esc(bank)} 停車優惠一覽（依卡別）</h2>
<div class="tblwrap"><table class="tiers"><thead><tr><th>卡別</th><th>門檻</th><th>免費／折抵</th><th>適用停車場</th></tr></thead><tbody>${tierRows}</tbody></table></div>
<p><b>使用方式：</b>${esc(d.method)}</p>
<h2>注意事項</h2>
<ul class="tips">${notesList}</ul>
<div class="note">📅 本頁資訊整理自 <a href="${official}" target="_blank" rel="noopener">${esc(bank)} 官方停車優惠頁</a>，最後查證 <b>${BANK_VERIFIED}</b>。信用卡優惠與門檻常有變動，實際權益、適用卡別與條件<b>請以 ${esc(bank)} 官方最新公告為準</b>；本頁僅供快速比較參考，請自行斟酌，發現有誤歡迎回報。</div>
<h2>${esc(bank)} 配合的停車場在哪？（地圖）</h2>
<p>用小Ｐ帶路只看 ${esc(bank)} 配合的品牌（${esc(brandNames)}）、地圖找離你最近的；各品牌詳細折抵操作見 👉 <a href="${CC}">信用卡折抵方式</a>。</p>
<a class="cta" href="${deepCta}">📍 開地圖看 ${esc(bank)} 配合的免費停車場 →</a>
${faqHtml(BANK_FAQ)}`;
  write(`parking/bank/${bank}.html`, page({
    title: `${bank}信用卡停車優惠｜可免費／折抵的停車場＋場站地圖｜小Ｐ帶路`,
    description: `${bank}信用卡停車優惠整理：配合 ${brandNames}，各卡別消費門檻與免費時數一次看，再用地圖找離你最近的場站。${BANK_VERIFIED} 查證、非無條件免費。`,
    canonical: bankUrl(bank), appHref: APP('bank'), ctaHref: deepCta, builtAt,
    crumb: `<a href="${APP('bank')}">小Ｐ帶路</a> › <a href="${HUB}">全台</a> › ${esc(bank)}信用卡停車`,
    h1: `${bank}信用卡免費停車：配合哪些停車場、場站在哪？`,
    lead: `用 ${bank} 信用卡可在部分停車場品牌享免費／折抵停車。這裡整理配合的品牌、怎麼折抵，並用地圖帶你找到場站（優惠條件依 ${bank} 公告，非無條件免費）。`,
    body,
    jsonLd: [breadcrumbLd([{ name: '小Ｐ帶路', url: APP('bank') }, { name: '全台', url: HUB }, { name: `${bank}信用卡停車`, url: bankUrl(bank) }]), faqLd(BANK_FAQ)],
  }));
  addUrl(bankUrl(bank));
}

// ===== 9) 區域頁（北/中/南/東；開車族看大範圍。含「辦哪張卡」建議＋縣市索引） =====
for (const [region, citiesInR] of Object.entries(REGIONS)) {
  const rc = citiesInR.filter((c) => cities.has(c));
  const rLots = rc.flatMap((c) => cities.get(c));
  if (!rLots.length) continue;
  const cityGrid = rc.map((c) => `<li><a href="${cityUrl(c)}">${esc(c)}<span class="n">${cities.get(c).length}</span></a></li>`).join('');
  const body = `
<div class="note">${esc(region)}（${rc.join('、')}）共收錄 <b>${rLots.length}</b> 個配合信用卡優惠的免費停車場。</div>
${cardAdviceHtml(rLots, region, APP('cardpick'))}
<h2>${esc(region)}各縣市</h2>
<ul class="grid">${cityGrid}</ul>
${faqHtml(FAQ)}`;
  write(`parking/region/${region}.html`, page({
    title: `${region}信用卡免費停車場｜辦哪張卡＋場站地圖一次看｜小Ｐ帶路`,
    description: `${region}（${rc.join('、')}）信用卡免費停車場整理：品牌分布、該辦哪張信用卡、各縣市場站地圖，共 ${rLots.length} 站。`,
    canonical: regionUrl(region), appHref: APP('seo'), builtAt,
    crumb: `<a href="${APP('seo')}">小Ｐ帶路</a> › <a href="${HUB}">全台</a> › ${esc(region)}`,
    h1: `${region}信用卡免費停車場：辦哪張卡、去哪停`,
    lead: `${region}地區信用卡免費停車場與選卡建議，共 ${rLots.length} 站，涵蓋 ${rc.join('、')}。`,
    body,
    jsonLd: [breadcrumbLd([{ name: '小Ｐ帶路', url: APP('seo') }, { name: '全台', url: HUB }, { name: region, url: regionUrl(region) }])],
  }));
  addUrl(regionUrl(region));
}

// ===== sitemap.xml + robots.txt =====
addUrl(SITE + '/'); // App 首頁（乾淨網址，與 index.html canonical 一致；勿用帶 ?ref 的 CTA 連結）
const lastmod = builtAt || '';
const sm = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemap.map((loc) => `<url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<changefreq>weekly</changefreq></url>`).join('\n')}
</urlset>`;
writeFileSync(join(WEB, 'sitemap.xml'), sm);
writeFileSync(join(WEB, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`SEO 產生完成：${sitemap.length} 頁（hub 1 + 縣市 ${cityOrder.length} + 行政區/品牌…）→ web/parking/、sitemap.xml、robots.txt`);

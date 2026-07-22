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
const SITE = 'https://angelatzh-mvp.github.io/parking-finder';

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

// 從地址重新推導行政區。上游資料集有 488 筆 district 被填成「縣市名」（如台北市）而非真正的行政區，
// 但地址裡有正確資訊。這裡以地址為準（去掉縣市前綴後的第一個 …區/鄉/鎮/市），失敗才退回原 district。
const CITY_PREFIX = /^(台北市|臺北市|新北市|桃園市|台中市|臺中市|台南市|臺南市|高雄市|基隆市|新竹市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|屏東縣|宜蘭縣|花蓮縣|台東縣|臺東縣|澎湖縣|金門縣|連江縣)/;
function realDistrict(l) {
  const a = toHalf(l.address || '').replace(/臺/g, '台').replace(CITY_PREFIX, '');
  const m = a.match(/^([一-鿿]{1,3}?[區鄉鎮市])/); // 非貪婪：停在第一個區/鄉/鎮/市，避免「中山區市民大道」被吃成「中山區市」
  let d = m ? m[1] : '';
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
ul.lots .go{font-size:14px;font-weight:600}
details{border:1px solid var(--border);border-radius:12px;padding:4px 15px;margin-bottom:10px;background:var(--surface-1)}
details summary{font-weight:600;cursor:pointer;padding:11px 0}
details p{margin:0 0 14px;color:var(--text-2)}
footer{margin-top:40px;padding-top:20px;border-top:1px solid var(--border);color:var(--text-3);font-size:13px}
footer a{color:var(--text-3)}
.note{background:var(--accent-bg);border-radius:12px;padding:12px 16px;font-size:14px;color:var(--text-2);margin:16px 0}
`;

const LOGO = '<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="24" fill="#E1F5EE"/><rect x="34" y="24" width="15" height="50" rx="7.5" fill="#1D9E75"/><circle cx="55" cy="40" r="21" fill="#1D9E75"/><circle cx="57" cy="38" r="11" fill="#fff"/><circle cx="53" cy="36" r="2.6" fill="#04342C"/><circle cx="61" cy="36" r="2.6" fill="#04342C"/><path d="M52.5 41.5 Q57 46 61.5 41.5" fill="none" stroke="#04342C" stroke-width="2.4" stroke-linecap="round"/><circle cx="41" cy="79" r="7.5" fill="#04342C" stroke="#fff" stroke-width="2.5"/><circle cx="60" cy="79" r="7.5" fill="#04342C" stroke="#fff" stroke-width="2.5"/></svg>';

// depth＝此頁相對 web/ 的目錄深度，用來組回 App 與資產的相對路徑
function page({ title, description, canonical, crumb, h1, lead, body, jsonLd, appHref, builtAt }) {
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
<a class="cta" href="${appHref}">📍 開啟小Ｐ帶路，地圖找最近的免費停車場</a>
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
const APP = (ref) => `${SITE}/?ref=${ref}`;

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

// ===== 1) 總覽 hub =====
{
  const total = lots.length;
  const brandLine = Object.entries(brandCounts).sort((a, b) => b[1] - a[1])
    .map(([b, n]) => `${BRAND_META[b]?.label ?? b}（${n}）`).join('、');
  const body = `
<div class="note">收錄全台 <b>${total}</b> 處配合信用卡優惠的停車場，涵蓋 ${cityOrder.length} 個縣市、${Object.keys(brandCounts).length} 大品牌：${esc(brandLine)}。點縣市查看該區完整名單。</div>
<h2>依縣市瀏覽</h2>
<ul class="grid">${cityOrder.map((c) => `<li><a href="${enc(c)}/">${esc(c)}<span class="n">${cities.get(c).length}</span></a></li>`).join('')}</ul>
<h2>依停車場品牌瀏覽</h2>
<ul class="grid">${Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).map(([b, n]) => `<li><a href="brand/${b}.html">${esc(BRAND_META[b]?.label ?? b)}<span class="n">${n}</span></a></li>`).join('')}</ul>
${faqHtml(FAQ)}`;
  write('parking/index.html', page({
    title: `全台信用卡免費停車場一覽（${total} 處）｜小Ｐ帶路`,
    description: `整合台灣聯通、車麻吉、嘟嘟房、ViVi PARK 等 ${total} 處信用卡優惠免費停車場，依縣市、品牌快速查詢，地圖找最近據點。`,
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
${faqHtml(FAQ)}`;
  write(`parking/${city}/index.html`, page({
    title: `${city}信用卡免費停車場一覽（${cl.length} 處）｜小Ｐ帶路`,
    description: `${city}共 ${cl.length} 處信用卡優惠免費停車場，涵蓋${namedDists.slice(0, 5).map(([d]) => d).join('、')}等行政區，附地址與導航，找最近的免費停車位。`,
    canonical: cityUrl(city), appHref: APP('seo'), builtAt,
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
      title: `${city}${d}信用卡免費停車場（${arr.length} 處）｜小Ｐ帶路`,
      description: `${city}${d}信用卡優惠免費停車場完整清單，共 ${arr.length} 處，含地址、車位與一鍵導航。`,
      canonical: distUrl(city, d), appHref: APP('seo'), builtAt,
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
    title: `${meta.label}信用卡免費停車場一覽（${bl.length} 處）｜小Ｐ帶路`,
    description: `${meta.label}配合信用卡優惠的免費停車場共 ${bl.length} 處，依縣市分類，含地址與導航。`,
    canonical: brandUrl(brand), appHref: APP('seo'), builtAt,
    crumb: `<a href="${APP('seo')}">小Ｐ帶路</a> › <a href="${HUB}">全台</a> › ${esc(meta.label)}`,
    h1: `${meta.label}信用卡免費停車場`,
    lead: `${meta.label}配合信用卡優惠停車的據點，共 ${bl.length} 處，依縣市分類。`,
    body,
    jsonLd: [breadcrumbLd([{ name: '小Ｐ帶路', url: APP('seo') }, { name: '全台', url: HUB }, { name: meta.label, url: brandUrl(brand) }])],
  }));
  addUrl(brandUrl(brand));
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

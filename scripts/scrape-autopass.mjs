// 從 Autopass 官方場站圖資補「缺地址／缺座標」的場站，產出 data/address-overrides.json。
// build-dataset 會以「縣市|場站名」為 key 套用（不改 id，收藏安全）。
//
// 資料來源：https://api.autopass.xyz/v3/pois?bounding_box=minLng,minLat,maxLng,maxLat
//   ⚠ 此 API 回傳的是「全部」停車場（不只支援清單），且只給「離查詢框中心最近的約 200 筆」，
//     超過就默默丟邊緣點（實測整個台北框有 2928 筆卻只回 183）。collection 過濾參數無效。
//   細節地址在 https://api.autopass.xyz/v3/pois/{id} 的 detail.address。
//
// 省流策略（不再全台硬掃）：只掃「含有待補目標」的縣市，用「內容剪枝」四分樹——
//   回傳數低於門檻即視為抓完不再細分，空曠/稀疏格子 1 次就停。一個縣市掃一次即服務該縣市所有目標。
//   （不用「以目標座標查小框」的捷徑：待補目標多半正是座標有問題的，座標不可信。）

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'address-overrides.json');
const API = 'https://api.autopass.xyz/v3/pois';

// 回傳數 >= 此值就再細分。實測截斷上限會浮動（137~197），故門檻壓在最低觀測值之下，
// 確保「回傳數 < 門檻」時必為框內全部、不會漏抓。
const SUBDIVIDE_AT = 100;
const BASE_WIDTH = 0.1;   // 先強制切到此邊長(約11km)再論筆數：避免大框中心落在山區/海上、
                          // 筆數偏低卻誤判「抓完」而漏掉邊緣密集區（高雄就踩過這坑）
const MIN_WIDTH = 0.004;  // 細分下限（約 440m）
const CONCURRENCY = 12;
const MIN_KEEP = 30;      // 自我保護：抓到過少（疑似 API 故障）就不覆寫舊檔

// --- 與 build-dataset.mjs 同步的縣市正規化 ---
const CITY_ALIAS = {
  臺北市: '台北市', 臺中市: '台中市', 臺南市: '台南市', 臺東縣: '台東縣',
  新竹市: '新竹縣市', 新竹縣: '新竹縣市', 嘉義市: '嘉義縣市', 嘉義縣: '嘉義縣市',
};
const canonCity = (c) => CITY_ALIAS[c?.trim()] ?? c?.trim() ?? '';
const toHalfWidth = (s) => s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
const normName = (s) => toHalfWidth(s || '').replace(/臺/g, '台').replace(/[\s\-()（）]/g, '');
const cityStem = (c) => canonCity(c).replace(/[縣市]/g, '');
const NO_DISCOUNT_RE = /不提供信用卡|無信用卡|不適用信用卡|[無不未]配合(提供)?信用卡/;

// 縣市概略邊界框 [w,s,e,n]（給無座標目標用；範圍寬鬆沒關係，內容剪枝會跳過空格）。
// 我方資料把新竹縣＋市→「新竹縣市」、嘉義縣＋市→「嘉義縣市」，故用聯集框。
const COUNTY_BBOX = {
  基隆市: [121.68, 25.08, 121.82, 25.16],
  台北市: [121.45, 24.95, 121.68, 25.22],
  新北市: [121.27, 24.66, 122.06, 25.31],
  桃園市: [120.95, 24.58, 121.48, 25.13],
  新竹縣市: [120.87, 24.42, 121.42, 24.95],
  苗栗縣: [120.62, 24.30, 121.28, 24.75],
  台中市: [120.43, 23.95, 121.46, 24.45],
  彰化縣: [120.25, 23.72, 120.78, 24.16],
  南投縣: [120.55, 23.44, 121.32, 24.20],
  雲林縣: [120.10, 23.44, 120.72, 23.86],
  嘉義縣市: [120.10, 23.20, 120.90, 23.62],
  台南市: [120.02, 22.88, 120.66, 23.43],
  高雄市: [120.15, 22.45, 121.06, 23.47],
  屏東縣: [120.32, 21.90, 120.92, 22.92],
  宜蘭縣: [121.30, 24.30, 121.92, 24.86],
  花蓮縣: [121.00, 23.09, 121.68, 24.38],
  台東縣: [120.75, 22.00, 121.52, 23.30],
};

let reqCount = 0;
let failCount = 0;
async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      reqCount++;
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.json();
    } catch { /* 重試 */ }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  failCount++;
  console.warn('取得失敗：', url);
  return null;
}
const fetchBox = async ([w, s, e, n]) =>
  (await getJson(`${API}?bounding_box=${w},${s},${e},${n}`))?.data?.parkinglots ?? [];

// 併發池
async function pool(items, fn) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// 內容剪枝四分樹：只掃指定縣市，回傳數低於上限即當抓完
async function scanCounty(bbox) {
  const found = new Map();
  let frontier = [bbox];
  while (frontier.length) {
    const results = await pool(frontier, fetchBox);
    const next = [];
    for (let i = 0; i < frontier.length; i++) {
      const [w, s, e, n] = frontier[i], lots = results[i];
      for (const l of lots) found.set(l.id, l);
      if ((e - w) > MIN_WIDTH && ((e - w) > BASE_WIDTH || lots.length >= SUBDIVIDE_AT)) {
        const mw = (w + e) / 2, mh = (s + n) / 2;
        next.push([w, s, mw, mh], [mw, s, e, mh], [w, mh, mw, n], [mw, mh, e, n]);
      }
    }
    frontier = next;
  }
  return [...found.values()];
}

async function main() {
  const cm = JSON.parse(readFileSync(join(ROOT, 'data', 'carmochi-geo.json'), 'utf8'));
  const targets = cm.lots.filter((l) =>
    !NO_DISCOUNT_RE.test(l.name + (l.note ?? '')) &&
    (!(l.address || '').trim() || l.lat == null));

  // 只掃「含有待補目標」的縣市；一次掃描服務該縣市所有目標
  const counties = [...new Set(targets.map((l) => canonCity(l.city)))];
  console.log(`需補場站 ${targets.length} 筆，涉及縣市：${counties.join('、')}`);

  const candidates = new Map(); // id -> {name,lat,lng}
  const scanStats = [];
  for (const c of counties) {
    const bbox = COUNTY_BBOX[c];
    if (!bbox) { console.warn(`無縣市邊界框，略過掃描：${c}`); scanStats.push({ city: c, scanned: null }); continue; }
    const lots = await scanCounty(bbox);
    console.log(`  掃描 ${c}：${lots.length} 個場站`);
    scanStats.push({ city: c, scanned: lots.length });
    for (const l of lots) candidates.set(l.id, { name: l.name, lat: l.lat, lng: l.lng });
  }

  // 名稱指紋索引
  const idx = new Map();
  for (const [id, p] of candidates) {
    const k = normName(p.name);
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push({ id, ...p });
  }
  const matchOf = (name) => {
    const nn = normName(name);
    if (idx.has(nn)) return idx.get(nn);
    const out = [];
    for (const [k, arr] of idx) if (nn && (nn.includes(k) || k.includes(nn))) out.push(...arr);
    return out;
  };

  // 抓候選明細（地址 + detail.city）
  const targetCands = targets.map((l) => ({ lot: l, cands: matchOf(l.name) }));
  const candIds = [...new Set(targetCands.flatMap((t) => t.cands.map((c) => c.id)))];
  const detailList = await pool(candIds, async (id) => {
    const x = (await getJson(`${API}/${id}`))?.data;
    return x ? { id, address: x.detail?.address, city: x.detail?.city } : null;
  });
  const detail = new Map(detailList.filter(Boolean).map((d) => [d.id, d]));

  // 同縣市 + 唯一候選才確認（防跨縣市同名誤配）
  const overrides = {};
  let confirmed = 0;
  const skipped = [];
  for (const { lot, cands } of targetCands) {
    const stem = cityStem(lot.city);
    const good = cands
      .map((c) => ({ ...c, det: detail.get(c.id) }))
      .filter((c) => c.det?.address && cityStem(c.det.city) === stem);
    if (good.length === 1) {
      const c = good[0];
      overrides[`${canonCity(lot.city)}|${lot.name}`] = {
        address: toHalfWidth(c.det.address),
        lat: Math.round(c.lat * 1e7) / 1e7,
        lng: Math.round(c.lng * 1e7) / 1e7,
        source: 'autopass',
      };
      confirmed++;
    } else {
      skipped.push(`${lot.city}|${lot.name}（同縣市候選 ${good.length} 筆）`);
    }
  }

  console.log(`\n總請求數 ${reqCount}｜確認補校 ${confirmed} 筆，未匹配 ${skipped.length} 筆`);
  for (const s of skipped) console.log('  略過：', s);

  // 供更新報告(write-update-log.mjs)使用的執行統計；此檔已 gitignore，不進 repo
  const writeRunStats = (wrote) => writeFileSync(
    join(ROOT, 'data', '.autopass-run.json'),
    JSON.stringify({ requests: reqCount, failed: failCount, targets: targets.length,
      counties: scanStats, confirmed, skipped, wrote }, null, 1));

  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
  if (confirmed < MIN_KEEP && Object.keys(prev).length > confirmed) {
    console.warn(`\n⚠ 只匹配到 ${confirmed} 筆（低於門檻 ${MIN_KEEP}），疑似來源異常，保留現有 ${Object.keys(prev).length} 筆不覆寫。`);
    writeRunStats(false);
    return;
  }
  const sorted = Object.fromEntries(Object.entries(overrides).sort());
  writeFileSync(OUT, JSON.stringify(sorted, null, 1));
  writeRunStats(true);
  console.log(`已寫入 ${OUT}（${Object.keys(sorted).length} 筆）`);
}

main();

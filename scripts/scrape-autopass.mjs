// 從 Autopass 官方場站圖資補「缺地址／缺座標」的場站，產出 data/address-overrides.json。
// build-dataset 會以「縣市|場站名」為 key 套用（不改 id，收藏安全）。
//
// 資料來源：https://api.autopass.xyz/v3/pois?bounding_box=minLng,minLat,maxLng,maxLat
//   ⚠ 此 API 只回傳「離查詢框中心最近的約 200 筆」，超過就默默丟掉邊緣的點。
//   所以必須把查詢框細分到每格回傳數都遠低於上限（此時「離中心最近」＝「框內全部」），
//   否則密集區（如台北）會漏抓。CAP 刻意設在觀測到的 ~200 上限之下。
//   細節地址在 https://api.autopass.xyz/v3/pois/{id} 的 detail.address。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'address-overrides.json');

const API = 'https://api.autopass.xyz/v3/pois';
const CAP = 140;           // 回傳數 >= 此值就再細分（上限約 200）
const BASE_WIDTH = 0.025;  // 強制的基礎網格（約 2.7km），確保密集區也被細切
const MIN_WIDTH = 0.0015;  // 細分下限（約 150m），避免卡住
const MAX_DEPTH = 13;
const CONCURRENCY = 16;
const MIN_KEEP = 30;       // 自我保護：抓到的筆數過少（疑似 API 故障）就不覆寫舊檔

// --- 與 build-dataset.mjs 同步的縣市正規化 ---
const CITY_ALIAS = {
  臺北市: '台北市', 臺中市: '台中市', 臺南市: '台南市', 臺東縣: '台東縣',
  新竹市: '新竹縣市', 新竹縣: '新竹縣市', 嘉義市: '嘉義縣市', 嘉義縣: '嘉義縣市',
};
const canonCity = (c) => CITY_ALIAS[c?.trim()] ?? c?.trim() ?? '';
const toHalfWidth = (s) => s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
// 比對用名稱指紋：半形、臺→台、去空白與括號連字號
const normName = (s) => toHalfWidth(s || '').replace(/臺/g, '台').replace(/[\s\-()（）]/g, '');
// 縣市比對：去掉縣/市字尾再比（新竹縣 vs 新竹縣市 也能對上）
const cityStem = (c) => canonCity(c).replace(/[縣市]/g, '');
const NO_DISCOUNT_RE = /不提供信用卡|無信用卡|不適用信用卡|[無不未]配合(提供)?信用卡/;

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.json();
    } catch { /* 重試 */ }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  console.warn('取得失敗：', url);
  return null;
}

// 併發池：對 items 逐一跑 fn，最多 CONCURRENCY 條同時進行
async function pool(items, fn) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

async function fetchBox([w, s, e, n]) {
  const d = await getJson(`${API}?bounding_box=${w},${s},${e},${n}`);
  return d?.data?.parkinglots ?? [];
}

const quarter = ([w, s, e, n]) => {
  const mw = (w + e) / 2, mh = (s + n) / 2;
  return [[w, s, mw, mh], [mw, s, e, mh], [w, mh, mw, n], [mw, mh, e, n]];
};

// BFS 逐層抓，回傳中的每個 POI 收進 pois，判斷是否要再細分
async function crawl() {
  const pois = new Map();
  let frontier = [[119.9, 21.85, 122.05, 25.35]]; // 台灣本島（離島無目標場站，略）
  let depth = 0, boxes = 0;
  while (frontier.length) {
    const results = await pool(frontier, fetchBox);
    const next = [];
    for (let i = 0; i < frontier.length; i++) {
      const box = frontier[i], lots = results[i];
      for (const l of lots) pois.set(l.id, { name: l.name, lat: l.lat, lng: l.lng });
      const width = box[2] - box[0];
      if (width > MIN_WIDTH && depth < MAX_DEPTH && (width > BASE_WIDTH || lots.length >= CAP)) {
        next.push(...quarter(box));
      }
    }
    boxes += frontier.length;
    console.log(`  第 ${depth} 層：累計 ${boxes} 框、${pois.size} 個場站，下一層 ${next.length} 框`);
    frontier = next;
    depth++;
  }
  return pois;
}

async function main() {
  console.log('抓取 Autopass 場站圖資（深度細分網格）…');
  const pois = await crawl();
  console.log(`共 ${pois.size} 個 Autopass 停車場 POI`);

  // 名稱指紋 → 候選 POI
  const idx = new Map();
  for (const [id, p] of pois) {
    const k = normName(p.name);
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push({ id, ...p });
  }

  // 目標：車麻吉來源中「缺地址或缺座標」的場站（正是 build 需要補的那些）
  const cm = JSON.parse(readFileSync(join(ROOT, 'data', 'carmochi-geo.json'), 'utf8'));
  const targets = cm.lots.filter((l) =>
    !NO_DISCOUNT_RE.test(l.name + (l.note ?? '')) &&
    (!(l.address || '').trim() || l.lat == null));
  console.log(`需補場站 ${targets.length} 筆`);

  // 找候選（先精確、再子字串），收集所有候選 id
  const matchOf = (name) => {
    const nn = normName(name);
    if (idx.has(nn)) return idx.get(nn);
    const out = [];
    for (const [k, arr] of idx) if (nn && (nn.includes(k) || k.includes(nn))) out.push(...arr);
    return out;
  };
  const targetCands = targets.map((l) => ({ lot: l, cands: matchOf(l.name) }));
  const candIds = [...new Set(targetCands.flatMap((t) => t.cands.map((c) => c.id)))];

  // 抓候選明細（含地址與 detail.city）
  console.log(`抓取 ${candIds.length} 筆候選明細…`);
  const detailList = await pool(candIds, async (id) => {
    const d = await getJson(`${API}/${id}`);
    const x = d?.data;
    return x ? { id, address: x.detail?.address, city: x.detail?.city } : null;
  });
  const detail = new Map(detailList.filter(Boolean).map((d) => [d.id, d]));

  // 以「縣市一致 + 唯一候選」確認，避免跨縣市同名誤配
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

  console.log(`確認補校 ${confirmed} 筆，未匹配 ${skipped.length} 筆`);
  for (const s of skipped) console.log('  略過：', s);

  // 自我保護：抓到的太少（多半是 API 故障）就保留舊檔，不要把好資料清掉
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
  if (confirmed < MIN_KEEP && Object.keys(prev).length > confirmed) {
    console.warn(`\n⚠ 只匹配到 ${confirmed} 筆（低於門檻 ${MIN_KEEP}），疑似來源異常，保留現有 ${Object.keys(prev).length} 筆不覆寫。`);
    return;
  }

  const sorted = Object.fromEntries(Object.entries(overrides).sort());
  writeFileSync(OUT, JSON.stringify(sorted, null, 1));
  console.log(`已寫入 ${OUT}（${Object.keys(sorted).length} 筆）`);
}

main();

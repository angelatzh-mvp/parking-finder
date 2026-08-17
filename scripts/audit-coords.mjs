// 座標可疑度稽核：把「位置判斷可能有問題」的場站寫進 docs/待確認位置.md 的自動區塊。
// 在 build-dataset 之後跑（讀最終資料集），只回報、不改座標——確認後由人工寫 coord-overrides.json。
//
// 判斷依據（無網路的結構性訊號 ＋ NLSC 門牌交叉比對）：
//   1. 無座標
//   2. 座標落在所屬縣市邊界框外（多為路名撞名誤配到外縣市）
//   3. 多個場站共用同一座標（反查退到路段／區域中心點，一個點餵給多筆）
//   4. 座標由地址反查而來、且地址沒有門牌號（交叉口／路段／地號）＝結構上只能落到路段層級
//   5. 座標由地址反查而來、且與 NLSC 門牌座標落差 >= AUDIT_THRESHOLD_M
//      （會另外標示地址帶「對面／旁／前／後／交叉」者：門牌本來就不等於停車場位置）
//
// 已寫進 coord-overrides.json 的（人工確認或 Autopass 釘死）一律跳過。
// 品牌自帶官方座標者（台灣聯通／嘟嘟房／ViVi PARK）不做 NLSC 比對，只吃 1–3 的結構性訊號。
//
// NLSC 查詢結果快取在 data/geocode-nlsc-audit-cache.json，每週只查新增／改過地址的場站。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITY_BBOX, inCity } from './lib/city-bbox.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = join(ROOT, 'docs', '待確認位置.md');
const CACHE_PATH = join(ROOT, 'data', 'geocode-nlsc-audit-cache.json');
const BEGIN = '<!-- AUDIT:BEGIN 以下由 scripts/audit-coords.mjs 自動產生，請勿手改 -->';
const END = '<!-- AUDIT:END -->';

const AUDIT_THRESHOLD_M = 200; // NLSC 落差達此值即列入待確認
const GEOCODED_BRANDS = new Set(['carmochi', 'tps', 'parkinsys']); // 座標由地址反查而來
const QUALIFIER_RE = /對面|斜對面|旁|前方|後方|交叉|路口/;
const HOUSE_NO_RE = /[0-9０-９]+\s*號/;
const BRAND_LABEL = { utg: '台灣聯通', carmochi: '車麻吉', dodohome: '嘟嘟房', tps: '24TPS', vivipark: 'ViVi PARK', parkinsys: '銓營' };

const lots = JSON.parse(readFileSync(join(ROOT, 'data', 'parking-lots.json'), 'utf8')).lots;
const overrides = JSON.parse(readFileSync(join(ROOT, 'data', 'coord-overrides.json'), 'utf8'));
const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {};

const pinned = (l) => l.id in overrides || `${l.city}|${l.name}` in overrides;

function distM(aLat, aLng, bLat, bLng) {
  const R = 6371000, t = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * t) / 2) ** 2
    + Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(((bLng - aLng) * t) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// NLSC 需要真實縣市名；我方把新竹縣＋市、嘉義縣＋市合併成一類，查詢用不帶縣市字尾的名稱
const cityForQuery = (c) => (c === '新竹縣市' ? '新竹' : c === '嘉義縣市' ? '嘉義' : c);
// 去掉樓層、括號、門牌號之後的尾綴（「旁空地」「對面停車場」等 NLSC 看不懂的描述）
const cleanAddress = (a) => (a || '')
  .replace(/[（(][^（）()]*[）)]/g, '')
  .replace(/(B\d.*|地下.*|[0-9]F.*)$/i, '')
  .replace(/([0-9０-９]+號).*$/, '$1')
  .replace(/\s+/g, '')
  .trim();

async function nlsc(query) {
  const url = `https://api.nlsc.gov.tw/idc/TextQueryMap/${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: { referer: 'https://maps.nlsc.gov.tw/', 'user-agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const m = (await res.text()).match(/<LOCATION>([0-9.]+),([0-9.]+)<\/LOCATION>/);
    if (!m) return null;
    const lng = Number(m[1]), lat = Number(m[2]);
    if (lat < 21 || lat > 26.5 || lng < 118 || lng > 122.5) return null;
    return { lat, lng };
  } catch {
    return null; // 查不到就當作沒有第二來源可比，不讓稽核擋住整個 pipeline
  }
}

const findings = [];
const add = (lot, severity, reason, extra = {}) =>
  findings.push({ lot, severity, reason, ...extra });

// --- 1~4：結構性訊號（無網路） ---
const coordKey = (l) => `${l.lat},${l.lng}`;
const shared = new Map();
for (const l of lots) if (l.lat != null) shared.set(coordKey(l), (shared.get(coordKey(l)) ?? 0) + 1);

const toCrossCheck = [];
for (const l of lots) {
  if (pinned(l)) continue;
  const geocoded = l.brands.some((b) => GEOCODED_BRANDS.has(b));
  if (l.lat == null) { add(l, 3, '無座標'); continue; }
  if (CITY_BBOX[l.city] && !inCity(l.city, l)) {
    add(l, 3, `座標落在「${l.city}」邊界框外，疑似誤配到其他縣市`);
    continue;
  }
  if (shared.get(coordKey(l)) > 1) {
    add(l, 2, `與其他 ${shared.get(coordKey(l)) - 1} 個場站共用同一座標，疑為路段／區域中心點`);
    continue;
  }
  if (!geocoded) continue; // 品牌官方座標，無門牌反查問題
  if (!HOUSE_NO_RE.test(l.address || '')) {
    add(l, 2, '座標由地址反查，但地址無門牌號（交叉口／路段／地號），只能落到路段層級');
    continue;
  }
  toCrossCheck.push(l);
}

// --- 5：NLSC 門牌交叉比對（僅查快取沒有的地址，限速 1 req/s） ---
let queried = 0;
for (const l of toCrossCheck) {
  const q = cityForQuery(l.city) + cleanAddress(l.address);
  if (!(q in cache)) {
    cache[q] = await nlsc(q);
    queried++;
    await new Promise((r) => setTimeout(r, 1000));
    if (queried % 25 === 0) writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
  }
  const g = cache[q];
  if (!g) continue; // NLSC 也查不到 → 沒有第二來源可判，不列入（避免大量無效噪音）
  const d = Math.round(distM(l.lat, l.lng, g.lat, g.lng));
  if (d < AUDIT_THRESHOLD_M) continue;
  const qual = QUALIFIER_RE.exec(l.address || '');
  add(l, d >= 1000 ? 3 : d >= 500 ? 2 : 1,
    `與 NLSC 門牌座標落差 ${d}m` + (qual ? `；地址含「${qual[0]}」，門牌≠停車場位置` : ''),
    { nlsc: g, d });
}
writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));

// --- 產生文件區塊 ---
const SEV = { 3: '高', 2: '中', 1: '低' };
findings.sort((a, b) => b.severity - a.severity || (b.d ?? 0) - (a.d ?? 0));

const lines = [BEGIN, '', `> 產生時間：${new Date().toISOString()}｜稽核 ${lots.length} 筆，可疑 ${findings.length} 筆`
  + `（NLSC 落差門檻 ${AUDIT_THRESHOLD_M}m，本次新查 ${queried} 筆）`, ''];
if (!findings.length) {
  lines.push('目前沒有可疑場站。', '');
} else {
  lines.push('| 風險 | 縣市 | 行政區 | 場站 | 地址 | 來源 | 現座標 | NLSC 門牌 | 判斷依據 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const f of findings) {
    const l = f.lot;
    lines.push(`| ${SEV[f.severity]} | ${l.city} | ${l.district ?? ''} | ${l.name} | ${l.address ?? ''} `
      + `| ${l.brands.map((b) => BRAND_LABEL[b] ?? b).join('／')} `
      + `| ${l.lat == null ? '**無**' : `\`${l.lat}, ${l.lng}\``} `
      + `| ${f.nlsc ? `\`${f.nlsc.lat}, ${f.nlsc.lng}\`` : '—'} | ${f.reason} |`);
  }
  lines.push('', '確認位置後把座標寫進 `data/coord-overrides.json`（同名場站用場站 id 當 key），'
    + '下次稽核就不會再列出來。', '');
}
lines.push(END);

const doc = readFileSync(DOC, 'utf8');
const i = doc.indexOf(BEGIN), j = doc.indexOf(END);
if (i === -1 || j === -1) throw new Error(`${DOC} 找不到 AUDIT:BEGIN／AUDIT:END 區塊標記`);
writeFileSync(DOC, doc.slice(0, i) + lines.join('\n') + doc.slice(j + END.length));

const bySev = findings.reduce((m, f) => ({ ...m, [SEV[f.severity]]: (m[SEV[f.severity]] ?? 0) + 1 }), {});
console.log(`座標稽核：${lots.length} 筆中可疑 ${findings.length} 筆`, bySev, `（NLSC 新查 ${queried} 筆）`);

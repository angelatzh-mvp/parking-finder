// 車麻吉場站地址 → 座標（Nominatim / OpenStreetMap，免費、限速 1 req/s）
// 快取存 data/geocode-cache.json：已解析過的地址不重查，之後每週更新只查新增場站
// 輸出：data/carmochi-geo.json

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_PATH = join(ROOT, 'data', 'geocode-cache.json');
const UA = 'free-parking-finder/0.1 (personal project)';

const raw = JSON.parse(readFileSync(join(ROOT, 'data', 'carmochi-raw.json'), 'utf8'));
const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {};

// 「新竹縣市」「嘉義縣市」這類合併分類 → 用不帶縣市字尾的名稱查詢
function cityForQuery(city) {
  return city.replace(/縣市$/, '');
}

// 去掉樓層、括號等 Nominatim 看不懂的尾巴
function cleanAddress(addr) {
  return addr
    .replace(/[（(][^（）()]*[）)]/g, '')
    .replace(/([0-9０-９]+號).*$/, '$1')
    .replace(/\s+/g, '')
    .trim();
}

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=tw&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) return null;
  const results = await res.json();
  if (!results.length) return null;
  return { lat: Number(results[0].lat), lng: Number(results[0].lon) };
}

const out = [];
let hits = 0;
let misses = 0;
let queries = 0;

for (const lot of raw.lots) {
  const query = cityForQuery(lot.city) + cleanAddress(lot.address);
  let geo = cache[query];
  if (geo === undefined) {
    geo = await geocode(query);
    // 整條地址查不到 → 退到路段層級（去掉門牌號）
    if (!geo) {
      const roadQuery = query.replace(/[0-9０-９]+號$/, '');
      if (roadQuery !== query) geo = await geocode(roadQuery);
    }
    cache[query] = geo;
    queries++;
    if (queries % 25 === 0) {
      writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
      console.log(`進度 ${out.length + 1}/${raw.lots.length}（命中 ${hits}、失敗 ${misses}）`);
    }
    await new Promise((r) => setTimeout(r, 1100));
  }
  if (geo) hits++;
  else misses++;
  out.push({ ...lot, lat: geo?.lat ?? null, lng: geo?.lng ?? null });
}

writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
writeFileSync(
  join(ROOT, 'data', 'carmochi-geo.json'),
  JSON.stringify({ ...raw, geocodedAt: new Date().toISOString(), hits, misses, lots: out }, null, 2),
);
console.log(`完成：${hits} 筆有座標、${misses} 筆失敗（共 ${raw.lots.length} 筆）`);

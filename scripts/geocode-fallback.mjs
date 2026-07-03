// 地理編碼備援：用國土測繪中心 NLSC TextQueryMap 補 Nominatim 查不到的地址
// 讀 data/carmochi-geo.json 中 lat=null 的場站，就地補上座標後寫回
// 交叉口類地址查不到時，退到「第一條路名」的路段層級

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEO_PATH = join(ROOT, 'data', 'carmochi-geo.json');
const CACHE_PATH = join(ROOT, 'data', 'geocode-nlsc-cache.json');

const data = JSON.parse(readFileSync(GEO_PATH, 'utf8'));
const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {};

// 合併縣市分類展開成候選城市；NLSC 需要真實縣市名
function cityCandidates(city) {
  if (city === '新竹縣市') return ['新竹市', '新竹縣'];
  if (city === '嘉義縣市') return ['嘉義市', '嘉義縣'];
  return [city];
}

function cleanAddress(addr) {
  return addr
    .replace(/[（(][^（）()]*[）)]/g, '')
    .replace(/(B\d.*|地下.*|[0-9]F.*)$/i, '')
    .replace(/(旁|對面|附近)$/, '')
    .replace(/\s+/g, '')
    .trim();
}

async function nlsc(query) {
  const url = `https://api.nlsc.gov.tw/idc/TextQueryMap/${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { referer: 'https://maps.nlsc.gov.tw/', 'user-agent': 'Mozilla/5.0' },
  });
  if (!res.ok) return null;
  const xml = await res.text();
  const m = xml.match(/<LOCATION>([0-9.]+),([0-9.]+)<\/LOCATION>/);
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (lat < 21 || lat > 26.5 || lng < 118 || lng > 122.5) return null;
  return { lat, lng };
}

async function cachedNlsc(query) {
  if (query in cache) return cache[query];
  const geo = await nlsc(query);
  cache[query] = geo;
  await new Promise((r) => setTimeout(r, 1000));
  return geo;
}

let fixed = 0;
let still = 0;
const misses = data.lots.filter((l) => l.lat === null);
let i = 0;
for (const lot of misses) {
  i++;
  const addr = cleanAddress(lot.address);
  let geo = null;
  for (const city of cityCandidates(lot.city)) {
    geo = await cachedNlsc(city + addr);
    if (geo) break;
    // 交叉口／巷弄查不到 → 取第一條路名做路段層級定位
    const road = addr.match(/^(.+?[路街道])/);
    if (road && road[1] !== addr) {
      geo = await cachedNlsc(city + road[1]);
      if (geo) break;
    }
  }
  if (geo) {
    lot.lat = geo.lat;
    lot.lng = geo.lng;
    fixed++;
  } else {
    still++;
    console.log(`仍失敗: ${lot.city} | ${lot.name} | ${lot.address}`);
  }
  if (i % 20 === 0) {
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
    console.log(`進度 ${i}/${misses.length}（補齊 ${fixed}）`);
  }
}

writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
data.hits = data.lots.filter((l) => l.lat !== null).length;
data.misses = still;
data.geocodedAt = new Date().toISOString();
writeFileSync(GEO_PATH, JSON.stringify(data, null, 2));
console.log(`備援完成：補齊 ${fixed} 筆，仍失敗 ${still} 筆（總座標覆蓋 ${data.hits}/${data.lots.length}）`);

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

// 各縣市粗略邊界框 [latMin, latMax, lngMin, lngMax]：座標落在框外＝地理編碼錯置
const CITY_BBOX = {
  基隆市: [25.0, 25.21, 121.6, 121.82],
  台北市: [24.95, 25.22, 121.44, 121.68],
  新北市: [24.66, 25.31, 121.27, 122.03],
  桃園市: [24.57, 25.14, 120.97, 121.5],
  新竹縣市: [24.34, 24.97, 120.86, 121.47],
  苗栗縣: [24.24, 24.77, 120.58, 121.32],
  台中市: [23.94, 24.47, 120.44, 121.46],
  彰化縣: [23.74, 24.24, 120.24, 120.72],
  南投縣: [23.4, 24.22, 120.58, 121.36],
  嘉義縣市: [23.18, 23.67, 119.93, 120.97],
  雲林縣: [23.48, 23.92, 120.08, 120.74],
  台南市: [22.84, 23.44, 120.0, 120.72],
  高雄市: [22.44, 23.32, 120.13, 121.07],
  屏東縣: [21.84, 22.92, 120.38, 120.97],
  宜蘭縣: [24.28, 24.92, 121.28, 122.07],
  花蓮縣: [23.06, 24.42, 120.98, 121.82],
  台東縣: [21.88, 23.47, 120.68, 121.67],
  澎湖縣: [23.13, 23.82, 119.28, 119.77],
  金門縣: [24.33, 24.57, 118.13, 118.52],
  連江縣: [25.88, 26.42, 119.83, 120.57],
};
function inCity(city, geo) {
  if (!geo) return false;
  const b = CITY_BBOX[city];
  if (!b) return true;
  return geo.lat >= b[0] && geo.lat <= b[1] && geo.lng >= b[2] && geo.lng <= b[3];
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

// 自癒前置檢查：座標落在所屬縣市邊界框外的一律歸零重查（防止名稱誤配到外縣市地標）
let reset = 0;
for (const lot of data.lots) {
  if (lot.lat != null && !inCity(lot.city, { lat: lot.lat, lng: lot.lng })) {
    lot.lat = null;
    lot.lng = null;
    reset++;
  }
}
if (reset) console.log(`座標落在縣市範圍外，歸零重查：${reset} 筆`);

let fixed = 0;
let still = 0;
const misses = data.lots.filter((l) => l.lat === null);
let i = 0;
for (const lot of misses) {
  i++;
  const addr = cleanAddress(lot.address);
  let geo = null;
  outer: for (const city of cityCandidates(lot.city)) {
    const candidates = [];
    if (addr) {
      candidates.push(city + addr);
      // 交叉口／巷弄查不到 → 取第一條路名做路段層級定位
      const road = addr.match(/^(.+?[路街道])/);
      if (road && road[1] !== addr) candidates.push(city + road[1]);
    } else {
      // 無地址：用場站名當地標查；絕不可只用縣市名查（會拿到縣市代表點）
      const base = lot.name.replace(/[（(][^（）()]*[）)]/g, '').trim();
      candidates.push(city + base);
      const stripped = base.replace(/(地下|立體|平面|轉乘|臨時)*(汽機車)?停車場$/, '').trim();
      if (stripped && stripped !== base) candidates.push(city + stripped);
    }
    for (const q of candidates) {
      geo = await cachedNlsc(q);
      // 查詢結果必須落在場站所屬縣市內，否則視為誤配
      if (geo && !inCity(lot.city, geo)) geo = null;
      if (geo) break outer;
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

// 24TPS 場站地址 → 座標。Nominatim 主力 + NLSC 備援，共用既有兩個快取檔。
// 讀 data/tps-raw.json，輸出 data/tps-geo.json（查不到者 lat/lng=null，交給 build 標 geoPending）

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOM_CACHE = join(ROOT, 'data', 'geocode-cache.json');
const NLSC_CACHE = join(ROOT, 'data', 'geocode-nlsc-cache.json');
const UA = 'free-parking-finder/0.1 (personal project)';

const raw = JSON.parse(readFileSync(join(ROOT, 'data', 'tps-raw.json'), 'utf8'));
const nomCache = existsSync(NOM_CACHE) ? JSON.parse(readFileSync(NOM_CACHE, 'utf8')) : {};
const nlscCache = existsSync(NLSC_CACHE) ? JSON.parse(readFileSync(NLSC_CACHE, 'utf8')) : {};

// 去掉樓層、括號、「旁／對面／空地」等定位服務看不懂的尾巴
function cleanAddress(addr) {
  return addr
    .replace(/[（(][^（）()]*[）)]/g, '')
    .replace(/(B\d.*|地下.*|[0-9０-９]+F.*|b-?b?\d.*)$/i, '')
    .replace(/(旁|對面|附近|交口|交叉路口)?空地$/, '')
    .replace(/\s+/g, '')
    .trim();
}
const inTaiwan = (g) => g && g.lat >= 21 && g.lat <= 26.5 && g.lng >= 118 && g.lng <= 122.5;

async function nominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=tw&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) return null;
  const r = await res.json();
  return r.length ? { lat: Number(r[0].lat), lng: Number(r[0].lon) } : null;
}
async function nlsc(query) {
  const url = `https://api.nlsc.gov.tw/idc/TextQueryMap/${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { referer: 'https://maps.nlsc.gov.tw/', 'user-agent': 'Mozilla/5.0' } });
  if (!res.ok) return null;
  const m = (await res.text()).match(/<LOCATION>([0-9.]+),([0-9.]+)<\/LOCATION>/);
  return m ? { lat: Number(m[2]), lng: Number(m[1]) } : null;
}

async function cached(cache, path, fn, query, delay) {
  if (query in cache) return cache[query];
  const geo = await fn(query);
  cache[query] = inTaiwan(geo) ? geo : null;
  writeFileSync(path, JSON.stringify(cache, null, 1));
  await new Promise((r) => setTimeout(r, delay));
  return cache[query];
}

const out = [];
let hits = 0;
for (const lot of raw.lots) {
  const addr = cleanAddress(lot.address);
  const road = addr.match(/^(.+?[路街道])/)?.[1];
  const queries = [lot.city + addr, road && road !== addr ? lot.city + road : null].filter(Boolean);
  let geo = null;
  for (const q of queries) {
    geo = await cached(nomCache, NOM_CACHE, nominatim, q, 1100);
    if (geo) break;
  }
  if (!geo) {
    for (const q of queries) {
      geo = await cached(nlscCache, NLSC_CACHE, nlsc, q, 1000);
      if (geo) break;
    }
  }
  if (geo) hits++;
  else console.log(`仍失敗: ${lot.city} | ${lot.name} | ${lot.address}`);
  out.push({ ...lot, lat: geo?.lat ?? null, lng: geo?.lng ?? null });
}

writeFileSync(
  join(ROOT, 'data', 'tps-geo.json'),
  JSON.stringify({ ...raw, geocodedAt: new Date().toISOString(), hits, misses: out.length - hits, lots: out }, null, 2),
);
console.log(`24TPS 座標：${hits}/${out.length} 筆`);

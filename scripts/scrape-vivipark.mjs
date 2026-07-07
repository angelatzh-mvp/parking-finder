// ViVi PARK 場站爬蟲
// 來源：GET https://vivi-park.com/parks/（WordPress，整份清單內嵌在 inline script `let allParks = [...]`）
// 229/229 官方自帶座標 → 免 geocode。優惠性質是「App 綁卡折抵」（11 家銀行），
// allParks 無逐站信用卡欄位，Angela 決定全數收錄。輸出：data/vivipark-raw.json
// ⚠️ 頁面另有 admin-ajax app_api_proxy+nonce 代理後端，清單用不到，別繞遠路。

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_URL = 'https://vivi-park.com/parks/';

const res = await fetch(SOURCE_URL, { headers: { 'user-agent': 'Mozilla/5.0' } });
if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SOURCE_URL}`);
const html = await res.text();

const m = html.match(/let allParks\s*=\s*(\[[\s\S]*?\]);/);
if (!m) throw new Error('找不到 inline allParks，疑似頁面改版');
const parks = JSON.parse(m[1]);

const inTaiwan = (lat, lng) => lat >= 21 && lat <= 26.5 && lng >= 118 && lng <= 122.5;

const lots = [];
for (const p of parks) {
  const name = (p.pa_name ?? '').trim();
  const city = (p.county ?? '').trim();
  const address = `${p.county ?? ''}${p.city ?? ''}${p.address ?? ''}`.trim();
  const lat = Number(p.pa_latitude);
  const lng = Number(p.pa_Longitude);
  if (!name || !city) continue;
  lots.push({ park_id: p.pa_id ?? '', name, city, address, lat: inTaiwan(lat, lng) ? lat : null, lng: inTaiwan(lat, lng) ? lng : null });
}

if (lots.length < 180) {
  throw new Error(`只解析到 ${lots.length} 筆，疑似頁面改版，請人工檢查來源`);
}
const noGeo = lots.filter((l) => l.lat == null).length;
if (noGeo > 5) throw new Error(`${noGeo} 筆缺座標，疑似欄位改版`);

const byCity = {};
for (const l of lots) byCity[l.city] = (byCity[l.city] ?? 0) + 1;

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(
  join(ROOT, 'data', 'vivipark-raw.json'),
  JSON.stringify({ source: SOURCE_URL, scrapedAt: new Date().toISOString(), count: lots.length, byCity, lots }, null, 2),
);
console.log(`ViVi PARK：${lots.length} 筆（缺座標 ${noGeo}）`);
console.log(byCity);

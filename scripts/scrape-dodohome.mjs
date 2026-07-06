// 嘟嘟房「信用卡優免」場站爬蟲
// 來源：POST https://www.dodohome.com.tw/p2_map.aspx/Search（回傳 {d: HTML表格字串}）
// server 端已濾好「信用卡優免」名單，且每列電子地圖連結內嵌官方座標（X=lng,Y=lat）
// → 直接用官方座標，免 Nominatim/NLSC。輸出：data/dodohome-raw.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_URL = 'https://www.dodohome.com.tw/p2_map.aspx/Search';

const CITY_RE = /(台北市|臺北市|新北市|桃園市|台中市|臺中市|台南市|臺南市|高雄市|基隆市|新竹市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|屏東縣|宜蘭縣|花蓮縣|台東縣|臺東縣|澎湖縣|金門縣|連江縣)/;

// 來源地址偶有髒值缺正式縣市名（如「台北中山區市」「新莊區」「宜蘭市」）→ 退到前綴／行政區推斷
const BARE_CITY = [
  [/^(台北|臺北)/, '台北市'], [/^桃園/, '桃園市'], [/^(台中|臺中)/, '台中市'],
  [/^(台南|臺南)/, '台南市'], [/^高雄/, '高雄市'], [/^基隆/, '基隆市'],
  [/^宜蘭/, '宜蘭縣'], [/^花蓮/, '花蓮縣'], [/^(台東|臺東)/, '台東縣'],
  [/^(板橋|新莊|三重|中和|永和|土城|樹林|汐止|蘆洲|新店|淡水|林口|三峽|鶯歌|泰山|五股|八里|深坑|石碇|坪林|三芝|石門|平溪|雙溪|貢寮|金山|萬里|烏來|瑞芳)區/, '新北市'],
];
function deriveCity(address) {
  const m = address.match(CITY_RE);
  if (m) return m[1];
  for (const [re, city] of BARE_CITY) if (re.test(address)) return city;
  return '';
}

const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

const res = await fetch(SOURCE_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0' },
  body: JSON.stringify({ selCountry: 'ALL', selService: '信用卡優免', strLat: '', strLng: '' }),
});
if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SOURCE_URL}`);
const { d: html } = await res.json();
if (!html) throw new Error('回傳無 d 欄位，疑似 API 改版');

const lots = [];
for (const row of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
  const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  if (cells.length < 6) continue; // 跳過 thead 標題列
  const name = strip(cells[0]);
  const address = strip(cells[1]);
  // 電話欄常見多支黏在一起（<br/> 分隔），正規化成分號
  const phone = strip(cells[2].replace(/<\/?br\s*\/?>/gi, ';')).replace(/;+/g, ';').replace(/^;|;$/g, '');
  const hours = strip(cells[3]);
  const park_id = cells[4].match(/CallParkDetail\('([^']+)'\)/)?.[1] ?? '';
  // 電子地圖連結內嵌官方座標：?pkname=站名&X=經度&Y=緯度
  const geo = cells[5].match(/[?&]X=([0-9.]+)&Y=([0-9.]+)/);
  const lng = geo ? Number(geo[1]) : null;
  const lat = geo ? Number(geo[2]) : null;
  if (!name || !address) continue; // 過濾空白雜訊列
  const city = deriveCity(address);
  lots.push({ park_id, name, address, phone, hours, city, lat, lng });
}

if (lots.length < 300) {
  throw new Error(`只解析到 ${lots.length} 筆，疑似 API 改版，請人工檢查來源`);
}
const noGeo = lots.filter((l) => l.lat == null).length;
const noCity = lots.filter((l) => !l.city).length;
if (noGeo > 5) throw new Error(`${noGeo} 筆缺座標，疑似地圖連結格式改版`);

const byCity = {};
for (const l of lots) byCity[l.city] = (byCity[l.city] ?? 0) + 1;

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(
  join(ROOT, 'data', 'dodohome-raw.json'),
  JSON.stringify({ source: SOURCE_URL, scrapedAt: new Date().toISOString(), count: lots.length, byCity, lots }, null, 2),
);
console.log(`嘟嘟房：${lots.length} 筆（缺座標 ${noGeo}、缺縣市 ${noCity}）`);
console.log(byCity);

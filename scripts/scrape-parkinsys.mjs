// 銓營（詮營股份 parkinsys）「有信用卡折抵」場站爬蟲
// 列表：GET https://www.parkinsys.com.tw/product.php?&p={1..4}&id=1&md=1（server-rendered PHP）
//   分頁怪：p3 之後與前頁部分重複 → 依明細 id 去重。站名直接標「（有/無信用卡折抵）」→ 精準過濾。
// 地址：逐站抓 product_detail.php?id=N 的「地　址｜」欄。
//   ⚠️ 明細頁 Google Map embed 座標會混到公司總部（內湖）座標，不可用 → 交給 geocode。
// 輸出：data/parkinsys-raw.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://www.parkinsys.com.tw';

const CITY_RE = /(台北市|臺北市|新北市|桃園市|台中市|臺中市|台南市|臺南市|高雄市|基隆市|新竹市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|屏東縣|宜蘭縣|花蓮縣|台東縣|臺東縣|澎湖縣|金門縣|連江縣)/;

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

// 掃列表頁收集「明細 id → 站名」，依 id 去重（分頁會重複列出）
const byId = new Map();
for (let p = 1; p <= 4; p++) {
  const html = await fetchText(`${BASE}/product.php?&p=${p}&id=1&md=1`);
  for (const m of html.matchAll(/product_detail\.php\?id=(\d+)[\s\S]*?<h3 class="fz-C">([^<]+)<\/h3>/g)) {
    if (!byId.has(m[1])) byId.set(m[1], m[2].trim());
  }
  await new Promise((r) => setTimeout(r, 300));
}
console.log(`列表去重後共 ${byId.size} 站`);

// 只留名稱明標「有信用卡折抵」者，逐站抓明細頁地址
const lots = [];
for (const [id, rawName] of byId) {
  if (!/（有信用卡折抵）/.test(rawName)) continue;
  const name = rawName.replace(/（有信用卡折抵）/, '').trim();
  const detail = await fetchText(`${BASE}/product_detail.php?id=${id}&p=1`);
  const address = detail.match(/地[　\s]*址｜\s*([^<\s]+)/)?.[1]?.trim() ?? '';
  const city = address.match(CITY_RE)?.[1] ?? '';
  if (!address) console.log(`⚠️ 抓不到地址: id=${id} ${name}`);
  lots.push({ park_id: id, name, address, city });
  await new Promise((r) => setTimeout(r, 300));
}

if (lots.length < 15) {
  throw new Error(`只解析到 ${lots.length} 筆有折抵場站，疑似頁面改版，請人工檢查來源`);
}
const noAddr = lots.filter((l) => !l.address).length;
if (noAddr > 3) throw new Error(`${noAddr} 筆缺地址，疑似明細頁改版`);

const byCity = {};
for (const l of lots) byCity[l.city] = (byCity[l.city] ?? 0) + 1;

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(
  join(ROOT, 'data', 'parkinsys-raw.json'),
  JSON.stringify({ source: `${BASE}/product.php`, scrapedAt: new Date().toISOString(), count: lots.length, byCity, lots }, null, 2),
);
console.log(`銓營（有折抵）：${lots.length} 筆（缺地址 ${noAddr}）`);
console.log(byCity);

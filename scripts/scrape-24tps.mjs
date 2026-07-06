// 24TPS 永固「信用卡專屬優惠場站」爬蟲
// 來源：http://www.24tps.com.tw/OtherServiceADV/CreditCardParkList.aspx
//   （http only：官方直接標示「皆適用信用卡優惠停車服務」＝免停名單；無座標，交給 geocode）
// 輸出：data/tps-raw.json
// ⚠️ 別用 ParkZone.aspx（只列行政區、無場站明細、要 postback）

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_URL = 'http://www.24tps.com.tw/OtherServiceADV/CreditCardParkList.aspx';

const CITY_RE = /(台北市|臺北市|新北市|桃園市|台中市|臺中市|台南市|臺南市|高雄市|基隆市|新竹市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|屏東縣|宜蘭縣|花蓮縣|台東縣|臺東縣|澎湖縣|金門縣|連江縣)/;

const res = await fetch(SOURCE_URL, { headers: { 'user-agent': 'Mozilla/5.0' } });
if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SOURCE_URL}`);
const html = await res.text();

// 表格為「名稱 / 地址」兩欄成對；抓所有 td/th 儲存格文字後過濾標題列
const cells = [...html.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
  .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[　]/g, '').trim())
  .filter(Boolean);

const lots = [];
for (let i = 0; i < cells.length - 1; i++) {
  const address = cells[i + 1];
  // 地址欄特徵：帶郵遞區號前綴 + 縣市名；名稱欄則否
  if (!/^\d{3}/.test(address) || !CITY_RE.test(address)) continue;
  const name = cells[i];
  if (!name || /名\s*稱|地\s*址|優惠場站/.test(name)) continue;
  const cleanAddr = address.replace(/^\d{3,5}[.\s、,，]*/, '').trim();
  const city = cleanAddr.match(CITY_RE)?.[1] ?? '';
  lots.push({ name, address: cleanAddr, city });
  i++; // 這一對已消化，跳過地址欄
}

if (lots.length < 20) {
  throw new Error(`只解析到 ${lots.length} 筆，疑似頁面改版，請人工檢查來源`);
}

const byCity = {};
for (const l of lots) byCity[l.city] = (byCity[l.city] ?? 0) + 1;

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(
  join(ROOT, 'data', 'tps-raw.json'),
  JSON.stringify({ source: SOURCE_URL, scrapedAt: new Date().toISOString(), count: lots.length, byCity, lots }, null, 2),
);
console.log(`24TPS：${lots.length} 筆`);
console.log(byCity);

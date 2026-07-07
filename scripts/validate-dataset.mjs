// 資料集自我測試：build-dataset 產出後必須通過才可發佈
// 任何 error 都會以非零退出碼終止（CI 的資料更新流程會因此中止，網站保持舊資料）
//
// 檢查項目：
// 1. 每筆場站的 brands 不得重複、值必須合法、至少一個
// 2. id 不得重複
// 3. 名稱不得空白、不得殘留「不支援線上繳費」註記（應已移至備註）
// 4. 不得含「無配合信用卡優惠」類字樣（應已被排除）
// 5. 縣市必須在合法清單內
// 6. 座標若存在必須落在台灣範圍；不得有場站落在「縣市代表點」（地理編碼污染的特徵）
// 7. 總筆數不得異常偏低（防止來源改版導致爬蟲大量漏抓）
// 8. 無官方地址的場站（用場站名查地標補座標，可靠度較低）不得與其他不同名場站座標
//    完全相同（build-dataset 應已將這類誤配歸零並標記 geoPending，這裡是回歸防護）

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { lots } = JSON.parse(readFileSync(join(ROOT, 'data', 'parking-lots.json'), 'utf8'));

const VALID_BRANDS = new Set(['utg', 'carmochi', 'dodohome', 'tps', 'vivipark', 'parkinsys']);
const CITIES = new Set(['基隆市', '台北市', '新北市', '桃園市', '新竹縣市', '苗栗縣', '台中市', '彰化縣', '南投縣', '雲林縣', '嘉義縣市', '台南市', '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '台東縣', '澎湖縣', '金門縣', '連江縣']);
// 與 build-dataset.mjs 的 NO_DISCOUNT_RE 同步
const NO_DISCOUNT_RE = /不提供信用卡|無信用卡|不適用信用卡|[無不未]配合(提供)?信用卡/;
const MIN_TOTAL = 1350;

const errors = [];
const warnings = [];

const seenIds = new Set();
for (const l of lots) {
  const tag = `${l.id}「${l.name}」`;
  if (!l.name?.trim()) errors.push(`名稱空白: ${l.id}`);
  if (!Array.isArray(l.brands) || !l.brands.length) errors.push(`無品牌標籤: ${tag}`);
  else {
    if (new Set(l.brands).size !== l.brands.length) errors.push(`品牌標籤重複: ${tag} ${JSON.stringify(l.brands)}`);
    for (const b of l.brands) if (!VALID_BRANDS.has(b)) errors.push(`品牌值非法: ${tag} ${b}`);
  }
  if (seenIds.has(l.id)) errors.push(`id 重複: ${tag}`);
  seenIds.add(l.id);
  if (/不支援線上繳費/.test(l.name)) errors.push(`名稱殘留繳費註記（應移至備註）: ${tag}`);
  if (NO_DISCOUNT_RE.test(l.name + (l.note ?? ''))) errors.push(`含無信用卡優惠字樣（應排除）: ${tag}`);
  if (!CITIES.has(l.city)) errors.push(`縣市非法: ${tag} ${l.city}`);
  if (l.lat != null && (l.lat < 21 || l.lat > 26.5 || l.lng < 118 || l.lng > 122.5)) {
    errors.push(`座標超出台灣範圍: ${tag} ${l.lat},${l.lng}`);
  }
  if (l.lat == null && !l.geoPending) warnings.push(`無座標: ${tag}`);
  if (l.geoPending && l.lat != null) errors.push(`geoPending 卻仍有座標（應已歸零）: ${tag}`);
}

if (lots.length < MIN_TOTAL) errors.push(`總筆數異常偏低: ${lots.length}（下限 ${MIN_TOTAL}，來源可能改版導致漏抓）`);

// 縣市代表點污染：任何場站座標不得等於「只用縣市名查詢」的結果（存於 geocode 快取）
const cityKeyRe = /^(台北市|臺北市|新北市|桃園市|台中市|臺中市|台南市|臺南市|高雄市|基隆市|新竹市?縣?|苗栗縣|彰化縣|南投縣|雲林縣|嘉義市?縣?|屏東縣|宜蘭縣|花蓮縣|台東縣|臺東縣|澎湖縣|金門縣|連江縣)$/;
const centroids = new Map();
for (const f of ['geocode-cache.json', 'geocode-nlsc-cache.json']) {
  const p = join(ROOT, 'data', f);
  if (!existsSync(p)) continue;
  const cache = JSON.parse(readFileSync(p, 'utf8'));
  for (const [k, v] of Object.entries(cache)) {
    if (cityKeyRe.test(k) && v?.lat) centroids.set(`${v.lat},${v.lng}`, k);
  }
}
for (const l of lots) {
  if (l.lat == null) continue;
  const hit = centroids.get(`${l.lat},${l.lng}`);
  if (hit) errors.push(`座標為縣市代表點（地理編碼污染）: ${l.id}「${l.name}」← 快取鍵「${hit}」`);
}

// 大量場站擠在同一座標點（>=10 且名稱各異）也是污染特徵
const coordGroups = new Map();
for (const l of lots) {
  if (l.lat == null) continue;
  const k = `${l.lat},${l.lng}`;
  if (!coordGroups.has(k)) coordGroups.set(k, new Set());
  coordGroups.get(k).add(l.name);
}
for (const [k, names] of coordGroups) {
  if (names.size >= 10) errors.push(`同一座標擠了 ${names.size} 個不同場站（疑似污染）: ${k}`);
}

// 無地址場站的座標互撞（＝地理編碼誤配到不相關地點）：任何 >=2 個不同名稱都不該發生，
// build-dataset 的碰撞偵測應已攔下並歸零，這裡是回歸測試
const noAddrCoordGroups = new Map();
for (const l of lots) {
  if (l.address || l.lat == null) continue;
  const k = `${l.lat},${l.lng}`;
  if (!noAddrCoordGroups.has(k)) noAddrCoordGroups.set(k, new Set());
  noAddrCoordGroups.get(k).add(l.name);
}
for (const [k, names] of noAddrCoordGroups) {
  if (names.size >= 2) errors.push(`無地址場站座標互撞（疑似誤配到不相關地點）: ${k} ← ${[...names].join('、')}`);
}

for (const w of warnings) console.warn('警告:', w);
if (errors.length) {
  for (const e of errors) console.error('錯誤:', e);
  console.error(`\n驗證失敗：${errors.length} 個錯誤（警告 ${warnings.length} 個）`);
  process.exit(1);
}
console.log(`驗證通過：${lots.length} 筆場站，0 錯誤，${warnings.length} 個警告`);

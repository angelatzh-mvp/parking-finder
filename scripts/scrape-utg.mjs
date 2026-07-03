// 台灣聯通全台據點爬蟲
// 來源：官網 Vue App 使用的 WebSocket API（wss://www.taiwan-parking.com.tw/ada/public）
//       entity=parking, action=list_parkings，分頁取回全部場站（含經緯度）
// 輸出：data/utg-raw.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WS_URL = 'wss://www.taiwan-parking.com.tw/ada/public';
const PAGE_SIZE = 100;

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error(`WebSocket 連線失敗: ${e.message ?? e.type}`));
  });
}

let reqSeq = 0;
function request(ws, entity, action, payload, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const reqId = `scrape-${++reqSeq}`;
    const timer = setTimeout(() => reject(new Error(`請求逾時: ${action}`)), timeoutMs);
    const onMessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.req_id && data.req_id !== reqId) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      resolve(data);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ req_id: reqId, entity, action, payload }));
  });
}

const ws = await connect();
const all = [];
for (let page = 1; page <= 100; page++) {
  const res = await request(ws, 'parking', 'list_parkings', {
    row: PAGE_SIZE, page, city: '', district: '', parking_type: '',
  });
  const parkings = res.parkings ?? [];
  all.push(...parkings);
  console.log(`page ${page}: +${parkings.length} (累計 ${all.length})`);
  if (parkings.length < PAGE_SIZE) break;
  await new Promise((r) => setTimeout(r, 300));
}
ws.close();

// 只保留 App 需要的欄位；is_visible=0 的場站不對外顯示
const seen = new Set();
const lots = [];
for (const p of all) {
  if (p.is_visible === 0) continue;
  const key = p.parking_id ?? p.id;
  if (seen.has(key)) continue;
  seen.add(key);
  lots.push({
    parkingId: String(key),
    name: p.title?.trim() ?? '',
    city: p.county?.trim() ?? '',
    district: p.district?.trim() ?? '',
    // 部分地址帶有內部編號前綴（如「123 台北市…」），清掉
    address: (p.address ?? '').replace(/^[\d\s-]+(?=[^\d])/, '').trim(),
    lat: Number(p.latitude) || null,
    lng: Number(p.longitude) || null,
    maxHeight: p.max_height ?? null,
    totalSpace: p.total_space ?? null,
    note: p.description?.trim() || '',
    phone: p.contact_phone?.trim() || '',
  });
}

if (lots.length < 50) {
  throw new Error(`只取得 ${lots.length} 筆，疑似 API 變動，請人工檢查`);
}

const byCity = {};
for (const lot of lots) byCity[lot.city] = (byCity[lot.city] ?? 0) + 1;

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(
  join(ROOT, 'data', 'utg-raw.json'),
  JSON.stringify({ source: WS_URL, scrapedAt: new Date().toISOString(), count: lots.length, byCity, lots }, null, 2),
);
console.log(`utg: ${lots.length} 筆`);
console.log(byCity);

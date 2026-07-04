// 車麻吉「適用免費停車優惠」場站爬蟲
// 來源：https://help.carmochi.com/cityparking/available（server-rendered，官方每次調整會更新此頁）
// 輸出：data/carmochi-raw.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_URL = 'https://help.carmochi.com/cityparking/available';

const CITY_RE = /^📍\s*(.+?(?:縣市|縣|市))$/;
const LOT_RE = /^🅿️?\s*(.+)$/;

function htmlToLines(html) {
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(\/?)(p|li|h[1-6]|div|br|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

// 「名稱（備註）（地址）」→ 最後一組括號視為地址，其餘括號為備註
function parseLot(line) {
  const groups = [...line.matchAll(/[（(]([^（）()]*)[）)]/g)];
  if (groups.length === 0) return { name: line.trim(), note: '', address: '' };
  const last = groups[groups.length - 1];
  const address = last[1].trim();
  const name = line.slice(0, groups[0].index).trim();
  const note = groups
    .slice(0, -1)
    .map((g) => g[1].trim())
    .filter(Boolean)
    .join('；');
  const lot = { name, note, address };
  // 來源偶有未閉合括號（如「名稱（地址（別名）」）→ 名稱殘留的「（」後段視為地址、原地址降為備註
  const cut = lot.name.search(/[（(]/);
  if (cut !== -1) {
    const tail = lot.name.slice(cut + 1).trim();
    lot.note = [lot.note, lot.address].filter(Boolean).join('；');
    lot.address = tail;
    lot.name = lot.name.slice(0, cut).trim();
  }
  return lot;
}

const res = await fetch(SOURCE_URL, { headers: { 'user-agent': 'Mozilla/5.0' } });
if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SOURCE_URL}`);
const html = await res.text();
const lines = htmlToLines(html);

// 官方頁面上的更新日期（如「2026年6月26日」或「2026/6/26」）
let updatedAt = null;
for (const line of lines) {
  const m = line.match(/(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})/);
  if (m) {
    updatedAt = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    break;
  }
}

const lots = [];
let currentCity = null;
for (const line of lines) {
  const cityMatch = line.match(CITY_RE);
  if (cityMatch) {
    currentCity = cityMatch[1];
    continue;
  }
  if (!line.startsWith('🅿')) continue;
  const body = line.match(LOT_RE)?.[1] ?? line;
  const lot = parseLot(body.replace(/^️/, '').trim());
  if (!lot.name || !currentCity) continue;
  lots.push({ ...lot, city: currentCity });
}

if (lots.length < 300) {
  throw new Error(`只解析到 ${lots.length} 筆，疑似頁面改版，請人工檢查來源頁`);
}

const byCity = {};
for (const lot of lots) byCity[lot.city] = (byCity[lot.city] ?? 0) + 1;

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(
  join(ROOT, 'data', 'carmochi-raw.json'),
  JSON.stringify({ source: SOURCE_URL, updatedAt, scrapedAt: new Date().toISOString(), count: lots.length, byCity, lots }, null, 2),
);
console.log(`carmochi: ${lots.length} 筆，官方更新日 ${updatedAt}`);
console.log(byCity);

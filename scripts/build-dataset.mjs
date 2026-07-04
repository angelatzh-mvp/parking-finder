// 合併台灣聯通 + 車麻吉 → App 用的最終資料集 data/parking-lots.json
// - 統一縣市名稱（台/臺、新竹縣＋新竹市→新竹縣市，跟車麻吉官方分組一致）
// - 以正規化地址跨品牌去重：同場站掛雙品牌
// - id 用「正規化地址」的 hash，資料更新後保持穩定（收藏功能依賴這點）

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CITY_ALIAS = {
  臺北市: '台北市', 臺中市: '台中市', 臺南市: '台南市', 臺東縣: '台東縣',
  新竹市: '新竹縣市', 新竹縣: '新竹縣市', 嘉義市: '嘉義縣市', 嘉義縣: '嘉義縣市',
};
const canonCity = (c) => CITY_ALIAS[c?.trim()] ?? c?.trim() ?? '';

function toHalfWidth(s) {
  return s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

// 去重用的地址指紋：半形、臺→台、去空白與標點、去縣市前綴
function addrKey(city, address) {
  let a = toHalfWidth(address).replace(/臺/g, '台').replace(/[\s,，。()（）-]/g, '');
  a = a.replace(/^[^區鄉鎮市]*?(台北市|新北市|桃園市|台中市|台南市|高雄市|基隆市|新竹市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|屏東縣|宜蘭縣|花蓮縣|台東縣|澎湖縣|金門縣|連江縣)/, '');
  return canonCity(city) + '|' + a;
}

function hashId(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'p' + h.toString(36);
}

const districtOf = (address) => toHalfWidth(address).match(/^(.{1,4}?[區鄉鎮市])/)?.[1] ?? '';

// 行政區驗證：來源偶有把路名或「鄰近○○區」塞進行政區的髒資料，清不掉的寧可留空
function cleanDistrict(d) {
  if (!d) return '';
  d = d.trim().replace(/^鄰近/, '');
  if (!/^[一-鿿]{1,3}[區鄉鎮市]$/.test(d)) return '';
  if (/[路街道段巷弄]/.test(d)) return '';
  return d;
}

const utg = JSON.parse(readFileSync(join(ROOT, 'data', 'utg-raw.json'), 'utf8'));
const cm = JSON.parse(readFileSync(join(ROOT, 'data', 'carmochi-geo.json'), 'utf8'));

const byKey = new Map();

// App 的定位是「信用卡免費停車」，官方名稱明示不提供／無配合優惠的場站直接排除
const NO_DISCOUNT_RE = /不提供信用卡|無信用卡|不適用信用卡|[無不未]配合(提供)?信用卡/;

// 名稱中的「(不支援線上繳費)」類註記 → 移到備註，名稱保持乾淨
function splitPayNote(name) {
  let n = name;
  let payNote = null;
  const m = n.match(/[（(]+\s*([^()（）]*不支援線上繳費[^()（）]*)\s*[)）]+/);
  if (m) {
    payNote = m[1].trim();
    n = n.replace(m[0], '');
  }
  n = n.replace(/[（(]\s*[)）]/g, '').trim();
  return { name: n, payNote };
}

for (const l of utg.lots) {
  if (NO_DISCOUNT_RE.test(l.name + (l.note ?? ''))) continue;
  const { name, payNote } = splitPayNote(l.name);
  const key = addrKey(l.city, l.address);
  byKey.set(key, {
    id: hashId(key),
    brands: ['utg'],
    name,
    city: canonCity(l.city),
    district: cleanDistrict(l.district || districtOf(l.address.replace(/^.{2,3}[市縣]/, ""))),
    address: toHalfWidth(l.address),
    lat: l.lat,
    lng: l.lng,
    note: [l.note, payNote].filter(Boolean).join('；'),
    maxHeight: l.maxHeight,
    totalSpace: l.totalSpace,
  });
}

let merged = 0;
for (const l of cm.lots) {
  if (NO_DISCOUNT_RE.test(l.name + (l.note ?? ''))) continue;
  const key = addrKey(l.city, l.address);
  const hasAddr = key.split('|')[1] !== '';
  // 只有「地址非空」才能跨品牌合併；空地址的 key 沒有辨識力
  const existing = hasAddr ? byKey.get(key) : undefined;
  if (existing) {
    if (!existing.brands.includes('carmochi')) {
      // 跨品牌同地址 → 同一場站，掛雙品牌
      existing.brands.push('carmochi');
      if (l.note && !existing.note?.includes(l.note)) {
        existing.note = [existing.note, l.note].filter(Boolean).join('；');
      }
      merged++;
      continue;
    }
    // 同品牌同地址同名 → 來源重複列出，跳過
    if (existing.name === l.name) continue;
    // 同品牌同地址不同名（如中科停一～六站）→ 是不同場站，往下各自獨立保留
  }
  // 撞 key（或無地址）時以「key＋名稱」確保各場站獨立且 id 穩定
  const ownKey = existing || !hasAddr ? `${key}|${l.name}` : key;
  if (byKey.has(ownKey)) continue;
  byKey.set(ownKey, {
    id: hashId(ownKey),
    brands: ['carmochi'],
    name: l.name,
    city: canonCity(l.city),
    district: cleanDistrict(districtOf(l.address)),
    address: toHalfWidth(l.address),
    lat: l.lat,
    lng: l.lng,
    note: l.note || '',
    maxHeight: null,
    totalSpace: null,
  });
}

const lots = [...byKey.values()].filter((l) => l.name);

// 官方無地址的場站是用「縣市＋場站名」查地標補座標，可靠度較低：
// 業者品牌名（如「嘟嘟房」「鼎豐」）常被地理編碼服務誤配到同一個不相關的點。
// 若兩個以上不同名稱的無地址場站座標完全相同，視為誤配，全部歸零並標記待確認，
// 避免地圖顯示假座標、使用者被導航到錯的地方。
const noAddrByCoord = new Map();
for (const l of lots) {
  if (l.address || !l.lat) continue;
  const k = `${l.lat},${l.lng}`;
  if (!noAddrByCoord.has(k)) noAddrByCoord.set(k, []);
  noAddrByCoord.get(k).push(l);
}
let geoPending = 0;
for (const group of noAddrByCoord.values()) {
  if (new Set(group.map((l) => l.name)).size < 2) continue;
  for (const l of group) {
    l.lat = null;
    l.lng = null;
    l.geoPending = true;
    geoPending++;
  }
}

const noGeo = lots.filter((l) => !l.lat).length;

// id 不得重複（重複代表 hash 或去重邏輯出錯）
const ids = new Set(lots.map((l) => l.id));
if (ids.size !== lots.length) throw new Error('id 重複，請檢查去重邏輯');

const dataset = {
  meta: {
    builtAt: new Date().toISOString(),
    sources: {
      utg: { label: '台灣聯通', scrapedAt: utg.scrapedAt, count: utg.count },
      carmochi: { label: '車麻吉', updatedAt: cm.updatedAt, scrapedAt: cm.scrapedAt, count: cm.count },
    },
    total: lots.length,
    mergedBoth: merged,
    noGeo,
    geoPending,
  },
  lots,
};

writeFileSync(join(ROOT, 'data', 'parking-lots.json'), JSON.stringify(dataset, null, 1));
console.log(`完成：${lots.length} 筆（雙品牌 ${merged} 筆、無座標 ${noGeo} 筆、地址待確認 ${geoPending} 筆）`);
const byCity = {};
for (const l of lots) byCity[l.city] = (byCity[l.city] ?? 0) + 1;
console.log(byCity);

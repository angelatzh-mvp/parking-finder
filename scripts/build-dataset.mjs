// 合併台灣聯通 + 車麻吉 → App 用的最終資料集 data/parking-lots.json
// - 統一縣市名稱（台/臺、新竹縣＋新竹市→新竹縣市，跟車麻吉官方分組一致）
// - 以正規化地址跨品牌去重：同場站掛雙品牌
// - id 用「正規化地址」的 hash，資料更新後保持穩定（收藏功能依賴這點）

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

// 「核心地址」指紋：截到門牌號為止（丟掉樓層／方位／「停車場」等尾綴），用於跨品牌二次合併。
// 例：「延壽街168號B1-B2」「168號地下停車場」「168號後方空地」→ 同一核心地址 168號。
const CITY_PREFIX_RE = /^[^區鄉鎮市]*?(台北市|新北市|桃園市|台中市|台南市|高雄市|基隆市|新竹市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|屏東縣|宜蘭縣|花蓮縣|台東縣|澎湖縣|金門縣|連江縣)/;
function coreKey(city, address) {
  let a = toHalfWidth(address).replace(/臺/g, '台');
  const m = a.match(/^(.*?\d+(?:之\d+)?號)/); // 截到第一個「…號」
  if (m) a = m[1];
  a = a.replace(/[\s,，。()（）-]/g, '').replace(CITY_PREFIX_RE, '');
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
const dodo = JSON.parse(readFileSync(join(ROOT, 'data', 'dodohome-raw.json'), 'utf8')); // 嘟嘟房：官方自帶座標
const tps = JSON.parse(readFileSync(join(ROOT, 'data', 'tps-geo.json'), 'utf8')); // 24TPS：geocode 後
// 人工補校的地址／座標（來源：Autopass 官方場站圖資，比爬蟲缺漏的原始資料可靠）。
// 以「縣市|場站名」為 key——這正是空地址場站的 id 依據，所以補地址不會改變 id、不影響收藏。
const overridesPath = join(ROOT, 'data', 'address-overrides.json');
const overrides = existsSync(overridesPath)
  ? JSON.parse(readFileSync(overridesPath, 'utf8'))
  : {};

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

// 把一個品牌的場站併入 byKey：同地址跨品牌合掛雙品牌，撞 key／無地址則以「key＋名稱」獨立保留。
// utg 是首個種子來源（上方單獨處理其行政區邏輯），其餘品牌都走這裡。
let merged = 0;
function mergeBrand(brand, srcLots) {
  for (const l of srcLots) {
    if (NO_DISCOUNT_RE.test(l.name + (l.note ?? ''))) continue;
    const key = addrKey(l.city, l.address);
    const hasAddr = key.split('|')[1] !== '';
    // 只有「地址非空」才能跨品牌合併；空地址的 key 沒有辨識力
    const existing = hasAddr ? byKey.get(key) : undefined;
    if (existing) {
      if (!existing.brands.includes(brand)) {
        // 跨品牌同地址 → 同一場站，加掛品牌
        existing.brands.push(brand);
        if (l.note && !existing.note?.includes(l.note)) {
          existing.note = [existing.note, l.note].filter(Boolean).join('；');
        }
        // 既有場站缺座標、此來源帶可靠座標（如嘟嘟房官方座標）→ 補上
        if (existing.lat == null && l.lat != null) {
          existing.lat = l.lat;
          existing.lng = l.lng;
          delete existing.geoPending;
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
      brands: [brand],
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
}

mergeBrand('carmochi', cm.lots);
mergeBrand('dodohome', dodo.lots);
mergeBrand('tps', tps.lots);

let lots = [...byKey.values()].filter((l) => l.name);

// 套用人工補校圖資：只針對「缺地址或缺座標」的場站補上，不動已同時具備地址與座標的資料。
// 補上地址＋可靠座標後，該場站自然不再進入下方的無地址碰撞歸零與 geoPending。
let overridden = 0;
for (const l of lots) {
  const ov = overrides[`${l.city}|${l.name}`];
  if (!ov || (l.address && l.lat != null)) continue;
  l.address = toHalfWidth(ov.address);
  l.district = cleanDistrict(l.district || districtOf(ov.address.replace(/^.{2,3}[市縣]/, '')));
  l.lat = ov.lat;
  l.lng = ov.lng;
  delete l.geoPending;
  overridden++;
}

// 跨品牌同場站二次合併：主 addrKey 含樓層／方位尾綴，會讓「同一門牌號」的同一場站在不同品牌下分裂成多筆。
// 以「核心地址（截到門牌號）」歸併。放在補校之後，讓原本空地址、補校後才有地址的場站也能參與合併。安全閥：
//  1. 只在真正跨品牌時合併；
//  2. 若同一核心地址下「任一品牌出現 2 筆以上不同名場站」（如中科停一~六同址），視為同址多場站，整組不動，避免誤併；
//  3. 保留品牌資歷最高者（utg>carmochi>dodohome>tps）的 id → 既有收藏不受影響（dodohome/tps 為新品牌，尚無收藏）。
const BRAND_RANK = { utg: 0, carmochi: 1, dodohome: 2, tps: 3 };
const seniority = (l) => Math.min(...l.brands.map((b) => BRAND_RANK[b] ?? 99));
const coreGroups = new Map();
for (const l of lots) {
  if (!l.address) continue;
  const ck = coreKey(l.city, l.address);
  if (ck.split('|')[1] === '') continue;
  if (!coreGroups.has(ck)) coreGroups.set(ck, []);
  coreGroups.get(ck).push(l);
}
const removedIds = new Set();
let consolidated = 0;
for (const group of coreGroups.values()) {
  if (group.length < 2) continue;
  const brandCounts = {};
  for (const l of group) for (const b of l.brands) brandCounts[b] = (brandCounts[b] ?? 0) + 1;
  if (Object.values(brandCounts).some((c) => c > 1)) continue; // 同址多場站 → 不動
  if (new Set(group.flatMap((l) => l.brands)).size < 2) continue; // 非跨品牌 → 不動
  group.sort((a, b) => seniority(a) - seniority(b));
  const primary = group[0];
  for (const l of group.slice(1)) {
    for (const b of l.brands) if (!primary.brands.includes(b)) primary.brands.push(b);
    if (l.note && !primary.note?.includes(l.note)) primary.note = [primary.note, l.note].filter(Boolean).join('；');
    if (primary.lat == null && l.lat != null) { primary.lat = l.lat; primary.lng = l.lng; delete primary.geoPending; }
    removedIds.add(l.id);
    consolidated++;
  }
  primary.brands.sort((a, b) => BRAND_RANK[a] - BRAND_RANK[b]); // 標籤依品牌資歷排序，與地圖 pin 優先序一致
}
lots = lots.filter((l) => !removedIds.has(l.id));

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
      dodohome: { label: '嘟嘟房', scrapedAt: dodo.scrapedAt, count: dodo.count },
      tps: { label: '24TPS', scrapedAt: tps.scrapedAt, count: tps.count },
    },
    total: lots.length,
    mergedBoth: merged,
    consolidated,
    noGeo,
    geoPending,
    overridden,
  },
  lots,
};

writeFileSync(join(ROOT, 'data', 'parking-lots.json'), JSON.stringify(dataset, null, 1));
console.log(`完成：${lots.length} 筆（跨品牌合併 ${merged}＋二次合併 ${consolidated} 筆、人工補校 ${overridden} 筆、無座標 ${noGeo} 筆、地址待確認 ${geoPending} 筆）`);
const byCity = {};
for (const l of lots) byCity[l.city] = (byCity[l.city] ?? 0) + 1;
console.log(byCity);

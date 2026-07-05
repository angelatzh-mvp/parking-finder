// 產生「給人看的」每週更新報告，倒序 prepend 到 docs/UPDATE-LOG.md。
// 在 build + validate 之後、commit 之前執行（此時 git HEAD 仍是上週已部署的版本，用來對比）。
//
// 資料來源：
//   - 上週資料：git show HEAD:data/parking-lots.json（HEAD＝上次 commit＝上次部署內容）
//   - 本週資料：剛 build 出的 data/parking-lots.json
//   - Autopass 補校統計：data/.autopass-run.json（scrape-autopass 產出，已 gitignore）
// 變化以「場站 id」比對；id 穩定（縣市+名稱/地址 hash），所以能穩定判斷新增/移除/變更。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = join(ROOT, 'docs', 'UPDATE-LOG.md');
const LOG_TITLE = '# 小P帶路 — 資料更新報告\n\n> 每週自動更新時由 CI 產生，最新一筆在最上面。\n';
const MAX_LIST = 20; // 新增場站超過此數就折疊，不逐筆列（避免洗版）

const label = (l) => `${l.city}${l.district ? '' : ''}｜${l.name}`;
const byId = (ds) => new Map(ds.lots.map((l) => [l.id, l]));

// 台北時間字串 2026-07-06 05:12
function taipeiNow() {
  const p = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// ISO 時間 → 台北「MM-DD HH:mm」；無值回 —
function fmtTs(iso) {
  if (!iso) return '—';
  const p = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso)).reduce((o, x) => (o[x.type] = x.value, o), {});
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function prevDataset() {
  try {
    return JSON.parse(execSync('git show HEAD:data/parking-lots.json', { cwd: ROOT }).toString());
  } catch {
    return null; // 首次執行或取不到 → 視為無基準
  }
}

const cur = JSON.parse(readFileSync(join(ROOT, 'data', 'parking-lots.json'), 'utf8'));
const prev = prevDataset();
const run = existsSync(join(ROOT, 'data', '.autopass-run.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'data', '.autopass-run.json'), 'utf8')) : null;

// --- 品質指標（本週）---
const emptyAddr = cur.lots.filter((l) => !(l.address || '').trim()).length;
const q = `無座標 ${cur.meta.noGeo}｜假座標歸零 ${cur.meta.geoPending}｜空地址 ${emptyAddr}｜人工補校 ${cur.meta.overridden ?? 0}`;

// --- 對比上週 ---
let changeBlock;
if (!prev) {
  changeBlock = `- 首次建立報告，無上週基準可比對。\n- 本週總筆數：**${cur.meta.total}**\n- 品質指標：${q}`;
} else {
  const o = byId(prev), n = byId(cur);
  const added = [...n.values()].filter((l) => !o.has(l.id));
  const removed = [...o.values()].filter((l) => !n.has(l.id));
  const changed = [];
  for (const [id, nl] of n) {
    const ol = o.get(id);
    if (!ol) continue;
    const diffs = [];
    if ((ol.address || '') !== (nl.address || '')) diffs.push(`地址「${ol.address || '（空）'}」→「${nl.address || '（空）'}」`);
    if (ol.lat !== nl.lat || ol.lng !== nl.lng) diffs.push('座標更動');
    if (diffs.length) changed.push({ l: nl, diffs });
  }
  const delta = cur.meta.total - prev.meta.total;
  const sign = delta > 0 ? `+${delta}` : `${delta}`;

  const lines = [`- 總筆數：${prev.meta.total} → **${cur.meta.total}**（${sign}）`];
  // 新增
  if (!added.length) lines.push('- 🆕 新增場站：（無）');
  else if (added.length > MAX_LIST) lines.push(`- 🆕 新增場站：共 ${added.length} 筆（數量較多，詳見 data/parking-lots.json）`);
  else lines.push('- 🆕 新增場站：\n' + added.map((l) => `  - ${label(l)}`).join('\n'));
  // 移除（一律逐筆）
  lines.push(removed.length ? '- ❌ 移除場站：\n' + removed.map((l) => `  - ${label(l)}`).join('\n') : '- ❌ 移除場站：（無）');
  // 變更（一律逐筆）
  lines.push(changed.length ? '- ✏️ 地址／座標變更：\n' + changed.map((c) => `  - ${label(c.l)}：${c.diffs.join('、')}`).join('\n') : '- ✏️ 地址／座標變更：（無）');
  lines.push(`- 品質指標：${q}`);
  changeBlock = lines.join('\n');
}

// --- 資料來源 ---
const m = cur.meta, src = m.sources || {};
const pm = prev?.meta?.sources || {};
const srcDelta = (k) => (prev && pm[k] ? (() => { const d = (src[k]?.count ?? 0) - (pm[k]?.count ?? 0); return d > 0 ? `+${d}` : `${d}`; })() : '—');
const srcRows = [
  `| 台灣聯通 | ${fmtTs(src.utg?.scrapedAt)} | ${src.utg?.count ?? '—'} | ${srcDelta('utg')} |`,
  `| 車麻吉 | ${fmtTs(src.carmochi?.scrapedAt)} | ${src.carmochi?.count ?? '—'} | ${srcDelta('carmochi')} |`,
  run
    ? `| Autopass 補校 | 本次 | ${run.confirmed} 筆（掃 ${run.counties.length} 縣市 · ${run.requests} 請求） | — |`
    : `| Autopass 補校 | — | 未執行/無統計 | — |`,
].join('\n');

// --- 待處理 / 異常 ---
const issues = [];
const stillMissing = run?.skipped ?? [];
issues.push(stillMissing.length
  ? '- ⚠️ 仍缺資料且 Autopass 查無（需人工）：\n' + stillMissing.map((s) => `  - ${s}`).join('\n')
  : '- ✅ 缺資料場站已全數補齊，無待人工項目。');
const orphanNoGeo = cur.lots.filter((l) => l.lat == null && !l.geoPending).length;
if (orphanNoGeo) issues.push(`- ⚠️ 無座標且未標記 geoPending：${orphanNoGeo} 筆`);
if (run?.failed) issues.push(`- ⚠️ Autopass 抓取失敗請求（重試後仍失敗）：${run.failed}`);

// --- 組段落 ---
const section = `## ${taipeiNow()}（台北時間） · ✅ 驗證通過

### 資料來源
| 來源 | 抓取時間 | 筆數 | 較上週 |
| --- | --- | --- | --- |
${srcRows}

### 資料集變化
${changeBlock}

### 待處理 / 異常
${issues.join('\n')}

### 驗證與部署
- 驗證：✅ 通過（${cur.meta.total} 筆，0 錯誤）
- 部署：接續由 deploy job 發佈到 GitHub Pages

---
`;

mkdirSync(dirname(LOG), { recursive: true });
const existing = existsSync(LOG) ? readFileSync(LOG, 'utf8').replace(LOG_TITLE, '') : '';
writeFileSync(LOG, LOG_TITLE + '\n' + section + '\n' + existing.replace(/^\n+/, ''));
console.log(`已更新 ${LOG}`);

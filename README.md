# 小P帶路｜免費停車場

快速找到「台灣聯通」與「車麻吉」信用卡免費停車的場站。純靜態 Web App（PWA），零後端。

**🌐 正式網址：https://angelatzh-mvp.github.io/parking-finder/**（手機開啟後可「加入主畫面」當 App 用）

部署：GitHub Pages；資料更新：GitHub Actions 每週一 05:00（台北時間）自動跑爬蟲並重新部署。

## 資料管線

```
scripts/scrape-utg.mjs        台灣聯通官網 WebSocket API（自帶座標）
scripts/scrape-carmochi.mjs   車麻吉幫助中心「免停場站」頁（official 名單，頁面帶更新日期）
scripts/geocode-carmochi.mjs  Nominatim 地理編碼（帶快取，只查新增地址）
scripts/geocode-fallback.mjs  NLSC 國土測繪備援（補 Nominatim 查不到的門牌/交叉口）
scripts/build-dataset.mjs     合併、去重（雙品牌掛雙標籤）、排除「不提供信用卡優惠」場站
scripts/audit-coords.mjs      座標可疑度稽核 → 寫進 docs/待確認位置.md（只回報不改資料）
```

更新資料（每週跑一次即可）：

```bash
node scripts/scrape-utg.mjs
node scripts/scrape-carmochi.mjs
node scripts/geocode-carmochi.mjs   # 有快取，增量很快
node scripts/geocode-fallback.mjs
node scripts/build-dataset.mjs
node scripts/audit-coords.mjs        # 座標稽核，NLSC 有快取、只查新增地址
cp data/parking-lots.json web/data/
```

## 本地預覽

```bash
python3 -m http.server 8642 --directory web
```

## 注意事項

- 場站 `id` 是「縣市＋正規化地址」的 hash——收藏功能依賴它跨資料更新保持穩定，改 hash 邏輯會讓使用者的收藏失效。
- 爬蟲有防呆：筆數異常偏低（來源改版徵兆）會直接報錯。
- 車麻吉的免停名單會變動，官方頁面上的更新日期會顯示在 App 頂部。

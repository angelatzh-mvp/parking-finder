# 免費停車場 Finder

快速找到「台灣聯通」與「車麻吉」信用卡免費停車的場站。純靜態 Web App（PWA），零後端。

## 資料管線

```
scripts/scrape-utg.mjs        台灣聯通官網 WebSocket API（自帶座標）
scripts/scrape-carmochi.mjs   車麻吉幫助中心「免停場站」頁（official 名單，頁面帶更新日期）
scripts/geocode-carmochi.mjs  Nominatim 地理編碼（帶快取，只查新增地址）
scripts/geocode-fallback.mjs  NLSC 國土測繪備援（補 Nominatim 查不到的門牌/交叉口）
scripts/build-dataset.mjs     合併、去重（雙品牌掛雙標籤）、排除「不提供信用卡優惠」場站
```

更新資料（每週跑一次即可）：

```bash
node scripts/scrape-utg.mjs
node scripts/scrape-carmochi.mjs
node scripts/geocode-carmochi.mjs   # 有快取，增量很快
node scripts/geocode-fallback.mjs
node scripts/build-dataset.mjs
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

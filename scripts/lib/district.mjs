// 行政區推導的共用邏輯（build-dataset 與 build-seo 共用）。
//
// 背景：台灣聯通（utg）來源的 raw district 欄位填的是「縣市名」（如「台北市」）而非真正
// 的行政區，但 address 內含正確資訊（如「台北市松山區八德路4段580號」）。若直接採信 raw
// district，App 的縣市→行政區兩層篩選會多出一個等於縣市名的假「行政區」，真正行政區也會漏站。
//
// 對策：一律「以地址推導優先」——去掉縣市前綴後取第一個 …區/鄉/鎮/市；地址推導失敗才退回
// raw district（並套用基本清洗）；最後把「等於縣市名」的值視為無效清成空字串。
//
// 註：新竹市／嘉義市這類「省轄市併入縣市分組（新竹縣市／嘉義縣市）」的場站，其地址無下級行政
// 區，推導後會落在 raw district「新竹市」「嘉義市」——這是該分組內有意義的細分，非本次要修的
// bug（不等於 canonical 縣市名「新竹縣市」「嘉義縣市」，故保留）。

const CITY_PREFIX = /^(台北市|臺北市|新北市|桃園市|台中市|臺中市|台南市|臺南市|高雄市|基隆市|新竹市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|屏東縣|宜蘭縣|花蓮縣|台東縣|臺東縣|澎湖縣|金門縣|連江縣)/;

export function toHalfWidth(s) {
  return String(s ?? '').replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

// 從場站推導行政區。l: { address, city, district? }。city 應為最終顯示用（canonical）的縣市名。
export function realDistrict(l) {
  const a = toHalfWidth(l.address || '').replace(/臺/g, '台').replace(CITY_PREFIX, '');
  const m = a.match(/^([一-鿿]{1,3}?[區鄉鎮市])/); // 非貪婪：停在第一個區/鄉/鎮/市，避免「中山區市民大道」被吃成「中山區市」
  let d = m ? m[1] : '';
  // 地址推導失敗才退回 raw district，並套用基本清洗（去「鄰近」前綴、排除含路名的髒值）
  if (!d && l.district) {
    const raw = l.district.trim().replace(/^鄰近/, '');
    if (/^[一-鿿]{1,3}[區鄉鎮市]$/.test(raw) && !/[路街道段巷弄]/.test(raw)) d = raw;
  }
  if (d === l.city) d = ''; // 「等於縣市名」一律視為無效（如 district=台北市）
  return d;
}

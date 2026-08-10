# 銀行信用卡市區停車頁 — 擴充調研（2026-08-10）

目前 `scripts/build-seo.mjs` 的 `BANK_DATA` 只有 5 家：台新、中信、國泰世華、玉山、富邦。
本文件是「下一批該加哪些銀行」的 survey，**未做任何程式改動**。

---

## 1. 市佔率盤點：現有 5 家已經吃掉頭部

金管會銀行局的月報只公布「32 家發卡機構」的加總（2026/5 底：流通卡 5,971 萬張、有效卡 4,013 萬張、
單月簽帳 4,202 億元），逐行明細要下載「信用卡重要業務及財務資訊揭露」的月報表。
公開報導的**有效流通卡數前 5 名＝中信、台北富邦、玉山、國泰世華、台新**——
也就是**我們已經全部收錄**。

→ 結論：**再往下加不能只看市佔，會遇到報酬遞減**。第二批的排序應該用兩個軸：
1. **發卡規模**（中段發卡行：聯邦、星展、永豐、上海商銀、兆豐、第一、華南、遠東、新光、元大、合庫、台銀…）
2. **品牌互補性**（能不能補上小P資料集裡「銀行覆蓋很薄」的品牌）

### 品牌覆蓋現況（現有 5 家 × 資料集 6 品牌）

| 品牌 | 站數 | 目前有幾家銀行 | 缺口 |
|---|---|---|---|
| 車麻吉 carmochi | ~684（最大） | 2（台新、中信） | 🔴 最大品牌但銀行最薄 |
| 嘟嘟房 dodohome | ~367 | 4 | 🟢 |
| 台灣聯通 utg | ~236 | 5 | 🟢 |
| ViVi PARK | ~229 | 1（國泰世華） | 🔴 |
| 24TPS 永固 | ~33 | 4 | 🟢 |
| 銓營 parkinsys | ~19 | 2 | 🟠 |

**車麻吉＋ViVi PARK 合計約 900 站，卻只被 2/1 家銀行覆蓋** ——
使用者在這兩個品牌的場站上，很可能在 `cardAdviceHtml` 裡看到「只能辦某一家」的誤導性建議。
補這兩個品牌的銀行，對 App 內「辦哪張卡」與 SEO 長尾都是最高槓桿。

---

## 2. 建議優先序

### 🥇 第一批（強烈建議，3 家）— 規模中上 ＋ 直接補品牌缺口

| 銀行 | 為什麼 | 涵蓋品牌 | 官方 source |
|---|---|---|---|
| **聯邦** | **唯一一次補齊 5 個品牌**（含車麻吉＋ViVi＋銓營），是所有銀行裡品牌覆蓋最廣的一家；且有官方「資格查詢」頁可直接導流，對使用者極實用 | 台灣聯通・車麻吉・嘟嘟房・ViVi PARK・詮營 | 活動頁 https://activity.ubot.com.tw/aws_act/freeparking/index.htm ・資格查詢 https://card.ubot.com.tw/eCard/CarService/qryFreeParking.aspx |
| **上海商銀** | 車麻吉＋ViVi 雙補；官方頁條件寫得很清楚（3 小時／月上限 5 次、限實體卡過卡） | 台灣聯通・車麻吉・嘟嘟房・ViVi PARK | https://www.scsb.com.tw/content/card/card04_c.html |
| **兆豐** | 官股大行、發卡量中上；有獨立「市區停車」權益頁＋紅利折抵制（商旅卡 300 點／小時），且補車麻吉／ViVi | 台灣聯通・車麻吉・嘟嘟房・ViVi PARK（需逐項核實） | https://www.megabank.com.tw/personal/credit-card/rights/city-parking |

### 🥈 第二批（規模型，補 SEO 搜尋量）

| 銀行 | 備註 | 官方 source |
|---|---|---|
| **星展** | 卡別高端、討論度高，但**優惠限週六日**（豐盛無限卡／飛行世界卡：前月新增消費滿 2 萬，次月週末每日 1 次 2 小時）→ 是很好的「差異化提醒」素材，別讓使用者白跑 | 權益頁 https://www.dbs.com.tw/personal-zh/cards/dbs-cards-benefits/city-parking.page ・積分兌換 https://www.dbs.com.tw/personal-zh/cards/rewards/bonus_redeem_city_parking |
| **永豐** | 發卡量中上，有專屬市區停車頁（2–4 小時級距） | https://bank.sinopac.com/sinopacbt/personal/credit-card/discount/612270601.html |
| **第一銀行** | 官股；免費停車（嘟嘟房／台灣聯通）＋紅利折抵 ViVi PARK（800 點／1 小時、1600 點／2 小時），**兩種機制並存**，是很好的頁面內容 | 權益頁 https://card.firstbank.com.tw/sites/Satellite?c=CreditCard&cid=1565692760570&d=Touch&pagename=FirstBankCard/CreditCard/zh/CardActivityDetailView ・調整公告 https://card.firstbank.com.tw/sites/card/zh_TW/1565700674524 |
| **華南** | 官股；門檻級距寬（3,000–20,000）＋覆蓋 4 品牌含 ViVi | https://www.hncb.com.tw/wps/portal/HNCB/card/benefit/card/city_park |
| **合庫** | 官股、卡數不小；每日 1 次 2 小時（無限金鑽卡 3 小時），含 ViVi＋24TPS | https://www.tcb-bank.com.tw/personal-banking/credit-card/interests/parking2022 |

### 🥉 第三批（長尾，做完再說）

| 銀行 | 備註 | source 狀態 |
|---|---|---|
| 新光 | ⚠️ 適用場含**叭叭房**（我們資料集沒有這品牌）→ 收錄時要標「部分場站不在小P名單」 | https://www.skbank.com.tw/card_friends_right/card_friends_right/111/ |
| 元大 | 門檻高（12,888–28,888），受眾窄；含永固＋詮營 | https://www.yuantabank.com.tw/bank/creditCard/right/list.do?right_id=交通類權益 |
| 彰銀 | 台灣聯通／ViVi PARK 各一頁 | https://www.bankchb.com/frontend/mashup.jsp?funcId=6b9b8b1615 （台灣聯通）／ funcId=8530280f15 （ViVi PARK） |
| 遠東商銀、台中銀、臺灣銀行、臺灣企銀、陽信 | 都有停車優惠但發卡規模小 | ❌ **官方頁尚未定位到**，需再查（見待辦） |

---

## 3. 交叉核對用的第三方彙整（僅當 checklist，不當 source）

這幾篇是「有哪些銀行有優惠」的完整名單，用來**確認我們沒漏銀行**；
但頁面上的數字**一律以銀行官方頁為準**（既有 `BANK_VERIFIED` 規則）。

- 卡優新聞網 19 家整理 https://www.cardu.com.tw/message/detail.php?32241=
- Money101 20+ 家整理 https://www.money101.com.tw/blog/信用卡-市區停車-免費-紅利點數-停車神卡
- Roo.Cash 各銀行免費市區停車大全 https://roo.cash/blog/parking-creditcard-discount/
- 市場先生 停車信用卡推薦 https://rich01.com/free-car-parking-creidt-cards/
- 停車場方視角（反查哪些銀行合作）：嘟嘟房卡友專區 https://www.dodohome.com.tw/p3_dodocard.aspx ・車麻吉說明 https://help.carmochi.com/cityparking/howto

**跨源對照發現的名單差異（需人工判定）**：第三方多寫「中興嘟嘟房」而官方常寫「嘟嘟房」——
同一品牌；另外部分整理把國泰世華只寫「中興嘟嘟房」，與我們現行 `BANK_BRANDS.國泰世華`
（utg/dodohome/tps/vivipark/parkinsys）不一致 → 上線前要以國泰世華官方頁再確認一次。

---

## 4. 落地時的實作 note（給未來的自己）

1. `BANK_BRANDS` / `BANK_OFFICIAL` / `BANK_DATA` 三個表都要同步加，`BANK_VERIFIED` 要更新查證日。
2. `cardAdviceHtml()` 的 `common = ['utg','dodohome','tps']` 是硬寫的「大多都能停」清單；
   銀行變多後這個假設要重算（車麻吉／ViVi 若被 4+ 家覆蓋，就該進 common）。
3. `app.js` 的折抵彈窗底部「依銀行查」目前是 5 顆 pill，加銀行後會擠 → 375px 要重驗，
   考慮改成兩行或「更多銀行」連到 hub。加 web/ 改動記得 **bump `sw.js` CACHE 版本**。
4. **折抵機制有三型**，頁面文案要分清楚（現行只講到 swipe / appbind）：
   - 消費滿額免費（台新、中信、聯邦、華南…）
   - **紅利／點數折抵**（國泰世華小樹點、玉山 e-Points、富邦紅利、第一 800 點、兆豐 300 點、星展活利積分）
   - 車麻吉／ViVi 的 **App 綁卡自動折抵**
5. 星展「限週末」這類**時段限制**目前 `BANK_DATA` 沒有欄位可放 → 建議加 `limit` 欄位，
   不然會誤導使用者平日白跑。

## ✅ 實作進度（2026-08-10）

**第一批＋第二批 8 家已全部落地**：聯邦、上海商銀、兆豐、星展、永豐、第一銀行、華南、合庫
→ 銀行頁 5 → **13 頁**，SEO 總頁數 220 → **228**。每家的 tiers 都逐一從上表的官方頁抄出核實。

實作時一併處理的三件事：
- **新增 `limit` 欄位**（時段限制）：目前只有星展有值，會多渲染一條 🗓️ 警示 note、
  並寫進 meta description 與 FAQ，避免使用者平日白跑。

### 🔧 星展補完（2026-08-10，12 張卡全查）
第一版只放了 2 張卡、且誤寫成「星展全卡限週六日」。**實際只有頂級卡限週末**。
資料來源：市區停車專區列出 12 張卡，但每張的細則要點進該卡商品頁的「注意事項」才有
（`dbs_Insignia`／`travel_world_elite`／`travelworld`／`infinite`／`dbs_Vantage`／
`livefresh_biz_signature_ipass`／`dbs-credit-cards/livefresh`／`everyday_titanium`／
`everyday_2023`／`everyday`／`yours_signature_business_card`）。已逐頁 curl 核實。三級結構：
- **週末 4 小時**：極耀無限卡、飛行世界之極卡（嘟嘟房＋台灣聯通）
- **週末 2 小時**：飛行世界卡／飛行世界商務卡、豐盛無限卡（嘟嘟房＋台灣聯通）；
  **（豐盛）晶耀無限卡只有台灣聯通、不含嘟嘟房**
- **天天 2 小時**：炫晶商務御璽卡、炫晶御璽卡、炫晶鈦金卡、everyday 鈦金／威士白金／威士御璽卡、優仕商務卡（皆僅台灣聯通）
- everyday 系列另有低門檻方案：當月有一筆消費 → 天天每日 1 次 1 小時，**每次折抵 100 點活利積分**
  （這與通案的「活利積分 600 點兌 1 小時」是兩回事，別混用）
- 重要規則：**每卡每月只適用一種優惠**；不符停車權益時，星展會自動扣回饋點數折抵停車費且無法取消。核卡當月不適用。
- ⚠️ **星展炫晶鈦金卡**官網已改連「卡友權益手冊 PDF」（無商品頁），本機沒有 PDF 轉文字工具
  （poppler／pymupdf 都沒裝）→ 該列以市區停車專區的分級（天天 2 小時）呈現，門檻標「依卡友權益手冊」。
  若要補精確門檻，需先 `brew install poppler`。
- **`verified` 改為可逐家覆寫**：`BANK_DATA[bank].verified` 優先於全域 `BANK_VERIFIED`。
  新 8 家＝2026-08-10，舊 5 家維持 2026-08-07（沒重查就不改日期）。
- **「該辦哪張卡」的硬寫銀行名全部改成動態**：原本 `exclusive` 寫死「車麻吉只有台新／中信」，
  現改由 `BANK_BRANDS` 反查計算（<2/3 家配合＝差異關鍵品牌，≤1/3 才說「只有」），
  以後再加銀行不會產出過時說法。`BANK_REC`（門檻／時數摘要＋ease）也補了 8 家。

**品牌覆蓋缺口已明顯改善**（銀行家數）：車麻吉 2→**5**、ViVi PARK 1→**7**、
24TPS 4→**7**、銓營 2→**3**、台灣聯通／嘟嘟房 5→**13**。全台頁排序也因此改變：
聯邦（涵蓋 1,474 站／98%）、兆豐與上海商銀（1,466 站／97%）現在排在中信、台新之前。

**外部品牌註記**：這 8 家的適用場站都落在小Ｐ收錄的 6 個品牌內，無須額外註記。
第三批的**新光**適用場含「叭叭房」，小Ｐ帶路未支援該品牌（也不打算新增）；
未來收錄新光時，需在頁面簡要註明「叭叭房不在小Ｐ名單內」。

## 5. 待辦（下一步）

- [ ] 下載銀行局「信用卡重要業務及財務資訊揭露」月報表，把第二／三批的排序用**實際有效卡數**釘死
      （https://www.banking.gov.tw/ch/home.jsp?id=591&parentpath=0,590&mcustomize=multimessage_view.jsp&dataserno=21207&dtable=Disclosure）
- [ ] 補查 遠東商銀／台中銀／臺灣銀行／臺灣企銀／陽信 的官方停車頁 URL
- [ ] 逐家把 tiers（卡別×門檻×免費時數×適用品牌）從官方頁抄出來核實，含國泰世華現有資料的複查
- [ ] 決定第一批就上 3 家還是連第二批 8 家一起（頁數 5 → 8 或 13，sitemap 連帶）

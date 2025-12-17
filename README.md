# 心情扭蛋機 (Mood Gashapon Machine)

## 專案簡介
心情扭蛋機是一款結合 AI 與心理療癒元素的心情日記 App。使用者先選擇當下情緒並寫下文字描述，再透過「扭蛋」儀式取得 AI 量身打造的任務。系統會將任務、日記與匿名漂流瓶紀錄同步到 Firebase，並以玻璃擬態的粉嫩界面呈現，協助使用者在日常中養成覺察與療癒習慣。

## 核心功能清單
- **AI 任務扭蛋**：扭蛋按鈕會根據選擇的心情 (壓力、焦慮、開心、疲憊、迷茫、平靜等) 與日記描述，呼叫自建的 AI 後端 API (`/generate-task`) 產出任務，並在 Lottie 扭蛋動畫與音效中展示結果。
- **心情日記時間軸**：每次扭蛋前的紀錄會寫入 Firestore，並於「心情日記」區塊以時間軸形式顯示，支援依心情濾器過濾與內容編修。
- **心情漂流瓶（匿名社交）**：勾選匿名分享即可把文字投入漂流瓶，其他人可撈取瓶子、回覆或送出鼓勵，系統會推播抱抱通知。
- **AI 心情週報**：週報按鈕會收集本週日記內容，將整理後的 prompt 送往 AI API，由導師口吻回傳情緒脈絡、成長亮點與暖心處方箋。
- **響應式設計 (RWD)**：透過 CSS Grid/Flex layout 與媒體查詢，確保手機、平板與桌面都能無縫切換，包含左側懸浮的任務面板與頂部導覽列。

## 技術棧 (Tech Stack)
- **前端**：HTML5、CSS3 (CSS Variables、Flexbox/Grid)、Vanilla JavaScript (ES6 module)。
- **後端 / 資料庫**：Firebase Authentication + Firestore 同步使用者、任務、日記與漂流瓶資料。
- **動畫**：Lottie-web 讀取 `Generator.json` 扭蛋動畫，搭配客製音效增添儀式感。
- **截圖**：`html2canvas` 將心情概覽卡片輸出為 JPG，方便分享完成週報或數據。

## 安裝與運行說明
1. **安裝依賴**：本專案為原生前端專案，可直接使用任何靜態伺服器 (如 `npm i -g serve` 後 `serve .`，或 VS Code Live Server)。
2. **設定 Firebase**：將專案專屬的 `firebaseConfig` 置於 `app.js`。若使用其他專案，請同步更新 Authentication / Firestore 規則與 collections (`logs`, `pending`, `favs`, `bottles`)。
3. **部署 AI 後端**：在 Render (或任何 Python/Node 服務) 架設 `/generate-task` API，需能接收 emotion/description/diary 並回傳任務內容；部署後更新 `BACKEND_URL`。
4. **啟動應用**：於瀏覽器開啟 `index.html`，從 `login.html` 完成 Firebase 登入後即可體驗扭蛋、心情日記、漂流瓶與週報功能。
5. **截圖與匯出**：在「心情概覽」頁面可使用 `📸 儲存心情小卡` 與 `匯出紀錄` 按鈕，需保持 `html2canvas` script 可正確載入。

## 視覺風格描述
整體色系採柔和粉嫩色搭配玻璃擬態卡片 (`backdrop-filter: blur`) 與透明光暈陰影，營造療癒雲霧感。背景覆蓋粉彩插畫 (`assets/gacha-bg.png`)，字體混合 Klee One 與 Noto Sans TC，讓標題具手寫風情、內文保持閱讀性。情緒籤、任務卡與漂流瓶採用不同漸層與圓角，配合 RWD 伸縮，呈現輕盈、溫暖又有儀式感的互動體驗。

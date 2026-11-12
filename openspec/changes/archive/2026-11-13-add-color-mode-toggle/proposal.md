# Proposal

## Why

Sincey 目前只有淺色介面，使用者無法依當下閱讀情境改用深色。加入簡單、暫時性的明暗切換，延續既有溫暖記事風格，讓使用者自行選擇畫面配色。

## What Changes

- 提供全站共用的淺色／深色切換入口，首次載入與重新整理皆預設淺色。
- 切換立即套用到首頁、新增、編輯、備份頁，以及載入、錯誤、確認與提示狀態；應用內換頁維持目前模式。
- 深色採暖深灰背景、柔和米白文字與灰綠點綴；淺色沿用現有視覺。
- 將既有固定色碼整理成可切換的共用語意色彩，涵蓋互動、停用與鍵盤焦點狀態。
- 不跟隨系統、不記住偏好，不新增主題 API、資料庫欄位或備份欄位。

## Capabilities

### New Capabilities

- `color-mode`: 兩種配色的手動切換、載入預設、應用內生命週期與全站一致呈現。

### Modified Capabilities

無。既有 `event-records` 的溫暖、柔和中性色規則仍適用，事件、匿名存取與備份行為不變。

## Impact

- 前端：`client/App.tsx` 的共用頁首與主題狀態、`client/style.css` 的顏色變數、`client/index.html` 的初始顯示與瀏覽器配色提示。
- 測試及文件：新增 Playwright 主題行為與顯示驗證，補充 README 的使用說明。
- 沿用現有 TypeScript、React、Vite 與 Tailwind CSS v4 整合，符合專案技術棧；不新增依賴、不更動 package-lock、後端或 migrations。

# Proposal

## Why

生活中常會忘記上次洗牙、回診、購物或與朋友見面的日期。建立一個沒有提醒與打卡壓力的生活記事網站，同時作為完整前後端開發的練習作品。

## What Changes

- 建立手機優先、繁體中文、溫暖簡潔的網站，記錄任何生活事件的最近一次日期與備註。
- 提供事件新增、編輯、刪除、標題搜尋，以及「今天做囉」與短暫復原。
- 每件事只保存最新日期，更新時保留備註；支援未知日期與過去日期。
- 以匿名瀏覽器憑證區分伺服器上的資料，不提供登入或自動跨裝置同步。
- 提供備份匯出與確認後完整取代的匯入。
- 不納入提醒、歷史日記、分類、標籤、附件、離線同步、成就或評分。

## Capabilities

### New Capabilities

- `event-records`: 事件內容、日期、列表排序、搜尋與快速更新復原。
- `anonymous-data-access`: 匿名資料隔離、持久保存與連線失敗處理。
- `data-backup`: 備份檔匯出、驗證、預覽與完整取代還原。

### Modified Capabilities

無；目前沒有既有主規格。

## Impact

目前專案只有 OpenSpec 與規範，沒有應用程式、套件清單或 lockfile。本變更將規劃全新 TypeScript 應用：React + Vite、React Router、Tailwind CSS v4 以上，以及 Node.js LTS + Express、Zod、Prisma、PostgreSQL；品質工具為 ESLint、Prettier、Playwright。

新增直接依賴須在實作安裝前說明用途、替代方案與必要性並取得使用者同意；本提案不安裝依賴。資料儲存由原先討論的手機本地調整為已確認的伺服器儲存；手機僅保存匿名存取憑證。

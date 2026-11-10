# Design

## Context

專案目前只有 AGENTS.md、技能與 OpenSpec 設定，沒有應用程式、既有 API、資料庫、套件清單或 lockfile。動機見 proposal.md；行為契約見三份 delta specs。採用 AGENTS.md 明定技術；其中「資料庫與 ORM：〈指定方案〉」仍是佔位文字，本設計依同檔明確指定的 PostgreSQL + Prisma，不另選方案。

## Goals / Non-Goals

**Goals:**
- 以單一網站來源連接 React 與 JSON REST API，建立容易練習與部署的完整資料流程。
- 集中處理驗證、匿名授權、日期與交易，避免不同入口行為不一致。

**Non-Goals:**
- 不建立事件歷史表、離線佇列、帳號或多裝置身分恢復機制。
- 不在本規劃階段安裝依賴、選定付費平台或寫應用程式。

## Decisions

### 專案與依賴

規劃 `client/`（React、Vite、React Router、Tailwind CSS v4 以上）、`server/`（Node.js LTS、Express）、`shared/`（純 TypeScript 資料契約）、`prisma/`（schema 與 migrations）、`tests/`（Playwright）。採單一套件管理工具與 lockfile；目前沒有既有工具，建議實作前連同依賴清單確認採 npm。TypeScript、Zod、Prisma、ESLint、Prettier、Playwright 與建置整合依賴須逐項說明用途、替代方案、必要性並獲同意後才安裝。版本在實作時確認相容性並鎖定，不預先猜測版本。

替代方案為拆成多個獨立儲存庫或加入額外狀態管理／日期套件；第一版以單一儲存庫、React 內建功能及平台日期能力降低工具負擔。

### 同來源服務與匿名身分

正式環境 Express 同時提供 `/api` 與前端靜態資源，非 API 路由回傳前端入口；開發時 Vite 代理 `/api`。優先同來源，避免額外跨來源設定。

`POST /api/anonymous-session` 初始化身分；有效既有憑證不重建。Node.js 內建加密功能產生高熵隨機憑證，僅將雜湊保存在 PostgreSQL。使用持久 HttpOnly、正式環境 Secure、SameSite=Strict cookie；開發環境依本機 HTTP 調整 Secure。所有修改請求驗證來源且要求 JSON。不得記錄原始憑證或完整私人請求內容。

替代方案 localStorage bearer token 較容易因腳本存取而外洩，故採 cookie。匿名憑證就是授權依據，沒有帳號找回；備份不攜帶憑證。cookie 遺失時舊資料不會自動刪除，也無法重新連結。首次初始化完成前不允許事件操作，避免建立多個身分。

### 資料模型與隔離

`AnonymousSpace`：id、tokenHash（唯一）、createdAt。

`Event`：id、spaceId（外鍵）、title、lastDoneOn（可空 PostgreSQL DATE）、note、revision、createdAt、updatedAt。建立 spaceId 與日期查詢所需索引；每次修改遞增 revision。標題不設唯一限制，不建歷史表。

所有服務查詢皆帶 spaceId，單筆查詢使用事件 ID 與 spaceId 雙條件；不屬於目前空間的 ID 統一回應 404。缺少或無效憑證回應 401，不返回事件。用不同瀏覽器 context 驗證隔離，涵蓋備份入口。

### 日期、排序與表單

API 傳遞 `YYYY-MM-DD | null`，禁止將日曆日期轉成會隨時區偏移的 ISO 時間戳。用戶端送出 IANA 裝置時區，伺服器驗證時區並以自己的時鐘計算該區今天，拒絕未來與不存在日期；這只用於輸入一致性，不作安全授權。

前端以日曆日差計算距今天數，避免夏令時間的小時差；重新聚焦或跨午夜時更新今天與按鈕狀態。列表先日期降冪、空值最後，同日以繁體中文標題排序，同標題以 ID 作穩定排序。第一版資料全部載入後在前端搜尋與排序，不引入分頁。

首頁 `/` 提供列表、搜尋、空狀態及新增入口；`/events/new` 與 `/events/:id/edit` 共用表單，`/backup` 提供備份。日期預設今天但可清空；搜尋新增帶入標題。保留載入、錯誤與未送出表單狀態，備註當純文字呈現。

### REST API 與快速復原

所有 API 請求與回應皆為 JSON（空 body 操作送 `{}`），錯誤統一 `{ error: { code, message, fields? } }`。Zod 在伺服器驗證所有寫入及備份，前端共用可用的契約。基本入口：

| 方法與路徑 | 用途 |
|---|---|
| POST /api/anonymous-session | 初始化匿名憑證 |
| GET /api/events | 列出自己的全部事件 |
| POST /api/events | 新增事件 |
| PATCH /api/events/:id | 修改標題、日期或備註，帶 revision |
| DELETE /api/events/:id | 刪除自己的事件，回傳確認 JSON |
| GET /api/backup | 匯出備份 JSON |
| POST /api/backup/preview | 驗證備份並回傳筆數 |
| POST /api/backup/import | 再次驗證並原子取代 |

「今天做囉」與復原沿用 PATCH；前端只在成功後變更顯示，暫存前一日期與回應 revision，5 秒內顯示復原。復原只改日期；revision 不符回應 409 並重新載入，避免覆寫其他分頁的新修改。這個暫存不落地成歷史紀錄。

寫入中停用重複送出。新增操作帶穩定的用戶端生成 UUID，重試相同 ID 不得建立第二筆；若內容與已存內容不同則回傳衝突。遇到回應遺失先重新讀取確認，不盲目重送破壞性操作。匯入後清除舊復原入口與快取。

### 備份格式與交易

備份格式 `{ version: 1, exportedAt, events: [{ title, lastDoneOn, note }] }`，不含原事件 ID、revision、spaceId 或憑證。匯出當下讀取完整一致資料；下載使用 JSON Blob。匯入保留同名與空日期，產生新的事件 ID。

預覽時顯示目前與備份筆數及「完整取代」說明。確認時伺服器再次驗證全部檔案，於 Prisma transaction 內刪除目前 space 的事件再建立匯入事件；任一步失敗回滾。序列化同一 space 的寫入，避免取代與並行新增交錯。格式與版本錯誤均在刪除前拒絕；零筆備份也須確認。

替代方案合併匯入需要額外去重與衝突規則，與已確認範圍不符。檔案／欄位上限作防止無界請求的實作設定，前後端一致並顯示錯誤；不靜默截斷資料。

## Risks / Trade-offs

- [匿名憑證遺失即失去原資料存取] → 清楚說明並提供備份；不暗示可找回或同步。
- [只存最近一次無法回顧日記] → 備註定位為當前資訊，更新日期不清除備註。
- [依賴連線、寫入可能成功但回應遺失] → 顯示失敗與重試、保留輸入，重試前重新確認資料並防止重複新增。
- [公開匿名建立可能被濫用] → 限制請求大小與合理流量，不記錄敏感資料；部署前檢查 cookie、來源驗證及資料隔離。
- [匿名空間可能長期無法存取] → 第一版不自動清除資料，後續若要保存期限需另訂規格。

## Migration Plan

1. 取得新增依賴與套件管理工具同意，建立應用、環境變數範本及忽略規則；`.env` 不提交。
2. 建立 PostgreSQL schema 與初始 migration，在獨立測試資料庫驗證；無舊資料需遷移。
3. 完成 API、介面及 Playwright 主要流程，執行型別、lint、格式與建置檢查。
4. 部署至支援 Node.js 與 PostgreSQL 的環境，設定 DATABASE_URL、網站來源與安全 cookie，執行 migration，再做手機與隔離煙霧測試。平台與費用另行確認，不在提案中建立付費資源。
5. 回退時還原前一應用版本；正式資料庫先備份，不以破壞性 reset 回退。尚未有相容版本時停止服務並修正，不刪除使用者資料。

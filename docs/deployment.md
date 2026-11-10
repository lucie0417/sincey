# 部署與回退

尚未選定公開部署平台；本文件是可執行步驟，不代表已部署或完成公開 HTTPS／實體手機驗收。選擇支援長駐 Node.js LTS、PostgreSQL 與 HTTPS 的環境，先確認費用與資料庫備份政策。

## 環境變數

| 名稱              | 用途                                                          |
| ----------------- | ------------------------------------------------------------- |
| DATABASE_URL      | PostgreSQL 連線字串，正式環境使用專屬資料庫與帳密             |
| PORT              | Express 監聽埠，預設 3001                                     |
| APP_ORIGIN        | 對外完整來源，例如 `https://sincey.example.com`，不含尾端斜線 |
| NODE_ENV          | 正式環境設定 `production`，啟用 Secure cookie 與靜態頁面      |
| TEST_DATABASE_URL | 僅測試使用，絕不可指向正式 DB                                 |

透過平台秘密設定或未提交的 `.env` 管理。建置階段需要開發依賴（TypeScript、Vite、Prisma），不可在建置前省略 devDependencies。

## 部署步驟

```sh
npm ci
npm run build
npm run db:migrate
npm start
```

Express 提供 `dist/client` 與 `/api`，由反向代理終止 HTTPS，維持同一來源並轉發至 PORT。不要公開 PostgreSQL 埠；正式環境不使用 compose 的示範帳密。`/api/health` 只回傳可用狀態，不暴露連線設定。

部署前檢查：

- migration 已在測試 DB 驗證，正式 DB 有可還原備份。
- APP_ORIGIN 精確匹配 HTTPS 網站來源。
- 回應 cookie 有 HttpOnly、Secure、SameSite=Strict、Path=/，沒有 token 出現在 URL、回應 JSON 或記錄中。
- 首頁與 `/events/new` 直接重新整理可開啟；API 不被 SPA fallback 攔截。
- 不同匿名瀏覽器互不可讀寫、匯出或取代他人的資料。
- 以實際手機完成新增、搜尋、編輯、更新、復原、刪除、備份及還原。

目前初始化限流以程序記憶體保存，每分鐘每來源 IP 最多 30 個新空間；單實例足夠供練習驗收。多實例或公開大量使用前需在入口代理配置可信來源與限流，避免將所有使用者混成同一來源或讓流量繞過限制。所有修改驗證 Origin，不開放任意跨來源 CORS。

## 回退

先停止新流量並保存資料庫備份。若前一應用版本相容現有 schema，回復前一部署映像或原始碼與 lockfile，重新建置後啟動；不執行 `prisma migrate reset` 或刪除 volume。首版沒有舊應用可退回時，停止服務、修正後重新部署，保留資料庫。

本地停止可用 `docker compose stop`；`docker compose down` 保留 volume。不要加 `--volumes`，除非明確要刪除全部本地事件。

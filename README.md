# Sincey

記住生活裡「上次是什麼時候」。繁體中文、手機優先的生活記事練習作品。

## 本機開發

需求：Node.js 22.18.0 以上的相容 LTS、npm、Docker Desktop。依賴版本已鎖定於 `package-lock.json`，請使用 npm，不混用其他套件管理工具。

```sh
npm ci
cp .env.example .env
docker compose up -d --wait
npm run db:generate
npm run db:migrate
npm run dev
```

開啟 <http://localhost:5173>。前端 Vite 會代理 `/api` 至 Express（3001）；`npm run dev` 同時啟動兩者，Ctrl+C 停止。也可分別執行 `npm run dev:client`、`npm run dev:server`。

若手機透過區網存取開發伺服器，請將 `.env` 的 `APP_ORIGIN` 改成實際前端網址（例如 `http://電腦區網IP:5173`），並重啟服務。正式環境必須使用 HTTPS。Docker 資料庫只綁定電腦本機 55432 埠，不對區網開放。

## 使用方式

- 新增標題即可；日期預設今天，也能清空或補登過去。備註之後再補。
- 列表由最近日期新到舊排列，同日依標題排序，未知日期在最後；可搜尋部分標題。
- 「今天做囉」只更新日期、保留備註，成功後 5 秒內可復原；沒有歷史紀錄。
- 點事件標題編輯完整內容；刪除需要再次確認。
- 不做提醒、逾期警告、打卡評分或自動跨裝置同步。

## 資料與隱私

事件存放在 PostgreSQL 伺服器。瀏覽器的 HttpOnly cookie 保存匿名憑證，資料庫只保存憑證雜湊；不是手機本地資料庫，也沒有登入帳號。

只有原瀏覽器可以直接存取。清除網站資料、更換瀏覽器／手機或 cookie 到期（最多 400 天，瀏覽器也可能提早清除）後，無法找回原資料的存取方式。舊資料不會自動刪除。請定期備份；新瀏覽器匯入會建立獨立資料，不會同步原瀏覽器。

## 測試與品質

測試只使用獨立 `sincey_test` 資料庫；不要將 `TEST_DATABASE_URL` 指向開發或正式資料庫。測試會建立匿名資料並暫時加入資料庫 trigger 驗證回滾，需要測試資料庫的表與函式管理權限。

```sh
docker compose exec -T db createdb -U sincey sincey_test
DATABASE_URL=postgresql://sincey:sincey_local@localhost:55432/sincey_test npm run db:migrate
npx playwright install chromium
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

`createdb` 只需執行一次，已存在會回報錯誤。測試自動建置並啟動正式模式網站於 localhost:5174；測試資料庫可用環境變數 `TEST_DATABASE_URL` 覆寫。瀏覽器測試模擬手機尺寸，不代表已完成實體手機與公開 HTTPS 部署驗收。

詳細文件：[API](docs/api.md)、[備份](docs/backup.md)、[部署與回退](docs/deployment.md)、[本機驗收紀錄](docs/verification.md)。

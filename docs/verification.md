# 本機驗收紀錄

日期：2026-11-10。變更：`build-last-time-tracker`。

## 已執行

- Node.js 22.18.0、npm 11.7.0；直接依賴已依使用者同意安裝並鎖定，未更換指定框架或資料庫。
- PostgreSQL 17 容器健康，開發與獨立測試資料庫的初始 migration 均成功。
- `npm run build` 成功：Prisma Client 產生、TypeScript 檢查、Vite 前端與後端編譯。
- `npm run typecheck`、`npm run lint`、`npm run format:check` 通過。
- `npm test`：14 項通過（16.3 秒），以實際 PostgreSQL 與 Chromium 執行。
- 開發服務 `http://localhost:5173` 成功載入；Vite 代理僅匹配 `/api` 路徑，避免攔截 `api.ts` 模組。
- 手機寬度與桌面畫面已檢視；手機主要流程無水平溢出，搜尋可用鍵盤操作。
- `.env` 確認被 git 忽略；範本不含正式秘密。

測試涵蓋：匿名初始化與持久性、不同空間隔離、來源驗證、輸入／日期驗證、同名事件、新增重試、revision 衝突、列表排序、搜尋新增、編輯刪除、今天更新與復原到期、跨午夜與時區、斷線及回應遺失、備份下載與新瀏覽器還原、格式錯誤、空備份、交易失敗回滾、並行取代與容量上限回滾。

## 依賴檢查

`npm audit --omit=dev`：0 項漏洞。完整 audit 仍有 7 項 moderate 公告，來自開發用 `typescript-eslint` 的 `minimatch` 相依鏈（GHSA-g3hv-75wg-m249）。未執行會任意改變已鎖定直接依賴版本的 audit fix。ESLint 9.39.5 安裝亦提示已停止支援；目前 lint 可正常執行。後續可另行確認 ESLint 主要版本升級與相容性，再更新工具鏈。

## 尚未完成

- 未選定公開部署平台、主機、網域與費用，未建立外部付費資源。
- 未驗證公開 HTTPS 的 Secure cookie、反向代理設定及公開路由。
- 手機測試為 Chromium 模擬尺寸，尚未做實體手機公開網站驗收。

因此 tasks 6.2、6.3 保持未完成，不將本機測試視為部署驗收。部署與回退步驟見 [deployment.md](deployment.md)。

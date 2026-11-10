# REST API

所有 API 回應為 JSON；修改請求使用 `Content-Type: application/json`，並帶與 `APP_ORIGIN` 完全一致的 `Origin`。瀏覽器自動攜帶匿名 cookie。日期寫入、備份預覽及匯入需帶有效 `X-Timezone` IANA 時區（例如 `Asia/Taipei`）。

| 方法與路徑                  | 請求                                       | 回應                                 |
| --------------------------- | ------------------------------------------ | ------------------------------------ |
| POST /api/anonymous-session | `{}`                                       | `{ ready: true }`，設定或重用 cookie |
| GET /api/health             | 無                                         | `{ ok: true }`，檢查 DB              |
| GET /api/events             | 無                                         | `{ events: Event[] }`                |
| POST /api/events            | `{ id, title, lastDoneOn, note }`          | `{ event: Event }`                   |
| PATCH /api/events/:id       | `{ revision, title?, lastDoneOn?, note? }` | `{ event: Event }`                   |
| DELETE /api/events/:id      | `{}`                                       | `{ deleted: true }`                  |
| GET /api/backup             | 無                                         | 備份物件                             |
| POST /api/backup/preview    | 備份物件                                   | `{ current, incoming }`              |
| POST /api/backup/import     | 備份物件                                   | `{ imported }`                       |

`Event` 包含 `id`、`title`、`lastDoneOn`、`note`、`revision`。UUID 由新增操作產生並在重試時沿用，相同內容不重複建立；同 ID 不同內容回應 409。標題去除前後空白後須 1–200 字元，備註最多 10,000 字元。日期為 `YYYY-MM-DD` 或 null，不能晚於伺服器計算的裝置時區今天。每個空間最多 5,000 筆；請求上限 2 MB。

更新必須攜帶讀取到的 revision，成功後遞增；衝突回應 409，不覆寫新資料。今天更新與復原只傳 lastDoneOn 及 revision，備註不變。排序與部分標題搜尋由前端完成。

每個資料空間的完整備份（含格式化 JSON）上限為 2 MB，新增、更新或匯入超過時整筆交易回滾並回應 422。此限制確保所有可保存資料都能完整匯出再匯入。

錯誤格式：`{ error: { code, message, fields? } }`。400 格式／日期錯誤；401 憑證無效；403 來源不符；404 不存在或不屬於目前空間；409 版本或 ID 衝突；413 請求過大；415 非 JSON；422 事件數量上限；429 匿名初始化過於頻繁；500 暫時性伺服器錯誤。不回傳資料庫細節或原始憑證。

本機範例（cookie 檔含私人存取權限，請勿提交或分享）：

```sh
curl -c /tmp/sincey-cookie.txt -H 'Origin: http://localhost:5173' -H 'Content-Type: application/json' -d '{}' http://localhost:3001/api/anonymous-session
curl -b /tmp/sincey-cookie.txt -H 'Origin: http://localhost:5173' -H 'Content-Type: application/json' -H 'X-Timezone: Asia/Taipei' -d '{"id":"00000000-0000-4000-8000-000000000001","title":"洗牙","lastDoneOn":null,"note":"帶健保卡"}' http://localhost:3001/api/events
curl -b /tmp/sincey-cookie.txt http://localhost:3001/api/events
```

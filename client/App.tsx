import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { api, ApiError, deviceTimezone, initialize, listEvents } from './api.js';
import {
  backupSchema,
  compareEvents,
  contentSchema,
  dayDifference,
  limits,
  todayIn,
  type Backup,
  type EventRecord,
} from '../shared/contracts.js';

type Undo = { id: string; previous: string | null; revision: number; expires: number };
type Store = {
  events: EventRecord[];
  reload: () => Promise<void>;
  today: string;
  setUndo: (value: Undo | null) => void;
  notice: (text: string) => void;
};
const Context = createContext<Store>(null!);
const message = (error: unknown) => (error instanceof Error ? error.message : '操作失敗，請重試');

export function App() {
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light');
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [today, setToday] = useState(() => todayIn(deviceTimezone()));
  const [undo, setUndo] = useState<Undo | null>(null);
  const [toast, setToast] = useState('');
  const [undoBusy, setUndoBusy] = useState(false);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previousMode = root.getAttribute('data-color-mode');
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousThemeColor = themeColor?.content;
    root.dataset.colorMode = colorMode;
    if (themeColor) {
      themeColor.content = getComputedStyle(root).getPropertyValue('--color-page').trim();
    }
    return () => {
      if (previousMode === null) root.removeAttribute('data-color-mode');
      else root.setAttribute('data-color-mode', previousMode);
      if (themeColor && previousThemeColor !== undefined) themeColor.content = previousThemeColor;
    };
  }, [colorMode]);
  const reload = useCallback(async () => {
    setEvents(await listEvents());
  }, []);
  const boot = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      await initialize();
      await reload();
      setStatus('ready');
    } catch (err) {
      setError(message(err));
      setStatus('error');
    }
  }, [reload]);
  useEffect(() => {
    void boot();
  }, [boot]);
  useEffect(() => {
    const refresh = () => setToday(todayIn(deviceTimezone()));
    const timer = window.setInterval(refresh, 1000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), Math.max(0, undo.expires - Date.now()));
    return () => clearTimeout(timer);
  }, [undo]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function restore() {
    if (!undo || undoBusy) return;
    setUndoBusy(true);
    try {
      await api(`/events/${undo.id}`, 'PATCH', {
        lastDoneOn: undo.previous,
        revision: undo.revision,
      });
      setUndo(null);
      await reload();
      setToast('已恢復原本的日期');
    } catch (err) {
      setToast(message(err));
      if (err instanceof ApiError && err.status === 409) {
        setUndo(null);
        await reload().catch(() => {});
      }
    } finally {
      setUndoBusy(false);
    }
  }
  return (
    <Context.Provider value={{ events, reload, today, setUndo, notice: setToast }}>
      <div className="shell">
        <header className="topbar">
          <Link to="/" className="brand" aria-label="Sincey 首頁">
            <span className="brand-mark">s.</span>sincey<span className="brand-dot">°</span>
          </Link>
          <div className="header-actions">
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setColorMode((mode) => (mode === 'light' ? 'dark' : 'light'))}
            >
              {colorMode === 'light' ? '切換為深色' : '切換為淺色'}
            </button>
            <Link to="/backup" className="quiet-link">
              備份與還原 <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </header>
        <main>
          {status === 'loading' ? (
            <div className="state" role="status">
              正在打開你的生活記事…
            </div>
          ) : status === 'error' ? (
            <div className="state">
              <h1>暫時連不上你的記事</h1>
              <p role="alert">{error}</p>
              <button onClick={() => void boot()}>重新連線</button>
            </div>
          ) : (
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/events/new" element={<EventForm key="new" />} />
              <Route path="/events/:id/edit" element={<EventForm />} />
              <Route path="/backup" element={<BackupPage />} />
              <Route
                path="*"
                element={
                  <div className="state">
                    <h1>這一頁走丟了</h1>
                    <Link to="/">回到記事</Link>
                  </div>
                }
              />
            </Routes>
          )}
        </main>
        <footer>
          <span>生活不用趕，記得就好。</span>
          <span>僅原瀏覽器可直接存取 · 請定期備份</span>
        </footer>
      </div>
      {undo && (
        <div className="undo" role="status">
          <span>日期已更新</span>
          <button disabled={undoBusy} onClick={() => void restore()}>
            {undoBusy ? '復原中…' : '復原'}
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </Context.Provider>
  );
}

function Home() {
  const { events, reload, today, setUndo } = useContext(Context);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [retryId, setRetryId] = useState<string | null>(null);
  const visible = [...events]
    .sort(compareEvents)
    .filter((event) => event.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  async function done(event: EventRecord, retry = false) {
    setBusy(event.id);
    setError('');
    setRetryId(null);
    try {
      // 回應遺失時先讀取；不以舊 revision 盲目覆寫。
      if (retry) {
        const latest = await listEvents();
        await reload();
        const current = latest.find((item) => item.id === event.id);
        if (!current || current.revision !== event.revision) return;
      }
      const result = await api<{ event: EventRecord }>(`/events/${event.id}`, 'PATCH', {
        revision: event.revision,
        lastDoneOn: today,
      });
      setUndo({
        id: event.id,
        previous: event.lastDoneOn,
        revision: result.event.revision,
        expires: Date.now() + 5000,
      });
      await reload();
    } catch (err) {
      setError(message(err));
      setRetryId(event.id);
      if (err instanceof ApiError && err.status === 409) await reload().catch(() => {});
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <section className="hero">
        <div className="eyebrow">
          <span className="tiny-dot" /> A LITTLE NOTE TO LIFE
        </div>
        <h1>
          上次，
          <br className="mobile-break" />
          是什麼時候<span className="serif">？</span>
        </h1>
        <p>
          那些生活裡的小事，
          <br className="mobile-break" />
          放在這裡，就不用一直放在心上。
        </p>
        <span className="hero-scribble" aria-hidden="true">
          ✳
        </span>
      </section>
      <section className="records" aria-label="生活記事">
        <div className="section-top">
          <div>
            <h2>
              我的生活記事 <span>{events.length.toString().padStart(2, '0')}</span>
            </h2>
            <p>最近做過的，放在最前面</p>
          </div>
          <Link
            className="button primary"
            to={`/events/new${query.trim() ? `?title=${encodeURIComponent(query.trim())}` : ''}`}
          >
            <span aria-hidden="true">＋</span> 記一件小事
          </Link>
        </div>
        <label className="search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="搜尋事件標題"
            placeholder="找找那件事…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="search-hint">搜尋標題</span>
        </label>
        {error && (
          <div className="error" role="alert">
            {error}
            {retryId && (
              <button
                disabled={busy !== null}
                onClick={() => {
                  const event = events.find((item) => item.id === retryId);
                  if (event) void done(event, true);
                }}
              >
                重新確認並重試
              </button>
            )}
          </div>
        )}
        <div className="list-head" aria-hidden="true">
          <span>生活裡的大小事</span>
          <span>最近一次</span>
        </div>
        {visible.length === 0 ? (
          <div className="empty">
            <span className="empty-flower" aria-hidden="true">
              ✳
            </span>
            <h3>{query ? '還沒找到這件小事' : '從一件小事開始'}</h3>
            <p>
              {query
                ? '也許，它正等著被你記下來。'
                : '洗牙、買保健食品，或和朋友見面。\n想得起標題，就能先記下來。'}
            </p>
            <Link className="button" to={`/events/new?title=${encodeURIComponent(query.trim())}`}>
              {query ? `記下「${query.trim()}」` : '建立第一筆記事'}{' '}
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
        ) : (
          <div className="event-list">
            {visible.map((event, index) => {
              const days = event.lastDoneOn ? dayDifference(event.lastDoneOn, today) : null;
              return (
                <article className="event-card" key={event.id} data-testid="event-card">
                  <span className="event-index" aria-hidden="true">
                    {(index + 1).toString().padStart(2, '0')}
                  </span>
                  <Link to={`/events/${event.id}/edit`} className="event-content">
                    <h3>{event.title}</h3>
                    <p className={event.note ? 'note' : 'note muted'}>
                      {event.note || '留一點備註，給下次的自己'}
                    </p>
                  </Link>
                  <div className="event-date">
                    <strong>
                      {days === null
                        ? '尚未記錄'
                        : days === 0
                          ? '就是今天'
                          : days > 0
                            ? `${days} 天前`
                            : `${Math.abs(days)} 天後`}
                    </strong>
                    <time dateTime={event.lastDoneOn ?? undefined}>
                      {event.lastDoneOn?.replaceAll('-', '.') ?? '想起來時再補上'}
                    </time>
                  </div>
                  <button
                    className="done-button"
                    disabled={busy !== null || event.lastDoneOn === today}
                    onClick={() => void done(event)}
                  >
                    {busy === event.id
                      ? '記錄中…'
                      : event.lastDoneOn === today
                        ? '✓ 今天做過囉'
                        : '今天做囉'}
                    {event.lastDoneOn !== today && <span aria-hidden="true"> ↗</span>}
                  </button>
                </article>
              );
            })}
          </div>
        )}
        <div className="list-bottom">
          <span aria-hidden="true">✧</span> 不用每天記，想起來的時候再來。
        </div>
      </section>
    </>
  );
}

function EventForm() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { events, reload, today, setUndo, notice } = useContext(Context);
  const existing = events.find((event) => event.id === id);
  const draftId = useRef(crypto.randomUUID());
  const [title, setTitle] = useState(
    existing?.title ?? new URLSearchParams(location.search).get('title') ?? '',
  );
  const [date, setDate] = useState(existing ? (existing.lastDoneOn ?? '') : today);
  const [note, setNote] = useState(existing?.note ?? '');
  const [revision, setRevision] = useState(existing?.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [submitted, setSubmitted] = useState<{
    title: string;
    note: string;
    lastDoneOn: string | null;
  } | null>(null);
  if (id && !existing)
    return (
      <div className="state">
        <h1>找不到這件事</h1>
        <Link to="/">回到記事</Link>
      </div>
    );
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const parsed = contentSchema(deviceTimezone()).safeParse({
        title,
        lastDoneOn: date || null,
        note,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const content = parsed.data;
      let expectedRevision = revision;
      if (uncertain) {
        const latest = await listEvents();
        const saved = latest.find((item) => item.id === (id ?? draftId.current));
        if (
          saved &&
          submitted &&
          saved.title === submitted.title &&
          saved.note === submitted.note &&
          saved.lastDoneOn === submitted.lastDoneOn
        ) {
          if (
            content.title === saved.title &&
            content.note === saved.note &&
            content.lastDoneOn === saved.lastDoneOn
          ) {
            await reload();
            navigate('/');
            notice('已確認記事儲存成功');
            return;
          }
          setRevision(saved.revision);
          expectedRevision = saved.revision;
          if (!id) {
            await reload();
            navigate(`/events/${saved.id}/edit`);
            notice('前次已儲存，請在編輯頁繼續修改');
            return;
          }
        } else if (id && saved && saved.revision !== revision) {
          setUncertain(false);
          await reload();
          throw new Error('事件已更新；你的輸入仍保留。請先按「載入最新內容」查看，避免覆蓋。');
        }
      }
      setSubmitted(content);
      const result = await api<{ event: EventRecord }>(
        id ? `/events/${id}` : '/events',
        id ? 'PATCH' : 'POST',
        id
          ? {
              ...content,
              revision: expectedRevision,
            }
          : { ...content, id: draftId.current },
      );
      setRevision(result.event.revision);
      setUncertain(false);
      setUndo(null);
      await reload();
      navigate('/');
      notice(id ? '記事已更新' : '小事記下來了');
    } catch (err) {
      setError(message(err));
      setUncertain(err instanceof ApiError && err.status === 0);
    } finally {
      setBusy(false);
    }
  }
  async function latest() {
    setBusy(true);
    try {
      const record = (await listEvents()).find((item) => item.id === id);
      if (!record) throw new Error('這筆事件已刪除');
      setTitle(record.title);
      setDate(record.lastDoneOn ?? '');
      setNote(record.note);
      setRevision(record.revision);
      setError('');
      setUncertain(false);
      await reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError('');
    try {
      const latest = await listEvents();
      if (latest.some((item) => item.id === id)) await api(`/events/${id}`, 'DELETE');
      setUndo(null);
      await reload();
      navigate('/');
      notice('記事已刪除');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="form-page">
      <Link to="/" className="back-link">
        ← 回到生活記事
      </Link>
      <div className="eyebrow">A SMALL THING TO REMEMBER</div>
      <h1>{id ? '留給下次的自己' : '記下一件小事'}</h1>
      <p className="subtitle">只要一個標題，細節可以慢慢補。</p>
      <form onSubmit={(event) => void save(event)} className="form-card">
        <label>
          事情的標題 <span className="required">必填</span>
          <input
            autoFocus
            required
            maxLength={limits.title}
            value={title}
            placeholder="例如：洗牙、和朋友見面"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          最近一次是
          <input
            type="date"
            max={today}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <span className="field-help">忘了也沒關係，可以留空，之後再補。</span>
        </label>
        <label>
          備註 <span className="optional">選填</span>
          <textarea
            rows={5}
            maxLength={limits.note}
            value={note}
            placeholder="品牌、地點，或一點想留住的細節…"
            onChange={(event) => setNote(event.target.value)}
          />
          <span className="field-help">按「今天做囉」時，這裡的文字會保留。</span>
        </label>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <Link to="/" className="button secondary">
            取消
          </Link>
          <button type="submit" disabled={busy}>
            {busy ? '處理中…' : uncertain ? '確認結果並重試' : '存好囉'}
          </button>
        </div>
        {id && (
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => void latest()}
          >
            載入最新內容
          </button>
        )}
      </form>
      {id && (
        <div className="delete-area">
          {confirmDelete ? (
            <>
              <p>確定刪除「{existing?.title}」？刪除後無法復原。</p>
              <button className="danger" disabled={busy} onClick={() => void remove()}>
                確定刪除
              </button>
              <button className="secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>
                保留這件事
              </button>
            </>
          ) : (
            <button className="text-button danger-text" onClick={() => setConfirmDelete(true)}>
              刪除這件事
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function BackupPage() {
  const { reload, setUndo, notice } = useContext(Context);
  const [backup, setBackup] = useState<Backup | null>(null);
  const [preview, setPreview] = useState<{ current: number; incoming: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function exportFile() {
    setBusy(true);
    setError('');
    try {
      const data = await api<Backup>('/backup');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sincey-${todayIn(deviceTimezone())}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notice('備份已匯出，請妥善保存檔案');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function selectFile(file?: File) {
    setBackup(null);
    setPreview(null);
    setError('');
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > limits.bytes) throw new Error('備份檔不得超過 2 MB');
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        throw new Error('備份檔不是有效的 JSON');
      }
      const parsed = backupSchema(deviceTimezone()).safeParse(raw);
      if (!parsed.success)
        throw new Error(`備份格式或日期不正確：${parsed.error.issues[0].message}`);
      const counts = await api<{ current: number; incoming: number }>(
        '/backup/preview',
        'POST',
        parsed.data,
      );
      setBackup(parsed.data);
      setPreview(counts);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function importFile() {
    if (!backup) return;
    setBusy(true);
    setError('');
    try {
      await api('/backup/import', 'POST', backup);
      setUndo(null);
      await reload();
      setBackup(null);
      setPreview(null);
      notice('備份已還原');
    } catch (err) {
      setPreview(null);
      setBackup(null);
      setUndo(null);
      setError(`${message(err)} 請先返回記事確認目前資料，再重新選取備份，避免重複取代。`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="form-page">
      <Link to="/" className="back-link">
        ← 回到生活記事
      </Link>
      <div className="eyebrow">KEEP YOUR LITTLE MEMORIES</div>
      <h1>把小事，好好收著</h1>
      <p className="subtitle">帶走一份備份，也為記憶留一個安心的位置。</p>
      <div className="info-card">
        <h2>關於你的資料</h2>
        <p>
          記事保存在伺服器，以這個瀏覽器的匿名憑證存取，沒有帳號或自動跨裝置同步。清除瀏覽器資料、憑證到期或換手機後，無法找回原本的存取方式；請先匯出備份，再於新瀏覽器匯入。
        </p>
        <p>備份包含私人記事，請妥善保存。只保存最近一次日期，不包含過往歷史。</p>
      </div>
      <div className="form-card backup-block">
        <h2>匯出備份</h2>
        <p>下載全部記事的 JSON 檔案，包含標題、日期與完整備註。</p>
        <button disabled={busy} onClick={() => void exportFile()}>
          下載備份 ↓
        </button>
      </div>
      <div className="form-card backup-block">
        <h2>從備份還原</h2>
        <p>匯入將完整取代目前記事，不會合併。最多 5,000 筆、全部記事與備份檔上限 2 MB。</p>
        <label className="file-label">
          選擇 JSON 備份檔
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => {
              void selectFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        {preview && (
          <div className="import-confirm">
            <p>
              目前有 <strong>{preview.current}</strong> 筆，備份有{' '}
              <strong>{preview.incoming}</strong> 筆。
            </p>
            <p>確認後將完整取代目前資料，無法復原。</p>
            <button disabled={busy} onClick={() => void importFile()}>
              確定完整取代
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setBackup(null);
                setPreview(null);
              }}
            >
              取消匯入
            </button>
          </div>
        )}
      </div>
      {busy && <p role="status">處理中，請稍候…</p>}
      {error && (
        <div className="error" role="alert">
          {error}
          <button disabled={busy} onClick={() => setError('')}>
            重新選取備份
          </button>
        </div>
      )}
    </section>
  );
}

import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { Backup, EventRecord } from '../shared/contracts.js';

const recordId = '00000000-0000-4000-8000-000000000001';
const initialEvent: EventRecord = {
  id: recordId,
  title: '洗牙',
  lastDoneOn: '2020-01-01',
  note: '帶健保卡，順便問問下次回診時間',
  revision: 1,
};

async function mockApi(page: Page) {
  const state = { events: [{ ...initialEvent }], requests: [] as string[], failWrites: false };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    state.requests.push(`${method} ${path}`);
    if (path === '/api/anonymous-session') return route.fulfill({ json: { ready: true } });
    if (state.failWrites && ['POST', 'PATCH', 'DELETE'].includes(method)) {
      return route.fulfill({
        status: 500,
        json: { error: { message: '測試中的連線錯誤，請重試' } },
      });
    }
    if (path === '/api/events' && method === 'GET') {
      return route.fulfill({ json: { events: state.events } });
    }
    if (path === '/api/events' && method === 'POST') {
      const event = { ...request.postDataJSON(), revision: 1 } as EventRecord;
      state.events.push(event);
      return route.fulfill({ json: { event } });
    }
    if (path.startsWith('/api/events/') && method === 'PATCH') {
      const event = state.events.find((item) => path.endsWith(item.id))!;
      Object.assign(event, request.postDataJSON(), { revision: event.revision + 1 });
      return route.fulfill({ json: { event } });
    }
    if (path.startsWith('/api/events/') && method === 'DELETE') {
      state.events = state.events.filter((item) => !path.endsWith(item.id));
      return route.fulfill({ json: { deleted: true } });
    }
    if (path === '/api/backup') {
      return route.fulfill({
        json: {
          version: 1,
          exportedAt: '2020-01-01T00:00:00.000Z',
          events: state.events.map(({ title, note, lastDoneOn }) => ({ title, note, lastDoneOn })),
        },
      });
    }
    if (path === '/api/backup/preview') {
      const backup = request.postDataJSON() as Backup;
      return route.fulfill({
        json: { current: state.events.length, incoming: backup.events.length },
      });
    }
    if (path === '/api/backup/import') {
      const backup = request.postDataJSON() as Backup;
      state.events = backup.events.map((item, index) => ({
        ...item,
        id: `import-${index}`,
        revision: 1,
      }));
      return route.fulfill({ json: { imported: state.events.length } });
    }
    throw new Error(`未預期的 API：${method} ${path}`);
  });
  return state;
}

async function ready(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.getByRole('link', { name: '備份與還原' })).toBeVisible();
  await expect(page.getByText('正在打開你的生活記事…')).not.toBeVisible();
}

async function expectMode(page: Page, mode: 'light' | 'dark') {
  await expect(page.locator('html')).toHaveAttribute('data-color-mode', mode);
  await expect(page.locator('html')).toHaveCSS('color-scheme', mode);
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    mode === 'light' ? 'rgb(245, 243, 237)' : 'rgb(32, 35, 31)',
  );
  await expect(
    page.getByRole('button', { name: mode === 'light' ? '切換為深色' : '切換為淺色' }),
  ).toBeVisible();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    mode === 'light' ? '#f5f3ed' : '#20231f',
  );
}

for (const system of ['light', 'dark'] as const) {
  test(`系統 ${system} 下所有直接載入均預設淺色且不跟隨系統變更`, async ({ page }) => {
    await mockApi(page);
    await page.emulateMedia({ colorScheme: system });
    for (const path of ['/', '/events/new', `/events/${recordId}/edit`, '/backup']) {
      await ready(page, path);
      await expectMode(page, 'light');
    }
    await page.getByRole('button', { name: '切換為深色' }).click();
    await expectMode(page, 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expectMode(page, 'dark');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectMode(page, 'dark');
    await page.getByRole('button', { name: '切換為淺色' }).click();
    await expectMode(page, 'light');
  });
}

test('換頁維持深色，重整回淺色，新分頁不繼承且沒有偏好儲存', async ({ page }) => {
  const state = await mockApi(page);
  await ready(page);
  const initialCookies = await page.context().cookies();
  await page.getByRole('button', { name: '切換為深色' }).tap();
  await page.getByRole('link', { name: '記一件小事' }).click();
  await expectMode(page, 'dark');
  await page.getByRole('link', { name: '回到生活記事' }).click();
  await page.getByTestId('event-card').getByRole('link').click();
  await expectMode(page, 'dark');
  await page.getByRole('link', { name: '備份與還原' }).click();
  await expectMode(page, 'dark');
  await page.getByRole('link', { name: '回到生活記事' }).click();
  await expectMode(page, 'dark');
  const second = await page.context().newPage();
  await mockApi(second);
  await ready(second);
  await expectMode(second, 'light');
  await expectMode(page, 'dark');
  await second.close();
  expect(await page.context().cookies()).toEqual(initialCookies);
  expect(
    await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })),
  ).toEqual({ local: {}, session: {} });
  expect(
    state.requests.every((path) => !path.includes('theme') && !path.includes('color-mode')),
  ).toBeTruthy();
  const backup = await page.evaluate(async () => (await fetch('/api/backup')).json());
  expect(Object.keys(backup).sort()).toEqual(['events', 'exportedAt', 'version']);
  for (const path of ['/', '/events/new', `/events/${recordId}/edit`, '/backup']) {
    await ready(page, path);
    await page.getByRole('button', { name: '切換為深色' }).click();
    await page.reload();
    await expectMode(page, 'light');
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.getByRole('link', { name: '備份與還原' })).toBeVisible();
  await expect(page.getByRole('button', { name: '切換為深色' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('載入及連線錯誤時仍能以鍵盤切換且不觸發重試', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route('**/api/anonymous-session', async (route) => {
    requests++;
    await gate;
    await route.fulfill({ status: 500, json: { error: { message: '暫時無法連線' } } });
  });
  await page.goto('/');
  await expect(page.getByText('正在打開你的生活記事…')).toBeVisible();
  const button = page.getByRole('button', { name: '切換為深色' });
  await button.focus();
  await page.keyboard.press('Enter');
  await expectMode(page, 'dark');
  await expect(page.getByRole('button', { name: '切換為淺色' })).toBeFocused();
  await expect(page.getByRole('button', { name: '切換為淺色' })).toHaveCSS(
    'outline-style',
    'solid',
  );
  release();
  await expect(page.getByRole('heading', { name: '暫時連不上你的記事' })).toBeVisible();
  await page.keyboard.press('Space');
  await expectMode(page, 'light');
  expect(requests).toBe(1);
});

test('切換保留搜尋、未送出表單與資料，不增加讀寫請求', async ({ page }) => {
  const state = await mockApi(page);
  await ready(page);
  await page.getByLabel('搜尋事件標題').fill('洗');
  const before = [...state.requests];
  await page.getByRole('button', { name: '切換為深色' }).click();
  await expectMode(page, 'dark');
  await expect(page.getByLabel('搜尋事件標題')).toHaveValue('洗');
  await expect(page.getByTestId('event-card')).toHaveCount(1);
  expect(state.requests).toEqual(before);
  expect(state.events).toEqual([initialEvent]);
  await page.getByRole('link', { name: '記一件小事' }).click();
  await page.getByLabel('事情的標題').fill('還沒存的標題');
  await page.getByLabel('備註 選填').fill('還沒存的細節');
  const draftRequests = [...state.requests];
  await page.getByRole('button', { name: '切換為淺色' }).click();
  await expect(page.getByLabel('事情的標題')).toHaveValue('還沒存的標題');
  await expect(page.getByLabel('備註 選填')).toHaveValue('還沒存的細節');
  expect(state.requests).toEqual(draftRequests);
  expect(state.events).toEqual([initialEvent]);
});

test('切換不重啟五秒復原期限，深色下能復原與編輯', async ({ page }) => {
  const state = await mockApi(page);
  await ready(page);
  await page.clock.install();
  await page.getByRole('button', { name: '今天做囉' }).click();
  await expect(page.getByRole('button', { name: '復原', exact: true })).toBeVisible();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.clock.runFor(3000);
  const requests = [...state.requests];
  await page.getByRole('button', { name: '切換為深色' }).click();
  expect(state.requests).toEqual(requests);
  await page.clock.runFor(2100);
  await expect(page.getByRole('button', { name: '復原', exact: true })).not.toBeVisible();
  // 重新載入以重設日期後，再驗證深色下實際復原。
  state.events[0] = { ...initialEvent };
  await page.reload();
  await page.getByRole('button', { name: '切換為深色' }).click();
  await page.getByRole('button', { name: '今天做囉' }).click();
  await page.getByRole('button', { name: '復原', exact: true }).click();
  await expect(page.getByTestId('event-card')).toContainText('2020.01.01');
  await page.getByTestId('event-card').getByRole('link').click();
  await page.getByLabel('備註 選填').fill('深色下編輯');
  await page.getByRole('button', { name: '存好囉' }).click();
  await expect(page.getByTestId('event-card')).toContainText('深色下編輯');
  await expectMode(page, 'dark');
});

async function capture(page: Page, info: TestInfo, name: string) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}

test('真實 API 深色下可新增、更新、復原、編輯、備份還原與刪除', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: '切換為深色' }).click();
  await page.getByRole('link', { name: '記一件小事' }).click();
  await page.getByLabel('事情的標題').fill('深色生活紀錄');
  await page.getByLabel('最近一次是').fill('2020-01-01');
  await page.getByRole('button', { name: '存好囉' }).click();
  await expect(page.getByTestId('event-card')).toContainText('深色生活紀錄');
  await page.getByRole('button', { name: '今天做囉' }).click();
  await page.getByRole('button', { name: '復原', exact: true }).click();
  await expect(page.getByTestId('event-card')).toContainText('2020.01.01');
  await page.getByTestId('event-card').getByRole('link').click();
  await page.getByLabel('備註 選填').fill('實際存進資料庫');
  await page.getByRole('button', { name: '存好囉' }).click();
  await expect(page.getByTestId('event-card')).toContainText('實際存進資料庫');
  await page.getByRole('link', { name: '備份與還原' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載備份' }).click();
  const file = await (await downloading).path();
  expect(file).toBeTruthy();
  await page.getByLabel('選擇 JSON 備份檔').setInputFiles(file!);
  await expect(page.locator('.import-confirm')).toContainText('目前有 1 筆，備份有 1 筆');
  await page.getByRole('button', { name: '確定完整取代' }).click();
  await expect(page.locator('.toast')).toHaveText('備份已還原');
  await expectMode(page, 'dark');
  await page.getByRole('link', { name: '回到生活記事' }).click();
  await page.getByTestId('event-card').getByRole('link').click();
  await page.getByRole('button', { name: '刪除這件事' }).click();
  await page.getByRole('button', { name: '確定刪除' }).click();
  await expect(page.getByRole('heading', { name: '從一件小事開始' })).toBeVisible();
  await expectMode(page, 'dark');
});

for (const width of [390, 1280]) {
  for (const mode of ['light', 'dark'] as const) {
    test(`${width}px ${mode} 完整畫面與互動狀態`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await mockApi(page);
      await ready(page);
      if (mode === 'dark') await page.getByRole('button', { name: '切換為深色' }).click();
      await page.getByRole('button', { name: '今天做囉' }).click();
      await expect(page.getByRole('button', { name: '今天做過囉' })).toBeDisabled();
      await capture(page, info, 'home-undo');
      await page.getByRole('button', { name: '復原', exact: true }).click();
      await expect(page.locator('.toast')).toHaveText('已恢復原本的日期');
      await page.getByRole('button', { name: '今天做囉' }).hover();
      await capture(page, info, 'home-hover-toast');
      await page.getByTestId('event-card').getByRole('link').click();
      await page.getByRole('button', { name: '刪除這件事' }).click();
      await page.getByLabel('事情的標題').focus();
      await expect(page.getByLabel('事情的標題')).toHaveCSS('outline-style', 'solid');
      await capture(page, info, 'form-delete-focus');
      await page.getByRole('button', { name: '保留這件事' }).click();
      await page.getByRole('link', { name: '備份與還原' }).click();
      const file = page.getByLabel('選擇 JSON 備份檔');
      await file.setInputFiles({
        name: 'bad.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{'),
      });
      await expect(page.getByRole('alert')).toContainText('不是有效的 JSON');
      await capture(page, info, 'backup-error');
      const backup: Backup = {
        version: 1,
        exportedAt: '2020-01-01T00:00:00.000Z',
        events: [{ title: '回診', note: '下次帶眼鏡', lastDoneOn: null }],
      };
      await file.setInputFiles({
        name: 'backup.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(backup)),
      });
      await expect(page.locator('.import-confirm')).toBeVisible();
      await capture(page, info, 'backup-confirm');
      await page.getByRole('button', { name: '確定完整取代' }).click();
      await expect(page.locator('.toast')).toHaveText('備份已還原');
      await expectMode(page, mode);
      await page.getByRole('link', { name: '回到生活記事' }).click();
      await expect(page.getByTestId('event-card')).toContainText('回診');
      await page.getByTestId('event-card').getByRole('link').click();
      await page.getByRole('button', { name: '刪除這件事' }).click();
      await page.getByRole('button', { name: '確定刪除' }).click();
      await expect(page.getByRole('heading', { name: '從一件小事開始' })).toBeVisible();
    });
  }
}

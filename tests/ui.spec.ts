import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { todayIn } from '../shared/contracts.js';

async function start(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '我的生活記事' })).toBeVisible();
}
async function add(page: Page, title: string, date: string | null, note = '') {
  await page.getByRole('link', { name: '記一件小事' }).click();
  await page.getByLabel('事情的標題').fill(title);
  await page.getByLabel('最近一次是').fill(date ?? '');
  await page.getByLabel('備註 選填').fill(note);
  await page.getByRole('button', { name: '存好囉' }).click();
  await expect(page.getByRole('heading', { name: '我的生活記事' })).toBeVisible();
}
test('手機完整記事流程、排序、搜尋、備註、日期復原與持久保存', async ({ page }) => {
  await start(page);
  await add(page, '洗牙', '2020-01-01', '帶健保卡\n第二行');
  await add(page, '未知日期', null);
  await add(page, '剛做過', todayIn('America/Los_Angeles'));
  await page.screenshot({ path: '/private/tmp/sincey-filled-mobile.png', fullPage: true });
  await expect(page.getByTestId('event-card').first()).toContainText('剛做過');
  await expect(page.getByTestId('event-card').last()).toContainText('未知日期');
  await expect(
    page.getByTestId('event-card').filter({ hasText: '剛做過' }).getByRole('button'),
  ).toBeDisabled();
  const card = page.getByTestId('event-card').filter({ hasText: '洗牙' });
  await card.getByRole('button', { name: '今天做囉' }).click();
  await expect(card).toContainText('就是今天');
  await page.getByRole('button', { name: '復原', exact: true }).click();
  await expect(card).toContainText('2020.01.01');
  const unknown = page.getByTestId('event-card').filter({ hasText: '未知日期' });
  await unknown.getByRole('button').click();
  await page.getByRole('button', { name: '復原', exact: true }).click();
  await expect(unknown).toContainText('尚未記錄');
  await page.getByLabel('搜尋事件標題').fill('洗');
  await expect(page.getByTestId('event-card')).toHaveCount(1);
  await card.getByRole('link').click();
  await expect(page.getByLabel('備註 選填')).toHaveValue('帶健保卡\n第二行');
  await page.getByLabel('事情的標題').fill('洗牙完成');
  await page.getByRole('button', { name: '存好囉' }).click();
  await expect(page.getByRole('heading', { name: '我的生活記事' })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('event-card').filter({ hasText: '洗牙完成' })).toBeVisible();
  await page.getByTestId('event-card').filter({ hasText: '洗牙完成' }).getByRole('link').click();
  await page.getByRole('button', { name: '刪除這件事' }).click();
  await page.getByRole('button', { name: '保留這件事' }).click();
  await page.getByRole('button', { name: '刪除這件事' }).click();
  await page.getByRole('button', { name: '確定刪除' }).click();
  await expect(page.getByTestId('event-card')).toHaveCount(2);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});
test('搜尋新增、日期預設、今天停用與復原到期', async ({ page }) => {
  await start(page);
  await page.getByLabel('搜尋事件標題').fill('健檢');
  await page.getByRole('link', { name: '記下「健檢」' }).click();
  await expect(page.getByLabel('事情的標題')).toHaveValue('健檢');
  await expect(page.getByLabel('最近一次是')).toHaveValue(todayIn('America/Los_Angeles'));
  await page.getByLabel('最近一次是').fill('');
  await page.getByRole('button', { name: '存好囉' }).click();
  await page.getByRole('button', { name: '今天做囉' }).click();
  await expect(page.getByRole('button', { name: '今天做過囉' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '復原', exact: true })).not.toBeVisible({
    timeout: 8000,
  });
});
test('讀取失敗可重試，送出斷線保留表單，回應遺失不重複新增', async ({ page }) => {
  await page.route('**/api/events', (route) =>
    route.request().method() === 'GET' ? route.abort() : route.continue(),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '暫時連不上你的記事' })).toBeVisible();
  await page.unroute('**/api/events');
  await page.getByRole('button', { name: '重新連線' }).click();
  await page.getByRole('link', { name: '記一件小事' }).click();
  await page.getByLabel('事情的標題').fill('重試事件');
  await page.route('**/api/events', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole('button', { name: '存好囉' }).click();
  await expect(page.getByRole('alert')).toContainText('連線中斷');
  await expect(page.getByLabel('事情的標題')).toHaveValue('重試事件');
  await page.unroute('**/api/events');
  await page.getByRole('button', { name: '確認結果並重試' }).click();
  await expect(page.getByTestId('event-card')).toHaveCount(1);
});
test('跨分頁修改不被舊表單覆蓋', async ({ page }) => {
  await start(page);
  await add(page, '洗牙', null);
  await page.getByTestId('event-card').getByRole('link').click();
  const state = await page.request.get('/api/events');
  const item = (await state.json()).events[0];
  await page.request.patch(`/api/events/${item.id}`, {
    headers: { Origin: 'http://localhost:5174', 'X-Timezone': 'Asia/Taipei' },
    data: { title: '其他分頁', revision: item.revision },
  });
  await page.getByLabel('事情的標題').fill('舊表單');
  await page.getByRole('button', { name: '存好囉' }).click();
  await expect(page.getByRole('alert')).toContainText('事件已在其他操作中更新');
  await expect(page.getByLabel('事情的標題')).toHaveValue('舊表單');
  await page.getByRole('button', { name: '載入最新內容' }).click();
  await expect(page.getByLabel('事情的標題')).toHaveValue('其他分頁');
});
test('手機備份下載、取消與完整還原，錯誤檔案保留資料', async ({ page, browser }) => {
  await start(page);
  await add(page, '備份事件', null, '完整備註');
  await page.getByRole('link', { name: '備份與還原' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載備份' }).click();
  const downloaded = await downloading;
  expect(downloaded.suggestedFilename()).toMatch(/sincey-.*\.json/);
  const path = await downloaded.path();
  expect(path).toBeTruthy();
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const second = await other.newPage();
  await start(second);
  await second.getByRole('link', { name: '備份與還原' }).click();
  await second.getByLabel('選擇 JSON 備份檔').setInputFiles(path!);
  await expect(second.getByText('目前有')).toContainText('目前有 0 筆，備份有 1 筆');
  await second.getByRole('button', { name: '取消匯入' }).click();
  await second.getByLabel('選擇 JSON 備份檔').setInputFiles(path!);
  await second.getByRole('button', { name: '確定完整取代' }).click();
  await expect(second.getByRole('status')).toContainText('備份已還原');
  await second.getByRole('link', { name: '回到生活記事' }).click();
  await expect(second.getByTestId('event-card')).toContainText('完整備註');
  await second.getByRole('link', { name: '備份與還原' }).click();
  await second
    .getByLabel('選擇 JSON 備份檔')
    .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(second.getByRole('alert')).toContainText('不是有效的 JSON');
  await second.getByRole('link', { name: '回到生活記事' }).click();
  await expect(second.getByTestId('event-card')).toHaveCount(1);
  await other.close();
});
test('跨時區保留日期、跨午夜更新按鈕與距今天數', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-05-05T23:59:58-07:00') });
  await start(page);
  // 透過 API 補登固定日期，避免測試伺服器時鐘與瀏覽器時鐘混淆。
  await page.request.post('/api/events', {
    headers: { Origin: 'http://localhost:5174', 'X-Timezone': 'America/Los_Angeles' },
    data: { id: randomUUID(), title: '午夜', lastDoneOn: '2026-05-05', note: '' },
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '今天做過囉' })).toBeDisabled();
  await page.clock.fastForward(4000);
  await expect(page.getByRole('button', { name: '今天做囉' })).toBeEnabled();
  await expect(page.getByTestId('event-card')).toContainText('1 天前');
  await expect(page.getByTestId('event-card')).toContainText('2026.05.05');
});

test('同日排序、不同時區仍保留日期，桌面鍵盤可搜尋', async ({ page, browser }) => {
  await start(page);
  const headers = { Origin: 'http://localhost:5174', 'X-Timezone': 'Asia/Taipei' };
  for (const title of ['B 事件', 'A 事件']) {
    expect(
      (
        await page.request.post('/api/events', {
          headers,
          data: { id: randomUUID(), title, lastDoneOn: '2020-03-01', note: '生活的一點細節' },
        })
      ).ok(),
    ).toBeTruthy();
  }
  await page.reload();
  await expect(page.getByTestId('event-card').first()).toContainText('A 事件');
  const context = await browser.newContext({
    timezoneId: 'Asia/Tokyo',
    storageState: await page.context().storageState(),
  });
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByTestId('event-card').first()).toContainText('2020.03.01');
  await other.getByLabel('搜尋事件標題').focus();
  await other.keyboard.type('B');
  await expect(other.getByTestId('event-card')).toHaveCount(1);
  await other.getByLabel('搜尋事件標題').fill('');
  await other.screenshot({ path: '/private/tmp/sincey-desktop.png', fullPage: true });
  await context.close();
});

test('未送達的表單可重試，快速更新回應遺失先確認狀態', async ({ page }) => {
  await start(page);
  await page.getByRole('link', { name: '記一件小事' }).click();
  await page.getByLabel('事情的標題').fill('斷線小事');
  await page.getByLabel('最近一次是').fill('');
  await page.route('**/api/events', (route) =>
    route.request().method() === 'POST' ? route.abort() : route.continue(),
  );
  await page.getByRole('button', { name: '存好囉' }).click();
  await expect(page.getByRole('alert')).toContainText('連線中斷');
  await expect(page.getByLabel('事情的標題')).toHaveValue('斷線小事');
  await page.unroute('**/api/events');
  await page.getByRole('button', { name: '確認結果並重試' }).click();
  await expect(page.getByTestId('event-card')).toHaveCount(1);
  await page.route('**/api/events/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole('button', { name: '今天做囉' }).click();
  await expect(page.getByRole('alert')).toContainText('連線中斷');
  await page.unroute('**/api/events/*');
  await page.getByRole('button', { name: '重新確認並重試' }).click();
  await expect(page.getByRole('button', { name: '今天做過囉' })).toBeDisabled();
  const events = (await (await page.request.get('/api/events')).json()).events;
  expect(events[0].revision).toBe(2);
});

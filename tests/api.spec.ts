import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const baseURL = 'http://localhost:5174';
const headers = { Origin: baseURL, 'X-Timezone': 'Asia/Taipei' };
async function session() {
  const context = await request.newContext({ baseURL, extraHTTPHeaders: headers });
  expect((await context.post('/api/anonymous-session', { data: {} })).ok()).toBeTruthy();
  return context;
}
async function add(context: APIRequestContext, data: Record<string, unknown> = {}) {
  const response = await context.post('/api/events', {
    data: { id: randomUUID(), title: '洗牙', lastDoneOn: null, note: '', ...data },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).event;
}
test('匿名初始化可重用、無憑證拒絕、內容持久保存與隔離', async () => {
  const a = await session();
  const b = await session();
  const event = await add(a);
  expect(await (await a.post('/api/anonymous-session', { data: {} })).json()).toEqual({
    ready: true,
  });
  expect((await (await a.get('/api/events')).json()).events).toHaveLength(1);
  expect((await (await b.get('/api/events')).json()).events).toEqual([]);
  for (const method of ['patch', 'delete'] as const) {
    const result = await b[method](`/api/events/${event.id}`, {
      data: { title: '別人的', revision: 1 },
    });
    expect(result.status()).toBe(404);
  }
  const anonymous = await request.newContext({ baseURL });
  expect((await anonymous.get('/api/events')).status()).toBe(401);
  expect((await anonymous.get('/api/backup')).status()).toBe(401);
  expect(
    (
      await a.post('/api/events', { headers: { Origin: 'https://example.com' }, data: {} })
    ).status(),
  ).toBe(403);
  expect(
    (
      await a.post('/api/events', { headers: { 'Content-Type': 'text/plain' }, data: '{}' })
    ).status(),
  ).toBe(415);
  await Promise.all([a.dispose(), b.dispose(), anonymous.dispose()]);
});
test('欄位驗證、同名、日期、JSON 錯誤與隔離', async () => {
  const a = await session();
  const first = await add(a);
  await add(a);
  for (const fields of [
    { title: '   ' },
    { lastDoneOn: '2099-01-01' },
    { lastDoneOn: '2025-02-30' },
    { note: 'x'.repeat(10001) },
  ]) {
    expect(
      (
        await a.post('/api/events', {
          data: { id: randomUUID(), title: 'a', lastDoneOn: null, note: '', ...fields },
        })
      ).status(),
    ).toBe(400);
  }
  expect(
    (
      await a.post('/api/events', { headers: { 'X-Timezone': 'not/a-timezone' }, data: {} })
    ).status(),
  ).toBe(400);
  expect(
    (
      await a.post('/api/events', { headers: { 'Content-Type': 'application/json' }, data: '{' })
    ).status(),
  ).toBe(400);
  const updated = await a.patch(`/api/events/${first.id}`, {
    data: { title: '眼科', note: '下次帶眼鏡', lastDoneOn: '2020-02-29', revision: 1 },
  });
  expect(updated.ok()).toBeTruthy();
  expect((await updated.json()).event).toMatchObject({
    title: '眼科',
    note: '下次帶眼鏡',
    lastDoneOn: '2020-02-29',
    revision: 2,
  });
  await a.dispose();
});
test('新增重試不重複、revision 衝突、日期更新保留備註', async () => {
  const a = await session();
  const id = randomUUID();
  const content = { id, title: '保健食品', lastDoneOn: '2020-01-01', note: '品牌 A' };
  await add(a, content);
  expect((await a.post('/api/events', { data: content })).ok()).toBeTruthy();
  expect((await (await a.get('/api/events')).json()).events).toHaveLength(1);
  expect((await a.post('/api/events', { data: { ...content, title: '不同內容' } })).status()).toBe(
    409,
  );
  const updated = await a.patch(`/api/events/${id}`, {
    data: { lastDoneOn: '2021-01-01', revision: 1 },
  });
  expect((await updated.json()).event.note).toBe('品牌 A');
  expect(
    (await a.patch(`/api/events/${id}`, { data: { lastDoneOn: null, revision: 1 } })).status(),
  ).toBe(409);
  expect(
    (await a.patch(`/api/events/${id}`, { data: { lastDoneOn: '2020-01-01', revision: 2 } })).ok(),
  ).toBeTruthy();
  await a.dispose();
});
test('備份預覽、完整還原、空備份與拒絕無效檔案', async () => {
  const a = await session();
  const b = await session();
  await add(a, { note: '細節\n第二行' });
  await add(a);
  const backup = await (await a.get('/api/backup')).json();
  expect(Object.keys(backup).sort()).toEqual(['events', 'exportedAt', 'version']);
  expect(Object.keys(backup.events[0]).sort()).toEqual(['lastDoneOn', 'note', 'title']);
  expect(backup.events).toHaveLength(2);
  expect(await (await b.post('/api/backup/preview', { data: backup })).json()).toEqual({
    current: 0,
    incoming: 2,
  });
  expect((await (await b.get('/api/events')).json()).events).toHaveLength(0);
  expect((await b.post('/api/backup/import', { data: backup })).ok()).toBeTruthy();
  expect((await (await b.get('/api/events')).json()).events).toHaveLength(2);
  for (const invalid of [
    { ...backup, version: 2 },
    { ...backup, events: [{ title: '', note: '', lastDoneOn: null }] },
    { ...backup, events: [{ title: '未來', note: '', lastDoneOn: '2099-01-01' }] },
  ]) {
    expect((await b.post('/api/backup/import', { data: invalid })).status()).toBe(400);
    expect((await (await b.get('/api/events')).json()).events).toHaveLength(2);
  }
  expect(
    (await b.post('/api/backup/import', { data: { ...backup, events: [] } })).ok(),
  ).toBeTruthy();
  expect((await (await b.get('/api/events')).json()).events).toHaveLength(0);
  expect((await (await a.get('/api/events')).json()).events).toHaveLength(2);
  await a.dispose();
  await b.dispose();
});
test('匯入交易失敗回滾，並行新增與匯入序列化', async () => {
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? 'postgresql://sincey:sincey_local@localhost:55432/sincey_test';
  const { db } = await import('../server/db.js');
  const a = await session();
  const original = await add(a);
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    events: [{ title: '新資料', lastDoneOn: null, note: '' }],
  };
  const row = await db.event.findUniqueOrThrow({ where: { id: original.id } });
  // 僅在獨立測試資料庫製造 DB 層失敗，不在產品加入測試後門。
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION sincey_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."spaceId" = '${row.spaceId}'::uuid THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER sincey_test_fail_trigger BEFORE INSERT ON "Event" FOR EACH ROW EXECUTE FUNCTION sincey_test_fail()',
  );
  try {
    expect((await a.post('/api/backup/import', { data: backup })).status()).toBe(500);
    expect((await (await a.get('/api/events')).json()).events[0].id).toBe(original.id);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER sincey_test_fail_trigger ON "Event"');
    await db.$executeRawUnsafe('DROP FUNCTION sincey_test_fail()');
  }
  const outcomes = await Promise.all([
    a.post('/api/backup/import', { data: backup }),
    a.post('/api/events', {
      data: { id: randomUUID(), title: '並行新增', lastDoneOn: null, note: '' },
    }),
  ]);
  expect(outcomes.every((response) => response.ok())).toBeTruthy();
  const events = (await (await a.get('/api/events')).json()).events;
  expect(events.some((event: { title: string }) => event.title === '新資料')).toBeTruthy();
  expect(events.some((event: { id: string }) => event.id === original.id)).toBeFalsy();
  expect(events.length).toBeGreaterThanOrEqual(1);
  expect(events.length).toBeLessThanOrEqual(2);
  await a.dispose();
  await db.$disconnect();
});

test('記事總量限制保證匯出檔可還原，超額更新回滾', async () => {
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? 'postgresql://sincey:sincey_local@localhost:55432/sincey_test';
  const { db } = await import('../server/db.js');
  const a = await session();
  const first = await add(a);
  const row = await db.event.findUniqueOrThrow({ where: { id: first.id } });
  await db.event.createMany({
    data: Array.from({ length: 69 }, () => ({
      id: randomUUID(),
      spaceId: row.spaceId,
      title: '大量內容',
      note: '字'.repeat(10000),
    })),
  });
  const response = await a.patch(`/api/events/${first.id}`, {
    data: { revision: 1, note: '字'.repeat(10000) },
  });
  expect(response.status()).toBe(422);
  expect(
    (await (await a.get('/api/events')).json()).events.find(
      (item: { id: string }) => item.id === first.id,
    ),
  ).toMatchObject({ revision: 1, note: '' });
  const backup = await (await a.get('/api/backup')).json();
  expect(Buffer.byteLength(JSON.stringify(backup, null, 2))).toBeLessThanOrEqual(2 * 1024 * 1024);
  await a.dispose();
  await db.$disconnect();
});

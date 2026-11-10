import express, { type Request, type Response, type NextFunction } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { db } from './db.js';
import { Prisma } from './generated/prisma/client.js';
import {
  backupSchema,
  backupBytes,
  contentSchema,
  limits,
  timezoneSchema,
  type EventRecord,
} from '../shared/contracts.js';

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const cookieName = 'sincey_session';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const uuid = z.uuid();
type Tx = Prisma.TransactionClient;
function serialize(row: {
  id: string;
  title: string;
  note: string;
  lastDoneOn: Date | null;
  revision: number;
}): EventRecord {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    lastDoneOn: row.lastDoneOn?.toISOString().slice(0, 10) ?? null,
    revision: row.revision,
  };
}
function tokenFrom(req: Request) {
  const token = req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : undefined;
}
function timezone(req: Request) {
  return timezoneSchema.parse(req.header('X-Timezone'));
}
async function spaceFor(req: Request) {
  const token = tokenFrom(req);
  const space = token
    ? await db.anonymousSpace.findUnique({ where: { tokenHash: hash(token) } })
    : null;
  if (!space)
    throw new ApiError(
      401,
      'UNAUTHORIZED',
      '此瀏覽器的存取憑證已失效，請重新整理以建立新的資料空間，或從備份還原。',
    );
  return space.id;
}
async function write<T>(spaceId: string, operation: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AnonymousSpace" WHERE "id" = ${spaceId}::uuid FOR UPDATE`;
      const result = await operation(tx);
      const events = await tx.event.findMany({ where: { spaceId } });
      const snapshot = {
        version: 1,
        exportedAt: new Date().toISOString(),
        events: events.map((row) => ({
          title: row.title,
          lastDoneOn: row.lastDoneOn?.toISOString().slice(0, 10) ?? null,
          note: row.note,
        })),
      };
      if (backupBytes(snapshot) > limits.bytes)
        throw new ApiError(422, 'LIMIT', '記事總量已達 2 MB 備份上限，請先縮減備註或刪除事件');
      return result;
    },
    { timeout: 30000 },
  );
}
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.header('Origin') !== process.env.APP_ORIGIN)
        return next(new ApiError(403, 'ORIGIN', '請從本站操作'));
      if (!req.is('application/json'))
        return next(new ApiError(415, 'CONTENT_TYPE', '請使用 JSON 格式'));
    }
    next();
  });
  app.use(express.json({ limit: limits.bytes }));
  // 僅限制初始化流量，不記錄私人內容或憑證。
  const attempts = new Map<string, { count: number; until: number }>();
  app.post('/api/anonymous-session', async (req, res) => {
    const token = tokenFrom(req);
    const existing =
      token && (await db.anonymousSpace.findUnique({ where: { tokenHash: hash(token) } }));
    if (existing) {
      res.json({ ready: true });
      return;
    }
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const key = req.ip ?? 'unknown';
    const entry = attempts.get(key) ?? { count: 0, until: now + 60000 };
    if (++entry.count > 30)
      throw new ApiError(429, 'RATE_LIMIT', '建立資料空間過於頻繁，請稍後重試');
    attempts.set(key, entry);
    const fresh = randomBytes(32).toString('hex');
    await db.anonymousSpace.create({ data: { tokenHash: hash(fresh) } });
    res.cookie(cookieName, fresh, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 400 * 86400000,
      path: '/',
    });
    res.json({ ready: true });
  });
  app.get('/api/health', async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });
  app.get('/api/events', async (req, res) => {
    const spaceId = await spaceFor(req);
    const rows = await db.event.findMany({ where: { spaceId } });
    res.json({ events: rows.map(serialize) });
  });
  app.post('/api/events', async (req, res) => {
    const spaceId = await spaceFor(req);
    const schema = contentSchema(timezone(req)).extend({ id: uuid });
    const { id, ...content } = schema.parse(req.body);
    const result = await write(spaceId, async (tx) => {
      const existing = await tx.event.findUnique({ where: { id } });
      if (existing) {
        const saved = serialize(existing);
        if (
          existing.spaceId !== spaceId ||
          saved.title !== content.title ||
          saved.lastDoneOn !== content.lastDoneOn ||
          saved.note !== content.note
        )
          throw new ApiError(409, 'CONFLICT', '這筆操作已存在且內容不同，請重新載入');
        return existing;
      }
      if ((await tx.event.count({ where: { spaceId } })) >= limits.events)
        throw new ApiError(422, 'LIMIT', '最多可保存 5,000 筆事件');
      return tx.event.create({
        data: {
          ...content,
          id,
          spaceId,
          lastDoneOn: content.lastDoneOn ? new Date(`${content.lastDoneOn}T00:00:00Z`) : null,
        },
      });
    });
    res.json({ event: serialize(result) });
  });
  app.patch('/api/events/:id', async (req, res) => {
    const spaceId = await spaceFor(req);
    const id = uuid.parse(req.params.id);
    const schema = contentSchema(timezone(req))
      .partial()
      .extend({ revision: z.number().int().positive() });
    const { revision, ...content } = schema.parse(req.body);
    const result = await write(spaceId, async (tx) => {
      const previous = await tx.event.findFirst({ where: { id, spaceId } });
      if (!previous) throw new ApiError(404, 'NOT_FOUND', '找不到這筆事件');
      if (previous.revision !== revision)
        throw new ApiError(409, 'CONFLICT', '事件已在其他操作中更新，請重新載入後再試');
      return tx.event.update({
        where: { id },
        data: {
          ...content,
          ...(content.lastDoneOn !== undefined
            ? {
                lastDoneOn: content.lastDoneOn ? new Date(`${content.lastDoneOn}T00:00:00Z`) : null,
              }
            : {}),
          revision: { increment: 1 },
        },
      });
    });
    res.json({ event: serialize(result) });
  });
  app.delete('/api/events/:id', async (req, res) => {
    const spaceId = await spaceFor(req);
    const id = uuid.parse(req.params.id);
    await write(spaceId, async (tx) => {
      const result = await tx.event.deleteMany({ where: { id, spaceId } });
      if (!result.count) throw new ApiError(404, 'NOT_FOUND', '找不到這筆事件');
    });
    res.json({ deleted: true });
  });
  app.get('/api/backup', async (req, res) => {
    const spaceId = await spaceFor(req);
    const rows = await db.event.findMany({ where: { spaceId }, orderBy: { id: 'asc' } });
    res.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      events: rows.map((row) => ({
        title: row.title,
        lastDoneOn: row.lastDoneOn?.toISOString().slice(0, 10) ?? null,
        note: row.note,
      })),
    });
  });
  app.post('/api/backup/preview', async (req, res) => {
    const spaceId = await spaceFor(req);
    const backup = backupSchema(timezone(req)).parse(req.body);
    res.json({
      current: await db.event.count({ where: { spaceId } }),
      incoming: backup.events.length,
    });
  });
  app.post('/api/backup/import', async (req, res) => {
    const spaceId = await spaceFor(req);
    const backup = backupSchema(timezone(req)).parse(req.body);
    await write(spaceId, async (tx) => {
      await tx.event.deleteMany({ where: { spaceId } });
      if (backup.events.length)
        await tx.event.createMany({
          data: backup.events.map((event) => ({
            ...event,
            id: randomUUID(),
            spaceId,
            lastDoneOn: event.lastDoneOn ? new Date(`${event.lastDoneOn}T00:00:00Z`) : null,
          })),
        });
    });
    res.json({ imported: backup.events.length });
  });
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', '找不到此 API')));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION',
          message: error.issues[0]?.message ?? '資料格式不正確',
          fields: error.flatten().fieldErrors,
        },
      });
      return;
    }
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: { code: 'JSON', message: 'JSON 格式不正確' } });
      return;
    }
    if (
      typeof error === 'object' &&
      error &&
      'type' in error &&
      error.type === 'entity.too.large'
    ) {
      res.status(413).json({ error: { code: 'LIMIT', message: '檔案或請求不得超過 2 MB' } });
      return;
    }
    res
      .status(500)
      .json({ error: { code: 'SERVER', message: '暫時無法儲存或讀取資料，請稍後重試' } });
  });
  return app;
}

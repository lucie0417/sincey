import { z } from 'zod';

export const limits = { title: 200, note: 10000, events: 5000, bytes: 2 * 1024 * 1024 };
export function backupBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value, null, 2)).byteLength;
}
export const timezoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, '裝置時區無效');
export function todayIn(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function dateSchema(timezone: string) {
  return z
    .string()
    .refine(validDate, '請填寫有效日期')
    .refine((date) => date <= todayIn(timezone), '不能記錄未來日期')
    .nullable();
}
export function contentSchema(timezone: string) {
  return z
    .object({
      title: z.string().trim().min(1, '請填寫標題').max(limits.title, '標題最多 200 字'),
      lastDoneOn: dateSchema(timezone),
      note: z.string().max(limits.note, '備註最多 10,000 字'),
    })
    .strict();
}
export function backupSchema(timezone: string) {
  return z
    .object({
      version: z.literal(1),
      exportedAt: z.iso.datetime(),
      events: z.array(contentSchema(timezone)).max(limits.events, '備份最多 5,000 筆'),
    })
    .strict();
}
export type EventContent = z.infer<ReturnType<typeof contentSchema>>;
export type EventRecord = EventContent & { id: string; revision: number };
export type Backup = z.infer<ReturnType<typeof backupSchema>>;
export function dayDifference(date: string, today: string): number {
  return Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000,
  );
}
export function compareEvents(a: EventRecord, b: EventRecord) {
  if (a.lastDoneOn !== b.lastDoneOn) return (b.lastDoneOn ?? '').localeCompare(a.lastDoneOn ?? '');
  return a.title.localeCompare(b.title, 'zh-TW') || a.id.localeCompare(b.id);
}

import type { EventRecord } from '../shared/contracts.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function deviceTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Timezone': deviceTimezone() },
      ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(0, '連線中斷，尚未確認操作結果。請保留輸入並重試。');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(response.status, result?.error?.message ?? '暫時無法完成操作，請重試');
  return result as T;
}
let initializing: Promise<unknown> | null = null;
export async function initialize() {
  initializing ??= api('/anonymous-session', 'POST').finally(() => {
    initializing = null;
  });
  return initializing;
}
export async function listEvents() {
  return (await api<{ events: EventRecord[] }>('/events')).events;
}

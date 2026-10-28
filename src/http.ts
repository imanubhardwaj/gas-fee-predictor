import { config } from './config';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
    readonly retryable = true,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

export interface FetchOptions {
  retries?: number;
  timeoutMs?: number;
}

/** fetch + JSON parse with exponential backoff on 429/5xx/network errors. */
export async function fetchJson<T>(url: string, init: RequestInit = {}, opts: FetchOptions = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { 'user-agent': config.userAgent, accept: 'application/json', ...(init.headers ?? {}) },
      });
      if (res.status === 429 || res.status >= 500) throw new HttpError(res.status, await safeText(res));
      if (!res.ok) throw new HttpError(res.status, await safeText(res), false);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (err instanceof HttpError && !err.retryable) throw err;
      if (attempt === retries) break;
      const delay = Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 250;
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** Run `fn` over `items` with at most `limit` in flight. Rejects on first failure. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

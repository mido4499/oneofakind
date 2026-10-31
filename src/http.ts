const USER_AGENT =
  process.env.ONEOFAKIND_USER_AGENT ?? 'oneofakind/0.1 (open-source project name checker)';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}`);
  }
}

export interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface Http {
  /** GETs JSON. Resolves null on 404/410 (the "name not found" signal), throws on other errors. */
  getJson<T>(url: string, options?: RequestOptions): Promise<T | null>;
}

async function fetchJson<T>(url: string, { headers, signal }: RequestOptions): Promise<T | null> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...headers },
    signal,
  });
  if (res.status === 404 || res.status === 410) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(res.status, url);
  }
  return (await res.json()) as T;
}

/** Upper bound for one upstream request; callers usually give up sooner through their own signal. */
const FETCH_TIMEOUT_MS = 30_000;

/** Rejects as soon as `signal` aborts, without cancelling `promise` for anyone else awaiting it. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** In-memory response cache: repeated checks of the same name don't burn upstream rate limits. */
export function createHttp({ ttlMs = 10 * 60_000, maxEntries = 5_000 } = {}): Http {
  const cache = new Map<string, { expires: number; value: Promise<unknown> }>();
  return {
    getJson<T>(url: string, { headers, signal }: RequestOptions = {}) {
      const key = `${url} ${JSON.stringify(headers ?? {})}`;
      const now = Date.now();
      let entry = cache.get(key);
      if (!entry || entry.expires <= now) {
        // Concurrent checks share this request, so it must not die with the first caller's signal.
        const value = fetchJson<T>(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        const created = { expires: now + ttlMs, value };
        cache.set(key, created);
        value.catch(() => cache.get(key) === created && cache.delete(key));
        if (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
        entry = created;
      }
      return abortable(entry.value as Promise<T | null>, signal);
    },
  };
}

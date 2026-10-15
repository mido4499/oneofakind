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

/** In-memory response cache: repeated checks of the same name don't burn upstream rate limits. */
export function createHttp({ ttlMs = 10 * 60_000, maxEntries = 5_000 } = {}): Http {
  const cache = new Map<string, { expires: number; value: Promise<unknown> }>();
  return {
    getJson<T>(url: string, options: RequestOptions = {}) {
      const key = `${url} ${JSON.stringify(options.headers ?? {})}`;
      const now = Date.now();
      const cached = cache.get(key);
      if (cached && cached.expires > now) return cached.value as Promise<T | null>;

      const value = fetchJson<T>(url, options);
      cache.set(key, { expires: now + ttlMs, value });
      value.catch(() => cache.delete(key));
      if (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
      return value;
    },
  };
}

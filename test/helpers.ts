import type { Http, RequestOptions } from '../src/http.js';
import { defaultConfig } from '../src/scoring/config.js';
import type { SourceContext } from '../src/sources/types.js';

/** Serves canned JSON by URL prefix; anything unmatched is a 404 (resolves null). Records every request. */
export function fakeHttp(routes: Record<string, unknown>): Http & { calls: { url: string; options?: RequestOptions }[] } {
  const calls: { url: string; options?: RequestOptions }[] = [];
  return {
    calls,
    async getJson<T>(url: string, options?: RequestOptions) {
      calls.push({ url, options });
      const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
      return (key === undefined ? null : routes[key]) as T | null;
    },
  };
}

export const context = (http: Http, name = 'quillo'): SourceContext => ({
  name,
  http,
  signal: new AbortController().signal,
  prominence: defaultConfig.prominence,
});

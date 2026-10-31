import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttp } from '../src/http.js';

afterEach(() => vi.unstubAllGlobals());

describe('createHttp', () => {
  it('shares one request between callers without letting one caller cancel it for the others', async () => {
    let respond!: (res: Response) => void;
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          respond = resolve;
          init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const http = createHttp();

    const leaving = new AbortController();
    const first = http.getJson('https://example.com/a', { signal: leaving.signal });
    const second = http.getJson('https://example.com/a', { signal: new AbortController().signal });
    leaving.abort(new Error('client left'));
    respond(Response.json({ ok: true }));

    await expect(first).rejects.toThrow('client left');
    await expect(second).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

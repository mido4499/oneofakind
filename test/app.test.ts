import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, optionsFromEnv, type AppOptions } from '../src/app.js';
import type { Http } from '../src/http.js';
import { defaultConfig } from '../src/scoring/config.js';
import type { Source } from '../src/sources/types.js';

const PAGE = 'https://mido4499.github.io';

const fake: Source = {
  id: 'fake',
  weightKeys: ['npm'],
  check: async () => ({ hits: [], availability: { npm: true } }),
};
const http: Http = { getJson: async () => null };
const deps = { http, sources: [fake], config: defaultConfig };

const appWith = (options: AppOptions = {}) => createApp({ deps, ...options });
const check = (app: ReturnType<typeof createApp>, headers: Record<string, string> = {}, name = 'quillo') =>
  app.request(`/v1/check?name=${name}`, { headers });

afterEach(() => vi.useRealTimers());

describe('CORS', () => {
  it('allows the configured origin on successful and error responses', async () => {
    // Invalid requests count toward the limit too, so the third request is the one rejected.
    const app = appWith({ corsOrigins: [PAGE], rateLimitPerMinute: 2 });
    const ok = await check(app, { origin: PAGE });
    const invalid = await check(app, { origin: PAGE }, '-bad');
    const limited = await check(app, { origin: PAGE });
    expect([ok.status, invalid.status, limited.status]).toEqual([200, 400, 429]);
    for (const res of [ok, invalid, limited]) expect(res.headers.get('access-control-allow-origin')).toBe(PAGE);
  });

  it('sends no CORS header to other origins', async () => {
    const res = await check(appWith({ corsOrigins: [PAGE] }), { origin: 'https://evil.example' });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('sends no CORS header when no origins are configured', async () => {
    const res = await check(appWith(), { origin: PAGE });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('rate limit', () => {
  it('rejects the request after the limit with the seconds to wait', async () => {
    const app = appWith({ rateLimitPerMinute: 2 });
    expect((await check(app)).status).toBe(200);
    expect((await check(app)).status).toBe(200);
    const res = await check(app);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.retryAfter).toBeGreaterThanOrEqual(1);
    expect(body.retryAfter).toBeLessThanOrEqual(60);
    expect(body.error).toBe(`Too many checks. Try again in ${body.retryAfter} seconds.`);
  });

  it('allows the client again once the minute has passed', async () => {
    vi.useFakeTimers();
    const app = appWith({ rateLimitPerMinute: 1 });
    await check(app);
    expect((await check(app)).status).toBe(429);
    vi.advanceTimersByTime(60_000);
    expect((await check(app)).status).toBe(200);
  });

  it('never limits /health or /v1/sources', async () => {
    const app = appWith({ rateLimitPerMinute: 1 });
    await check(app);
    expect((await app.request('/health')).status).toBe(200);
    expect((await app.request('/v1/sources')).status).toBe(200);
  });

  it('does not limit anything when no limit is configured', async () => {
    const app = appWith();
    for (let i = 0; i < 20; i++) expect((await check(app)).status).toBe(200);
  });
});

describe('client IP', () => {
  it('counts clients separately by the last X-Forwarded-For entry when the proxy is trusted', async () => {
    const app = appWith({ rateLimitPerMinute: 1, trustProxy: true });
    expect((await check(app, { 'x-forwarded-for': '6.6.6.6, 1.1.1.1' })).status).toBe(200);
    // Same proxy-seen address, different client-supplied prefix: still the same client.
    expect((await check(app, { 'x-forwarded-for': '7.7.7.7, 1.1.1.1' })).status).toBe(429);
    expect((await check(app, { 'x-forwarded-for': '2.2.2.2' })).status).toBe(200);
  });

  it('ignores X-Forwarded-For when the proxy is not trusted, so it cannot be spoofed', async () => {
    const app = appWith({ rateLimitPerMinute: 1 });
    expect((await check(app, { 'x-forwarded-for': '1.1.1.1' })).status).toBe(200);
    expect((await check(app, { 'x-forwarded-for': '2.2.2.2' })).status).toBe(429);
  });
});

describe('optionsFromEnv', () => {
  it('enables nothing when the variables are unset or empty', () => {
    expect(optionsFromEnv({})).toEqual({ corsOrigins: undefined, rateLimitPerMinute: undefined, trustProxy: false });
    expect(optionsFromEnv({ CORS_ORIGINS: '', RATE_LIMIT_PER_MINUTE: '', TRUST_PROXY: '' })).toEqual({
      corsOrigins: undefined,
      rateLimitPerMinute: undefined,
      trustProxy: false,
    });
  });

  it('parses valid values', () => {
    expect(
      optionsFromEnv({
        CORS_ORIGINS: 'https://mido4499.github.io, http://localhost:8080',
        RATE_LIMIT_PER_MINUTE: '10',
        TRUST_PROXY: '1',
      }),
    ).toEqual({
      corsOrigins: ['https://mido4499.github.io', 'http://localhost:8080'],
      rateLimitPerMinute: 10,
      trustProxy: true,
    });
  });

  it.each(['abc', '0', '-5', '2.5'])('rejects RATE_LIMIT_PER_MINUTE=%j', (value) => {
    expect(() => optionsFromEnv({ RATE_LIMIT_PER_MINUTE: value })).toThrow('RATE_LIMIT_PER_MINUTE');
  });

  it.each(['https://mido4499.github.io/', 'mido4499.github.io', 'https://mido4499.github.io/oneofakind'])(
    'rejects CORS_ORIGINS=%j, which is not a bare origin',
    (value) => {
      expect(() => optionsFromEnv({ CORS_ORIGINS: value })).toThrow('CORS_ORIGINS');
    },
  );

  it('rejects an unrecognised TRUST_PROXY value', () => {
    expect(() => optionsFromEnv({ TRUST_PROXY: 'yes please' })).toThrow('TRUST_PROXY');
  });
});

import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { checkName, InvalidInputError, parseEcosystem, type CheckDeps } from './check.js';
import { defaultConfig } from './scoring/config.js';
import { allSources } from './sources/index.js';

export interface AppOptions {
  corsOrigins?: string[];
  rateLimitPerMinute?: number;
  trustProxy?: boolean;
  /** Overrides the real sources and HTTP client; used by tests. */
  deps?: CheckDeps;
}

/** Reads the hosting settings from environment variables. Throws on invalid values, so a typo
 *  stops the server at startup instead of silently disabling CORS or the rate limit. */
export function optionsFromEnv(env: Record<string, string | undefined>): AppOptions {
  const origins = env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean);
  for (const origin of origins ?? []) {
    if (!URL.canParse(origin) || new URL(origin).origin !== origin) {
      throw new Error(`CORS_ORIGINS entries must be bare origins like https://example.com, got "${origin}"`);
    }
  }

  const limit = env.RATE_LIMIT_PER_MINUTE?.trim();
  if (limit && !/^[1-9]\d*$/.test(limit)) {
    throw new Error(`RATE_LIMIT_PER_MINUTE must be a positive whole number, got "${limit}"`);
  }

  const trustProxy = env.TRUST_PROXY?.trim().toLowerCase() ?? '';
  if (!['', '0', '1', 'false', 'true'].includes(trustProxy)) {
    throw new Error(`TRUST_PROXY must be 1 or 0, got "${env.TRUST_PROXY}"`);
  }

  return {
    corsOrigins: origins?.length ? origins : undefined,
    rateLimitPerMinute: limit ? Number(limit) : undefined,
    trustProxy: trustProxy === '1' || trustProxy === 'true',
  };
}

/** Behind a reverse proxy the socket address is the proxy's; it appends the real client as the
 *  last X-Forwarded-For entry. Earlier entries come from the client and can be forged. */
function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown'; // No socket, e.g. app.request() in tests.
  }
}

const WINDOW_MS = 60_000;

/** Fixed one-minute window per client IP, kept in memory. */
function rateLimit(limit: number, trustProxy: boolean): MiddlewareHandler {
  const windows = new Map<string, { count: number; resetAt: number }>();
  let nextSweep = 0;
  return async (c, next) => {
    const now = Date.now();
    if (now >= nextSweep) {
      for (const [ip, window] of windows) if (window.resetAt <= now) windows.delete(ip);
      nextSweep = now + WINDOW_MS;
    }
    const ip = clientIp(c, trustProxy);
    let window = windows.get(ip);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + WINDOW_MS };
      windows.set(ip, window);
    }
    if (++window.count > limit) {
      // In the body, not only Retry-After: a cross-origin page cannot read that header.
      const retryAfter = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
      return c.json({ error: `Too many checks. Try again in ${retryAfter} seconds.`, retryAfter }, 429);
    }
    await next();
  };
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono();
  if (options.corsOrigins) app.use('/v1/*', cors({ origin: options.corsOrigins, allowMethods: ['GET'] }));
  const limiter: MiddlewareHandler = options.rateLimitPerMinute
    ? rateLimit(options.rateLimitPerMinute, options.trustProxy ?? false)
    : (_c, next) => next();

  app.get('/', (c) =>
    c.json({
      name: 'oneofakind',
      endpoints: {
        check: '/v1/check?name=<name>&ecosystem=<js|python|...>&sources=<id,id>&limit=<hits>',
        sources: '/v1/sources',
        health: '/health',
      },
    }),
  );

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/v1/sources', (c) =>
    c.json({
      scoringVersion: defaultConfig.version,
      sources: allSources.map((source) => ({
        id: source.id,
        weights: Object.fromEntries(source.weightKeys.map((key) => [key, defaultConfig.weights[key]])),
      })),
      ecosystems: defaultConfig.ecosystems,
    }),
  );

  app.get('/v1/check/:name?', limiter, async (c) => {
    const limit = Number(c.req.query('limit') ?? 50);
    if (!Number.isInteger(limit) || limit < 0) throw new InvalidInputError('limit must be a non-negative integer');
    const result = await checkName(
      c.req.param('name') ?? c.req.query('name') ?? '',
      {
        ecosystem: parseEcosystem(c.req.query('ecosystem')),
        sources: c.req.query('sources')?.split(','),
        signal: c.req.raw.signal,
      },
      options.deps,
    );
    return c.json({ ...result, hits: result.hits.slice(0, limit) });
  });

  app.onError((error, c) => {
    if (error instanceof InvalidInputError) return c.json({ error: error.message }, 400);
    console.error(error);
    return c.json({ error: 'internal error' }, 500);
  });

  return app;
}

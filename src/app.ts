import { Hono } from 'hono';
import { checkName, InvalidInputError, parseEcosystem } from './check.js';
import { defaultConfig } from './scoring/config.js';
import { allSources } from './sources/index.js';

export const app = new Hono();

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

app.get('/v1/check/:name?', async (c) => {
  const limit = Number(c.req.query('limit') ?? 50);
  const result = await checkName(c.req.param('name') ?? c.req.query('name') ?? '', {
    ecosystem: parseEcosystem(c.req.query('ecosystem')),
    sources: c.req.query('sources')?.split(','),
    signal: c.req.raw.signal,
  });
  return c.json({ ...result, hits: result.hits.slice(0, Number.isFinite(limit) ? limit : 50) });
});

app.onError((error, c) => {
  if (error instanceof InvalidInputError) return c.json({ error: error.message }, 400);
  console.error(error);
  return c.json({ error: 'internal error' }, 500);
});

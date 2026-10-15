import { describe, expect, it } from 'vitest';
import { checkName, InvalidInputError } from '../src/check.js';
import type { Http } from '../src/http.js';
import { defaultConfig } from '../src/scoring/config.js';
import { hackernews } from '../src/sources/hackernews.js';
import { npm } from '../src/sources/npm.js';
import type { Source, SourceContext } from '../src/sources/types.js';

/** Serves canned JSON by URL prefix; anything unmatched is a 404 (resolves null). */
function fakeHttp(routes: Record<string, unknown>): Http {
  return {
    async getJson<T>(url: string) {
      const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
      return (key === undefined ? null : routes[key]) as T | null;
    },
  };
}

const context = (http: Http, name = 'quillo'): SourceContext => ({
  name,
  http,
  signal: new AbortController().signal,
  prominence: defaultConfig.prominence,
});

describe('npm source', () => {
  it('classifies search results and keeps scoped packages from blocking the name', async () => {
    const http = fakeHttp({
      'https://registry.npmjs.org/-/v1/search': {
        objects: [
          { downloads: { weekly: 6_688_793 }, package: { name: 'quill', date: '2024-11-30T12:19:39Z', links: { repository: 'git+https://github.com/slab/quill.git' } } },
          { downloads: { weekly: 10 }, package: { name: '@quillo/core' } },
          { downloads: { weekly: 10 }, package: { name: 'left-pad' } },
        ],
      },
    });
    const result = await npm.check(context(http));
    expect(result.hits.map((hit) => [hit.name, hit.match])).toEqual([
      ['quill', 'phonetic'],
      ['@quillo/core', 'affix'],
    ]);
    expect(result.hits[0].prominence).toBeCloseTo(0.975, 2);
    expect(result.availability).toEqual({ npm: true });
  });

  it('marks the name taken when the exact probe finds a package search missed', async () => {
    const http = fakeHttp({
      'https://registry.npmjs.org/-/v1/search': { objects: [] },
      'https://registry.npmjs.org/quillo': { name: 'quillo', modified: '2020-01-01T00:00:00Z' },
      'https://api.npmjs.org/downloads': { downloads: 3 },
    });
    const result = await npm.check(context(http));
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ name: 'quillo', match: 'exact', metrics: { weeklyDownloads: 3 } });
    expect(result.availability).toEqual({ npm: false });
  });
});

describe('hackernews source', () => {
  it('groups stories by matching word and ignores fuzzy title words', async () => {
    const http = fakeHttp({
      'https://hn.algolia.com': {
        hits: [
          { objectID: '1', title: 'Show HN: Quillo – a tiny editor', url: 'https://quillo.dev', points: 120, created_at: '2025-01-01T00:00:00Z' },
          { objectID: '2', title: 'Quillo 2.0 released', url: null, points: 30, created_at: '2026-01-01T00:00:00Z' },
          { objectID: '3', title: 'The quill pen is back', url: null, points: 500, created_at: '2026-01-01T00:00:00Z' },
        ],
      },
    });
    const { hits } = await hackernews.check(context(http));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      name: 'Quillo',
      match: 'exact',
      url: 'https://news.ycombinator.com/item?id=1',
      lastActivity: '2026-01-01T00:00:00Z',
      links: ['https://quillo.dev'],
      metrics: { stories: 2, topPoints: 120 },
    });
  });
});

describe('checkName', () => {
  const ok: Source = {
    id: 'ok',
    weightKeys: ['npm'],
    check: async () => ({
      hits: [{ source: 'ok', weightKey: 'npm', name: 'quillo', url: 'u', match: 'exact', prominence: 1 }],
      availability: { npm: false },
    }),
  };
  const broken: Source = {
    id: 'broken',
    weightKeys: ['github_repo'],
    check: async () => {
      throw new Error('HTTP 403 from api.github.com');
    },
  };
  const slow: Source = {
    id: 'slow',
    weightKeys: ['crates'],
    check: ({ signal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('timed out')))),
  };
  const deps = { http: fakeHttp({}), sources: [ok, broken, slow], config: defaultConfig };

  it('keeps going when sources fail or time out, and reports reduced coverage', async () => {
    const result = await checkName('Quillo', { ecosystem: 'js', timeoutMs: 50 }, deps);
    expect(result.name).toBe('quillo');
    expect(result.sources.ok.status).toBe('ok');
    expect(result.sources.broken).toMatchObject({ status: 'error', error: 'HTTP 403 from api.github.com' });
    expect(result.sources.slow.status).toBe('error');
    expect(result.coverage).toBeCloseTo(1 / (1 + 0.6 + 0.4), 2);
    expect(result.blockers).toHaveLength(1);
    expect(result.score).toBe(25); // W 1 × M 1 × P 1 × A 0.75 (no activity date)
  });

  it('runs only the requested sources', async () => {
    const result = await checkName('quillo', { sources: ['ok'] }, deps);
    expect(Object.keys(result.sources)).toEqual(['ok']);
    expect(result.coverage).toBe(1);
  });

  it('rejects invalid names', async () => {
    await expect(checkName('-bad', {}, deps)).rejects.toBeInstanceOf(InvalidInputError);
    await expect(checkName('has space', {}, deps)).rejects.toBeInstanceOf(InvalidInputError);
    await expect(checkName('x'.repeat(65), {}, deps)).rejects.toBeInstanceOf(InvalidInputError);
  });
});

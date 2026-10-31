import { afterEach, describe, expect, it, vi } from 'vitest';
import { crates } from '../src/sources/crates.js';
import { dockerhub } from '../src/sources/dockerhub.js';
import { github } from '../src/sources/github.js';
import { homebrew } from '../src/sources/homebrew.js';
import { nuget } from '../src/sources/nuget.js';
import { packagist } from '../src/sources/packagist.js';
import { pypi } from '../src/sources/pypi.js';
import { rubygems } from '../src/sources/rubygems.js';
import { wikidata } from '../src/sources/wikidata.js';
import { context, fakeHttp } from './helpers.js';

afterEach(() => vi.unstubAllEnvs());

describe('github source', () => {
  const routes = {
    'https://api.github.com/users/quillo': {
      login: 'Quillo',
      type: 'Organization',
      followers: 1000,
      public_repos: 5,
      html_url: 'https://github.com/Quillo',
      blog: 'https://quillo.dev',
    },
    'https://api.github.com/search/repositories': {
      items: [
        { name: 'quillo', full_name: 'Quillo/quillo', description: null, html_url: 'https://github.com/Quillo/quillo', homepage: '', stargazers_count: 99_999, pushed_at: '2026-10-01T00:00:00Z', archived: false },
        { name: 'quill', full_name: 'slab/quill', description: 'Rich text editor', html_url: 'https://github.com/slab/quill', homepage: 'https://quilljs.com', stargazers_count: 40_000, pushed_at: '2026-09-01T00:00:00Z', archived: false },
        { name: 'awesome-lists', full_name: 'someone/awesome-lists', description: null, html_url: 'https://github.com/someone/awesome-lists', homepage: null, stargazers_count: 5, pushed_at: '2020-01-01T00:00:00Z', archived: true },
      ],
    },
  };

  it('reports the account as an exact owner hit and classifies repositories', async () => {
    const result = await github.check(context(fakeHttp(routes)));
    expect(result.availability).toEqual({ github: false });
    expect(result.hits.map((hit) => [hit.name, hit.weightKey, hit.match])).toEqual([
      ['Quillo', 'github_owner', 'exact'],
      ['Quillo/quillo', 'github_repo', 'exact'],
      ['slab/quill', 'github_repo', 'phonetic'],
    ]);
    expect(result.hits[0]).toMatchObject({ links: ['https://quillo.dev'], metrics: { type: 'Organization', followers: 1000 } });
    expect(result.hits[0].prominence).toBeCloseTo(Math.log10(1001) / 5, 5);
    expect(result.hits[1]).toMatchObject({ links: ['https://github.com/Quillo/quillo'], lastActivity: '2026-10-01T00:00:00Z' });
  });

  it('sends GITHUB_TOKEN as a bearer token when it is set', async () => {
    vi.stubEnv('GITHUB_TOKEN', 't0ken');
    const http = fakeHttp(routes);
    await github.check(context(http));
    expect(http.calls).toHaveLength(2);
    for (const call of http.calls) expect(call.options?.headers?.authorization).toBe('Bearer t0ken');
  });

  it('marks the name available when no account holds it, without sending a token if none is set', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    const http = fakeHttp({ 'https://api.github.com/search/repositories': { items: [] } });
    const result = await github.check(context(http));
    expect(result).toEqual({ hits: [], availability: { github: true } });
    for (const call of http.calls) expect(call.options?.headers?.authorization).toBeUndefined();
  });
});

describe('pypi source', () => {
  it('probes name variants and reads downloads from pypistats, falling back when stats are missing', async () => {
    const http = fakeHttp({
      'https://pypi.org/pypi/quillo/json': {
        info: { name: 'Quillo', summary: 'An editor', home_page: null, project_urls: { Source: 'https://github.com/x/quillo' } },
        urls: [{ upload_time_iso_8601: '2026-05-01T00:00:00Z' }],
      },
      'https://pypi.org/pypi/py-quillo/json': { info: { name: 'py-quillo' }, urls: [] },
      'https://pypistats.org/api/packages/quillo/recent': { data: { last_month: 50_000 } },
    });
    const result = await pypi.check(context(http));
    expect(result.availability).toEqual({ pypi: false });
    expect(result.hits.map((hit) => [hit.name, hit.match])).toEqual([
      ['Quillo', 'exact'],
      ['py-quillo', 'affix'],
    ]);
    expect(result.hits[0]).toMatchObject({
      lastActivity: '2026-05-01T00:00:00Z',
      links: ['https://github.com/x/quillo'],
      metrics: { monthlyDownloads: 50_000 },
    });
    expect(result.hits[0].prominence).toBeCloseTo(Math.log10(50_001) / 7.5, 5);
    expect(result.hits[1]).toMatchObject({ prominence: 0.2, metrics: { monthlyDownloads: null } });
  });

  it('counts a project once when several probes resolve to it (PyPI normalizes - _ and .)', async () => {
    const project = { info: { name: 'my-tool' }, urls: [] };
    const http = fakeHttp({
      'https://pypi.org/pypi/my_tool/json': project,
      'https://pypi.org/pypi/my-tool/json': project,
    });
    const result = await pypi.check(context(http, 'my_tool'));
    expect(result.hits.map((hit) => [hit.name, hit.match])).toEqual([['my-tool', 'normalized']]);
    expect(result.availability).toEqual({ pypi: false });
  });
});

describe('crates source', () => {
  const crate = (name: string) => ({
    name,
    description: null,
    recent_downloads: 1000,
    downloads: 5000,
    updated_at: '2026-01-01T00:00:00Z',
    homepage: null,
    repository: `https://github.com/a/${name}`,
  });

  it('treats - and _ as the same character when deciding availability', async () => {
    const http = fakeHttp({ 'https://crates.io/api/v1/crates': { crates: [crate('my-tool'), crate('unrelated')] } });
    const result = await crates.check(context(http, 'my_tool'));
    expect(result.hits.map((hit) => [hit.name, hit.match])).toEqual([['my-tool', 'normalized']]);
    expect(result.hits[0]).toMatchObject({ links: ['https://github.com/a/my-tool'], metrics: { recentDownloads: 1000, downloads: 5000 } });
    expect(result.availability).toEqual({ crates: false });
  });

  it('keeps affix variants as hits without blocking the name', async () => {
    const http = fakeHttp({ 'https://crates.io/api/v1/crates': { crates: [crate('my-tool-cli')] } });
    const result = await crates.check(context(http, 'my_tool'));
    expect(result.hits.map((hit) => [hit.name, hit.match])).toEqual([['my-tool-cli', 'affix']]);
    expect(result.availability).toEqual({ crates: true });
  });
});

describe('rubygems source', () => {
  it('merges the exact lookup, which carries the release date, into search results', async () => {
    const http = fakeHttp({
      'https://rubygems.org/api/v1/search.json': [
        { name: 'quillo', downloads: 100, project_uri: 'https://rubygems.org/gems/quillo' },
        { name: 'quillo-rails', downloads: 50, project_uri: 'https://rubygems.org/gems/quillo-rails' },
      ],
      'https://rubygems.org/api/v1/gems/quillo.json': {
        name: 'quillo',
        downloads: 100,
        version_created_at: '2025-06-01T00:00:00Z',
        project_uri: 'https://rubygems.org/gems/quillo',
        source_code_uri: 'https://github.com/a/quillo',
      },
    });
    const result = await rubygems.check(context(http));
    expect(result.hits.map((hit) => [hit.name, hit.match])).toEqual([
      ['quillo', 'exact'],
      ['quillo-rails', 'substring'],
    ]);
    expect(result.hits[0]).toMatchObject({ lastActivity: '2025-06-01T00:00:00Z', links: ['https://github.com/a/quillo'] });
    expect(result.hits[1].lastActivity).toBeNull();
    expect(result.availability).toEqual({ rubygems: false });
  });

  it('marks the name available when only longer names exist', async () => {
    const http = fakeHttp({
      'https://rubygems.org/api/v1/search.json': [{ name: 'quillo-rails', downloads: 50, project_uri: 'https://rubygems.org/gems/quillo-rails' }],
    });
    expect((await rubygems.check(context(http))).availability).toEqual({ rubygems: true });
  });
});

describe('packagist source', () => {
  const pkg = (name: string) => ({ name, url: `https://packagist.org/packages/${name}`, repository: `https://github.com/${name}`, downloads: 1000 });

  it('counts a vendor named after the query as an affix match and as taken', async () => {
    const http = fakeHttp({
      'https://packagist.org/search.json': { results: [pkg('quillo/framework'), pkg('acme/quillo'), pkg('acme/unrelated')] },
    });
    const result = await packagist.check(context(http));
    expect(result.hits.map((hit) => [hit.name, hit.match])).toEqual([
      ['quillo/framework', 'affix'],
      ['acme/quillo', 'exact'],
    ]);
    expect(result.availability).toEqual({ packagist: false });
  });

  it('leaves the vendor namespace available when only other vendors use the name', async () => {
    const http = fakeHttp({ 'https://packagist.org/search.json': { results: [pkg('acme/quillo')] } });
    expect((await packagist.check(context(http))).availability).toEqual({ packagist: true });
  });
});

describe('nuget source', () => {
  it('uses the search endpoint from the service index and matches ids case-insensitively', async () => {
    const http = fakeHttp({
      'https://api.nuget.org/v3/index.json': {
        resources: [
          { '@id': 'https://api.nuget.org/v3/registration5-semver1/', '@type': 'RegistrationsBaseUrl' },
          { '@id': 'https://search.example/query', '@type': 'SearchQueryService/3.5.0' },
        ],
      },
      'https://search.example/query': {
        data: [
          { id: 'Quillo', totalDownloads: 1_000_000, projectUrl: 'https://quillo.dev', verified: true },
          { id: 'Quillo.Extensions', totalDownloads: 10, verified: false },
        ],
      },
    });
    const result = await nuget.check(context(http));
    expect(result.hits.map((hit) => [hit.name, hit.match])).toEqual([
      ['Quillo', 'exact'],
      ['Quillo.Extensions', 'substring'],
    ]);
    expect(result.hits[0]).toMatchObject({ links: ['https://quillo.dev'], metrics: { verifiedOwner: true } });
    expect(result.availability).toEqual({ nuget: false });
  });

  it('falls back to the default search endpoint when the service index is unavailable', async () => {
    const http = fakeHttp({ 'https://azuresearch-usnc.nuget.org/query': { data: [] } });
    const result = await nuget.check(context(http));
    expect(http.calls.map((call) => new URL(call.url).host)).toEqual(['api.nuget.org', 'azuresearch-usnc.nuget.org']);
    expect(result).toEqual({ hits: [], availability: { nuget: true } });
  });
});

describe('homebrew source', () => {
  it('probes formulae and casks and never rates an accepted package below the floor', async () => {
    const http = fakeHttp({
      'https://formulae.brew.sh/api/formula/quillo.json': {
        name: 'quillo',
        desc: 'Editor',
        homepage: 'https://quillo.dev',
        analytics: { install: { '365d': { quillo: 1_000_000 } } },
      },
      'https://formulae.brew.sh/api/cask/quillo-cli.json': {
        token: 'quillo-cli',
        analytics: { install: { '365d': { 'quillo-cli': 5 } } },
      },
    });
    const result = await homebrew.check(context(http));
    expect(result.hits.map((hit) => [hit.name, hit.match, hit.url])).toEqual([
      ['quillo', 'exact', 'https://formulae.brew.sh/formula/quillo'],
      ['quillo-cli', 'affix', 'https://formulae.brew.sh/cask/quillo-cli'],
    ]);
    expect(result.hits[0].prominence).toBe(1);
    expect(result.hits[1].prominence).toBe(0.4);
    expect(result.availability).toEqual({ homebrew: false });
  });

  it('marks the name available when no probe finds a package', async () => {
    expect(await homebrew.check(context(fakeHttp({})))).toEqual({ hits: [], availability: { homebrew: true } });
  });
});

describe('dockerhub source', () => {
  const repo = (repo_name: string, is_official = false) => ({ repo_name, pull_count: 1000, star_count: 1, is_official });

  it('weights official images separately and treats a namespace named after the query as an affix match', async () => {
    const http = fakeHttp({
      'https://hub.docker.com/v2/search/repositories/': {
        results: [repo('quillo', true), repo('quillo/server'), repo('acme/quillo'), repo('acme/other')],
      },
      'https://hub.docker.com/v2/users/quillo/': { id: 'abc' },
    });
    const result = await dockerhub.check(context(http));
    expect(result.hits.map((hit) => [hit.name, hit.weightKey, hit.match, hit.url])).toEqual([
      ['quillo', 'dockerhub_official', 'exact', 'https://hub.docker.com/_/quillo'],
      ['quillo/server', 'dockerhub_user', 'affix', 'https://hub.docker.com/r/quillo/server'],
      ['acme/quillo', 'dockerhub_user', 'exact', 'https://hub.docker.com/r/acme/quillo'],
    ]);
    expect(result.availability).toEqual({ dockerhub: false });
  });

  it('marks the namespace available when the user lookup is a 404', async () => {
    const http = fakeHttp({ 'https://hub.docker.com/v2/search/repositories/': { results: [] } });
    expect((await dockerhub.check(context(http))).availability).toEqual({ dockerhub: true });
  });
});

describe('wikidata source', () => {
  const API = 'https://www.wikidata.org/w/api.php';
  const claim = (value: unknown) => [{ mainsnak: { datavalue: { value } } }];

  it('classifies entities as tech by class or description and reads links from their claims', async () => {
    const http = fakeHttp({
      [`${API}?action=wbsearchentities`]: {
        search: [
          { id: 'Q1', label: 'Quillo', description: 'tool for writing' },
          { id: 'Q2', label: 'Quillo', description: 'village in Peru' },
          { id: 'Q3', label: 'Something else', description: 'unrelated' },
        ],
      },
      [`${API}?action=wbgetentities`]: {
        entities: {
          Q1: { sitelinks: { enwiki: {}, dewiki: {} }, claims: { P31: claim({ id: 'Q7397' }), P856: claim('https://quillo.dev') } },
          Q2: { sitelinks: {}, claims: { P31: claim({ id: 'Q532' }) } },
        },
      },
    });
    const result = await wikidata.check(context(http));
    expect(result.hits.map((hit) => [hit.url, hit.weightKey, hit.match])).toEqual([
      ['https://www.wikidata.org/wiki/Q1', 'wikidata_tech', 'exact'],
      ['https://www.wikidata.org/wiki/Q2', 'wikidata_other', 'exact'],
    ]);
    expect(result.hits[0].links).toEqual(['https://quillo.dev']);
    expect(result.hits[0].prominence).toBeCloseTo(0.3 + Math.log10(3) / 2, 5);
    expect(result.hits[1].prominence).toBe(0.3);
  });

  it('skips the entity lookup when no search result matches', async () => {
    const http = fakeHttp({ [`${API}?action=wbsearchentities`]: { search: [{ id: 'Q3', label: 'Something else' }] } });
    expect(await wikidata.check(context(http))).toEqual({ hits: [] });
    expect(http.calls).toHaveLength(1);
  });
});

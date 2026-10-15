import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/scoring/config.js';
import { linkKey } from '../src/scoring/links.js';
import { scoreName, type ScoreInput } from '../src/scoring/score.js';
import type { Hit } from '../src/types.js';

const now = new Date('2026-10-13T00:00:00Z');
const monthsAgo = (months: number) => new Date(now.getTime() - months * 30.44 * 24 * 3600 * 1000).toISOString();

const allOk: ScoreInput['sources'] = [
  { id: 'github', weightKeys: ['github_repo', 'github_owner'], ok: true },
  { id: 'npm', weightKeys: ['npm'], ok: true },
];

function hit(overrides: Partial<Hit>): Hit {
  return {
    source: 'npm',
    weightKey: 'npm',
    name: 'x',
    url: 'https://example.test',
    match: 'exact',
    prominence: 0.5,
    lastActivity: now.toISOString(),
    ...overrides,
  };
}

const score = (input: Partial<ScoreInput>) =>
  scoreName({ name: 'quillo', hits: [], availability: {}, sources: allOk, now, ...input }, defaultConfig);

describe('scoreName', () => {
  it('scores a name with no hits as 100', () => {
    const result = score({});
    expect(result.score).toBe(100);
    expect(result.label).toBe('highly_unique');
  });

  it('reproduces the worked example from the design (quillo, ecosystem js -> 41)', () => {
    const result = score({
      ecosystem: 'js',
      hits: [
        hit({
          source: 'github',
          weightKey: 'github_repo',
          name: 'someone/quillo',
          prominence: Math.log10(41) / 5,
          lastActivity: monthsAgo(36),
          links: ['https://github.com/someone/quillo'],
        }),
        hit({ source: 'domains', weightKey: 'domain_com', name: 'quillo.com', prominence: 0.3, activity: 1, links: ['quillo.com'] }),
        hit({
          name: 'quill',
          match: 'edit_distance_1',
          prominence: Math.log10(1_500_001) / 7,
          links: ['https://quilljs.com', 'git+https://github.com/slab/quill.git'],
        }),
        hit({
          source: 'wikidata',
          weightKey: 'wikidata_tech',
          name: 'Quill',
          match: 'edit_distance_1',
          prominence: 0.3 + Math.log10(6) / 2,
          activity: 1,
          links: ['https://quilljs.com/'],
        }),
      ],
    });

    expect(result.score).toBe(41);
    expect(result.label).toBe('crowded');
    expect(result.clusters[0]).toMatchObject({ label: 'quill', sources: ['npm', 'wikidata'], hits: 2 });
    expect(result.clusters[0].risk).toBeCloseTo(0.4367, 3);
    expect(result.clusters).toHaveLength(3);
  });

  it('lets one strong hit dominate while weak hits accumulate slowly', () => {
    const strong = score({ hits: [hit({ prominence: 1 })] });
    const weak = score({
      hits: Array.from({ length: 5 }, (_, i) => hit({ source: `s${i}`, weightKey: 'hackernews', prominence: 0.1 })),
    });
    expect(strong.score).toBe(50);
    expect(weak.score).toBeGreaterThan(80);
  });

  it('decays the long tail of a weight key and caps its combined risk at its weight', () => {
    const weak = Array.from({ length: 50 }, (_, i) => hit({ name: `quillo-${i}`, prominence: 0.1 }));
    const decayed = score({ hits: weak });
    expect(decayed.hits.map((h) => h.factors.D).slice(0, 3)).toEqual([1, 0.5, 0.25]);
    // One hit alone would be 0.05 risk; fifty of them stay below two hits' worth.
    expect(100 - decayed.distinctiveness).toBeLessThan(10);

    const strong = Array.from({ length: 50 }, (_, i) => hit({ name: `quillo-${i}`, prominence: 1 }));
    expect(score({ hits: strong }).distinctiveness).toBeCloseTo(50, 0); // npm weight 0.5 -> at most 50 points
  });

  it('decays risk for inactive projects but never below the floor', () => {
    const active = score({ hits: [hit({ prominence: 1 })] }).hits[0];
    const dead = score({ hits: [hit({ prominence: 1, lastActivity: monthsAgo(240) })] }).hits[0];
    const unknown = score({ hits: [hit({ prominence: 1, lastActivity: null })] }).hits[0];
    expect(active.factors.A).toBe(1);
    expect(dead.factors.A).toBeCloseTo(0.5, 2);
    expect(unknown.factors.A).toBe(0.75);
  });

  it('boosts the home registry weight when an ecosystem is given', () => {
    const plain = score({ hits: [hit({})] });
    const js = score({ ecosystem: 'js', hits: [hit({})] });
    expect(plain.hits[0].factors.W).toBe(0.5);
    expect(js.hits[0].factors.W).toBe(1);
  });

  it('caps the score when the name is taken on the ecosystem registry', () => {
    const result = score({ ecosystem: 'python', availability: { pypi: false } });
    expect(result.score).toBe(35);
    expect(result.blockers).toHaveLength(1);
    expect(score({ availability: { pypi: false } }).blockers).toHaveLength(0);
  });

  it('applies name penalties', () => {
    expect(scoreName({ name: 'orbit', hits: [], availability: {}, sources: allOk, now }, defaultConfig).score).toBe(90);
    expect(scoreName({ name: 'bq', hits: [], availability: {}, sources: allOk, now }, defaultConfig).score).toBe(90);
    expect(scoreName({ name: 'web3x', hits: [], availability: {}, sources: allOk, now }, defaultConfig).score).toBe(95);
  });

  it('reports coverage from the weight of the sources that answered', () => {
    const result = score({
      sources: [
        { id: 'github', weightKeys: ['github_repo', 'github_owner'], ok: false },
        { id: 'npm', weightKeys: ['npm'], ok: true },
      ],
    });
    expect(result.coverage).toBeCloseTo(0.5 / 1.1, 2);
  });
});

describe('linkKey', () => {
  it.each([
    ['git+https://github.com/Slab/quill.git', 'github.com/slab/quill'],
    ['git@github.com:slab/quill.git', 'github.com/slab/quill'],
    ['https://github.com/slab/quill/issues', 'github.com/slab/quill'],
    ['https://www.quilljs.com/docs/', 'quilljs.com'],
    ['quillo.com', 'quillo.com'],
    ['https://github.com', null],
    ['https://www.npmjs.com/', null],
    ['https://user.github.io/project/page', 'user.github.io/project'],
  ])('%s -> %s', (raw, expected) => {
    expect(linkKey(raw)).toBe(expected);
  });
});

import { classifyMatch, MATCH_ORDER, normalize } from '../matching.js';
import type { Hit, MatchType } from '../types.js';
import { compact, logScale } from '../util.js';
import type { Source } from './types.js';

interface SearchResponse {
  hits: { objectID: string; title: string; url: string | null; points: number | null; created_at: string }[];
}

/** Fuzzy matches against free-form titles are mostly noise, so only near-identical words count. */
const ACCEPTED: MatchType[] = ['exact', 'normalized', 'affix'];

function bestToken(name: string, title: string): { token: string; match: MatchType } | null {
  let best: { token: string; match: MatchType } | null = null;
  for (const raw of title.split(/[^a-z0-9._-]+/i)) {
    const token = raw.replace(/^[._-]+|[._-]+$/g, '');
    const match = token && classifyMatch(name, token);
    if (!match || !ACCEPTED.includes(match)) continue;
    if (!best || MATCH_ORDER.indexOf(match) < MATCH_ORDER.indexOf(best.match)) best = { token, match };
  }
  return best;
}

export const hackernews: Source = {
  id: 'hackernews',
  weightKeys: ['hackernews'],
  async check({ name, http, signal, prominence }) {
    const search = await http.getJson<SearchResponse>(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(name)}&tags=story&hitsPerPage=50`,
      { signal },
    );

    // One hit per distinct matching word, summarizing every story that mentions it.
    const groups = new Map<string, { token: string; match: MatchType; stories: SearchResponse['hits'] }>();
    for (const story of search?.hits ?? []) {
      const best = bestToken(name, story.title);
      if (!best) continue;
      const key = normalize(best.token);
      const group = groups.get(key) ?? { ...best, stories: [] };
      group.stories.push(story);
      groups.set(key, group);
    }

    const hits: Hit[] = [...groups.values()].map(({ token, match, stories }) => {
      const top = stories.reduce((a, b) => ((b.points ?? 0) > (a.points ?? 0) ? b : a));
      const latest = stories.map((story) => story.created_at).sort().at(-1);
      return {
        source: 'hackernews',
        weightKey: 'hackernews',
        name: token,
        url: `https://news.ycombinator.com/item?id=${top.objectID}`,
        match,
        prominence: logScale(top.points, prominence.hnPoints),
        lastActivity: latest ?? null,
        // Only the top story's link: one word can name several unrelated projects.
        links: compact([top.url]),
        description: top.title,
        metrics: { stories: stories.length, topPoints: top.points },
      };
    });
    return { hits };
  },
};

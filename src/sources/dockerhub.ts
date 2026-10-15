import { blocksName, classifyMatch } from '../matching.js';
import type { Hit } from '../types.js';
import { logScale } from '../util.js';
import type { Source } from './types.js';

const API = 'https://hub.docker.com/v2';

interface SearchResponse {
  results: { repo_name: string; short_description?: string; pull_count: number; star_count: number; is_official: boolean }[];
}

export const dockerhub: Source = {
  id: 'dockerhub',
  weightKeys: ['dockerhub_official', 'dockerhub_user'],
  async check({ name, http, signal, prominence }) {
    const [search, namespace] = await Promise.all([
      http.getJson<SearchResponse>(`${API}/search/repositories/?query=${encodeURIComponent(name)}&page_size=50`, {
        signal,
      }),
      // Redirects to /orgs/<name> for organizations; 404 when nobody holds the namespace.
      http.getJson<unknown>(`${API}/users/${name}/`, { signal }),
    ]);

    const hits: Hit[] = [];
    for (const repo of search?.results ?? []) {
      const [owner, image] = repo.repo_name.includes('/') ? repo.repo_name.split('/') : [null, repo.repo_name];
      // An owner named exactly after the query is a namespace match: at most an affix-level match.
      const match = classifyMatch(name, image) ?? (owner && blocksName(name, owner) ? 'affix' : null);
      if (!match) continue;
      hits.push({
        source: 'dockerhub',
        weightKey: repo.is_official ? 'dockerhub_official' : 'dockerhub_user',
        name: repo.repo_name,
        url: repo.is_official ? `https://hub.docker.com/_/${image}` : `https://hub.docker.com/r/${repo.repo_name}`,
        match,
        prominence: logScale(repo.pull_count, prominence.dockerPulls),
        description: repo.short_description || undefined,
        metrics: { pulls: repo.pull_count, stars: repo.star_count, official: repo.is_official },
      });
    }

    return { hits, availability: { dockerhub: !namespace } };
  },
};

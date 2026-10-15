import { blocksName, classifyMatch } from '../matching.js';
import type { Hit } from '../types.js';
import { compact, logScale } from '../util.js';
import type { Source } from './types.js';

const SERVICE_INDEX = 'https://api.nuget.org/v3/index.json';
const FALLBACK_SEARCH = 'https://azuresearch-usnc.nuget.org/query';

interface ServiceIndex {
  resources: { '@id': string; '@type': string }[];
}

interface SearchResponse {
  data: { id: string; description?: string; totalDownloads: number; projectUrl?: string; verified: boolean }[];
}

export const nuget: Source = {
  id: 'nuget',
  weightKeys: ['nuget'],
  async check({ name, http, signal, prominence }) {
    const index = await http.getJson<ServiceIndex>(SERVICE_INDEX, { signal }).catch(() => null);
    const searchUrl =
      index?.resources.find((resource) => resource['@type'].startsWith('SearchQueryService'))?.['@id'] ??
      FALLBACK_SEARCH;
    const search = await http.getJson<SearchResponse>(
      `${searchUrl}?q=${encodeURIComponent(name)}&take=50&prerelease=true&semVerLevel=2.0.0`,
      { signal },
    );

    const hits: Hit[] = [];
    for (const pkg of search?.data ?? []) {
      const match = classifyMatch(name, pkg.id);
      if (!match) continue;
      hits.push({
        source: 'nuget',
        weightKey: 'nuget',
        name: pkg.id,
        url: `https://www.nuget.org/packages/${pkg.id}`,
        match,
        prominence: logScale(pkg.totalDownloads, prominence.nugetTotalDownloads),
        links: compact([pkg.projectUrl]),
        description: pkg.description,
        metrics: { totalDownloads: pkg.totalDownloads, verifiedOwner: pkg.verified },
      });
    }

    const taken = hits.some((hit) => blocksName(name, hit.name));
    return { hits, availability: { nuget: !taken } };
  },
};

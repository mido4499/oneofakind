import { blocksName, classifyMatch } from '../matching.js';
import type { Hit } from '../types.js';
import { compact, logScale } from '../util.js';
import type { Source } from './types.js';

interface Gem {
  name: string;
  info?: string;
  downloads: number;
  version_created_at?: string;
  project_uri: string;
  homepage_uri?: string | null;
  source_code_uri?: string | null;
}

export const rubygems: Source = {
  id: 'rubygems',
  weightKeys: ['rubygems'],
  async check({ name, http, signal, prominence }) {
    const [search, exact] = await Promise.all([
      http.getJson<Gem[]>(`https://rubygems.org/api/v1/search.json?query=${encodeURIComponent(name)}`, { signal }),
      http.getJson<Gem>(`https://rubygems.org/api/v1/gems/${name}.json`, { signal }),
    ]);
    const gems = new Map((search ?? []).map((gem) => [gem.name, gem]));
    // The exact lookup carries `version_created_at`, which search results lack.
    if (exact) gems.set(exact.name, exact);

    const hits: Hit[] = [];
    for (const gem of gems.values()) {
      const match = classifyMatch(name, gem.name);
      if (!match) continue;
      hits.push({
        source: 'rubygems',
        weightKey: 'rubygems',
        name: gem.name,
        url: gem.project_uri,
        match,
        prominence: logScale(gem.downloads, prominence.rubygemsTotalDownloads),
        lastActivity: gem.version_created_at ?? null,
        links: compact([gem.homepage_uri, gem.source_code_uri]),
        description: gem.info,
        metrics: { downloads: gem.downloads },
      });
    }

    const taken = hits.some((hit) => blocksName(name, hit.name));
    return { hits, availability: { rubygems: !taken } };
  },
};

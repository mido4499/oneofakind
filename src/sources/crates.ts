import { blocksName, classifyMatch } from '../matching.js';
import type { Hit } from '../types.js';
import { compact, logScale } from '../util.js';
import type { Source } from './types.js';

interface SearchResponse {
  crates: {
    name: string;
    description: string | null;
    recent_downloads: number | null;
    downloads: number;
    updated_at: string;
    homepage: string | null;
    repository: string | null;
  }[];
}

export const crates: Source = {
  id: 'crates',
  weightKeys: ['crates'],
  async check({ name, http, signal, prominence }) {
    const search = await http.getJson<SearchResponse>(
      `https://crates.io/api/v1/crates?q=${encodeURIComponent(name)}&per_page=50`,
      { signal },
    );

    const hits: Hit[] = [];
    for (const crate of search?.crates ?? []) {
      const match = classifyMatch(name, crate.name);
      if (!match) continue;
      hits.push({
        source: 'crates',
        weightKey: 'crates',
        name: crate.name,
        url: `https://crates.io/crates/${crate.name}`,
        match,
        prominence: logScale(crate.recent_downloads, prominence.cratesRecentDownloads),
        lastActivity: crate.updated_at,
        links: compact([crate.homepage, crate.repository]),
        description: crate.description ?? undefined,
        metrics: { recentDownloads: crate.recent_downloads, downloads: crate.downloads },
      });
    }

    // crates.io treats `-` and `_` as the same character.
    const taken = hits.some((hit) => blocksName(name, hit.name));
    return { hits, availability: { crates: !taken } };
  },
};

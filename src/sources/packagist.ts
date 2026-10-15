import { blocksName, classifyMatch } from '../matching.js';
import type { Hit } from '../types.js';
import { compact, logScale } from '../util.js';
import type { Source } from './types.js';

interface SearchResponse {
  results: { name: string; description?: string; url: string; repository?: string; downloads: number }[];
}

export const packagist: Source = {
  id: 'packagist',
  weightKeys: ['packagist'],
  async check({ name, http, signal, prominence }) {
    const search = await http.getJson<SearchResponse>(
      `https://packagist.org/search.json?q=${encodeURIComponent(name)}&per_page=50`,
      { signal },
    );

    const hits: Hit[] = [];
    let vendorTaken = false;
    for (const result of search?.results ?? []) {
      const [vendor, pkg] = result.name.split('/');
      vendorTaken ||= blocksName(name, vendor);
      // A vendor named after the project is a namespace match: at most an affix-level match.
      const vendorMatch = blocksName(name, vendor) ? 'affix' : null;
      const match = (pkg ? classifyMatch(name, pkg) : null) ?? vendorMatch;
      if (!match) continue;
      hits.push({
        source: 'packagist',
        weightKey: 'packagist',
        name: result.name,
        url: result.url,
        match,
        prominence: logScale(result.downloads, prominence.packagistTotalDownloads),
        links: compact([result.repository]),
        description: result.description,
        metrics: { downloads: result.downloads },
      });
    }

    // Packages are vendor/name, so what can actually be "taken" is the vendor namespace.
    return { hits, availability: { packagist: !vendorTaken } };
  },
};

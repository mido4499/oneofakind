import { blocksName, classifyMatch, normalize } from '../matching.js';
import type { Hit } from '../types.js';
import { compact, logScale } from '../util.js';
import type { Source } from './types.js';

const REGISTRY = 'https://registry.npmjs.org';

interface SearchResponse {
  objects: {
    downloads?: { weekly?: number };
    package: {
      name: string;
      description?: string;
      date?: string;
      links?: { npm?: string; homepage?: string; repository?: string };
    };
  }[];
}

interface Package {
  name: string;
  description?: string;
  date?: string;
  weekly?: number;
  links: string[];
}

export const npm: Source = {
  id: 'npm',
  weightKeys: ['npm'],
  async check({ name, http, signal, prominence }) {
    const packages = new Map<string, Package>();

    // Search ranks by relevance, so also probe the exact names that npm would treat as ours.
    const probes = [...new Set([name, normalize(name)])];
    const [search, ...docs] = await Promise.all([
      http.getJson<SearchResponse>(`${REGISTRY}/-/v1/search?text=${encodeURIComponent(name)}&size=50`, { signal }),
      ...probes.map((probe) =>
        http.getJson<{ name: string; modified?: string }>(`${REGISTRY}/${probe}`, {
          signal,
          headers: { accept: 'application/vnd.npm.install-v1+json' },
        }),
      ),
    ]);

    for (const { package: pkg, downloads } of search?.objects ?? []) {
      packages.set(pkg.name, {
        name: pkg.name,
        description: pkg.description,
        date: pkg.date,
        weekly: downloads?.weekly,
        links: compact([pkg.links?.homepage, pkg.links?.repository]),
      });
    }
    for (const doc of compact(docs)) {
      if (packages.has(doc.name)) continue;
      const downloads = await http
        .getJson<{ downloads?: number }>(`https://api.npmjs.org/downloads/point/last-week/${doc.name}`, { signal })
        .catch(() => null);
      packages.set(doc.name, { name: doc.name, date: doc.modified, weekly: downloads?.downloads, links: [] });
    }

    const hits: Hit[] = [];
    for (const pkg of packages.values()) {
      const slash = pkg.name.indexOf('/');
      const scope = pkg.name.startsWith('@') ? pkg.name.slice(1, slash) : null;
      const bare = scope ? pkg.name.slice(slash + 1) : pkg.name;
      let match = classifyMatch(name, bare) ?? (scope && blocksName(name, scope) ? 'affix' : null);
      if (!match) continue;
      // A scoped package never blocks the bare name, so it is a namespaced variant at most.
      if (scope && (match === 'exact' || match === 'normalized')) match = 'affix';
      hits.push({
        source: 'npm',
        weightKey: 'npm',
        name: pkg.name,
        url: `https://www.npmjs.com/package/${pkg.name}`,
        match,
        prominence: logScale(pkg.weekly, prominence.npmWeeklyDownloads),
        lastActivity: pkg.date ?? null,
        links: pkg.links,
        description: pkg.description,
        metrics: { weeklyDownloads: pkg.weekly ?? null },
      });
    }

    // npm rejects new names that equal an existing one once punctuation is removed.
    const taken = hits.some((hit) => !hit.name.startsWith('@') && blocksName(name, hit.name));
    return { hits, availability: { npm: !taken } };
  },
};

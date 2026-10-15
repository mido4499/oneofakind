import { blocksName, classifyMatch, probeVariants } from '../matching.js';
import type { Hit } from '../types.js';
import { clamp, compact, logScale, mapLimit } from '../util.js';
import type { Source } from './types.js';

const API = 'https://formulae.brew.sh/api';

interface Formula {
  name: string;
  desc?: string;
  homepage?: string;
  analytics?: { install?: { '365d'?: Record<string, number> } };
}

interface Cask {
  token: string;
  desc?: string;
  homepage?: string;
  analytics?: { install?: { '365d'?: Record<string, number> } };
}

export const homebrew: Source = {
  id: 'homebrew',
  weightKeys: ['homebrew'],
  async check({ name, http, signal, prominence }) {
    // The full formula list is ~30 MB, so probe likely names instead of searching.
    const candidates = probeVariants(name, { suffixes: ['cli'] });
    const [formulae, casks] = await Promise.all([
      mapLimit(candidates, 4, (candidate) => http.getJson<Formula>(`${API}/formula/${candidate}.json`, { signal })),
      mapLimit(candidates, 4, (candidate) => http.getJson<Cask>(`${API}/cask/${candidate}.json`, { signal })),
    ]);

    const entries = [
      ...compact(formulae).map((formula) => ({ ...formula, id: formula.name, kind: 'formula' })),
      ...compact(casks).map((cask) => ({ ...cask, id: cask.token, kind: 'cask' })),
    ];
    const hits: Hit[] = [];
    for (const entry of entries) {
      const match = classifyMatch(name, entry.id);
      if (!match) continue;
      const installs = entry.analytics?.install?.['365d']?.[entry.id] ?? 0;
      hits.push({
        source: 'homebrew',
        weightKey: 'homebrew',
        name: entry.id,
        url: `https://formulae.brew.sh/${entry.kind}/${entry.id}`,
        match,
        // Being accepted into homebrew-core/cask already implies some notability.
        prominence: clamp(
          Math.max(prominence.homebrewFloor, logScale(installs, prominence.homebrewInstalls365d)),
        ),
        links: compact([entry.homepage]),
        description: entry.desc,
        metrics: { kind: entry.kind, installs365d: installs },
      });
    }

    const taken = hits.some((hit) => blocksName(name, hit.name));
    return { hits, availability: { homebrew: !taken } };
  },
};

import { blocksName, classifyMatch } from '../matching.js';
import type { Hit } from '../types.js';
import { logScale } from '../util.js';
import type { Source } from './types.js';

interface SearchResponse {
  response: { docs: { g: string; a: string; latestVersion?: string; timestamp?: number; versionCount?: number }[] };
}

export const maven: Source = {
  id: 'maven',
  weightKeys: ['maven'],
  async check({ name, http, signal, prominence }) {
    const search = await http.getJson<SearchResponse>(
      `https://search.maven.org/solrsearch/select?q=${encodeURIComponent(name)}&rows=50&wt=json`,
      { signal },
    );

    const hits: Hit[] = [];
    for (const doc of search?.response.docs ?? []) {
      // `io.quillo:core` is a project named after the query even though the artifact is not.
      const groupMatch = blocksName(name, doc.g.split('.').at(-1)!) ? 'affix' : null;
      const match = classifyMatch(name, doc.a) ?? groupMatch;
      if (!match) continue;
      hits.push({
        source: 'maven',
        weightKey: 'maven',
        name: `${doc.g}:${doc.a}`,
        url: `https://central.sonatype.com/artifact/${doc.g}/${doc.a}`,
        match,
        // Maven Central publishes no download counts; the number of releases is the best proxy.
        prominence: logScale(doc.versionCount, prominence.mavenVersions),
        lastActivity: doc.timestamp ? new Date(doc.timestamp).toISOString() : null,
        metrics: { versionCount: doc.versionCount ?? null, latestVersion: doc.latestVersion ?? null },
      });
    }

    // Coordinates are namespaced by groupId, so no availability entry: the name is never blocked.
    return { hits };
  },
};

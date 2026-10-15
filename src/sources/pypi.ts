import { blocksName, classifyMatch, probeVariants } from '../matching.js';
import type { Hit } from '../types.js';
import { compact, logScale, mapLimit } from '../util.js';
import type { Source } from './types.js';

interface ProjectResponse {
  info: { name: string; summary?: string; home_page?: string | null; project_urls?: Record<string, string> | null };
  urls: { upload_time_iso_8601?: string }[];
}

interface StatsResponse {
  data: { last_month?: number };
}

/** PEP 503 name normalization. */
const pep503 = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');

export const pypi: Source = {
  id: 'pypi',
  weightKeys: ['pypi'],
  async check({ name, http, signal, prominence }) {
    // PyPI has no search API, so probe the names a collision would most likely have.
    const candidates = probeVariants(name, { prefixes: ['py', 'python'], suffixes: ['py', 'python'] });
    const projects = await mapLimit(candidates, 6, (candidate) =>
      http.getJson<ProjectResponse>(`https://pypi.org/pypi/${candidate}/json`, { signal }),
    );

    const unique = new Map(compact(projects).map((project) => [pep503(project.info.name), project]));
    const hits: Hit[] = [];
    for (const [normalized, { info, urls }] of unique) {
      const match = classifyMatch(name, info.name);
      if (!match) continue;
      const stats = await http
        .getJson<StatsResponse>(`https://pypistats.org/api/packages/${normalized}/recent`, { signal })
        .catch(() => null);
      const monthly = stats?.data.last_month;
      hits.push({
        source: 'pypi',
        weightKey: 'pypi',
        name: info.name,
        url: `https://pypi.org/project/${info.name}/`,
        match,
        prominence:
          monthly === undefined ? prominence.pypiUnknown : logScale(monthly, prominence.pypiMonthlyDownloads),
        lastActivity: urls[0]?.upload_time_iso_8601 ?? null,
        links: compact([info.home_page, ...Object.values(info.project_urls ?? {})]),
        description: info.summary,
        metrics: { monthlyDownloads: monthly ?? null },
      });
    }

    const taken = hits.some((hit) => blocksName(name, hit.name));
    return { hits, availability: { pypi: !taken } };
  },
};

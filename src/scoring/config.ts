import type { Ecosystem, MatchType, WeightKey } from '../types.js';

/**
 * Every tunable constant of the scoring model lives here.
 * Bump `version` whenever a value changes so API consumers can tell scores apart.
 */
export interface ScoringConfig {
  version: string;
  /** W: how much a collision of this kind matters. */
  weights: Record<WeightKey, number>;
  /** Passing `ecosystem` overrides weights for that ecosystem's home registry, and a taken
   *  name on `availabilityKey` caps the score. */
  ecosystems: Record<Ecosystem, { boost: Partial<Record<WeightKey, number>>; availabilityKey?: string }>;
  /** M: how similar the names are. */
  match: Record<MatchType, number>;
  /** P: per-source log scales (`decades` = powers of ten needed to reach 1.0). */
  prominence: {
    floor: number;
    githubStars: number;
    githubFollowers: number;
    npmWeeklyDownloads: number;
    pypiMonthlyDownloads: number;
    pypiUnknown: number;
    cratesRecentDownloads: number;
    rubygemsTotalDownloads: number;
    packagistTotalDownloads: number;
    nugetTotalDownloads: number;
    homebrewInstalls365d: number;
    homebrewFloor: number;
    dockerPulls: number;
    wikidataBase: number;
    wikidataSitelinks: number;
    hnPoints: number;
    domainParked: number;
    domainLive: number;
    domainRanked: number;
  };
  /** A = floor + (1 - floor) * exp(-monthsSinceActivity / decayMonths). */
  activity: { floor: number; decayMonths: number; unknown: number };
  /** D: within one weight key, the n-th strongest hit (from 0) counts tailDecay^n, so fifty tiny
   *  `quillo-*` repos weigh about as much as two. The key's combined risk is then capped at its W. */
  tailDecay: number;
  /** Same project on N sources: cluster risk = max(r) * (1 + bonus * (N - 1)). */
  clusterBonusPerExtraSource: number;
  penalties: { shortNameMaxLength: number; shortName: number; commonWord: number; hardToSpell: number };
  /** Score ceiling when the name is taken on the requested ecosystem's registry. */
  blockerCap: number;
  /** Highest `min` first. */
  bands: { min: number; label: string }[];
}

export const defaultConfig: ScoringConfig = {
  version: '0.3.0',
  weights: {
    domain_com: 0.6,
    domain_other: 0.2,
    github_repo: 0.6,
    github_owner: 0.4,
    npm: 0.5,
    pypi: 0.5,
    homebrew: 0.5,
    crates: 0.4,
    rubygems: 0.3,
    packagist: 0.3,
    nuget: 0.3,
    dockerhub_official: 0.7,
    dockerhub_user: 0.2,
    wikidata_tech: 0.7,
    wikidata_other: 0.3,
    hackernews: 0.4,
  },
  ecosystems: {
    js: { boost: { npm: 1 }, availabilityKey: 'npm' },
    python: { boost: { pypi: 1 }, availabilityKey: 'pypi' },
    rust: { boost: { crates: 1 }, availabilityKey: 'crates' },
    ruby: { boost: { rubygems: 1 }, availabilityKey: 'rubygems' },
    php: { boost: { packagist: 1 }, availabilityKey: 'packagist' },
    dotnet: { boost: { nuget: 1 }, availabilityKey: 'nuget' },
    homebrew: { boost: { homebrew: 1 }, availabilityKey: 'homebrew' },
    docker: { boost: { dockerhub_official: 1, dockerhub_user: 0.5 }, availabilityKey: 'dockerhub' },
  },
  match: {
    exact: 1,
    normalized: 0.9,
    affix: 0.6,
    phonetic: 0.5,
    edit_distance_1: 0.45,
    edit_distance_2: 0.2,
    substring: 0.15,
  },
  prominence: {
    floor: 0.05,
    githubStars: 5,
    githubFollowers: 5,
    npmWeeklyDownloads: 7,
    pypiMonthlyDownloads: 7.5,
    pypiUnknown: 0.2,
    cratesRecentDownloads: 7,
    rubygemsTotalDownloads: 8.5,
    packagistTotalDownloads: 8,
    nugetTotalDownloads: 9,
    homebrewInstalls365d: 6,
    homebrewFloor: 0.4,
    dockerPulls: 9,
    wikidataBase: 0.3,
    wikidataSitelinks: 2,
    hnPoints: 3,
    domainParked: 0.3,
    domainLive: 0.7,
    domainRanked: 1,
  },
  activity: { floor: 0.5, decayMonths: 24, unknown: 0.75 },
  tailDecay: 0.5,
  clusterBonusPerExtraSource: 0.1,
  penalties: { shortNameMaxLength: 3, shortName: 10, commonWord: 10, hardToSpell: 5 },
  blockerCap: 35,
  bands: [
    { min: 85, label: 'highly_unique' },
    { min: 65, label: 'mostly_clear' },
    { min: 40, label: 'crowded' },
    { min: 0, label: 'high_risk' },
  ],
};

import type { Ecosystem, Hit, WeightKey } from '../types.js';
import { clamp, compact, monthsSince, orCombine } from '../util.js';
import type { ScoringConfig } from './config.js';
import { linkKey } from './links.js';
import { namePenalties, type Penalty } from './penalties.js';

export interface ScoredHit extends Hit {
  /** The factors behind `risk = W * M * P * A * D`. */
  factors: { W: number; M: number; P: number; A: number; D: number };
  risk: number;
}

export interface Cluster {
  label: string;
  risk: number;
  match: Hit['match'];
  url: string;
  sources: string[];
  hits: number;
}

export interface Blocker {
  platform: string;
  detail: string;
}

export interface SourceStatus {
  id: string;
  weightKeys: WeightKey[];
  ok: boolean;
}

export interface ScoreInput {
  name: string;
  ecosystem?: Ecosystem;
  hits: Hit[];
  availability: Record<string, boolean>;
  sources: SourceStatus[];
  now?: Date;
}

export interface ScoreResult {
  score: number;
  label: string;
  /** Score before name penalties and blocker caps, 0..100. */
  distinctiveness: number;
  /** Share of source weight that answered, 0..1. */
  coverage: number;
  penalties: Penalty[];
  blockers: Blocker[];
  clusters: Cluster[];
  hits: ScoredHit[];
}

const round = (value: number, digits = 3) => Number(value.toFixed(digits));

export function weightFor(key: WeightKey, ecosystem: Ecosystem | undefined, config: ScoringConfig): number {
  return (ecosystem && config.ecosystems[ecosystem].boost[key]) ?? config.weights[key];
}

export function activityFactor(hit: Hit, now: Date, config: ScoringConfig): number {
  if (hit.activity !== undefined) return hit.activity;
  const months = hit.lastActivity ? monthsSince(hit.lastActivity, now) : null;
  if (months === null) return config.activity.unknown;
  const { floor, decayMonths } = config.activity;
  return floor + (1 - floor) * Math.exp(-months / decayMonths);
}

function scoreHit(hit: Hit, input: ScoreInput, now: Date, config: ScoringConfig): ScoredHit {
  const W = weightFor(hit.weightKey, input.ecosystem, config);
  const M = config.match[hit.match];
  const P = clamp(hit.prominence, config.prominence.floor, 1);
  const A = activityFactor(hit, now, config);
  return { ...hit, factors: { W: round(W), M, P: round(P), A: round(A), D: 1 }, risk: W * M * P * A };
}

/** Many weak hits of one kind must not outweigh one real collision: the n-th strongest hit of a
 *  weight key counts tailDecay^n, and the key's combined risk is capped at its own weight. */
function dampenByWeightKey(hits: ScoredHit[], config: ScoringConfig): void {
  for (const group of Map.groupBy(hits, (hit) => hit.weightKey).values()) {
    group.sort((a, b) => b.risk - a.risk);
    const decayed = group.map((hit, n) => hit.risk * config.tailDecay ** n);

    let scale = 1;
    const cap = group[0].factors.W;
    if (orCombine(decayed) > cap) {
      let low = 0;
      let high = 1;
      for (let i = 0; i < 40; i++) {
        const mid = (low + high) / 2;
        if (orCombine(decayed.map((risk) => risk * mid)) > cap) high = mid;
        else low = mid;
      }
      scale = low;
    }
    group.forEach((hit, n) => {
      const D = config.tailDecay ** n * scale;
      hit.risk *= D;
      hit.factors.D = round(D, 4);
    });
  }
}

/** Groups hits that share a homepage/repository link: the same project seen on several sources. */
function clusterHits(hits: ScoredHit[]): ScoredHit[][] {
  const parent = hits.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owners = new Map<string, number>();
  hits.forEach((hit, i) => {
    for (const key of compact((hit.links ?? []).map(linkKey))) {
      const owner = owners.get(key);
      if (owner === undefined) owners.set(key, i);
      else parent[find(i)] = find(owner);
    }
  });
  return [...Map.groupBy(hits.map((_, i) => i), find).values()].map((indexes) => indexes.map((i) => hits[i]));
}

function toCluster(group: ScoredHit[], config: ScoringConfig): Cluster {
  const top = group.reduce((best, hit) => (hit.risk > best.risk ? hit : best));
  const sources = [...new Set(group.map((hit) => hit.source))];
  const risk = Math.min(1, top.risk * (1 + config.clusterBonusPerExtraSource * (sources.length - 1)));
  return { label: top.name, risk, match: top.match, url: top.url, sources, hits: group.length };
}

function coverageOf(sources: SourceStatus[], ecosystem: Ecosystem | undefined, config: ScoringConfig): number {
  const weightOf = (source: SourceStatus) =>
    Math.max(...source.weightKeys.map((key) => weightFor(key, ecosystem, config)));
  const total = sources.reduce((sum, source) => sum + weightOf(source), 0);
  const answered = sources.filter((source) => source.ok).reduce((sum, source) => sum + weightOf(source), 0);
  return total ? answered / total : 0;
}

export function scoreName(input: ScoreInput, config: ScoringConfig): ScoreResult {
  const now = input.now ?? new Date();
  const hits = input.hits.map((hit) => scoreHit(hit, input, now, config));
  dampenByWeightKey(hits, config);

  const clusters = clusterHits(hits)
    .map((group) => toCluster(group, config))
    .sort((a, b) => b.risk - a.risk);
  const distinctiveness = 100 * (1 - orCombine(clusters.map((cluster) => cluster.risk)));

  const penalties = namePenalties(input.name, config);
  let score = distinctiveness - penalties.reduce((sum, penalty) => sum + penalty.points, 0);

  const blockers: Blocker[] = [];
  const availabilityKey = input.ecosystem && config.ecosystems[input.ecosystem].availabilityKey;
  if (availabilityKey && input.availability[availabilityKey] === false) {
    blockers.push({
      platform: availabilityKey,
      detail: `"${input.name}" is already taken on ${availabilityKey}, the home registry for ${input.ecosystem}`,
    });
    score = Math.min(score, config.blockerCap);
  }

  score = Math.round(clamp(score, 0, 100));
  return {
    score,
    label: config.bands.find((band) => score >= band.min)!.label,
    distinctiveness: round(distinctiveness, 1),
    coverage: round(coverageOf(input.sources, input.ecosystem, config), 2),
    penalties,
    blockers,
    clusters: clusters.map((cluster) => ({ ...cluster, risk: round(cluster.risk) })),
    hits: hits.sort((a, b) => b.risk - a.risk).map((hit) => ({ ...hit, risk: round(hit.risk) })),
  };
}

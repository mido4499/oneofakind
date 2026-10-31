import { createHttp, type Http } from './http.js';
import { defaultConfig, type ScoringConfig } from './scoring/config.js';
import { scoreName, type ScoreResult } from './scoring/score.js';
import { allSources } from './sources/index.js';
import type { Source } from './sources/types.js';
import { ECOSYSTEMS, type Ecosystem, type Hit } from './types.js';

const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

export class InvalidInputError extends Error {}

export interface CheckOptions {
  ecosystem?: Ecosystem;
  /** Source ids to run; defaults to all. */
  sources?: string[];
  /** Time budget per source. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CheckDeps {
  http: Http;
  sources: Source[];
  config: ScoringConfig;
}

export interface SourceReport {
  status: 'ok' | 'error';
  ms: number;
  hits: number;
  error?: string;
}

export interface CheckResult extends ScoreResult {
  name: string;
  ecosystem: Ecosystem | null;
  scoringVersion: string;
  availability: Record<string, boolean>;
  sources: Record<string, SourceReport>;
}

const defaultDeps: CheckDeps = { http: createHttp(), sources: allSources, config: defaultConfig };

export function parseName(raw: string | undefined): string {
  const name = raw?.trim().toLowerCase() ?? '';
  if (!NAME_PATTERN.test(name)) {
    throw new InvalidInputError(
      'name must be 1-64 characters of letters, digits, ".", "_" or "-", starting and ending with a letter or digit',
    );
  }
  return name;
}

export function parseEcosystem(raw: string | undefined): Ecosystem | undefined {
  if (!raw) return undefined;
  if (!ECOSYSTEMS.includes(raw as Ecosystem)) {
    throw new InvalidInputError(`ecosystem must be one of: ${ECOSYSTEMS.join(', ')}`);
  }
  return raw as Ecosystem;
}

export async function checkName(
  rawName: string,
  options: CheckOptions = {},
  deps: CheckDeps = defaultDeps,
): Promise<CheckResult> {
  const name = parseName(rawName);
  const { config, http } = deps;
  const ids = deps.sources.map((source) => source.id);
  if (options.sources && (!options.sources.length || options.sources.some((id) => !ids.includes(id)))) {
    throw new InvalidInputError(`sources must be a comma-separated subset of: ${ids.join(', ')}`);
  }
  const selected = options.sources ? deps.sources.filter((source) => options.sources!.includes(source.id)) : deps.sources;

  const runs = await Promise.all(
    selected.map(async (source) => {
      const started = performance.now();
      const signal = AbortSignal.any(
        [AbortSignal.timeout(options.timeoutMs ?? 10_000), options.signal].filter((s) => s !== undefined),
      );
      try {
        const result = await source.check({ name, http, signal, prominence: config.prominence });
        return { source, result, ms: performance.now() - started };
      } catch (error) {
        return { source, error: error instanceof Error ? error.message : String(error), ms: performance.now() - started };
      }
    }),
  );

  const hits: Hit[] = [];
  const availability: Record<string, boolean> = {};
  const reports: Record<string, SourceReport> = {};
  for (const run of runs) {
    const ms = Math.round(run.ms);
    if (run.result) {
      hits.push(...run.result.hits);
      Object.assign(availability, run.result.availability);
      reports[run.source.id] = { status: 'ok', ms, hits: run.result.hits.length };
    } else {
      reports[run.source.id] = { status: 'error', ms, hits: 0, error: run.error };
    }
  }

  const scored = scoreName(
    {
      name,
      ecosystem: options.ecosystem,
      hits,
      availability,
      sources: runs.map((run) => ({ id: run.source.id, weightKeys: run.source.weightKeys, ok: !!run.result })),
    },
    config,
  );

  return {
    name,
    ecosystem: options.ecosystem ?? null,
    scoringVersion: config.version,
    ...scored,
    availability,
    sources: reports,
  };
}

import type { Http } from '../http.js';
import type { ScoringConfig } from '../scoring/config.js';
import type { SourceResult, WeightKey } from '../types.js';

export interface SourceContext {
  /** Validated, lowercase name. */
  name: string;
  http: Http;
  /** Aborts when the source exceeds its time budget or the client disconnects. */
  signal: AbortSignal;
  prominence: ScoringConfig['prominence'];
}

/**
 * A place where a name can collide. To add one: implement this interface, register it in
 * `sources/index.ts` and give its weight keys a weight in `scoring/config.ts`.
 */
export interface Source {
  id: string;
  /** Weight keys this source emits; used for coverage. */
  weightKeys: WeightKey[];
  check(context: SourceContext): Promise<SourceResult>;
}

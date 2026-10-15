export type MatchType =
  | 'exact'
  | 'normalized'
  | 'affix'
  | 'phonetic'
  | 'edit_distance_1'
  | 'edit_distance_2'
  | 'substring';

/** Each hit is weighted by the kind of thing it collides with. */
export type WeightKey =
  | 'domain_com'
  | 'domain_other'
  | 'github_repo'
  | 'github_owner'
  | 'npm'
  | 'pypi'
  | 'crates'
  | 'rubygems'
  | 'packagist'
  | 'nuget'
  | 'maven'
  | 'homebrew'
  | 'dockerhub_official'
  | 'dockerhub_user'
  | 'wikidata_tech'
  | 'wikidata_other'
  | 'hackernews';

export type Ecosystem = 'js' | 'python' | 'rust' | 'ruby' | 'php' | 'dotnet' | 'java' | 'homebrew' | 'docker';

export const ECOSYSTEMS: Ecosystem[] = ['js', 'python', 'rust', 'ruby', 'php', 'dotnet', 'java', 'homebrew', 'docker'];

/** One existing thing whose name collides with (or resembles) the queried name. */
export interface Hit {
  source: string;
  weightKey: WeightKey;
  name: string;
  url: string;
  match: MatchType;
  /** 0..1: how well known the match is. */
  prominence: number;
  /** ISO date of the last release/push; null or missing when unknown. */
  lastActivity?: string | null;
  /** Fixed activity factor that bypasses the decay formula (domains, Wikidata). */
  activity?: number;
  /** Homepage and repository URLs, used to merge hits that belong to the same project. */
  links?: string[];
  description?: string;
  metrics?: Record<string, number | string | boolean | null>;
}

export interface SourceResult {
  hits: Hit[];
  /** Platform key -> true when the name can still be registered there. */
  availability?: Record<string, boolean>;
}

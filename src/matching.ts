import { doubleMetaphone } from 'double-metaphone';
import type { MatchType } from './types.js';

/** Strongest first; the order defines which match type wins when several apply. */
export const MATCH_ORDER: MatchType[] = [
  'exact',
  'normalized',
  'affix',
  'phonetic',
  'edit_distance_1',
  'edit_distance_2',
  'substring',
];

const SEPARATORS = /[-_.\s]+/;

/** Common ecosystem/product decorations: `quillo-js`, `pyquillo` and `quillo-cli` are all "quillo". */
export const AFFIXES = new Set([
  'js', 'ts', 'node', 'deno', 'py', 'python', 'rs', 'rust', 'go', 'golang', 'rb', 'ruby', 'php', 'net',
  'dotnet', 'java', 'kt', 'swift', 'cli', 'cmd', 'core', 'lib', 'libs', 'sdk', 'api', 'app', 'apps', 'ui',
  'kit', 'hq', 'io', 'dev', 'labs', 'cloud', 'server', 'client', 'plugin', 'react', 'vue', 'svelte',
  'angular', 'next', 'web', 'official', 'docker', 'the', 'get', 'use', 'my', 'v2', 'tool', 'tools',
]);

/** Lowercase and drop separators: `Quill-O`, `quill_o` and `quill.o` all become `quillo`. */
export function normalize(name: string): string {
  return name.toLowerCase().split(SEPARATORS).join('');
}

function pluralEquals(a: string, b: string): boolean {
  return a === b || a + 's' === b || b + 's' === a || a + 'es' === b || b + 'es' === a;
}

function isAffixVariant(normalizedQuery: string, candidate: string): boolean {
  const tokens = candidate.toLowerCase().split(SEPARATORS).filter(Boolean);
  // Separated form: "quillo-js", "py-quillo", "react-quillo-ui".
  for (let start = 0; start < tokens.length; start++) {
    for (let end = start + 1; end <= tokens.length; end++) {
      if (tokens.slice(start, end).join('') !== normalizedQuery) continue;
      const rest = [...tokens.slice(0, start), ...tokens.slice(end)];
      if (rest.length > 0 && rest.every((token) => AFFIXES.has(token))) return true;
    }
  }
  // Attached form: "quillojs", "pyquillo".
  const joined = tokens.join('');
  if (joined.startsWith(normalizedQuery) && AFFIXES.has(joined.slice(normalizedQuery.length))) return true;
  if (joined.endsWith(normalizedQuery) && AFFIXES.has(joined.slice(0, joined.length - normalizedQuery.length))) {
    return true;
  }
  return false;
}

/** Damerau-Levenshtein distance (optimal string alignment variant). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

function soundsAlike(a: string, b: string, distance: number): boolean {
  // Metaphone codes are short, so unrelated words collide; require the spellings to be close too.
  if (Math.abs(a.length - b.length) > 2 || distance > Math.ceil(a.length / 2)) return false;
  const [primaryA, secondaryA] = doubleMetaphone(a);
  const [primaryB, secondaryB] = doubleMetaphone(b);
  return primaryA === primaryB || primaryA === secondaryB || secondaryA === primaryB;
}

/** How `candidate` relates to the queried name, or null when it is unrelated. */
export function classifyMatch(query: string, candidate: string): MatchType | null {
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  if (c === q) return 'exact';

  const nq = normalize(q);
  const nc = normalize(c);
  if (!nc) return null;
  if (pluralEquals(nq, nc)) return 'normalized';
  if (isAffixVariant(nq, c)) return 'affix';
  // Short names have too many fuzzy neighbours to say anything useful.
  if (nq.length < 4) return null;

  const distance = editDistance(nq, nc);
  if (soundsAlike(nq, nc, distance)) return 'phonetic';
  const maxDistance = Math.floor(nq.length / 4);
  if (distance === 1 && maxDistance >= 1) return 'edit_distance_1';
  if (distance === 2 && maxDistance >= 2) return 'edit_distance_2';
  if (nc.includes(nq)) return 'substring';
  return null;
}

/** Strongest match among several names for the same thing (e.g. a package name and its scope). */
export function bestMatch(query: string, candidates: string[]): MatchType | null {
  let best: MatchType | null = null;
  for (const candidate of candidates) {
    const match = classifyMatch(query, candidate);
    if (match && (!best || MATCH_ORDER.indexOf(match) < MATCH_ORDER.indexOf(best))) best = match;
  }
  return best;
}

/** True when a registry would treat the two names as the same (case and separators ignored). */
export function blocksName(query: string, candidate: string): boolean {
  return normalize(query) === normalize(candidate);
}

/** Names worth probing directly on registries that have no search API. */
export function probeVariants(name: string, { prefixes = [] as string[], suffixes = [] as string[] } = {}): string[] {
  const base = name.toLowerCase();
  const flat = normalize(base);
  const variants = new Set([base, flat, base.replace(/[_.]/g, '-'), `${flat}s`]);
  if (flat.endsWith('s')) variants.add(flat.slice(0, -1));
  for (const prefix of prefixes) variants.add(prefix + flat).add(`${prefix}-${base}`);
  for (const suffix of suffixes) variants.add(flat + suffix).add(`${base}-${suffix}`);
  return [...variants];
}

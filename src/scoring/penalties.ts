import { createRequire } from 'node:module';
import { normalize } from '../matching.js';
import type { ScoringConfig } from './config.js';

export interface Penalty {
  reason: 'short_name' | 'common_word' | 'hard_to_spell';
  points: number;
  detail: string;
}

let commonWords: Set<string> | undefined;

/** ~10k most common English words (SCOWL size 10 + 20, via the MIT-licensed `wordlist-english`). */
function getCommonWords(): Set<string> {
  if (!commonWords) {
    const lists = createRequire(import.meta.url)('wordlist-english') as Record<string, string[]>;
    commonWords = new Set([...lists['english/10'], ...lists['english/20']].map((word) => word.toLowerCase()));
  }
  return commonWords;
}

/** Penalties that depend only on the name itself, not on what exists elsewhere. */
export function namePenalties(name: string, config: ScoringConfig): Penalty[] {
  const { penalties } = config;
  const flat = normalize(name);
  const result: Penalty[] = [];

  if (flat.length <= penalties.shortNameMaxLength) {
    result.push({
      reason: 'short_name',
      points: penalties.shortName,
      detail: `${flat.length} characters or fewer: almost certainly taken somewhere`,
    });
  }
  const words = getCommonWords();
  if (words.has(name.toLowerCase()) || words.has(flat)) {
    result.push({
      reason: 'common_word',
      points: penalties.commonWord,
      detail: 'Common English word: hard to find in search results',
    });
  }
  if (/[a-z]/.test(flat) && /\d/.test(flat)) {
    result.push({
      reason: 'hard_to_spell',
      points: penalties.hardToSpell,
      detail: 'Mixes letters and digits: easy to mistype when heard aloud',
    });
  }
  return result;
}

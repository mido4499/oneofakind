import { describe, expect, it } from 'vitest';
import { blocksName, classifyMatch, editDistance, probeVariants } from '../src/matching.js';

describe('classifyMatch', () => {
  it.each([
    ['quillo', 'quillo', 'exact'],
    ['quillo', 'Quillo', 'exact'],
    ['quillo', 'quill-o', 'normalized'],
    ['quillo', 'quillos', 'normalized'],
    ['quillo', 'quillo-js', 'affix'],
    ['quillo', 'py-quillo', 'affix'],
    ['quillo', 'pyquillo', 'affix'],
    ['quillo', 'react-quillo-ui', 'affix'],
    ['quillo', 'Quillo.Core', 'affix'],
    ['quillo', 'quill', 'phonetic'],
    ['quickly', 'kwikly', 'phonetic'],
    ['quillo', 'quilla', 'phonetic'],
    ['quillo', 'quilmo', 'edit_distance_1'],
    ['oneofakind', 'oneofakimb', 'edit_distance_2'],
    ['quillo', 'quillometer', 'substring'],
  ] as const)('%s vs %s -> %s', (query, candidate, expected) => {
    expect(classifyMatch(query, candidate)).toBe(expected);
  });

  it('ignores unrelated names', () => {
    expect(classifyMatch('quillo', 'react')).toBeNull();
    expect(classifyMatch('quillo', 'quixotic')).toBeNull();
  });

  it('only allows exact/normalized/affix matches for names shorter than 4', () => {
    expect(classifyMatch('bun', 'bun-js')).toBe('affix');
    expect(classifyMatch('bun', 'bum')).toBeNull();
    expect(classifyMatch('bun', 'bunny')).toBeNull();
  });

  it('scales the allowed edit distance with length', () => {
    // 5 letters -> distance 1 allowed, 2 not.
    expect(classifyMatch('orbit', 'orxix')).toBeNull();
  });
});

describe('editDistance', () => {
  it('counts transpositions as one edit', () => {
    expect(editDistance('quillo', 'qiullo')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('blocksName', () => {
  it('treats case and separators as equal, plurals as different', () => {
    expect(blocksName('quillo', 'Quil-lo')).toBe(true);
    expect(blocksName('quillo', 'quillos')).toBe(false);
  });
});

describe('probeVariants', () => {
  it('includes separator, plural and affix forms', () => {
    const variants = probeVariants('my_tool', { prefixes: ['py'], suffixes: ['cli'] });
    expect(variants).toEqual(
      expect.arrayContaining(['my_tool', 'mytool', 'my-tool', 'mytools', 'pymytool', 'py-my_tool', 'mytoolcli']),
    );
  });
});

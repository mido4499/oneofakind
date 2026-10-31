import { describe, expect, it } from 'vitest';
import { safeUrl, validateName } from '../site/validate.js';

describe('validateName', () => {
  it.each(['quillo', 'abc123', 'a', '7', 'x'.repeat(64)])('accepts %j', (raw) => {
    expect(validateName(raw)).toEqual({ name: raw, error: null });
  });

  it('lowercases capital letters instead of rejecting them', () => {
    expect(validateName('QuilLo')).toEqual({ name: 'quillo', error: null });
  });

  it.each([
    ['my-tool', '"-" isn\'t allowed'],
    ['my_tool', '"_" isn\'t allowed'],
    ['my.tool', '"." isn\'t allowed'],
    ['my tool', "Spaces aren't allowed"],
    ['café', '"é" isn\'t allowed'],
    ['rocket🚀', '"🚀" isn\'t allowed'],
    ['', 'Enter a name'],
    ['x'.repeat(65), 'Names can be at most 64 characters'],
  ])('rejects %j with %j', (raw, error) => {
    expect(validateName(raw).error).toBe(error);
  });

  it('reports the first character that is not allowed', () => {
    expect(validateName('a_b-c').error).toBe('"_" isn\'t allowed');
  });
});

describe('safeUrl', () => {
  it.each(['https://quillo.com', 'http://example.org/path?q=1'])('accepts %j', (url) => {
    expect(safeUrl(url)).toBe(new URL(url).href);
  });

  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', '/relative/path', 'not a url', '', null, undefined])(
    'rejects %j',
    (url) => {
      expect(safeUrl(url)).toBeNull();
    },
  );
});

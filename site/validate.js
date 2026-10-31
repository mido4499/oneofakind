// Pure helpers with no DOM access, so they can be unit-tested (test/validate.test.ts).

export const MAX_LENGTH = 64;

/**
 * The page accepts only lowercase letters and digits. Capitals are lowercased (the API ignores
 * case anyway); anything else is reported, never silently removed.
 * @param {string} raw
 * @returns {{ name: string, error: string | null }}
 */
export function validateName(raw) {
  const name = raw.toLowerCase();
  if (!name) return { name, error: 'Enter a name' };
  // for...of walks code points, so an emoji is reported whole.
  for (const char of name) {
    if (/[a-z0-9]/.test(char)) continue;
    return { name, error: /\s/.test(char) ? "Spaces aren't allowed" : `"${char}" isn't allowed` };
  }
  if (name.length > MAX_LENGTH) return { name, error: `Names can be at most ${MAX_LENGTH} characters` };
  return { name, error: null };
}

/**
 * Returns the URL if it is an absolute http(s) URL, else null. Registry data is untrusted, so
 * anything else (javascript:, data:, relative paths) must never become a link.
 * @param {unknown} url
 * @returns {string | null}
 */
export function safeUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

const CODE_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org']);

/** Hosts whose bare homepage says nothing about a project; only a full path identifies one. */
const SHARED_HOSTS = new Set([
  'npmjs.com', 'pypi.org', 'crates.io', 'docs.rs', 'rubygems.org', 'packagist.org', 'nuget.org',
  'hub.docker.com', 'formulae.brew.sh', 'news.ycombinator.com', 'wikidata.org', 'medium.com',
  'sites.google.com', 'docs.google.com', 'gitbook.io', 'notion.site', 'twitter.com', 'x.com',
]);

/**
 * Reduces a homepage/repository URL to a key that is equal for links pointing to the same project:
 * `git+https://github.com/Slab/quill.git` and `https://github.com/slab/quill/issues` -> `github.com/slab/quill`,
 * `https://www.quilljs.com/docs` -> `quilljs.com`.
 */
export function linkKey(raw: string): string | null {
  let value = raw.trim().replace(/^git\+/, '').replace(/^git@([^:]+):/, 'https://$1/');
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean).map((part) => part.toLowerCase());

  if (CODE_HOSTS.has(host)) {
    return parts.length >= 2 ? `${host}/${parts[0]}/${parts[1].replace(/\.git$/, '')}` : null;
  }
  if (SHARED_HOSTS.has(host)) return parts.length ? `${host}/${parts.join('/')}` : null;
  if (host.endsWith('.github.io') && parts.length) return `${host}/${parts[0]}`;
  return host || null;
}

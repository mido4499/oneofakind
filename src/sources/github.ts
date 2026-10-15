import { classifyMatch } from '../matching.js';
import type { Hit } from '../types.js';
import { compact, logScale } from '../util.js';
import type { Source } from './types.js';

const API = 'https://api.github.com';

interface Account {
  login: string;
  type: 'User' | 'Organization';
  followers: number;
  public_repos: number;
  html_url: string;
  blog?: string | null;
}

interface SearchResponse {
  items: {
    name: string;
    full_name: string;
    description: string | null;
    html_url: string;
    homepage: string | null;
    stargazers_count: number;
    pushed_at: string;
    archived: boolean;
  }[];
}

function headers(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

export const github: Source = {
  id: 'github',
  weightKeys: ['github_repo', 'github_owner'],
  async check({ name, http, signal, prominence }) {
    // Unauthenticated search allows 10 requests/minute; set GITHUB_TOKEN for 30.
    const query = encodeURIComponent(`${name} in:name`);
    const [account, search] = await Promise.all([
      http.getJson<Account>(`${API}/users/${name}`, { signal, headers: headers() }),
      http.getJson<SearchResponse>(`${API}/search/repositories?q=${query}&sort=stars&order=desc&per_page=50`, {
        signal,
        headers: headers(),
      }),
    ]);

    const hits: Hit[] = [];
    if (account) {
      hits.push({
        source: 'github',
        weightKey: 'github_owner',
        name: account.login,
        url: account.html_url,
        // Logins are case-insensitive, so any account at this URL holds the exact name.
        match: 'exact',
        prominence: logScale(account.followers, prominence.githubFollowers),
        links: compact([account.blog]),
        description: `GitHub ${account.type === 'Organization' ? 'organization' : 'user'}`,
        metrics: { type: account.type, followers: account.followers, publicRepos: account.public_repos },
      });
    }
    for (const repo of search?.items ?? []) {
      const match = classifyMatch(name, repo.name);
      if (!match) continue;
      hits.push({
        source: 'github',
        weightKey: 'github_repo',
        name: repo.full_name,
        url: repo.html_url,
        match,
        prominence: logScale(repo.stargazers_count, prominence.githubStars),
        lastActivity: repo.pushed_at,
        links: compact([repo.html_url, repo.homepage]),
        description: repo.description ?? undefined,
        metrics: { stars: repo.stargazers_count, archived: repo.archived },
      });
    }

    return { hits, availability: { github: !account } };
  },
};

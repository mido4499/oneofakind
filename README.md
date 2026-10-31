# oneofakind

An API that tells you whether a project name is unique. It checks domains, package registries, GitHub, Docker Hub, Wikidata and Hacker News for the name and for names that look or sound like it. It returns a **0–100 uniqueness score** with a breakdown of what each collision costs.

```console
$ npm run check -- quillo --ecosystem js

quillo: 28/100 (high_risk), coverage 100%

Top risks:
  0.420  quillo.com [exact] domains  https://quillo.com
  0.128  quillo.dev [exact] domains  https://quillo.dev
  0.090  Quillow [phonetic] wikidata  https://www.wikidata.org/wiki/...
  ...

Available: npm, pypi, crates, rubygems, nuget, homebrew
Taken:     domain_com, domain_io, domain_app, domain_ai, domain_dev, github, packagist, dockerhub
```

> **Not legal advice.** This tool does not check trademarks yet. Before committing to a name, search the trademark databases for your market or ask a trademark attorney.

## Quick start

Requires Node.js 22.9+ (`nvm use` picks it up from `.nvmrc`).

```sh
npm install
npm run dev                      # API on http://localhost:3000
npm run check -- <name>          # one-off check from the terminal (add --json for the full result)
npm test
```

Set these in your shell or in a `.env` file at the repo root. The `dev`, `start` and `check` scripts load `.env` automatically, and it is gitignored.

| Environment variable | Purpose |
|---|---|
| `PORT` | HTTP port (default `3000`) |
| `GITHUB_TOKEN` | Raises GitHub limits from 10 searches/minute and 60 requests/hour to 30/minute and 5,000/hour. Each check uses one of each. A fine-grained token with only public read-only access is enough. |
| `ONEOFAKIND_USER_AGENT` | User-Agent sent upstream. Wikidata and crates.io ask for one that includes contact details. |
| `HOST` | Bind address, e.g. `127.0.0.1` to accept connections only from a reverse proxy on the same machine |
| `CORS_ORIGINS` | Comma-separated origins allowed to call `/v1/*` from a browser, e.g. `https://mido4499.github.io`. Unset: no CORS headers. |
| `RATE_LIMIT_PER_MINUTE` | Checks per minute per client IP on `/v1/check`. Over the limit it returns `429` with `{ "error", "retryAfter" }`. Unset: no limit. |
| `TRUST_PROXY` | `1` to identify clients by the last `X-Forwarded-For` entry. Set it only behind a reverse proxy, or clients can fake their IP. |

The server refuses to start when one of these has an invalid value.

## API

### `GET /v1/check?name=<name>` (or `/v1/check/<name>`)

| Query parameter | Description |
|---|---|
| `name` | 1–64 characters: letters, digits, `.`, `_`, `-` |
| `ecosystem` | Optional: `js`, `python`, `rust`, `ruby`, `php`, `dotnet`, `homebrew` or `docker`. Gives that ecosystem's registry full weight, and caps the score if the name is taken there. |
| `sources` | Optional comma-separated subset, e.g. `npm,github,domains` |
| `limit` | Maximum number of `hits` returned (default 50) |

```jsonc
{
  "name": "quillo",
  "ecosystem": "js",
  "scoringVersion": "0.3.0",
  "score": 28,
  "label": "high_risk",            // highly_unique ≥ 85 > mostly_clear ≥ 65 > crowded ≥ 40 > high_risk
  "distinctiveness": 27.7,         // score before name penalties and blocker caps
  "coverage": 1,                   // share of source weight that answered (failed sources are excluded, not counted as clear)
  "penalties": [],                 // e.g. { "reason": "common_word", "points": 10 }
  "blockers": [],                  // set when the name is taken on the ecosystem's registry
  "availability": { "npm": true, "domain_com": false, "github": false },
  "clusters": [                    // hits merged per project, strongest first
    { "label": "quillo.com", "risk": 0.42, "match": "exact", "sources": ["domains"], "hits": 1, "url": "https://quillo.com" }
  ],
  "hits": [                        // every collision with the factors behind its risk
    { "source": "domains", "name": "quillo.com", "match": "exact",
      "factors": { "W": 0.6, "M": 1, "P": 0.7, "A": 1, "D": 1 }, "risk": 0.42 }
  ],
  "sources": { "npm": { "status": "ok", "ms": 366, "hits": 0 } }
}
```

Also available: `GET /v1/sources` (sources, weights and ecosystems) and `GET /health`.

## Web page

[`site/`](site) is a static page for GitHub Pages: visitors type a name and see the score, warnings, availability and closest matches. It has no build step and calls the API set in [`site/config.js`](site/config.js). The page accepts only lowercase letters and digits; the API and CLI also accept `.`, `_` and `-`.

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) publishes `site/` on every push to `main` that changes it. To enable it, set the repository's Settings → Pages → Source to "GitHub Actions".

## Deploying the API

The page needs the API running somewhere reachable over HTTPS. On a server with Node.js 22.9+, [pm2](https://pm2.keymetrics.io) and a reverse proxy that handles HTTPS:

```sh
git clone https://github.com/mido4499/oneofakind.git && cd oneofakind
npm ci && npm run build
cp .env.example .env             # then edit it: GITHUB_TOKEN, CORS_ORIGINS, ...
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup          # restart on reboot; run the command pm2 startup prints
```

Point a subdomain at the server and have the proxy forward it to `127.0.0.1:3000` with the client's address in `X-Forwarded-For`. Caddy and Traefik send that header by default. For nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Then put the subdomain's URL in [`site/config.js`](site/config.js).

To update: `git pull && npm ci && npm run build && pm2 restart oneofakind`.

## Sources

| Source | What is checked | Availability key |
|---|---|---|
| `domains` | RDAP registration of `.com .dev .io .app .ai`; DNS, parking nameservers and Tranco rank for prominence | `domain_<tld>` |
| `github` | Repository search by name, plus the user/org account with the exact name | `github` (account) |
| `npm` | Registry search plus exact-name probes; weekly downloads | `npm` |
| `pypi` | Probes of the name and common variants (PyPI has no search API); downloads from pypistats | `pypi` |
| `crates` | crates.io search; recent downloads | `crates` |
| `rubygems` | Search plus exact lookup; total downloads | `rubygems` |
| `packagist` | Search; total downloads | `packagist` (vendor namespace) |
| `nuget` | Search; total downloads | `nuget` |
| `homebrew` | Probes of formulae and casks; 365-day installs | `homebrew` |
| `dockerhub` | Repository search; pulls. Namespace lookup. | `dockerhub` (namespace) |
| `wikidata` | Entity search; sitelinks, and whether the entity is software, a company or a product | — |
| `hackernews` | Story titles (Algolia API); points | — |

Each source runs in parallel with a 10-second budget. If a source fails, the check still returns: the source is marked `error` and `coverage` drops.

## How the score works

All constants live in [src/scoring/config.ts](src/scoring/config.ts). `scoringVersion` changes whenever they do.

**1. Each hit gets a risk** between 0 and 1:

```
risk = W × M × P × A × D
```

- **W, source weight:** how much a collision of this kind matters. Examples: `.com` 0.6, other TLDs 0.2, GitHub repo 0.6, npm/PyPI 0.5, official Docker image 0.7, Wikidata software/company 0.7. The `ecosystem` registry is raised to 1.0.
- **M, match type:** exact 1.0, normalized (case, separators, plural) 0.9, affix (`quillo-js`, `pyquillo`) 0.6, phonetic (Double Metaphone) 0.5, edit distance 1: 0.45, edit distance 2: 0.2, substring 0.15. Edit distance is only allowed up to `floor(length / 4)`. Names shorter than 4 characters only match exactly, normalized or by affix.
- **P, prominence:** log-scaled popularity, e.g. `log10(stars + 1) / 5` (100k stars = 1.0) or `log10(weeklyDownloads + 1) / 7`. Clamped to 0.05–1.
- **A, activity:** `0.5 + 0.5 × exp(−monthsSinceLastRelease / 24)`. A dead project counts half as much as an active one. Unknown dates count 0.75. Domains and Wikidata always count 1.
- **D, tail decay:** within one weight key, the n-th strongest hit counts `0.5^n`. Fifty tiny `quillo-*` repos then weigh about as much as two. The key's combined risk is also capped at its W.

**2. Hits of the same project are merged.** Hits that share a homepage or repository URL (e.g. the npm package and Wikidata entity of the same editor) form a cluster:
`clusterRisk = max(risk) × (1 + 0.1 × (sources − 1))`.

**3. Clusters are combined like independent probabilities**, so one strong collision dominates and many weak ones add up without going past 100:

```
distinctiveness = 100 × Π (1 − clusterRisk)
```

**4. Name penalties:** ≤ 3 characters −10, common English word −10, letters mixed with digits −5.

**5. Blocker cap:** if the name is taken on the `ecosystem` registry, the score is capped at 35.

## Adding a source

1. Create `src/sources/<id>.ts` implementing `Source` from [src/sources/types.ts](src/sources/types.ts). Use `classifyMatch()` to decide whether a candidate is a hit, and `logScale()` for prominence.
2. Add a weight key to `WeightKey` in [src/types.ts](src/types.ts) and give it a weight in [src/scoring/config.ts](src/scoring/config.ts).
3. Register the source in [src/sources/index.ts](src/sources/index.ts).
4. Add a test with canned responses (see [test/sources.test.ts](test/sources.test.ts)).

## Known limitations

- No trademark data yet (USPTO/EUIPO/WIPO are planned).
- Search-based sources find names that *contain* the query. Shorter look-alikes (e.g. `quill` for `quillo`) only surface where the source probes variants (PyPI, Homebrew, npm exact) or its search is fuzzy.
- Go modules are not checked directly: Go has no central name registry and modules are named by repository path, so GitHub covers them.
- Maven Central is not checked: its search API (`search.maven.org`) often takes 30 seconds or more to answer, and its index lags real releases by many months. Most Java libraries are on GitHub, and Maven coordinates are namespaced by groupId, so an existing artifactId never blocks a name.
- Responses are cached in memory for 10 minutes. Upstream rate limits (GitHub search, pypistats, Tranco) apply per server instance.

## License

[MIT](LICENSE)

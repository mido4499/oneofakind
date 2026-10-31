# GitHub Pages name checker — design

Date: 2026-10-31
Status: approved in conversation, pending written-spec review

## Goal

A public web page on GitHub Pages where anyone can type a project name they are considering and see its oneofakind score on that page, without installing anything.

**Stated by the owner:** the page is hosted on GitHub Pages; the visitor enters a name and gets the score directly on the page; the API is hosted on the owner's VPS (domain and HTTPS reverse proxy already in place, services run with pm2); the page accepts only lowercase letters and digits and tells the visitor so.

**Assumed (confirmed during design):** no sign-up; the page shows the same score, breakdown and availability as the CLI; the existing API and CLI keep working unchanged for self-hosters.

**Success criteria**

- A visitor at `https://mido4499.github.io/oneofakind/` can check a valid name and see score, label, warnings, availability and top risks.
- Invalid names are rejected on the page with a clear message, before any request is sent.
- A single visitor cannot exhaust the API: per-IP rate limiting is enforced on the real client IP behind the proxy.
- With none of the new environment variables set, the API behaves exactly as it does today.

## Architecture

```
Browser ── loads page ──▶ GitHub Pages: site/ (static HTML/CSS/JS, no build step)
   │
   └── GET https://<api-subdomain>/v1/check?name=…&ecosystem=…&limit=0
          ▼
       VPS: existing HTTPS reverse proxy ──▶ 127.0.0.1:3000 oneofakind API (pm2)
                                               └─ queries the 12 sources, returns JSON
```

Considered and rejected:

- **Checks in the browser, no server.** crates.io, Docker Hub, RubyGems (unreadable 404s) and pypistats do not allow cross-origin browser requests (verified from response headers on 2026-10-31), so 3 of 12 sources would be lost.
- **Vite/React app.** Adds a build step and a second dependency tree for a single screen.
- **Serving the page from the VPS.** Simplest, but the owner wants the page on GitHub Pages.

## 1. API changes

All new behaviour is opt-in through environment variables. Unset means current behaviour.

| Variable | Effect |
|---|---|
| `CORS_ORIGINS` | Comma-separated allowed origins, e.g. `https://mido4499.github.io`. Enables Hono's `cors()` middleware on `/v1/*` for `GET` from those origins only. Unset: no CORS headers. |
| `RATE_LIMIT_PER_MINUTE` | Positive integer, e.g. `10`. Limits `/v1/check` per client IP with a fixed 60-second window. `/health` and `/v1/sources` are not limited. Unset: no limit. |
| `TRUST_PROXY` | `1` to take the client IP from the **last** entry of `X-Forwarded-For` (the address the proxy saw; earlier entries are client-controlled). If the header is missing, or the flag is unset, the socket address is used. |
| `HOST` | Bind address passed to `serve()`, e.g. `127.0.0.1` so the API is reachable only through the proxy. Unset: current default. |

**Structure.** `src/app.ts` exports `createApp(options)` with `{ corsOrigins?: string[], rateLimitPerMinute?: number, trustProxy?: boolean, deps?: CheckDeps }`, and `optionsFromEnv(env)`, which turns environment variables into those options. Invalid values (e.g. `RATE_LIMIT_PER_MINUTE=abc`) make `optionsFromEnv` throw, so the server stops at startup with a clear message rather than silently disabling the limit. `src/server.ts` calls `createApp(optionsFromEnv(process.env))` and passes `HOST`/`PORT` to `serve()`.

**Order.** The CORS middleware runs before the rate limiter and the routes, and error responses (`400`, `429`, `500`) carry the CORS header too. Otherwise the browser hides the error body from the page and it can only show a generic failure.

**Rate limiter.** In-memory `Map<ip, { count, resetAt }>`, written inline (no dependency). Entries whose window has passed are swept at most once per minute, so memory stays bounded by the number of IPs active in the last minute. Over the limit the response is:

```json
HTTP 429
{ "error": "Too many checks. Try again in 42 seconds.", "retryAfter": 42 }
```

`retryAfter` is in the body because a cross-origin page cannot read `Retry-After` without extra CORS configuration.

**Client IP when there is no socket** (e.g. in tests via `app.request()`): the literal `"unknown"`, so all such requests share one bucket.

**Known limits, accepted:** all visitors share one `GITHUB_TOKEN` (30 searches/minute), so the site handles roughly 30 new checks per minute; repeat checks are served from the existing 10-minute cache. When GitHub's quota runs out, that source fails like any other and coverage drops. There is no global concurrency cap, API key or persistent store.

## 2. The page

**Files** in `site/`:

- `index.html`: markup and the static note text.
- `style.css`: light and dark themes (`prefers-color-scheme`), layout that works at phone width.
- `config.js`: `export const API_URL = '…';` the only file to edit when the API address changes.
- `validate.js`: pure functions `validateName(raw)` and `safeUrl(url)`, no DOM access, unit-tested.
- `app.js`: fetches, URL state and rendering.

**Input**

- Name field, and an ecosystem dropdown: "Any" plus the ecosystems returned by `GET /v1/sources`, with friendly labels (`js` → "JavaScript (npm)", `python` → "Python (PyPI)", `rust` → "Rust (crates.io)", `ruby` → "Ruby (RubyGems)", `php` → "PHP (Packagist)", `dotnet` → ".NET (NuGet)", `homebrew` → "Homebrew", `docker` → "Docker"). An unknown id falls back to the id itself. If `/v1/sources` fails, the dropdown shows only "Any" and checks still work.
- The address bar mirrors the query (`?name=quillo&ecosystem=js`) via `history.replaceState`; opening such a URL runs the check automatically if the name is valid.

**Name validation (page only)**

- Rule: `^[a-z0-9]{1,64}$`. Input is lowercased as the visitor types (lowercasing never changes the score: the API lowercases too). Every other character is rejected, never silently removed.
- Permanent note under the field: *"Use lowercase letters (a–z) and numbers (0–9) only. No spaces, hyphens or other special characters."*
- Inline error, announced to screen readers, and the button disabled while invalid:
  - first offending character: `"-" isn't allowed` (space: `Spaces aren't allowed`)
  - empty: `Enter a name`
  - over 64 characters: `Names can be at most 64 characters`
- A shared URL with an invalid name shows the same error and does not run.
- The API and CLI keep accepting `.`, `_` and `-`. Consequence, accepted: on the page, a hyphenated name must be checked without separators; registry availability is unaffected (registries normalize separators), but domain and account lookups use the unseparated form.

**While checking:** button disabled, status text "Checking 12 sources…" (the count comes from `/v1/sources` when available).

**Result**, top to bottom (requested with `limit=0`, since the page uses `clusters`, not `hits`):

1. Score `/100` in large type, label in words ("Highly unique", "Mostly clear", "Crowded", "High risk") and a band color.
2. Blockers, penalties, and a coverage note listing each source with `status: "error"` and its error text. Shown only when present.
3. Availability: a free/taken chip per key, with readable names (`domain_com` → ".com", `github` → "GitHub account", `packagist` → "Packagist vendor", `dockerhub` → "Docker Hub namespace", registries by name).
4. Top risks: up to 8 clusters with link, match type in words, sources, and a risk bar.
5. Footer: the "not legal advice" note, links to the repository and to the README's "How the score works".

**Errors**

| Case | Shown |
|---|---|
| `400` | The API's `error` message under the field |
| `429` | "Too many checks. Try again in N seconds." using `retryAfter` |
| Network failure or `5xx` | "Couldn't reach the oneofakind API. Try again later." |

**Safety:** every value from the API is inserted with `textContent` or as an attribute value, never as HTML. Links are rendered only when `safeUrl()` accepts them (`http:` or `https:` only); otherwise the text is shown unlinked. Results are announced through an `aria-live` region; everything works by keyboard.

## 3. Deployment

**Page.** New `.github/workflows/pages.yml`: on pushes to `main` that touch `site/**`, and on manual dispatch, it publishes `site/` with `actions/configure-pages`, `actions/upload-pages-artifact` and `actions/deploy-pages`. One-time setting: repository Settings → Pages → Source: GitHub Actions.

**API on the VPS**

- `ecosystem.config.cjs` at the repo root: pm2 app `oneofakind`, script `dist/server.js`, node args `--env-file-if-exists=.env`.
- `.env.example` documenting `GITHUB_TOKEN`, `CORS_ORIGINS`, `RATE_LIMIT_PER_MINUTE`, `TRUST_PROXY`, `HOST`, `PORT`, `ONEOFAKIND_USER_AGENT`.
- Install: `git clone …`, `npm ci`, `npm run build`, `cp .env.example .env` and fill in, `pm2 start ecosystem.config.cjs`, `pm2 save`, `pm2 startup`.
- Update: `git pull && npm ci && npm run build && pm2 restart oneofakind`.
- Requires Node 22.9+ on the PATH pm2 uses.
- Reverse proxy: forward the API subdomain to `127.0.0.1:3000` and pass `X-Forwarded-For` (Caddy and Traefik do by default; nginx needs `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`).

**README:** new "Deploying" section with the steps above; the environment variable table gains the four new variables.

**Out of scope:** automated deployment to the VPS (would require an SSH key in GitHub secrets).

## 4. Testing

**API** (Vitest, `createApp()` with fake sources, requests through `app.request()`, no network):

- CORS: allowed origin gets `Access-Control-Allow-Origin` on `200`, `400` and `429` responses; other origins and an unset `corsOrigins` get none.
- Rate limit: with limit N, request N+1 from one IP gets `429` with `retryAfter` between 1 and 60; another IP is unaffected; after the window (fake timers) the IP is allowed again; `/health` is never limited.
- Client IP: with `trustProxy`, two requests whose last `X-Forwarded-For` entries differ use separate buckets; without it, different spoofed `X-Forwarded-For` values share one bucket.
- `optionsFromEnv`: an empty environment gives no CORS, no limit and no proxy trust; valid values parse; `RATE_LIMIT_PER_MINUTE` of `abc`, `0` or `-5` throws.

**Page** (Vitest importing `site/validate.js`):

- Accepted: `quillo`, `abc123`, `a`, 64 characters; `Quillo` is lowercased and accepted.
- Rejected with the specified message: `my-tool`, `my tool`, `my_tool`, `café`, an emoji, empty, 65 characters.
- `safeUrl`: accepts `https://…` and `http://…`; rejects `javascript:alert(1)`, `data:…` and relative or malformed values.

**Manual check during implementation** (not in CI, since it calls live registries): local API with `CORS_ORIGINS` set to a local static server, page opened in Playwright. Cases: a taken name, a free name, an invalid name, a rate-limited check, API stopped; light and dark mode; phone width. Screenshots shared with the owner.

The existing CI workflow runs the new tests.

## Open value

- The API subdomain for `site/config.js`. A placeholder is used until the owner provides it.

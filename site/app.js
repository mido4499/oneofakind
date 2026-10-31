import { API_URL } from './config.js';
import { safeUrl, validateName } from './validate.js';

const ECOSYSTEMS = {
  js: 'JavaScript (npm)',
  python: 'Python (PyPI)',
  rust: 'Rust (crates.io)',
  ruby: 'Ruby (RubyGems)',
  php: 'PHP (Packagist)',
  dotnet: '.NET (NuGet)',
  homebrew: 'Homebrew',
  docker: 'Docker',
};

const SOURCES = {
  domains: 'Domains',
  github: 'GitHub',
  npm: 'npm',
  pypi: 'PyPI',
  crates: 'crates.io',
  rubygems: 'RubyGems',
  packagist: 'Packagist',
  nuget: 'NuGet',
  homebrew: 'Homebrew',
  dockerhub: 'Docker Hub',
  wikidata: 'Wikidata',
  hackernews: 'Hacker News',
};

/** Availability keys in display order. */
const AVAILABILITY = {
  domain_com: '.com',
  domain_dev: '.dev',
  domain_io: '.io',
  domain_app: '.app',
  domain_ai: '.ai',
  github: 'GitHub account',
  npm: 'npm',
  pypi: 'PyPI',
  crates: 'crates.io',
  rubygems: 'RubyGems',
  packagist: 'Packagist vendor',
  nuget: 'NuGet',
  homebrew: 'Homebrew',
  dockerhub: 'Docker Hub namespace',
};

const MATCHES = {
  exact: 'Same name',
  normalized: 'Same name, different spelling',
  affix: 'Same name with a prefix or suffix',
  phonetic: 'Sounds alike',
  edit_distance_1: 'One letter off',
  edit_distance_2: 'Two letters off',
  substring: 'Contains the name',
};

/** Score bands, lowest first, matching the API's thresholds (0, 40, 65, 85). */
const BANDS = [
  ['high_risk', 'High risk', 40],
  ['crowded', 'Crowded', 25],
  ['mostly_clear', 'Mostly clear', 20],
  ['highly_unique', 'Highly unique', 15],
];

const UNREACHABLE = "Couldn't reach the oneofakind API. Try again later.";

const form = document.querySelector('#check-form');
const input = document.querySelector('#name');
const errorText = document.querySelector('#name-error');
const select = document.querySelector('#ecosystem');
const submit = document.querySelector('#submit');
const result = document.querySelector('#result');
const announcer = document.querySelector('#announce');

let sourceCount = null;
let inFlight = null;

/** Builds an element. Children are appended as nodes or plain text, never parsed as HTML. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'style') for (const [property, v] of Object.entries(value)) node.style.setProperty(property, v);
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

/** A link when the URL is a safe http(s) URL, plain text otherwise. */
function link(text, url) {
  const href = safeUrl(url);
  return href ? el('a', { href, rel: 'noopener noreferrer' }, text) : el('span', {}, text);
}

const label = (labels, key) => labels[key] ?? key;

function setFieldError(message) {
  errorText.textContent = message;
  input.setAttribute('aria-invalid', String(Boolean(message)));
}

/** Validates the field. An empty field is only flagged when the visitor tries to check it. */
function updateValidity({ flagEmpty = false } = {}) {
  const { name, error } = validateName(input.value);
  setFieldError(error && (input.value || flagEmpty) ? error : '');
  submit.disabled = Boolean(error) || inFlight !== null;
  return { name, error };
}

function addEcosystemOption(id) {
  if ([...select.options].some((option) => option.value === id)) return;
  select.append(el('option', { value: id }, label(ECOSYSTEMS, id)));
}

async function loadSources() {
  try {
    const res = await fetch(`${API_URL}/v1/sources`);
    if (!res.ok) return;
    const data = await res.json();
    sourceCount = data.sources?.length ?? null;
    for (const id of Object.keys(data.ecosystems ?? {})) addEcosystemOption(id);
  } catch {
    // The dropdown keeps "Any ecosystem"; checks still work.
  }
}

function showRequestError(message) {
  result.replaceChildren(el('p', { class: 'request-error' }, message));
  announcer.textContent = message;
}

async function check(name, ecosystem) {
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;
  submit.disabled = true;

  const shown = new URLSearchParams(ecosystem ? { name, ecosystem } : { name });
  history.replaceState(null, '', `?${shown}`);
  const query = new URLSearchParams(shown);
  query.set('limit', '0'); // The page shows clusters, not the raw hits.

  const status = `Checking ${sourceCount ? `${sourceCount} sources` : 'all sources'}…`;
  result.setAttribute('aria-busy', 'true');
  result.replaceChildren(el('p', { class: 'status' }, status));
  announcer.textContent = status;

  try {
    const res = await fetch(`${API_URL}/v1/check?${query}`, { signal: controller.signal });
    const body = await res.json().catch(() => null);
    if (res.ok && body) {
      renderResult(body);
    } else if (res.status === 400 && body?.error) {
      result.replaceChildren();
      setFieldError(body.error);
      announcer.textContent = body.error;
    } else if (res.status === 429) {
      showRequestError(`Too many checks. Try again in ${body?.retryAfter ?? 60} seconds.`);
    } else {
      showRequestError(UNREACHABLE);
    }
  } catch {
    if (!controller.signal.aborted) showRequestError(UNREACHABLE);
  } finally {
    if (inFlight === controller) {
      inFlight = null;
      result.setAttribute('aria-busy', 'false');
      submit.disabled = Boolean(validateName(input.value).error);
    }
  }
}

function renderResult(r) {
  const band = BANDS.find(([id]) => id === r.label);
  const bandName = band ? band[1] : r.label;
  const ecosystem = r.ecosystem ? ` as a ${label(ECOSYSTEMS, r.ecosystem)} project` : '';

  const verdict = el(
    'div',
    { class: 'verdict', style: { '--band': `var(--band-${r.label.replaceAll('_', '-')})` } },
    el('span', { class: 'score' }, String(r.score)),
    el('span', { class: 'score-out-of' }, 'out of 100'),
    el('span', { class: 'band-label' }, bandName),
    el('p', { class: 'verdict-name' }, `Uniqueness score for “${r.name}”${ecosystem}`),
  );

  const scale = el(
    'div',
    { class: 'scale', 'aria-hidden': 'true' },
    ...BANDS.map(([id]) => el('span', { class: `band-${id.replaceAll('_', '-')}` })),
    el('span', { class: 'marker', style: { '--at': `${r.score}%` } }),
  );
  const scaleLabels = el(
    'div',
    { class: 'scale-labels', 'aria-hidden': 'true' },
    ...BANDS.map(([, name]) => el('span', {}, name)),
  );

  const warnings = renderWarnings(r);
  result.replaceChildren(verdict, scale, scaleLabels, ...(warnings ? [warnings] : []), ...renderAvailability(r), ...renderMatches(r));
  announcer.textContent = `Score ${r.score} out of 100, ${bandName.toLowerCase()}.`;
}

function renderWarnings(r) {
  const items = [];
  for (const blocker of r.blockers) {
    const ecosystem = r.ecosystem ? label(ECOSYSTEMS, r.ecosystem) : 'this ecosystem';
    items.push(
      el(
        'li',
        { class: 'blocker' },
        `Taken on ${label(AVAILABILITY, blocker.platform)}, the main registry for ${ecosystem}, so the score is capped at 35.`,
      ),
    );
  }
  for (const penalty of r.penalties) items.push(el('li', {}, `${penalty.detail}. Minus ${penalty.points} points.`));

  const failed = Object.entries(r.sources).filter(([, report]) => report.status === 'error');
  if (failed.length) {
    const count = failed.length === 1 ? '1 source' : `${failed.length} sources`;
    const list = failed.map(([id, report]) => `${label(SOURCES, id)} (${report.error})`).join('; ');
    items.push(el('li', {}, `${count} didn't answer, so the score may be too optimistic: ${list}.`));
  }
  return items.length ? el('ul', { class: 'warnings' }, ...items) : null;
}

function renderAvailability(r) {
  const keys = Object.keys(r.availability).sort((a, b) => order(a) - order(b));
  const chips = (free) =>
    keys.filter((key) => r.availability[key] === free).map((key) =>
      el('span', { class: `chip ${free ? 'free' : 'taken'}` }, label(AVAILABILITY, key)),
    );
  const free = chips(true);
  const taken = chips(false);
  if (!free.length && !taken.length) return [];
  return [
    el('h2', {}, 'Availability'),
    el(
      'dl',
      { class: 'availability' },
      el('dt', {}, 'Free'),
      el('dd', {}, ...(free.length ? free : ['None'])),
      el('dt', {}, 'Taken'),
      el('dd', {}, ...(taken.length ? taken : ['None'])),
    ),
  ];
}

const availabilityOrder = Object.keys(AVAILABILITY);
const order = (key) => (availabilityOrder.includes(key) ? availabilityOrder.indexOf(key) : availabilityOrder.length);

function renderMatches(r) {
  const heading = el('h2', {}, 'Closest matches');
  if (!r.clusters.length) return [heading, el('p', { class: 'empty' }, 'No similar names found.')];

  const items = r.clusters.slice(0, 8).map((cluster) => {
    const percent = Math.round(cluster.risk * 100);
    return el(
      'li',
      {},
      el('span', { class: 'match-name' }, link(cluster.label, cluster.url)),
      el(
        'span',
        { class: 'match-detail' },
        `${label(MATCHES, cluster.match)}, found on ${cluster.sources.map((id) => label(SOURCES, id)).join(', ')}`,
      ),
      el(
        'span',
        { class: 'risk' },
        `${percent}% risk`,
        el('span', { class: 'risk-bar', 'aria-hidden': 'true' }, el('span', { style: { '--risk': `${percent}%` } })),
      ),
    );
  });
  return [
    heading,
    el('p', { class: 'hint' }, 'Risk is how much each match lowers the score.'),
    el('ul', { class: 'matches' }, ...items),
  ];
}

input.addEventListener('input', () => {
  const lower = input.value.toLowerCase();
  if (lower !== input.value) {
    const { selectionStart, selectionEnd } = input;
    input.value = lower;
    input.setSelectionRange(selectionStart, selectionEnd);
  }
  updateValidity();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const { name, error } = updateValidity({ flagEmpty: true });
  if (error) {
    input.focus();
    return;
  }
  check(name, select.value);
});

const params = new URLSearchParams(location.search);
const sourcesLoaded = loadSources();
if (params.has('name')) {
  input.value = params.get('name').toLowerCase();
  await sourcesLoaded;
  const ecosystem = params.get('ecosystem');
  if (ecosystem) {
    addEcosystemOption(ecosystem);
    select.value = ecosystem;
  }
  const { name, error } = updateValidity({ flagEmpty: true });
  if (!error) check(name, select.value);
}

#!/usr/bin/env node
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { checkName, InvalidInputError, parseEcosystem, type CheckResult } from './check.js';
import { ECOSYSTEMS } from './types.js';

const USAGE = `Usage: oneofakind <name> [options]

Checks how unique a project name is across domains, package registries, GitHub and more.

Options:
  -e, --ecosystem <id>   ${ECOSYSTEMS.join(', ')}
  -s, --sources <ids>    comma-separated subset, e.g. npm,github,domains
      --json             print the full result as JSON
  -h, --help             show this help
  -v, --version          show the version

Set GITHUB_TOKEN to raise GitHub's rate limits.`;

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      ecosystem: { type: 'string', short: 'e' },
      sources: { type: 'string', short: 's' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
} catch (error) {
  // parseArgs explains itself in the first sentence; the rest is advice about `--` that rarely applies.
  console.error(`${(error as Error).message.split('. ')[0]}.\n\n${USAGE}`);
  process.exit(1);
}
const { values, positionals } = parsed;

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (values.version) {
  console.log((createRequire(import.meta.url)('../package.json') as { version: string }).version);
  process.exit(0);
}
if (!positionals[0]) {
  console.error(USAGE);
  process.exit(1);
}

let result: CheckResult;
try {
  result = await checkName(positionals[0], {
    ecosystem: parseEcosystem(values.ecosystem),
    sources: values.sources?.split(','),
  });
} catch (error) {
  if (!(error instanceof InvalidInputError)) throw error;
  console.error(error.message);
  process.exit(1);
}

if (values.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`\n${result.name}: ${result.score}/100 (${result.label}), coverage ${Math.round(result.coverage * 100)}%`);
  for (const blocker of result.blockers) console.log(`  BLOCKER  ${blocker.detail}`);
  for (const penalty of result.penalties) console.log(`  -${penalty.points}      ${penalty.detail}`);

  console.log('\nTop risks:');
  for (const cluster of result.clusters.slice(0, 8)) {
    console.log(`  ${cluster.risk.toFixed(3)}  ${cluster.label} [${cluster.match}] ${cluster.sources.join('+')}  ${cluster.url}`);
  }

  const taken = Object.entries(result.availability).filter(([, free]) => !free).map(([key]) => key);
  const free = Object.entries(result.availability).filter(([, free]) => free).map(([key]) => key);
  console.log(`\nAvailable: ${free.join(', ') || 'none'}`);
  console.log(`Taken:     ${taken.join(', ') || 'none'}`);

  const failed = Object.entries(result.sources).filter(([, report]) => report.status === 'error');
  for (const [id, report] of failed) console.log(`Source ${id} failed: ${report.error}`);
}

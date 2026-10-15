#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { checkName, parseEcosystem } from './check.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    ecosystem: { type: 'string', short: 'e' },
    sources: { type: 'string', short: 's' },
    json: { type: 'boolean' },
  },
});

if (!positionals[0]) {
  console.error('usage: oneofakind <name> [--ecosystem js|python|...] [--sources npm,github] [--json]');
  process.exit(1);
}

const result = await checkName(positionals[0], {
  ecosystem: parseEcosystem(values.ecosystem),
  sources: values.sources?.split(','),
});

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

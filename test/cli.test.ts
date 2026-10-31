import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

/** Runs the CLI from source; only arguments that make no network requests are used here. */
const cli = (...args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { encoding: 'utf8' });

describe('cli', () => {
  it.each(['--help', '-h'])('prints usage for %s and exits 0', (flag) => {
    const run = cli(flag);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Usage: oneofakind <name>');
    expect(run.stdout).toContain('--ecosystem');
  });

  it('prints the package version for --version', () => {
    const run = cli('--version');
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(version);
  });

  it('rejects an unknown option with a short message and usage, not a stack trace', () => {
    const run = cli('quillo', '--colour');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Unknown option '--colour'");
    expect(run.stderr).toContain('Usage: oneofakind <name>');
    expect(run.stderr).not.toMatch(/\n\s+at /);
  });

  it('prints usage and exits 1 without a name', () => {
    const run = cli();
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Usage: oneofakind <name>');
  });
});

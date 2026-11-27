/**
 * Builds benchmark/cases from BugsJS.
 *
 * For every case in cases.config.json:
 *   1. fetch the BugsJS tags Bug-N (buggy) and Bug-N-fix (fixed, source only)
 *   2. diff fixed -> buggy, which is the fix reversed: a PR that reintroduces the bug
 *   3. record the lines that diff adds as ground truth
 *   4. copy the touched files at both versions, so the cases can be pushed as real PRs
 *
 * The output is committed, so running the benchmark needs no network. Rerun
 * this only to add or change cases:
 *
 *   npx tsx benchmark/scripts/build-cases.ts
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { groundTruthFromDiff } from '../core/score';
import type { BenchCase } from '../core/types';

const BENCH = join(__dirname, '..');
const CACHE = join(BENCH, '.cache', 'bugsjs');
const CASES = join(BENCH, 'cases');

/** Tests, docs and manifests are not part of the change under review. */
const PATHSPEC = ['.', ':!test', ':!tests', ':!*.md', ':!package.json', ':!*.min.js'];

type ConfigCase = Pick<BenchCase, 'id' | 'repo' | 'bug' | 'severity' | 'description'>;

function git(repoDir: string, args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function ensureTags(repo: string, bug: number): string {
  const dir = join(CACHE, `${repo}.git`);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '-q', '--bare', dir]);
  }
  const wanted = [`Bug-${bug}`, `Bug-${bug}-fix`, `Bug-${bug}-original`];
  const missing = wanted.filter((tag) => {
    try {
      git(dir, ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]);
      return false;
    } catch {
      return true;
    }
  });
  if (missing.length > 0) {
    git(dir, [
      'fetch',
      '-q',
      '--depth=1',
      `https://github.com/BugsJS/${repo}`,
      ...missing.map((tag) => `refs/tags/${tag}:refs/tags/${tag}`),
    ]);
  }
  return dir;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/**
 * Drops `index <old>..<new>` headers from a generated diff.
 *
 * Those are the upstream repository's blob hashes. They say nothing a reviewer
 * can use, and they identify the exact file versions on either side of a
 * public BugsJS fix, which is a lookup key into the answer for anyone who can
 * search those repositories. Hosted reviewers never see these: bench:push
 * commits the file contents and GitHub computes its own headers, so removing
 * them from the prompt makes the two inputs more alike, not less.
 */
function stripBlobHashes(diff: string): string {
  return diff
    .split('\n')
    .filter((line) => !/^index [0-9a-f]{4,40}\.\.[0-9a-f]{4,40}( [0-7]{6})?\r?$/.test(line))
    .join('\n');
}

function build(entry: ConfigCase): BenchCase {
  const dir = ensureTags(entry.repo, entry.bug);
  const buggy = `Bug-${entry.bug}`;
  const fixed = `Bug-${entry.bug}-fix`;

  const diff = stripBlobHashes(git(dir, ['diff', '-U3', fixed, buggy, '--', ...PATHSPEC]));
  const files = git(dir, ['diff', '--name-only', fixed, buggy, '--', ...PATHSPEC])
    .split('\n')
    .filter((line) => line !== '');
  const groundTruth = groundTruthFromDiff(diff);

  if (groundTruth.length === 0) {
    throw new Error(`${entry.id}: the reversed fix adds no lines, so there is nothing to locate`);
  }

  const out = join(CASES, entry.id);
  rmSync(out, { recursive: true, force: true });
  for (const file of files) {
    writeFile(join(out, 'base', file), git(dir, ['show', `${fixed}:${file}`]));
    writeFile(join(out, 'head', file), git(dir, ['show', `${buggy}:${file}`]));
  }

  const original = `Bug-${entry.bug}-original`;
  const benchCase: BenchCase = {
    ...entry,
    upstreamFixSha: git(dir, ['rev-parse', `${original}^{commit}`]).trim(),
    upstreamFixSubject: git(dir, ['log', '-1', '--format=%s', original]).trim(),
    diff,
    files,
    groundTruth,
  };
  writeFile(join(out, 'case.json'), `${JSON.stringify(benchCase, null, 2)}\n`);
  return benchCase;
}

function main(): void {
  const config = JSON.parse(readFileSync(join(BENCH, 'cases.config.json'), 'utf8')) as {
    cases: ConfigCase[];
  };
  for (const entry of config.cases) {
    const built = build(entry);
    const lines = built.groundTruth.reduce((sum, loc) => sum + loc.lines.length, 0);
    console.log(`${built.id.padEnd(14)} ${built.files.join(', ')}  (${lines} bug line${lines === 1 ? '' : 's'})`);
  }

  // Dropping a case from the manifest has to drop it from the benchmark.
  // build() only replaces the directory of a case it is building, so without
  // this a removed id keeps its fixtures, loadCases keeps finding them, and
  // every later run still scores a case the manifest no longer lists.
  const wanted = new Set(config.cases.map((entry) => entry.id));
  for (const dir of readdirSync(CASES, { withFileTypes: true })) {
    if (dir.isDirectory() && !wanted.has(dir.name)) {
      rmSync(join(CASES, dir.name), { recursive: true, force: true });
      console.log(`${dir.name.padEnd(14)} removed, no longer in cases.config.json`);
    }
  }
}

if (require.main === module) {
  main();
}

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { BenchCase, ReviewerFinding } from './types';

export const BENCH_DIR = join(__dirname, '..');
export const CASES_DIR = join(BENCH_DIR, 'cases');
export const RESULTS_DIR = join(BENCH_DIR, 'results');
export const RUNS_DIR = join(RESULTS_DIR, 'runs');

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export const CASES_CONFIG = join(BENCH_DIR, 'cases.config.json');

/**
 * Every built case directory, checked against the manifest first.
 *
 * `bench:cases` prunes a directory whose id has left cases.config.json, but it
 * only runs when someone runs it. Until then the fixtures are still on disk
 * and this function would happily load and score a case the manifest no
 * longer lists. Refusing to load is the honest answer: the benchmark says
 * which cases it runs in one place, and a stale directory means the build is
 * out of date, not that the extra case belongs in the results.
 */
export function loadCases(): BenchCase[] {
  const config = readJson<{ cases: Array<{ id: string }> }>(CASES_CONFIG);
  const wanted = new Set(config.cases.map((entry) => entry.id));

  const built = readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const orphans = built.filter((name) => !wanted.has(name));
  if (orphans.length > 0) {
    throw new Error(
      `benchmark/cases has ${orphans.join(', ')}, which cases.config.json does not list: ` +
        'run `npm run bench:cases` to rebuild, or restore the manifest entry',
    );
  }

  return built
    .map((name) => readJson<BenchCase>(join(CASES_DIR, name, 'case.json')))
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

/** One file per reviewer, written by a runner. */
export type RunFile = {
  reviewer: string;
  /** Free text: model name, app name, anything that identifies what ran. */
  source: string;
  ranAt: string;
  /** Cases the reviewer actually saw. A case missing here was not run, not missed. */
  caseIds: string[];
  findings: ReviewerFinding[];
  /** Per case failures (timeouts, unparseable output). Reported, never hidden. */
  errors: Array<{ caseId: string; message: string }>;
};

export function loadRuns(): RunFile[] {
  if (!existsSync(RUNS_DIR)) {
    return [];
  }
  return readdirSync(RUNS_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => readJson<RunFile>(join(RUNS_DIR, name)));
}

/** First line of a comment, without markdown decoration, capped. */
export function titleFrom(body: string): string {
  const first =
    body
      .split('\n')
      .map((line) => line.replace(/[#*_`>]/g, '').trim())
      .find((line) => line !== '') ?? '';
  return first.slice(0, 200);
}

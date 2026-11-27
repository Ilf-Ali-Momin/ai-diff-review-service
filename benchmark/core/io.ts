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

export function loadCases(): BenchCase[] {
  return readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readJson<BenchCase>(join(CASES_DIR, entry.name, 'case.json')))
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

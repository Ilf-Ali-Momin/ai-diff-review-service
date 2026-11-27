/**
 * Guards the committed case data. If a case is rebuilt wrongly, the benchmark
 * would quietly score reviewers against the wrong lines; these tests make that
 * loud instead.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CASES_CONFIG, CASES_DIR, loadCases } from '../../benchmark/core/io';
import type { BenchCase } from '../../benchmark/core/types';
import { groundTruthFromDiff, indexDiff } from '../../benchmark/core/score';

/**
 * Applies a case's stored unified diff to its base snapshot, the way git would.
 * Returns the resulting text per file.
 */
function applyDiff(benchCase: BenchCase): Map<string, string> {
  const out = new Map<string, string>();
  const lines = benchCase.diff.split('\n');

  let path: string | null = null;
  let source: string[] = [];
  let result: string[] = [];
  let cursor = 0;

  const flush = (): void => {
    if (path !== null) {
      out.set(path, [...result, ...source.slice(cursor)].join('\n'));
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const next = lines[i + 1];

    if (line.startsWith('--- ') && next !== undefined && next.startsWith('+++ ')) {
      flush();
      path = (next.slice('+++ '.length).split('\t')[0] ?? '').replace(/^b\//, '');
      source = readFileSync(join(CASES_DIR, benchCase.id, 'base', path), 'utf8').split('\n');
      result = [];
      cursor = 0;
      i += 1;
      continue;
    }

    const hunk = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
    if (hunk !== null) {
      const start = Number.parseInt(hunk[1] as string, 10) - 1;
      result.push(...source.slice(cursor, start));
      cursor = start;
      continue;
    }

    if (path === null) {
      continue;
    }
    if (line.startsWith('+')) {
      result.push(line.slice(1));
    } else if (line.startsWith('-')) {
      cursor += 1;
    } else if (line.startsWith(' ')) {
      result.push(source[cursor] as string);
      cursor += 1;
    } else if (line === '' && i === lines.length - 1) {
      // The document's terminating newline, not a row of the file.
      continue;
    } else if (line === '') {
      result.push(source[cursor] as string);
      cursor += 1;
    }
  }

  flush();
  return out;
}

const cases = loadCases();

describe('benchmark cases', () => {
  it('has the expected set', () => {
    expect(cases).toHaveLength(15);
    expect(new Set(cases.map((c) => c.id)).size).toBe(15);
  });

  it('is exactly what cases.config.json lists, upstream bug included', () => {
    // Comparing ids alone would pass after someone pointed an existing id at a
    // different upstream bug without rebuilding, so the benchmark would keep
    // scoring the old bug while the manifest declared the new one.
    const config = JSON.parse(readFileSync(CASES_CONFIG, 'utf8')) as {
      cases: Array<{ id: string; repo: string; bug: number }>;
    };
    const key = (c: { id: string; repo: string; bug: number }): string => `${c.id} ${c.repo} ${c.bug}`;

    expect(cases.map(key).sort()).toEqual(config.cases.map(key).sort());
  });

  it('refuses to load when a manifest id has no fixture directory', () => {
    // Both directions, because a missing directory is silently a smaller
    // benchmark while a stale one is silently a larger one.
    const config = JSON.parse(readFileSync(CASES_CONFIG, 'utf8')) as { cases: Array<{ id: string }> };
    const built = readdirSync(CASES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(config.cases.filter((c) => !built.includes(c.id))).toEqual([]);
    expect(built.filter((name) => !config.cases.some((c) => c.id === name))).toEqual([]);
  });

  it('carries no index blob hash headers, which are a lookup key into the fix', () => {
    for (const benchCase of cases) {
      const offenders = benchCase.diff
        .split('\n')
        .filter((line) => /^index [0-9a-f]{4,40}\.\.[0-9a-f]{4,40}( [0-7]{6})?\r?$/.test(line));
      expect(offenders, benchCase.id).toEqual([]);
    }
  });

  for (const benchCase of cases) {
    describe(benchCase.id, () => {
      it('ground truth matches the diff it was derived from', () => {
        expect(groundTruthFromDiff(benchCase.diff)).toEqual(benchCase.groundTruth);
      });

      it('every bug line is an added line in the diff', () => {
        const index = indexDiff(benchCase.diff);
        for (const location of benchCase.groundTruth) {
          for (const line of location.lines) {
            expect(index.get(location.path)?.added.has(line)).toBe(true);
          }
        }
      });

      it('applying the stored patch to base reproduces head exactly', () => {
        // The weaker check below only asks whether each labelled line appears
        // somewhere in the additions, so two labelled lines could be swapped
        // in the head snapshot and still pass while the published pull request
        // no longer matches the patch that scoring uses. Applying the patch is
        // the only check that ties the three together.
        const patched = applyDiff(benchCase);
        for (const file of benchCase.files) {
          const head = readFileSync(join(CASES_DIR, benchCase.id, 'head', file), 'utf8');
          expect(patched.get(file), `${file} was not produced by the patch`).toBe(head);
        }
      });

      it('the head file really contains the added text at that line', () => {
        const added = benchCase.diff
          .split('\n')
          .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
          .map((line) => line.slice(1));
        for (const location of benchCase.groundTruth) {
          const head = readFileSync(join(CASES_DIR, benchCase.id, 'head', location.path), 'utf8').split('\n');
          for (const line of location.lines) {
            expect(added).toContain(head[line - 1]);
          }
        }
      });
    });
  }
});

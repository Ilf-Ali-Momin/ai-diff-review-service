/**
 * Guards the committed case data. If a case is rebuilt wrongly, the benchmark
 * would quietly score reviewers against the wrong lines; these tests make that
 * loud instead.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CASES_DIR, loadCases } from '../../benchmark/core/io';
import { groundTruthFromDiff, indexDiff } from '../../benchmark/core/score';

const cases = loadCases();

describe('benchmark cases', () => {
  it('has the expected set', () => {
    expect(cases).toHaveLength(15);
    expect(new Set(cases.map((c) => c.id)).size).toBe(15);
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

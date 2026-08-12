/**
 * Diff builders for the core tests.
 *
 * Hunk headers carry real counts even though the parser derives line numbers
 * from the start value alone. A fixture that lies about its own shape is a
 * fixture nobody trusts when a test fails.
 */

import { orderFindings } from '../../src/core/order';
import { parseDiff } from '../../src/core/parseDiff';
import { scan } from '../../src/core/rules';
import type { Finding } from '../../src/core/types';

/** Lines are written with their diff marker: `+added`, `-removed`, ` context`. */
export function fileDiff(path: string, newStart: number, markedLines: string[]): string {
  const oldCount = markedLines.filter((line) => !line.startsWith('+')).length;
  const newCount = markedLines.filter((line) => !line.startsWith('-')).length;

  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${newStart},${oldCount} +${newStart},${newCount} @@`,
    ...markedLines,
    '',
  ].join('\n');
}

/** A diff of a single added line, for the one line predicate tables in RULES.md. */
export function oneAddedLine(text: string, path = 'src/app.ts'): string {
  return fileDiff(path, 1, [`+${text}`]);
}

/** The full pipeline a job runs, minus chunking: parse, scan, dedupe and sort. */
export function findingsFor(diff: string): Finding[] {
  return orderFindings(scan(parseDiff(diff)));
}

export function ruleIdsFor(diff: string): string[] {
  return findingsFor(diff).map((finding) => finding.ruleId);
}

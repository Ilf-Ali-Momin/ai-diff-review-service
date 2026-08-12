/**
 * Deduplication and ordering, in one place.
 *
 * Invariant 4 in CLAUDE.md: this function is called once per job, and its
 * output feeds both the JSON result and the event log. Sorting in two places
 * is how the stream and the poll response quietly stop agreeing.
 */

import type { Finding } from './types';

/**
 * Lexicographic by code unit, deliberately not `localeCompare`.
 *
 * `localeCompare` is locale dependent, so the same diff could order
 * differently on a host with a different default locale. The contract asks for
 * one ordering, not for a culturally correct one.
 */
function comparePaths(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * Dedupe by `id` keeping the first occurrence, then sort by path, then line
 * ascending as a number, then ruleId.
 *
 * `MOCK-INJ` sorts after every numbered rule without a special case, because
 * `I` is greater than any digit in code unit order.
 */
export function orderFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const unique: Finding[] = [];

  for (const finding of findings) {
    if (!seen.has(finding.id)) {
      seen.add(finding.id);
      unique.push(finding);
    }
  }

  return unique.sort((a, b) => {
    const byPath = comparePaths(a.path, b.path);
    if (byPath !== 0) {
      return byPath;
    }
    // Numeric, not string: 9 must sort before 10.
    if (a.line !== b.line) {
      return a.line - b.line;
    }
    return comparePaths(a.ruleId, b.ruleId);
  });
}

/**
 * Applies `maxFindings` to an already ordered, already deduplicated list.
 *
 * Kept separate from `orderFindings` because the cache stores the full list
 * and truncates per request at read time, which is what lets one scan serve
 * both a limit of 10 and a limit of 100. See D-009.
 */
export function truncateFindings(ordered: Finding[], maxFindings: number): Finding[] {
  return ordered.slice(0, maxFindings);
}

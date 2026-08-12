/**
 * Ordering and deduplication, the function invariant 4 says is called exactly
 * once per job and feeds both the JSON result and the event log.
 */

import { describe, expect, it } from 'vitest';

import { orderFindings, truncateFindings } from '../../src/core/order';
import type { Finding } from '../../src/core/types';

function finding(path: string, line: number, ruleId: string): Finding {
  return {
    id: `${ruleId}:${path}:${line}`,
    ruleId,
    path,
    line,
    severity: 'low',
    category: 'style',
    title: 'test',
    evidence: 'test',
  };
}

const idsOf = (findings: Finding[]): string[] => findings.map((f) => f.id);

describe('orderFindings', () => {
  it('sorts by path, then line, then ruleId', () => {
    const ordered = orderFindings([
      finding('src/b.ts', 1, 'MOCK-001'),
      finding('src/a.ts', 2, 'MOCK-001'),
      finding('src/a.ts', 1, 'MOCK-007'),
      finding('src/a.ts', 1, 'MOCK-001'),
    ]);

    expect(idsOf(ordered)).toEqual([
      'MOCK-001:src/a.ts:1',
      'MOCK-007:src/a.ts:1',
      'MOCK-001:src/a.ts:2',
      'MOCK-001:src/b.ts:1',
    ]);
  });

  it('sorts lines numerically, so 9 precedes 10', () => {
    const ordered = orderFindings([
      finding('src/a.ts', 10, 'MOCK-001'),
      finding('src/a.ts', 9, 'MOCK-001'),
      finding('src/a.ts', 100, 'MOCK-001'),
    ]);

    expect(ordered.map((f) => f.line)).toEqual([9, 10, 100]);
  });

  it('places MOCK-INJ after every numbered rule without a special case', () => {
    const ordered = orderFindings([
      finding('src/a.ts', 1, 'MOCK-INJ'),
      finding('src/a.ts', 1, 'MOCK-002'),
      finding('src/a.ts', 1, 'MOCK-001'),
    ]);

    expect(ordered.map((f) => f.ruleId)).toEqual(['MOCK-001', 'MOCK-002', 'MOCK-INJ']);
  });

  it('compares paths by code unit rather than by locale', () => {
    // localeCompare in most locales puts a.ts first. Code unit order puts the
    // uppercase B first, and that is the ordering the contract gets, on every
    // host, regardless of the default locale there.
    const ordered = orderFindings([finding('a.ts', 1, 'MOCK-001'), finding('B.ts', 1, 'MOCK-001')]);

    expect(ordered.map((f) => f.path)).toEqual(['B.ts', 'a.ts']);
    expect(['a.ts', 'B.ts'].sort((x, y) => x.localeCompare(y))).toEqual(['a.ts', 'B.ts']);
  });

  it('deduplicates by id, keeping the first occurrence', () => {
    const first = finding('src/a.ts', 1, 'MOCK-001');
    const duplicate = { ...first, evidence: 'a later copy' };

    const ordered = orderFindings([first, duplicate]);

    expect(ordered).toHaveLength(1);
    expect(ordered[0]?.evidence).toBe('test');
  });

  it('is stable across input orderings', () => {
    const input = [
      finding('src/b.ts', 3, 'MOCK-005'),
      finding('src/a.ts', 1, 'MOCK-001'),
      finding('src/a.ts', 12, 'MOCK-008'),
      finding('src/a.ts', 2, 'MOCK-003'),
    ];

    expect(idsOf(orderFindings(input))).toEqual(idsOf(orderFindings(input.slice().reverse())));
  });
});

describe('truncateFindings', () => {
  it('takes the first maxFindings of the ordered list', () => {
    const ordered = orderFindings([
      finding('src/a.ts', 3, 'MOCK-001'),
      finding('src/a.ts', 1, 'MOCK-001'),
      finding('src/a.ts', 2, 'MOCK-001'),
    ]);

    expect(truncateFindings(ordered, 2).map((f) => f.line)).toEqual([1, 2]);
  });

  it('returns everything when the limit exceeds the list', () => {
    const ordered = orderFindings([finding('src/a.ts', 1, 'MOCK-001')]);
    expect(truncateFindings(ordered, 100)).toHaveLength(1);
  });

  it('returns nothing at a limit of zero', () => {
    const ordered = orderFindings([finding('src/a.ts', 1, 'MOCK-001')]);
    expect(truncateFindings(ordered, 0)).toEqual([]);
  });
});

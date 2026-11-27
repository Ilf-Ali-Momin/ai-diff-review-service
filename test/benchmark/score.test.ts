import { describe, expect, it } from 'vitest';

import {
  findingKey,
  groundingOf,
  groundTruthFromDiff,
  hitsBug,
  indexDiff,
  normalizePath,
  scoreCase,
  summarize,
} from '../../benchmark/core/score';
import type { BenchCase, ReviewerFinding } from '../../benchmark/core/types';

const diff = [
  'diff --git a/lib/a.js b/lib/a.js',
  '--- a/lib/a.js',
  '+++ b/lib/a.js',
  '@@ -10,4 +10,4 @@ function f() {',
  ' const a = 1;',
  '-const b = check(a, 0);',
  '+const b = check(a);',
  ' return b;',
  ' }',
  '',
].join('\n');

const benchCase: BenchCase = {
  id: 'demo-1',
  repo: 'demo',
  bug: 1,
  severity: 'high',
  description: 'drops the second argument',
  upstreamFixSha: 'abc',
  upstreamFixSubject: 'fix',
  diff,
  files: ['lib/a.js'],
  groundTruth: [{ path: 'lib/a.js', lines: [11] }],
};

const finding = (over: Partial<ReviewerFinding>): ReviewerFinding => ({
  reviewer: 'r',
  caseId: 'demo-1',
  path: 'lib/a.js',
  line: 11,
  title: 'missing argument',
  ...over,
});

describe('groundTruthFromDiff', () => {
  it('records every added line of the reversed fix', () => {
    expect(groundTruthFromDiff(diff)).toEqual([{ path: 'lib/a.js', lines: [11] }]);
  });
});

describe('groundingOf', () => {
  const index = indexDiff(diff);

  it('separates added, context, fabricated and unlocated', () => {
    expect(groundingOf(finding({ line: 11 }), index)).toBe('added');
    expect(groundingOf(finding({ line: 10 }), index)).toBe('context');
    expect(groundingOf(finding({ line: 40 }), index)).toBe('fabricated');
    expect(groundingOf(finding({ path: 'lib/other.js' }), index)).toBe('fabricated');
    expect(groundingOf(finding({ path: null, line: null }), index)).toBe('unlocated');
  });

  it('marks a finding that misquotes a real line, and accepts a correct quote', () => {
    expect(groundingOf(finding({ evidence: 'const b = check(a);' }), index)).toBe('added');
    expect(groundingOf(finding({ evidence: 'eval(userInput);' }), index)).toBe('misquoted');
  });

  it('accepts the cases/<id>/ prefix pull request reviewers see', () => {
    expect(groundingOf(finding({ path: 'cases/demo-1/lib/a.js' }), index)).toBe('added');
  });
});

describe('normalizePath', () => {
  it('strips the case prefix and diff prefixes, and nothing else', () => {
    expect(normalizePath('cases/demo-1/lib/a.js', 'demo-1')).toBe('lib/a.js');
    expect(normalizePath('b/lib/a.js', 'demo-1')).toBe('lib/a.js');
    expect(normalizePath('./lib/a.js', 'demo-1')).toBe('lib/a.js');
    expect(normalizePath('cases/demo-2/lib/a.js', 'demo-1')).toBe('cases/demo-2/lib/a.js');
  });
});

describe('hitsBug', () => {
  it('counts a finding within tolerance of a bug line', () => {
    expect(hitsBug(finding({ line: 11 }), benchCase)).toBe(true);
    expect(hitsBug(finding({ line: 13 }), benchCase)).toBe(true);
    expect(hitsBug(finding({ line: 14 }), benchCase)).toBe(false);
  });

  it('never counts a finding on another file', () => {
    expect(hitsBug(finding({ path: 'lib/b.js' }), benchCase)).toBe(false);
  });
});

describe('scoreCase', () => {
  it('does not let a fabricated line near the bug count as a catch', () => {
    // The line number lands exactly on the bug, but the path is not in the diff.
    const score = scoreCase(benchCase, 'r', [finding({ path: 'lib/ghost.js', line: 11 })]);
    expect(score.caught).toBe(false);
    expect(score.findings[0]?.grounding).toBe('fabricated');
  });

  it('does not let a misquoted finding on the bug line count as a catch', () => {
    const score = scoreCase(benchCase, 'r', [finding({ evidence: 'not what the line says' })]);
    expect(score.caught).toBe(false);
  });

  it('only scores findings for its own case and reviewer', () => {
    const score = scoreCase(benchCase, 'r', [
      finding({}),
      finding({ reviewer: 'other' }),
      finding({ caseId: 'demo-2' }),
    ]);
    expect(score.findings).toHaveLength(1);
    expect(score.caught).toBe(true);
  });
});

describe('summarize', () => {
  it('splits extra grounded findings by human label', () => {
    // A second hunk far from the bug, so findings there are extras, not hits.
    const twoHunks = `${diff}@@ -50,2 +50,2 @@\n const c = 2;\n-log(c);\n+console.log(c);\n`;
    const wide: BenchCase = { ...benchCase, diff: twoHunks };

    const extraValid = finding({ line: 51, title: 'console.log left in' });
    const extraNoise = finding({ line: 50, title: 'rename c' });
    const extraOpen = finding({ line: 50, title: 'something else' });
    const score = scoreCase(wide, 'r', [finding({}), extraValid, extraNoise, extraOpen, finding({ line: 99 })]);
    const labels = new Map<string, 'valid' | 'noise'>([
      [findingKey(extraValid), 'valid'],
      [findingKey(extraNoise), 'noise'],
    ]);

    expect(summarize('r', [score], labels)).toMatchObject({
      caught: 1,
      cases: 1,
      findings: 5,
      added: 2,
      context: 2,
      fabricated: 1,
      extraValid: 1,
      extraNoise: 1,
      extraUnlabeled: 1,
    });
  });
});

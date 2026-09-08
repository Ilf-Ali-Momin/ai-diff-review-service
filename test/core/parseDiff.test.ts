/**
 * Probes 22, 23 and 24, plus the parser level behavior the rule tests
 * depend on: line numbering from hunk headers, path resolution, segment
 * boundaries, and the parseability signal that drives 422.
 */

import { describe, expect, it } from 'vitest';

import { parseDiff } from '../../src/core/parseDiff';
import { fileDiff, findingsFor } from './fixtures';

describe('probe 22: line numbers come from the hunk header', () => {
  const multiHunk = [
    'diff --git a/src/multi.ts b/src/multi.ts',
    '--- a/src/multi.ts',
    '+++ b/src/multi.ts',
    '@@ -1,4 +20,6 @@',
    ' const a = 1;',
    '+console.log("first");',
    ' const b = 2;',
    '-const removed = 3;',
    '+console.log("second");',
    '@@ -30,3 +50,4 @@',
    ' const c = 4;',
    '+// TODO second hunk',
    '',
  ].join('\n');

  it('counts from the header start, not from one', () => {
    expect(findingsFor(multiHunk).map((f) => [f.ruleId, f.line])).toEqual([
      ['MOCK-007', 21],
      ['MOCK-007', 23],
      ['MOCK-008', 51],
    ]);
  });

  it('does not advance the counter on a removed line', () => {
    const lines = parseDiff(multiHunk).addedLines;
    // The removed line sits between them, so the second added line is 23 and
    // not 24. A parser that incremented on removals would be one out here.
    expect(lines.map((line) => line.line)).toEqual([21, 23, 51]);
  });

  it('resets the counter at the second hunk header', () => {
    expect(parseDiff(multiHunk).hunkCount).toBe(2);
  });
});

describe('probe 23: a multi file diff', () => {
  it('reports the right path for every finding', () => {
    const diff =
      fileDiff('src/zeta.ts', 1, ['+console.log("z");']) +
      fileDiff('src/alpha.ts', 1, ['+// TODO alpha']);

    // Sorted by path, so alpha precedes zeta despite appearing second.
    expect(findingsFor(diff).map((f) => [f.path, f.ruleId])).toEqual([
      ['src/alpha.ts', 'MOCK-008'],
      ['src/zeta.ts', 'MOCK-007'],
    ]);
  });

  it('produces one segment per file', () => {
    const diff =
      fileDiff('src/a.ts', 1, ['+const a = 1;']) + fileDiff('src/b.ts', 1, ['+const b = 2;']);
    const { segments } = parseDiff(diff);

    expect(segments.map((segment) => segment.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(segments.map((segment) => segment.text).join('')).toBe(diff);
  });
});

describe('probe 24: a rename reports the new path', () => {
  it('takes the path from the +++ header', () => {
    const diff = [
      'diff --git a/src/old.ts b/src/new.ts',
      'similarity index 90%',
      'rename from src/old.ts',
      'rename to src/new.ts',
      '--- a/src/old.ts',
      '+++ b/src/new.ts',
      '@@ -1,2 +1,3 @@',
      ' const keep = 1;',
      '+console.log("renamed");',
      '',
    ].join('\n');

    expect(findingsFor(diff).map((f) => f.path)).toEqual(['src/new.ts']);
  });

  it('keeps a rename with no hunks as a single segment with no findings', () => {
    const diff = [
      'diff --git a/src/old.ts b/src/new.ts',
      'similarity index 100%',
      'rename from src/old.ts',
      'rename to src/new.ts',
      '',
    ].join('\n');

    expect(findingsFor(diff)).toEqual([]);
    expect(parseDiff(diff).hunkCount).toBe(0);
  });
});

describe('path resolution', () => {
  it('strips a leading b/ prefix', () => {
    const { addedLines } = parseDiff(fileDiff('src/app.ts', 1, ['+const a = 1;']));
    expect(addedLines[0]?.path).toBe('src/app.ts');
  });

  it('treats a /dev/null target as a deletion with no added lines', () => {
    const diff = [
      'diff --git a/src/gone.ts b/src/gone.ts',
      'deleted file mode 100644',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-console.log("gone");',
      '',
    ].join('\n');

    expect(parseDiff(diff).addedLines).toEqual([]);
    expect(findingsFor(diff)).toEqual([]);
  });

  it('drops a trailing tab timestamp', () => {
    const diff = [
      '--- a/src/app.ts\t2024-01-01 10:00:00.000000000 +0000',
      '+++ b/src/app.ts\t2024-01-02 10:00:00.000000000 +0000',
      '@@ -1,1 +1,2 @@',
      '+console.log("x");',
      '',
    ].join('\n');

    expect(parseDiff(diff).addedLines[0]?.path).toBe('src/app.ts');
  });
});

describe('D-019: both header styles are recognized', () => {
  it('segments a plain diff -u document with no diff --git headers', () => {
    const diff = [
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,1 +1,2 @@',
      '+console.log("a");',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -1,1 +1,2 @@',
      '+// TODO b',
      '',
    ].join('\n');
    const { segments } = parseDiff(diff);

    expect(segments.map((segment) => segment.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(segments.map((segment) => segment.text).join('')).toBe(diff);
    expect(findingsFor(diff).map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('carries a format-patch preamble inside the first file segment', () => {
    const diff = [
      'From 1234567890abcdef Mon Sep 17 00:00:00 2001',
      'Subject: [PATCH] add logging',
      '',
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,1 +1,2 @@',
      '+console.log("a");',
      '',
    ].join('\n');
    const { segments } = parseDiff(diff);

    expect(segments.length).toBe(1);
    expect(segments[0]?.text).toBe(diff);
    expect(findingsFor(diff).map((f) => f.ruleId)).toEqual(['MOCK-007']);
  });
});

describe('D-018: parseability is signalled by the hunk count', () => {
  it.each([
    ['', 0],
    ['just some text', 0],
    ['+ not really a diff', 0],
    ['diff --git a/x b/x\nindex 111..222 100644\n', 0],
  ])('%j has no hunks', (input, expected) => {
    expect(parseDiff(input).hunkCount).toBe(expected);
  });

  it('counts a real diff', () => {
    expect(parseDiff(fileDiff('src/a.ts', 1, ['+const a = 1;'])).hunkCount).toBe(1);
  });
});

describe('hunk content handling', () => {
  it('treats a completely empty line inside a hunk as context', () => {
    const diff = [
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,4 @@',
      ' const a = 1;',
      '',
      '+console.log("after blank");',
      '',
    ].join('\n');

    // The blank context line advances the counter, so the added line is 3.
    expect(parseDiff(diff).addedLines.map((line) => line.line)).toEqual([3]);
  });

  it('ignores the no newline marker without advancing the counter', () => {
    const diff = [
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,2 @@',
      '-const a = 1;',
      '+const a = 2;',
      '\\ No newline at end of file',
      '+// TODO next',
      '',
    ].join('\n');

    expect(parseDiff(diff).addedLines.map((line) => line.line)).toEqual([1, 2]);
  });

  it('keeps evidence verbatim, including indentation and trailing spaces', () => {
    const diff = fileDiff('src/a.ts', 1, ['+    console.log("x");   ']);
    expect(findingsFor(diff)[0]?.evidence).toBe('    console.log("x");   ');
  });
});

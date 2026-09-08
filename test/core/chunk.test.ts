/**
 * Probes 28 to 33.
 *
 * Row 31, the property test, is the highest value test in the plan and is
 * written first. It is only meaningful because the mock provider re parses
 * each chunk rather than sharing one parse of the whole diff, so a boundary
 * that dropped or duplicated a finding would actually show up here. See D-022.
 */

import { describe, expect, it } from 'vitest';

import { chunkSegments } from '../../src/core/chunk';
import { orderFindings } from '../../src/core/order';
import { parseDiff } from '../../src/core/parseDiff';
import { scan } from '../../src/core/rules';
import type { Finding } from '../../src/core/types';
import { mockProvider } from '../../src/providers/mock';
import { fileDiff, findingsFor } from './fixtures';

const signal = new AbortController().signal;

async function chunkedFindings(diff: string, maxBytes: number): Promise<Finding[]> {
  const { segments } = parseDiff(diff);
  const chunks = chunkSegments(segments, maxBytes);
  return orderFindings(await mockProvider.review(chunks, signal));
}

/**
 * A diff whose files deliberately do not appear in lexicographic order, so a
 * chunked scan that returned findings in discovery order rather than sorted
 * order would fail rather than pass by luck.
 */
function multiFileDiff(fileCount: number, linesPerFile: number): string {
  const names = ['zeta', 'alpha', 'mu', 'beta', 'omega', 'gamma', 'delta', 'kappa'];
  const files: string[] = [];

  for (let f = 0; f < fileCount; f += 1) {
    const name = names[f % names.length] ?? 'file';
    const marked: string[] = [];

    for (let l = 0; l < linesPerFile; l += 1) {
      switch (l % 6) {
        case 0:
          marked.push(`+  console.log("row ${l}");`);
          break;
        case 1:
          marked.push(`+  if (value == null) { return; }`);
          break;
        case 2:
          marked.push(`-  const removed = eval("nope");`);
          break;
        case 3:
          marked.push(`   const untouched = ${l};`);
          break;
        case 4:
          marked.push(`+  db.query("SELECT * FROM t WHERE id = " + id${l});`);
          break;
        default:
          marked.push(`+  // TODO revisit ${l}`);
      }
    }

    files.push(fileDiff(`src/${name}${f}.ts`, 1, marked));
  }

  return files.join('');
}

describe('probe 31: a chunked scan equals an unchunked scan', () => {
  it('produces deep equal findings at every chunk size', async () => {
    const diff = multiFileDiff(8, 30);
    const unchunked = findingsFor(diff);

    expect(unchunked.length).toBeGreaterThan(20);

    // Sizes chosen to land boundaries in different places, including one small
    // enough that almost every file becomes its own chunk and one large enough
    // that the whole diff is a single chunk.
    for (const maxBytes of [64, 200, 512, 1024, 4096, 65536]) {
      const chunked = await chunkedFindings(diff, maxBytes);
      expect(chunked, `maxBytes=${maxBytes}`).toEqual(unchunked);
    }
  });

  it('holds when a single file is larger than the whole budget', async () => {
    const diff = multiFileDiff(3, 400);
    const unchunked = findingsFor(diff);

    const chunked = await chunkedFindings(diff, 512);
    expect(chunked).toEqual(unchunked);
  });
});

describe('probe 28: a diff under the budget is one chunk', () => {
  it('reports a single chunk', () => {
    const { segments } = parseDiff(multiFileDiff(2, 5));
    expect(chunkSegments(segments).length).toBe(1);
  });
});

describe('probe 29: many files pack greedily and are never split', () => {
  it('places every file whole, in exactly one chunk', () => {
    const diff = multiFileDiff(5, 60);
    const { segments } = parseDiff(diff);
    const chunks = chunkSegments(segments, 2048);

    expect(chunks.length).toBeGreaterThan(1);

    // Every chunk must re-parse on its own, and the union of the paths each
    // chunk reports must be the full set with no path appearing twice.
    const seen: string[] = [];
    for (const chunk of chunks) {
      const paths = [...new Set(parseDiff(chunk.text).addedLines.map((a) => a.path))];
      seen.push(...paths);
    }

    const expected = [...new Set(parseDiff(diff).addedLines.map((a) => a.path))];
    expect(seen.slice().sort()).toEqual(expected.slice().sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('reassembles into exactly the submitted bytes', () => {
    const diff = multiFileDiff(5, 20);
    const { segments } = parseDiff(diff);
    const chunks = chunkSegments(segments, 700);

    expect(chunks.map((chunk) => chunk.text).join('')).toBe(diff);
  });
});

describe('probe 30: a single file over the budget is its own chunk', () => {
  it('gives the oversized file a chunk to itself and keeps its findings', async () => {
    const small = fileDiff('src/a.ts', 1, ['+console.log("a");']);
    const large = fileDiff('src/b.ts', 1, [
      ...Array.from({ length: 300 }, (_, i) => `+  const padding${i} = "${'x'.repeat(40)}";`),
      '+console.log("b");',
    ]);
    const diff = small + large;

    const { segments } = parseDiff(diff);
    const maxBytes = 512;
    expect(segments[1]?.byteLength).toBeGreaterThan(maxBytes);

    const chunks = chunkSegments(segments, maxBytes);
    const oversized = chunks.find((chunk) => chunk.byteLength > maxBytes);
    expect(oversized).toBeDefined();
    expect(parseDiff(oversized?.text ?? '').addedLines.every((a) => a.path === 'src/b.ts')).toBe(
      true,
    );

    expect(await chunkedFindings(diff, maxBytes)).toEqual(findingsFor(diff));
  });
});

describe('probe 33: the budget is measured in UTF 8 bytes', () => {
  it('packs by byte length rather than string length', async () => {
    // Each of these characters is three bytes in UTF 8 and one JavaScript
    // string unit, so a packer using .length would fit three times too much.
    const wide = '。'.repeat(60);
    const diff =
      fileDiff('src/one.ts', 1, [`+const a = "${wide}"; // TODO one`]) +
      fileDiff('src/two.ts', 1, [`+const b = "${wide}"; // TODO two`]);

    const { segments } = parseDiff(diff);
    const first = segments[0];
    expect(first).toBeDefined();
    expect(first?.byteLength).toBeGreaterThan(first?.text.length ?? 0);

    // A budget that both files would fit under by string length, but not by
    // byte length, must still split them.
    const maxBytes = (first?.byteLength ?? 0) + 10;
    const chunks = chunkSegments(segments, maxBytes);

    expect(chunks.length).toBe(2);
    expect(await chunkedFindings(diff, maxBytes)).toEqual(findingsFor(diff));
  });
});

describe('probe 32: findings either side of a boundary survive', () => {
  it('loses none and duplicates none when the boundary moves', async () => {
    const diff = multiFileDiff(6, 24);
    const expected = findingsFor(diff);
    const { segments } = parseDiff(diff);

    // Sweep the boundary across every plausible position.
    const total = segments.reduce((sum, segment) => sum + segment.byteLength, 0);
    for (let maxBytes = 100; maxBytes < total; maxBytes += 137) {
      const actual = await chunkedFindings(diff, maxBytes);
      expect(actual, `maxBytes=${maxBytes}`).toEqual(expected);
    }
  });
});

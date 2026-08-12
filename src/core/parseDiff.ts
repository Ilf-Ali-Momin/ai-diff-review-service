/**
 * Unified diff parser.
 *
 * Produces three things from one pass: the added lines every single line rule
 * evaluates, the reconstructed new file content per hunk that MOCK-004 needs
 * for brace matching, and the file segments that chunking packs.
 *
 * The one rule that governs the whole file: the `+` marker is stripped here,
 * exactly once, and no rule ever sees a raw line. See D-002.
 */

import type { AddedLine, FileSegment, Hunk, HunkLine, ParsedDiff } from './types';

/**
 * A trailing `\r` from a CRLF document must not stop a header being
 * recognized, so every structural pattern tolerates one. The line content
 * itself keeps the `\r`, because RULES.md forbids normalization. See D-021.
 */
const DIFF_GIT_HEADER = /^diff --git /;
const OLD_FILE_HEADER = /^--- /;
const NEW_FILE_HEADER = /^\+\+\+ /;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Reads the new file path out of a `+++` header.
 *
 * Unified diffs may append a tab and a timestamp, which is metadata rather
 * than part of the path. `/dev/null` means the file was deleted, so it has no
 * new path and therefore no added lines.
 */
function parseNewPath(headerLine: string): string | null {
  const afterMarker = headerLine.slice('+++ '.length);
  const withoutTimestamp = afterMarker.split('\t')[0] ?? '';
  const path = withoutTimestamp.replace(/\r$/, '').trim();

  if (path === '' || path === '/dev/null') {
    return null;
  }
  return path.startsWith('b/') ? path.slice(2) : path;
}

export function parseDiff(diff: string): ParsedDiff {
  const lines = diff.split('\n');

  const addedLines: AddedLine[] = [];
  const hunks: Hunk[] = [];
  const segments: FileSegment[] = [];

  let segmentStart = 0;
  let currentPath: string | null = null;
  let currentHunk: Hunk | null = null;
  let hunkCount = 0;
  let newLineNumber = 0;
  let inHunk = false;
  /**
   * True between a `diff --git` line and the `---` and `+++` pair that belongs
   * to it. While true, that pair describes the file we are already inside and
   * must not open a second segment for it.
   */
  let expectingHeadersForCurrentFile = false;
  /**
   * Until the first file header is seen, everything read so far is preamble,
   * for example the commit message `git format-patch` emits. It belongs to the
   * first file's segment rather than to a segment of its own, so that the
   * segment byte lengths still sum to the submitted document. See D-019.
   */
  let sawAnyFileHeader = false;

  /** Closes the segment that ends just before `endExclusive`. */
  const closeSegment = (endExclusive: number): void => {
    if (endExclusive <= segmentStart) {
      return;
    }
    const isFinal = endExclusive >= lines.length;
    const body = lines.slice(segmentStart, endExclusive).join('\n');
    // Every segment but the last keeps the newline that separated it from the
    // next, so concatenating all segments reproduces the submitted bytes.
    const text = isFinal ? body : `${body}\n`;

    segments.push({ path: currentPath, text, byteLength: Buffer.byteLength(text, 'utf8') });
    segmentStart = endExclusive;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    if (DIFF_GIT_HEADER.test(line)) {
      if (sawAnyFileHeader) {
        closeSegment(i);
      }
      sawAnyFileHeader = true;
      currentPath = null;
      currentHunk = null;
      inHunk = false;
      expectingHeadersForCurrentFile = true;
      continue;
    }

    /**
     * Headers are detected before added lines, as RULES.md requires, which is
     * what stops `+++ b/file.ts` being scanned as source. The pairing check,
     * that a `+++` only counts as a header directly after a `---`, is what
     * stops a removed line inside a hunk from being mistaken for one.
     */
    const next = lines[i + 1];
    if (OLD_FILE_HEADER.test(line) && next !== undefined && NEW_FILE_HEADER.test(next)) {
      if (!expectingHeadersForCurrentFile && sawAnyFileHeader) {
        closeSegment(i);
      }
      sawAnyFileHeader = true;
      currentPath = parseNewPath(next);
      currentHunk = null;
      inHunk = false;
      expectingHeadersForCurrentFile = false;
      i += 1; // the `+++` line is consumed here and never seen as content
      continue;
    }

    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      hunkCount += 1;
      newLineNumber = Number.parseInt(hunkMatch[1] ?? '0', 10);
      inHunk = true;
      expectingHeadersForCurrentFile = false;

      if (currentPath !== null) {
        currentHunk = { path: currentPath, lines: [] };
        hunks.push(currentHunk);
      } else {
        currentHunk = null;
      }
      continue;
    }

    if (!inHunk) {
      // Index lines, mode lines, similarity headers, preamble. Not content.
      continue;
    }

    const marker = line.charAt(0);

    if (marker === '+') {
      const text = line.slice(1);
      if (currentPath !== null) {
        addedLines.push({ path: currentPath, line: newLineNumber, text, raw: line });
        currentHunk?.lines.push({ line: newLineNumber, text, added: true });
      }
      newLineNumber += 1;
      continue;
    }

    if (marker === '-') {
      // Removed lines are not part of the new file, so the counter stands still.
      continue;
    }

    if (marker === '\\') {
      // "\ No newline at end of file" is metadata, not a line of the file.
      continue;
    }

    if (marker === ' ' || line === '' || line === '\r') {
      // RULES.md: a completely empty line inside a hunk is a context line that
      // some producers write without its leading space.
      const text = marker === ' ' ? line.slice(1) : line;
      const contextLine: HunkLine = { line: newLineNumber, text, added: false };
      currentHunk?.lines.push(contextLine);
      newLineNumber += 1;
      continue;
    }

    // Anything else ends the hunk; reprocess this line as structure.
    inHunk = false;
    i -= 1;
  }

  closeSegment(lines.length);

  return { addedLines, hunks, segments, hunkCount };
}

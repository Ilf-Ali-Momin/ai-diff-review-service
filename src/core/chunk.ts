/**
 * Greedy packing of whole file segments into chunks.
 *
 * The contract allows chunk boundaries only on file boundaries, so a segment
 * is never split. That constraint is also what makes chunking safe: line
 * numbers come from hunk headers and paths come from file headers, and neither
 * crosses a file boundary, so a chunked scan and an unchunked scan see the
 * same thing.
 */

import { limits } from '../config';
import type { Chunk, FileSegment } from './types';

/**
 * Packs segments into chunks of at most `maxBytes`, measured in UTF 8 bytes.
 *
 * A single segment larger than `maxBytes` becomes its own chunk rather than
 * being split. The contract asks for both "chunks of at most 64 KiB" and "a
 * single file over 64 KiB is its own chunk", which cannot both hold; the file
 * boundary rule is the one it states as a hard constraint, so it wins.
 */
export function chunkSegments(
  segments: FileSegment[],
  maxBytes: number = limits.chunkBytes,
): Chunk[] {
  const chunks: Chunk[] = [];
  let pending: FileSegment[] = [];
  let pendingBytes = 0;

  const flush = (): void => {
    if (pending.length === 0) {
      return;
    }
    chunks.push({
      index: chunks.length,
      text: pending.map((segment) => segment.text).join(''),
      byteLength: pendingBytes,
    });
    pending = [];
    pendingBytes = 0;
  };

  for (const segment of segments) {
    // Start a new chunk before this segment would overflow the current one,
    // never after, so a chunk only exceeds the budget when one file does.
    if (pending.length > 0 && pendingBytes + segment.byteLength > maxBytes) {
      flush();
    }

    pending.push(segment);
    pendingBytes += segment.byteLength;

    if (pendingBytes >= maxBytes) {
      flush();
    }
  }

  flush();
  return chunks;
}

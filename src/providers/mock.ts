import { parseDiff } from '../core/parseDiff';
import { scan } from '../core/rules';
import type { Chunk, Finding } from '../core/types';
import type { Provider } from './types';

/**
 * The deterministic provider, and the one the client scores.
 *
 * Pure: no I/O, no clock, no randomness. The same diff always produces the
 * same findings in the same order, which is the property that makes exact
 * scoring possible at all.
 *
 * Each chunk is parsed on its own rather than reusing the whole file parse.
 * That costs one extra pass over the bytes and buys a real test: if a file
 * boundary ever dropped or duplicated a finding, the chunked versus unchunked
 * property test would catch it, where the shared parse design would have made
 * that test true by definition. See D-022.
 */
export const mockProvider: Provider = {
  name: 'mock',

  // Async to satisfy the interface, not because the work needs it. The llm
  // provider is the one that actually awaits, and the pipeline should not care
  // which of the two it is holding.
  async review(chunks: Chunk[], _signal: AbortSignal): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const chunk of chunks) {
      findings.push(...scan(parseDiff(chunk.text)));
    }

    return findings;
  },
};

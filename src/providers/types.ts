import type { Chunk, Finding } from '../core/types';

export type ProviderName = 'mock' | 'llm';

/**
 * What a provider is, and more importantly what it is not.
 *
 * A provider takes chunks and returns findings. It knows nothing about
 * ordering, deduplication, truncation, caching or streaming: the pipeline owns
 * all of those, once, for every provider. That is what keeps `mock` a pure
 * function and lets the `llm` path be swapped for any vendor without anything
 * leaking into the rest of the service.
 *
 * Findings come back unordered and possibly duplicated. That is expected.
 */
export interface Provider {
  readonly name: ProviderName;
  review(chunks: Chunk[], signal: AbortSignal): Promise<Finding[]>;
}

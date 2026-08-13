import { defineConfig } from 'vitest/config';

/**
 * The black box probe suite, run against a base URL rather than in process.
 *
 * The timeout is generous because these tests cross a real network and one of
 * them deliberately waits out a `Retry-After`.
 */
export default defineConfig({
  test: {
    include: ['test/probe/**/*.probe.ts'],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    // One file, run in order, so the rate limit budget is spent predictably.
    fileParallelism: false,
  },
});

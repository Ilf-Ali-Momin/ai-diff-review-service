import { defineConfig } from 'vitest/config';

/**
 * The unit and in process suites. `test/probe` is excluded deliberately: it
 * needs a running service and a token, and is run separately by `npm run
 * probe` against a base URL.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/probe/**', 'node_modules/**', 'dist/**'],
  },
});

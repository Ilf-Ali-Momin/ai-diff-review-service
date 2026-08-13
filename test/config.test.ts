/**
 * D-041, the empty environment variable.
 *
 * This exists because a blank `LLM_TIMEOUT_MS` made every model request time
 * out on the next tick, and the identical expression governed `PORT`, where
 * the same fault would have bound the deployed service to a random port while
 * every local test still passed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const KEYS = ['PORT', 'LLM_TIMEOUT_MS'] as const;
const saved = new Map<string, string | undefined>();

function setEnv(key: string, value: string | undefined): void {
  if (!saved.has(key)) {
    saved.set(key, process.env[key]);
  }
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  saved.clear();
});

/** config.ts reads the environment once at import, so each case needs a fresh module. */
async function loadConfig(): Promise<typeof import('../src/config')> {
  vi.resetModules();
  return import('../src/config');
}

describe('numeric configuration from the environment', () => {
  it.each([
    ['a blank value', ''],
    ['whitespace only', '   '],
    ['not a number', 'soon'],
    ['zero', '0'],
    ['negative', '-1'],
  ])('falls back to the default for %s', async (_label, value) => {
    for (const key of KEYS) {
      setEnv(key, value);
    }

    const config = await loadConfig();

    expect(config.llm.timeoutMs).toBe(20_000);
    expect(config.env.port).toBe(3000);
  });

  it('falls back when the variable is absent entirely', async () => {
    for (const key of KEYS) {
      setEnv(key, undefined);
    }

    const config = await loadConfig();

    expect(config.llm.timeoutMs).toBe(20_000);
    expect(config.env.port).toBe(3000);
  });

  it('uses a real value when one is given', async () => {
    setEnv('LLM_TIMEOUT_MS', '5000');
    setEnv('PORT', '8080');

    const config = await loadConfig();

    expect(config.llm.timeoutMs).toBe(5000);
    expect(config.env.port).toBe(8080);
  });

  it('never yields NaN, which is the failure this guards against', async () => {
    for (const key of KEYS) {
      setEnv(key, '');
    }

    const config = await loadConfig();

    expect(Number.isNaN(config.llm.timeoutMs)).toBe(false);
    expect(Number.isNaN(config.env.port)).toBe(false);
  });
});

describe('isLlmConfigured', () => {
  it('is false unless all three values are present', async () => {
    const { isLlmConfigured } = await loadConfig();

    expect(isLlmConfigured({ baseUrl: '', apiKey: 'k', model: 'm' })).toBe(false);
    expect(isLlmConfigured({ baseUrl: 'u', apiKey: '', model: 'm' })).toBe(false);
    expect(isLlmConfigured({ baseUrl: 'u', apiKey: 'k', model: '' })).toBe(false);
    expect(isLlmConfigured({ baseUrl: 'u', apiKey: 'k', model: 'm' })).toBe(true);
  });
});

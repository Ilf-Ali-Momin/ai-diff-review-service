import type { FastifyInstance } from 'fastify';
import type { LightMyRequestResponse } from 'fastify';

import type { Finding } from '../../src/core/types';
import { createRateLimiter } from '../../src/http/rateLimit';
import { buildServer, type ServerOptions } from '../../src/http/server';
import type { Usage } from '../../src/jobs/store';
import type { Provider } from '../../src/providers/types';

export const TOKEN = 'test-bearer-token';
export const auth = { authorization: `Bearer ${TOKEN}` };

export type JobView = {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  findings?: Finding[];
  usage: Usage;
  error?: { code: string; message: string };
};

/**
 * Rate limiting is exercised deliberately in rateLimit.test.ts with the real
 * configured numbers. Everywhere else it is turned up out of the way, so that
 * a test file which happens to submit forty times does not start failing for a
 * reason it is not testing.
 */
export function testServer(options: Omit<ServerOptions, 'authToken'> = {}): FastifyInstance {
  return buildServer({
    authToken: TOKEN,
    rateLimiter: createRateLimiter({ capacity: 100_000, refillPerMinute: 100_000 }),
    ...options,
  });
}

/**
 * Posts a raw string body rather than an object, because idempotency hashes
 * the bytes and several probes turn on two bodies being byte identical or
 * deliberately not.
 */
export function post(
  app: FastifyInstance,
  payload: string,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/v1/reviews',
    headers: { ...auth, 'content-type': 'application/json', ...headers },
    payload,
  });
}

export function getJob(
  app: FastifyInstance,
  jobId: string,
  headers: Record<string, string> = auth,
): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'GET', url: `/v1/reviews/${jobId}`, headers });
}

export function body(diff: string, options?: Record<string, unknown>): string {
  return JSON.stringify(options === undefined ? { diff } : { diff, options });
}

export async function waitForTerminal(
  app: FastifyInstance,
  jobId: string,
  timeoutMs = 5000,
): Promise<JobView> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const view = (await getJob(app, jobId)).json() as JobView;
    if (view.status === 'done' || view.status === 'failed') {
      return view;
    }
    if (Date.now() > deadline) {
      throw new Error(`job ${jobId} stayed ${view.status} for ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

/** Submits and waits, for the many probes that only care about the outcome. */
export async function review(app: FastifyInstance, payload: string): Promise<JobView> {
  const accepted = await post(app, payload);
  const { jobId } = accepted.json() as { jobId: string };
  return waitForTerminal(app, jobId);
}

/** A provider that holds its slot long enough for concurrency to be observable. */
export function slowProvider(ms: number, name: 'mock' | 'llm' = 'mock'): Provider {
  return {
    name,
    review: async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return [];
    },
  };
}

export function throwingProvider(message: string, name: 'mock' | 'llm' = 'mock'): Provider {
  return {
    name,
    review: () => Promise.reject(new Error(message)),
  };
}

export function emptyProvider(name: 'mock' | 'llm' = 'llm'): Provider {
  return { name, review: () => Promise.resolve([]) };
}

/** A one file diff whose added lines trip a predictable set of rules. */
export function sampleDiff(marker = 'a'): string {
  return [
    `diff --git a/src/${marker}.ts b/src/${marker}.ts`,
    `--- a/src/${marker}.ts`,
    `+++ b/src/${marker}.ts`,
    '@@ -1,1 +1,4 @@',
    ' const keep = 1;',
    `+console.log("${marker}");`,
    '+// TODO one',
    '+if (x == null) return;',
    '',
  ].join('\n');
}

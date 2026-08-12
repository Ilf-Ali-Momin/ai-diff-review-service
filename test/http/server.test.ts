/**
 * Phase 1 gate: TESTPLAN.md probes 1, 2, 58 and 59, plus the invariant that
 * every non 2xx response leaves through the error envelope.
 *
 * These run against the Fastify instance through `inject`, so they need no
 * port and no network. The probe suite in test/probe runs the same assertions
 * against a base URL later, which is what proves the deployed service behaves
 * like the local one.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { limits, version } from '../../src/config';
import { buildServer } from '../../src/http/server';

const TOKEN = 'phase-one-test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

let app: FastifyInstance;

beforeAll(async () => {
  app = buildServer({ authToken: TOKEN });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

/** Every non 2xx body must be exactly `{ error: { code, message } }`, no more. */
function expectEnvelope(payload: unknown, code: string): void {
  expect(payload).toBeTypeOf('object');
  const body = payload as { error?: { code?: unknown; message?: unknown } };

  expect(Object.keys(body)).toEqual(['error']);
  expect(Object.keys(body.error ?? {}).sort()).toEqual(['code', 'message']);
  expect(body.error?.code).toBe(code);
  expect(body.error?.message).toBeTypeOf('string');
  expect(body.error?.message).not.toBe('');
}

describe('probe 1: GET /health', () => {
  it('returns ok, a semver version and a numeric uptime', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; version: string; uptimeSeconds: number };

    expect(body.status).toBe('ok');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.uptimeSeconds).toBeTypeOf('number');
    expect(Number.isFinite(body.uptimeSeconds)).toBe(true);
  });

  it('reports an uptime that increases between two calls', async () => {
    const first = (await app.inject({ method: 'GET', url: '/health' })).json() as {
      uptimeSeconds: number;
    };
    // Millisecond precision, so a short real delay is enough to see movement.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = (await app.inject({ method: 'GET', url: '/health' })).json() as {
      uptimeSeconds: number;
    };

    expect(second.uptimeSeconds).toBeGreaterThan(first.uptimeSeconds);
  });

  it('is public, with no Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});

describe('probe 2: GET /spec', () => {
  it('matches the document in CONTRACT.md exactly', async () => {
    const res = await app.inject({ method: 'GET', url: '/spec' });

    expect(res.statusCode).toBe(200);
    // Literal values, transcribed from the contract rather than read from
    // config, so that this test can actually fail if config changes.
    expect(res.json()).toEqual({
      specVersion: '1.0',
      providers: ['mock', 'llm'],
      limits: {
        maxPayloadBytes: 1048576,
        chunkBytes: 65536,
        maxConcurrentJobs: 4,
        rateLimitPerMinute: 30,
      },
    });
  });

  it('declares the same limits the runtime enforces', async () => {
    const res = await app.inject({ method: 'GET', url: '/spec' });
    const body = res.json() as { limits: Record<string, number> };

    expect(body.limits).toEqual(limits);
  });

  it('is public, with no Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/spec' });
    expect(res.statusCode).toBe(200);
  });
});

describe('probe 58: an unknown route', () => {
  it('answers 404 through the envelope, not an HTML page', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/nonsense', headers: auth });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expectEnvelope(res.json(), 'not_found');
  });

  it('answers 401 rather than 404 when the caller has no token', async () => {
    // Auth covers the whole /v1 prefix including paths that match no route, so
    // an unauthenticated caller learns nothing about which paths exist. D-014.
    const res = await app.inject({ method: 'GET', url: '/v1/nonsense' });

    expect(res.statusCode).toBe(401);
    expectEnvelope(res.json(), 'unauthorized');
  });

  it('answers the same way outside the /v1 prefix', async () => {
    const res = await app.inject({ method: 'GET', url: '/definitely-not-a-route' });

    expect(res.statusCode).toBe(404);
    expectEnvelope(res.json(), 'not_found');
  });
});

describe('probe 59: a method we do not register', () => {
  it('answers through the envelope rather than a framework default', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/reviews/x', headers: auth });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expectEnvelope(res.json(), 'not_found');
  });

  it('applies to a path that does exist for another method', async () => {
    // /health is registered for GET only. POST must still leave through the envelope.
    const res = await app.inject({ method: 'POST', url: '/health' });

    expect(res.statusCode).toBe(404);
    expectEnvelope(res.json(), 'not_found');
  });
});

describe('invariant 1: unhandled errors leave through the envelope', () => {
  it('turns a thrown exception into internal, never a stack trace', async () => {
    const throwing = buildServer();
    throwing.get('/boom', async () => {
      throw new Error('secret internal detail');
    });
    await throwing.ready();

    const res = await throwing.inject({ method: 'GET', url: '/boom' });

    expect(res.statusCode).toBe(500);
    expectEnvelope(res.json(), 'internal');
    // The thrown message must not reach the client.
    expect(res.body).not.toContain('secret internal detail');

    await throwing.close();
  });
});

describe('D-017: the reported version cannot drift from package.json', () => {
  it('serves the same version package.json declares', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as { version: string };

    expect(pkg.version).toBe(version);
  });
});

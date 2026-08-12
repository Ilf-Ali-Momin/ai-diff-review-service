/**
 * TESTPLAN rows 3 to 6, the auth rows 7 to 12, and the error taxonomy rows
 * 51 to 56 and 60.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { auth, body, getJob, post, review, sampleDiff, testServer, waitForTerminal } from './helpers';

let app: FastifyInstance;

beforeAll(async () => {
  app = testServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

function expectEnvelope(payload: unknown, code: string): void {
  const parsed = payload as { error?: { code?: unknown; message?: unknown } };
  expect(Object.keys(parsed)).toEqual(['error']);
  expect(Object.keys(parsed.error ?? {}).sort()).toEqual(['code', 'message']);
  expect(parsed.error?.code).toBe(code);
  expect(parsed.error?.message).toBeTypeOf('string');
}

describe('probe 3: POST a small diff', () => {
  it('answers 202 with a jobId and a queued status', async () => {
    const res = await post(app, body(sampleDiff()));

    expect(res.statusCode).toBe(202);
    const accepted = res.json() as { jobId: string; status: string };
    expect(accepted.status).toBe('queued');
    expect(accepted.jobId).toBeTypeOf('string');
    expect(accepted.jobId.length).toBeGreaterThan(10);
  });
});

describe('probe 4: poll that jobId', () => {
  it('reaches done with findings and usage', async () => {
    const view = await review(app, body(sampleDiff('poll')));

    expect(view.status).toBe('done');
    expect(view.findings?.map((f) => f.ruleId)).toEqual(['MOCK-007', 'MOCK-008', 'MOCK-005']);
    expect(view.usage.chunks).toBe(1);
    expect(view.usage.inputBytes).toBe(Buffer.byteLength(sampleDiff('poll'), 'utf8'));
    expect(view.usage.cacheHit).toBe(false);
  });
});

describe('probe 5: an unknown jobId', () => {
  it('answers 404 not_found', async () => {
    const res = await getJob(app, 'no-such-job');

    expect(res.statusCode).toBe(404);
    expectEnvelope(res.json(), 'not_found');
  });
});

describe('probe 6: polling immediately after submission', () => {
  it('never reports an undefined status', async () => {
    const accepted = await post(app, body(sampleDiff('immediate')));
    const { jobId } = accepted.json() as { jobId: string };

    const view = (await getJob(app, jobId)).json() as { status: string; usage: unknown };

    expect(['queued', 'running', 'done']).toContain(view.status);
    // usage is complete from creation, so a caller polling a queued job still
    // learns the size of what it submitted. See D-024.
    expect(view.usage).toEqual({
      inputBytes: Buffer.byteLength(sampleDiff('immediate'), 'utf8'),
      chunks: 1,
      cacheHit: false,
    });
  });

  it('omits findings until the job is done', async () => {
    const accepted = await post(app, body(sampleDiff('omit')));
    const { jobId } = accepted.json() as { jobId: string };
    const early = (await getJob(app, jobId)).json() as Record<string, unknown>;

    if (early['status'] !== 'done') {
      expect(early).not.toHaveProperty('findings');
    }

    const finished = await waitForTerminal(app, jobId);
    expect(finished.status).toBe('done');
    expect(finished.findings).toBeDefined();
  });
});

describe('probes 7 to 11: auth on every /v1 route', () => {
  it('probe 7: POST with no Authorization header is 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/reviews',
      headers: { 'content-type': 'application/json' },
      payload: body(sampleDiff()),
    });

    expect(res.statusCode).toBe(401);
    expectEnvelope(res.json(), 'unauthorized');
  });

  it('probe 8: POST with the wrong token is 401', async () => {
    const res = await post(app, body(sampleDiff()), { authorization: 'Bearer not-the-token' });

    expect(res.statusCode).toBe(401);
    expectEnvelope(res.json(), 'unauthorized');
  });

  it('rejects a token of the right length but the wrong bytes', async () => {
    const res = await post(app, body(sampleDiff()), {
      authorization: 'Bearer test-bearer-tokeX',
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects a header that is not a bearer scheme', async () => {
    const res = await post(app, body(sampleDiff()), { authorization: 'Basic dXNlcjpwYXNz' });
    expect(res.statusCode).toBe(401);
  });

  it('probe 9: GET a valid jobId with no token is 401, not 200', async () => {
    const accepted = await post(app, body(sampleDiff('authcheck')));
    const { jobId } = accepted.json() as { jobId: string };

    const res = await getJob(app, jobId, {});

    expect(res.statusCode).toBe(401);
    expectEnvelope(res.json(), 'unauthorized');
  });

  it('probe 10: GET an unknown jobId with no token is 401, not 404', async () => {
    // Auth precedes existence, so an unauthenticated caller cannot use the
    // status code to discover which job ids are real.
    const res = await getJob(app, 'definitely-not-a-job', {});

    expect(res.statusCode).toBe(401);
    expectEnvelope(res.json(), 'unauthorized');
  });

  it('probe 11: GET the stream with no token is 401', async () => {
    // The stream route arrives in Phase 4. The auth hook is keyed on the URL
    // prefix rather than a matched route, so this already answers 401.
    const res = await app.inject({ method: 'GET', url: '/v1/reviews/anything/stream' });

    expect(res.statusCode).toBe(401);
    expectEnvelope(res.json(), 'unauthorized');
  });
});

describe('probes 51 to 56: the error taxonomy', () => {
  it('probe 51: a 2 MiB body is 413, not 400', async () => {
    const oversized = JSON.stringify({ diff: 'x'.repeat(2 * 1024 * 1024) });
    const res = await post(app, oversized);

    expect(res.statusCode).toBe(413);
    expectEnvelope(res.json(), 'payload_too_large');
  });

  it('probe 60: a 2 MiB body with no auth is 401, because auth precedes size', async () => {
    const oversized = JSON.stringify({ diff: 'x'.repeat(2 * 1024 * 1024) });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/reviews',
      headers: { 'content-type': 'application/json' },
      payload: oversized,
    });

    expect(res.statusCode).toBe(401);
    expectEnvelope(res.json(), 'unauthorized');
  });

  it('probe 52: truncated JSON is 400 invalid_json', async () => {
    const res = await post(app, '{"diff":');

    expect(res.statusCode).toBe(400);
    expectEnvelope(res.json(), 'invalid_json');
  });

  it('an empty body is 400 invalid_json', async () => {
    const res = await post(app, '');

    expect(res.statusCode).toBe(400);
    expectEnvelope(res.json(), 'invalid_json');
  });

  it('probe 53: a body with no diff field is 422 invalid_diff', async () => {
    const res = await post(app, '{"notdiff": "x"}');

    expect(res.statusCode).toBe(422);
    expectEnvelope(res.json(), 'invalid_diff');
  });

  it('probe 54: an empty diff is 422', async () => {
    const res = await post(app, '{"diff": ""}');

    expect(res.statusCode).toBe(422);
    expectEnvelope(res.json(), 'invalid_diff');
  });

  it('probe 55: text that is not a unified diff is 422', async () => {
    const res = await post(app, '{"diff": "just some text"}');

    expect(res.statusCode).toBe(422);
    expectEnvelope(res.json(), 'invalid_diff');
  });

  it('a non string diff is 422', async () => {
    const res = await post(app, '{"diff": 42}');

    expect(res.statusCode).toBe(422);
    expectEnvelope(res.json(), 'invalid_diff');
  });

  it('probe 56: unknown body fields are ignored', async () => {
    const payload = JSON.stringify({ diff: sampleDiff('unknownfield'), unknownField: 1 });
    const res = await post(app, payload);

    expect(res.statusCode).toBe(202);
  });
});

describe('D-015: an unusable option value falls back to its default', () => {
  it('ignores a negative maxFindings and uses the default', async () => {
    const view = await review(app, body(sampleDiff('negmax'), { maxFindings: -5 }));

    expect(view.status).toBe('done');
    expect(view.findings).toHaveLength(3);
  });

  it('ignores an unknown provider and uses mock', async () => {
    const view = await review(app, body(sampleDiff('badprov'), { provider: 'banana' }));

    expect(view.status).toBe('done');
    expect(view.findings).toHaveLength(3);
  });

  it('honours a maxFindings of zero, which is a usable value', async () => {
    const view = await review(app, body(sampleDiff('zeromax'), { maxFindings: 0 }));

    expect(view.status).toBe('done');
    expect(view.findings).toEqual([]);
    // usage always reflects the full scan, never the truncation.
    expect(view.usage.chunks).toBe(1);
  });
});

describe('probe 27: maxFindings truncates without changing usage', () => {
  it('returns the first n of the ordered list', async () => {
    const full = await review(app, body(sampleDiff('trunc')));
    const limited = await review(app, body(sampleDiff('trunc'), { maxFindings: 2 }));

    expect(full.findings).toHaveLength(3);
    expect(limited.findings).toHaveLength(2);
    expect(limited.findings).toEqual(full.findings?.slice(0, 2));
    expect(limited.usage.inputBytes).toBe(full.usage.inputBytes);
    expect(limited.usage.chunks).toBe(full.usage.chunks);
  });
});

describe('the ordering the stream and the result must share', () => {
  it('orders findings by path, then line, then ruleId', async () => {
    const diff = sampleDiff('zeta') + sampleDiff('alpha');
    const view = await review(app, body(diff));

    const seen = view.findings?.map((f) => `${f.path}:${f.line}:${f.ruleId}`) ?? [];
    expect(seen).toEqual([...seen].sort());
    expect(view.findings?.[0]?.path).toBe('src/alpha.ts');
  });
});

describe('auth is not required for the public routes', () => {
  it('probe 12: /health and /spec answer 200 with no token', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/spec' })).statusCode).toBe(200);
  });

  it('does not leak the token through an error message', async () => {
    const res = await post(app, body(sampleDiff()), { authorization: 'Bearer wrong' });
    expect(res.body).not.toContain(auth.authorization.split(' ')[1]);
  });
});

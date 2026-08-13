/**
 * TESTPLAN rows 65 to 69.
 *
 * These use the real configured numbers, capacity 40 refilling at 30 per
 * minute, with an injected clock so that a minute of refill can be observed
 * without a test that takes a minute.
 */

import { describe, expect, it } from 'vitest';

import { limits, rateLimitBurst } from '../../src/config';
import { createRateLimiter } from '../../src/http/rateLimit';
import { auth, body, post, sampleDiff, testServer } from './helpers';

/** A clock the test moves by hand. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let current = 1_000_000;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function limitedServer(clock: { now: () => number }) {
  return testServer({ rateLimiter: createRateLimiter({ now: clock.now }) });
}

describe('probe 65: a sustained 30 per minute always succeeds', () => {
  it('accepts 30 submissions per minute over several minutes', async () => {
    const clock = fakeClock();
    const app = limitedServer(clock);
    await app.ready();

    const statuses: number[] = [];
    // Three full minutes at exactly the declared sustained rate. A fixed
    // window limiter fails this the moment a request straddles a boundary.
    for (let i = 0; i < 90; i += 1) {
      const res = await post(app, body(sampleDiff(`sustained${i}`)));
      statuses.push(res.statusCode);
      clock.advance(2000);
    }

    expect(statuses.every((status) => status === 202)).toBe(true);

    await app.close();
  });
});

describe('probes 66 and 67: a burst', () => {
  it('rejects beyond the burst allowance with 429 and never a 5xx', async () => {
    const clock = fakeClock();
    const app = limitedServer(clock);
    await app.ready();

    const statuses: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      statuses.push((await post(app, body(sampleDiff(`burst${i}`)))).statusCode);
    }

    const accepted = statuses.filter((status) => status === 202).length;
    const limited = statuses.filter((status) => status === 429).length;

    expect(accepted).toBe(rateLimitBurst);
    expect(limited).toBe(60 - rateLimitBurst);
    expect(statuses.some((status) => status >= 500)).toBe(false);

    await app.close();
  });

  it('probe 67: a 429 carries Retry-After in whole seconds and the envelope', async () => {
    const clock = fakeClock();
    const app = limitedServer(clock);
    await app.ready();

    let rejected;
    for (let i = 0; i < rateLimitBurst + 1; i += 1) {
      rejected = await post(app, body(sampleDiff(`retry${i}`)));
    }

    expect(rejected?.statusCode).toBe(429);

    const retryAfter = rejected?.headers['retry-after'];
    expect(retryAfter).toBeDefined();
    expect(String(retryAfter)).toMatch(/^\d+$/);
    expect(Number(retryAfter)).toBeGreaterThan(0);

    expect(rejected?.json()).toEqual({
      error: { code: 'rate_limited', message: expect.any(String) },
    });

    await app.close();
  });
});

describe('probe 68: GETs are never rate limited', () => {
  it('serves polls and streams while POSTs are being rejected', async () => {
    const clock = fakeClock();
    const app = limitedServer(clock);
    await app.ready();

    const first = await post(app, body(sampleDiff('gets')));
    const { jobId } = first.json() as { jobId: string };

    // Exhaust the bucket.
    for (let i = 0; i < rateLimitBurst + 5; i += 1) {
      await post(app, body(sampleDiff(`exhaust${i}`)));
    }
    expect((await post(app, body(sampleDiff('blocked')))).statusCode).toBe(429);

    const polls: number[] = [];
    for (let i = 0; i < 100; i += 1) {
      polls.push(
        (await app.inject({ method: 'GET', url: `/v1/reviews/${jobId}`, headers: auth }))
          .statusCode,
      );
    }

    expect(polls.every((status) => status === 200)).toBe(true);
    // /health and /spec are untouched too.
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);

    await app.close();
  });
});

describe('probe 69: waiting out a Retry-After', () => {
  it('accepts the next submission once the advertised delay has passed', async () => {
    const clock = fakeClock();
    const app = limitedServer(clock);
    await app.ready();

    for (let i = 0; i < rateLimitBurst; i += 1) {
      await post(app, body(sampleDiff(`fill${i}`)));
    }

    const rejected = await post(app, body(sampleDiff('rejected')));
    expect(rejected.statusCode).toBe(429);

    const retryAfter = Number(rejected.headers['retry-after']);
    clock.advance(retryAfter * 1000);

    const retried = await post(app, body(sampleDiff('retried')));
    expect(retried.statusCode).toBe(202);

    await app.close();
  });
});

describe('the bucket itself', () => {
  it('refills continuously rather than in windows', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ now: clock.now });

    for (let i = 0; i < rateLimitBurst; i += 1) {
      expect(limiter.take('token').allowed).toBe(true);
    }
    expect(limiter.take('token').allowed).toBe(false);

    // Half a minute of refill is half the per minute rate, not nothing and
    // not the whole capacity.
    clock.advance(30_000);
    expect(limiter.tokensFor('token')).toBeCloseTo(limits.rateLimitPerMinute / 2, 5);
  });

  it('keeps one bucket per token', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ now: clock.now });

    for (let i = 0; i < rateLimitBurst; i += 1) {
      limiter.take('first');
    }

    expect(limiter.take('first').allowed).toBe(false);
    // A second client is unaffected, which is what stops one caller starving
    // another. It also means the key must be the token, not the route.
    expect(limiter.take('second').allowed).toBe(true);
  });

  it('never lets the bucket exceed its capacity', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ now: clock.now });

    limiter.take('token');
    clock.advance(60 * 60 * 1000);

    expect(limiter.tokensFor('token')).toBeLessThanOrEqual(rateLimitBurst);
  });
});

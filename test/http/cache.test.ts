/**
 * TESTPLAN rows 43 to 50.
 *
 * Caching and idempotency are two mechanisms that are easy to conflate. They
 * are keyed differently and they return different things: idempotency returns
 * the same job, caching returns a new job that did not redo the work.
 */

import { describe, expect, it } from 'vitest';

import type { Chunk, Finding } from '../../src/core/types';
import { mockProvider } from '../../src/providers/mock';
import type { Provider } from '../../src/providers/types';
import {
  body,
  emptyProvider,
  post,
  review,
  sampleDiff,
  testServer,
  throwingProvider,
  waitForTerminal,
} from './helpers';

/** Wraps the real provider so a test can prove work was or was not repeated. */
function countingProvider(inner: Provider = mockProvider): {
  provider: Provider;
  calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    provider: {
      name: 'mock',
      review: (chunks: Chunk[], signal: AbortSignal): Promise<Finding[]> => {
        calls += 1;
        return inner.review(chunks, signal);
      },
    },
  };
}

describe('probes 43 and 44: caching by diff and provider', () => {
  it('reports cacheHit false first and true afterwards, with identical findings', async () => {
    const app = testServer();
    await app.ready();

    const payload = body(sampleDiff('cache'));
    const first = await review(app, payload);
    const second = await review(app, payload);

    expect(first.usage.cacheHit).toBe(false);
    expect(second.usage.cacheHit).toBe(true);
    expect(second.findings).toEqual(first.findings);

    await app.close();
  });

  it('does not run the provider a second time', async () => {
    const counting = countingProvider();
    const app = testServer({ providers: { mock: counting.provider } });
    await app.ready();

    const payload = body(sampleDiff('nowork'));
    await review(app, payload);
    await review(app, payload);

    expect(counting.calls()).toBe(1);

    await app.close();
  });

  it('D-023: concurrent duplicates share one scan rather than both doing it', async () => {
    const counting = countingProvider();
    const app = testServer({ providers: { mock: counting.provider } });
    await app.ready();

    const payload = body(sampleDiff('concurrent'));
    const accepted = await Promise.all([post(app, payload), post(app, payload), post(app, payload)]);
    const ids = accepted.map((res) => (res.json() as { jobId: string }).jobId);
    const views = await Promise.all(ids.map((id) => waitForTerminal(app, id)));

    expect(new Set(ids).size).toBe(3);
    expect(counting.calls()).toBe(1);
    expect(views.every((view) => view.status === 'done')).toBe(true);
    // Every one of them returns the same findings, whichever did the work.
    expect(views[1]?.findings).toEqual(views[0]?.findings);
    expect(views[2]?.findings).toEqual(views[0]?.findings);

    await app.close();
  });

  it('does not cache a failure, so a later submission tries again', async () => {
    const app = testServer({ providers: { mock: throwingProvider('provider exploded') } });
    await app.ready();

    const payload = body(sampleDiff('failure'));
    const first = await review(app, payload);
    const second = await review(app, payload);

    expect(first.status).toBe('failed');
    expect(first.error?.message).toContain('provider exploded');
    // A cached rejection would make this one report cacheHit true and fail for
    // a reason that no longer applies.
    expect(second.usage.cacheHit).toBe(false);

    await app.close();
  });

  it('probe 50: a different provider is a different cache key', async () => {
    const app = testServer({ providers: { llm: emptyProvider('llm') } });
    await app.ready();

    const diff = sampleDiff('providerkey');
    const viaMock = await review(app, body(diff));
    const viaLlm = await review(app, body(diff, { provider: 'llm' }));

    expect(viaMock.usage.cacheHit).toBe(false);
    expect(viaLlm.usage.cacheHit).toBe(false);
    expect(viaLlm.findings).toEqual([]);

    await app.close();
  });
});

describe('probe 49: maxFindings is not part of the cache key', () => {
  it('shares one scan across two limits and truncates correctly for each', async () => {
    const counting = countingProvider();
    const app = testServer({ providers: { mock: counting.provider } });
    await app.ready();

    const diff = sampleDiff('limits');
    const narrow = await review(app, body(diff, { maxFindings: 1 }));
    const wide = await review(app, body(diff, { maxFindings: 100 }));

    expect(counting.calls()).toBe(1);
    expect(narrow.findings).toHaveLength(1);
    // The decisive assertion for D-009. Caching the truncated list instead of
    // the full one would silently answer this second request with one finding.
    expect(wide.findings).toHaveLength(3);
    expect(wide.usage.cacheHit).toBe(true);
    expect(narrow.findings?.[0]).toEqual(wide.findings?.[0]);

    await app.close();
  });
});

describe('probes 45 to 48: idempotency', () => {
  it('probe 45: the same key and a byte identical body returns the same jobId', async () => {
    const app = testServer();
    await app.ready();

    const payload = body(sampleDiff('idem'));
    const first = await post(app, payload, { 'idempotency-key': 'key-1' });
    const second = await post(app, payload, { 'idempotency-key': 'key-1' });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect((second.json() as { jobId: string }).jobId).toBe(
      (first.json() as { jobId: string }).jobId,
    );
    // Always queued, even when the replayed job has already finished. D-026.
    expect((second.json() as { status: string }).status).toBe('queued');

    await app.close();
  });

  it('probe 46: the same key with a different body is 409', async () => {
    const app = testServer();
    await app.ready();

    await post(app, body(sampleDiff('one')), { 'idempotency-key': 'key-2' });
    const conflict = await post(app, body(sampleDiff('two')), { 'idempotency-key': 'key-2' });

    expect(conflict.statusCode).toBe(409);
    expect((conflict.json() as { error: { code: string } }).error.code).toBe(
      'idempotency_conflict',
    );

    await app.close();
  });

  it('probe 47: the same JSON with reordered keys is 409, because bytes are bytes', async () => {
    const app = testServer();
    await app.ready();

    const diff = sampleDiff('reorder');
    const original = JSON.stringify({ diff, options: { maxFindings: 5 } });
    const reordered = JSON.stringify({ options: { maxFindings: 5 }, diff });

    // Semantically identical documents, different bytes.
    expect(JSON.parse(original)).toEqual(JSON.parse(reordered));
    expect(original).not.toBe(reordered);

    await post(app, original, { 'idempotency-key': 'key-3' });
    const conflict = await post(app, reordered, { 'idempotency-key': 'key-3' });

    expect(conflict.statusCode).toBe(409);

    await app.close();
  });

  it('probe 48: a different key with the same body is a new job that still hits the cache', async () => {
    const app = testServer();
    await app.ready();

    const payload = body(sampleDiff('twokeys'));
    const first = await post(app, payload, { 'idempotency-key': 'key-4' });
    const second = await post(app, payload, { 'idempotency-key': 'key-5' });

    const firstId = (first.json() as { jobId: string }).jobId;
    const secondId = (second.json() as { jobId: string }).jobId;
    expect(secondId).not.toBe(firstId);

    const view = await waitForTerminal(app, secondId);
    expect(view.usage.cacheHit).toBe(true);

    await app.close();
  });

  it('treats an absent key as no idempotency handling at all', async () => {
    const app = testServer();
    await app.ready();

    const payload = body(sampleDiff('nokey'));
    const first = await post(app, payload);
    const second = await post(app, payload);

    expect((second.json() as { jobId: string }).jobId).not.toBe(
      (first.json() as { jobId: string }).jobId,
    );

    await app.close();
  });
});

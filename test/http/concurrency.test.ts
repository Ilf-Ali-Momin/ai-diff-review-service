/**
 * Probes 70 to 74.
 *
 * Every diff here is distinct on purpose. Identical diffs would share one scan
 * through the cache and the test would measure deduplication rather than
 * concurrency.
 */

import { describe, expect, it } from 'vitest';

import { limits } from '../../src/config';
import { createQueue } from '../../src/jobs/queue';
import {
  body,
  post,
  review,
  sampleDiff,
  slowProvider,
  testServer,
  throwingProvider,
  waitForTerminal,
} from './helpers';

describe('probes 70 and 71: four run at once and the fifth queues', () => {
  it('reaches the declared concurrency and completes the overflow', async () => {
    const queue = createQueue();
    const app = testServer({ queue, providers: { mock: slowProvider(80) } });
    await app.ready();

    const accepted = await Promise.all(
      Array.from({ length: 5 }, (_, i) => post(app, body(sampleDiff(`conc${i}`)))),
    );

    expect(accepted.every((res) => res.statusCode === 202)).toBe(true);

    // Four hold slots, the fifth is accepted and waiting. It was never
    // rejected and it never blocked the HTTP thread.
    expect(queue.active).toBe(limits.maxConcurrentJobs);
    expect(queue.waiting).toBe(1);

    const ids = accepted.map((res) => (res.json() as { jobId: string }).jobId);
    const views = await Promise.all(ids.map((id) => waitForTerminal(app, id, 10000)));

    expect(views.map((view) => view.status)).toEqual(Array(5).fill('done'));
    expect(queue.peakActive).toBe(limits.maxConcurrentJobs);
    // Every slot came back. A leaked slot would leave this above zero.
    expect(queue.active).toBe(0);
    expect(queue.waiting).toBe(0);

    await app.close();
  });
});

describe('probe 73: ten jobs at once', () => {
  it('all reach done and none stick in running', async () => {
    const queue = createQueue();
    const app = testServer({ queue, providers: { mock: slowProvider(20) } });
    await app.ready();

    const accepted = await Promise.all(
      Array.from({ length: 10 }, (_, i) => post(app, body(sampleDiff(`ten${i}`)))),
    );
    const ids = accepted.map((res) => (res.json() as { jobId: string }).jobId);
    const views = await Promise.all(ids.map((id) => waitForTerminal(app, id, 10000)));

    expect(views.every((view) => view.status === 'done')).toBe(true);
    expect(queue.active).toBe(0);
    expect(queue.peakActive).toBeLessThanOrEqual(limits.maxConcurrentJobs);

    await app.close();
  });
});

describe('probe 72: the latency budget', () => {
  it('finishes a 64 KiB diff well inside 30 seconds', async () => {
    const app = testServer();
    await app.ready();

    const lines: string[] = [];
    while (Buffer.byteLength(lines.join('\n'), 'utf8') < 64 * 1024) {
      const i = lines.length;
      lines.push(i % 5 === 0 ? `+  console.log("line ${i}");` : `+  const value${i} = ${i};`);
    }
    const diff = [
      'diff --git a/src/big.ts b/src/big.ts',
      '--- a/src/big.ts',
      '+++ b/src/big.ts',
      `@@ -1,1 +1,${lines.length} @@`,
      ...lines,
      '',
    ].join('\n');

    expect(Buffer.byteLength(diff, 'utf8')).toBeGreaterThan(64 * 1024);

    const started = Date.now();
    const view = await review(app, body(diff, { maxFindings: 1000 }));
    const elapsed = Date.now() - started;

    expect(view.status).toBe('done');
    expect(view.findings?.length).toBeGreaterThan(100);
    expect(elapsed).toBeLessThan(30_000);

    await app.close();
  });
});

describe('probe 74: a job that throws internally', () => {
  it('fails that job alone and leaves the service healthy', async () => {
    const queue = createQueue();
    const app = testServer({ queue, providers: { mock: throwingProvider('synthetic failure') } });
    await app.ready();

    const view = await review(app, body(sampleDiff('boom')));

    expect(view.status).toBe('failed');
    expect(view.error?.message).toContain('synthetic failure');
    expect(view).not.toHaveProperty('findings');

    // The slot was released in the finally, so the service can still work.
    expect(queue.active).toBe(0);

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect((health.json() as { status: string }).status).toBe('ok');

    await app.close();
  });

  it('keeps serving other jobs after one fails', async () => {
    const app = testServer();
    await app.ready();

    const failing = testServer({ providers: { mock: throwingProvider('one bad job') } });
    await failing.ready();
    await review(failing, body(sampleDiff('bad')));
    await failing.close();

    const good = await review(app, body(sampleDiff('good')));
    expect(good.status).toBe('done');

    await app.close();
  });
});

describe('the semaphore itself', () => {
  it('hands a released slot to the longest waiter, in order', async () => {
    const queue = createQueue(1);
    const order: number[] = [];
    const started: Array<Promise<void>> = [];

    for (let i = 0; i < 4; i += 1) {
      started.push(
        queue.run(async () => {
          order.push(i);
          await new Promise((resolve) => setTimeout(resolve, 5));
        }),
      );
    }

    await Promise.all(started);

    expect(order).toEqual([0, 1, 2, 3]);
    expect(queue.active).toBe(0);
    expect(queue.waiting).toBe(0);
  });

  it('releases the slot even when the task throws', async () => {
    const queue = createQueue(1);

    await expect(
      queue.run(() => Promise.reject(new Error('task failed'))),
    ).rejects.toThrow('task failed');

    expect(queue.active).toBe(0);
    // The slot is available again, which a leak would prevent.
    await queue.run(() => Promise.resolve());
    expect(queue.active).toBe(0);
  });
});

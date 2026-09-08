/**
 * Probes 34 to 42.
 *
 * These run against a real listening socket rather than through `inject`,
 * because the framing, the flush behavior and the headers that stop a proxy
 * buffering are exactly what is being tested, and an in process injection
 * would prove none of them.
 */

import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import type { Chunk, Finding } from '../../src/core/types';
import { mockProvider } from '../../src/providers/mock';
import type { Provider } from '../../src/providers/types';
import { auth, body, post, sampleDiff, testServer, throwingProvider } from './helpers';

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((app) => app.close()));
});

async function listening(options: Parameters<typeof testServer>[0] = {}): Promise<{
  app: FastifyInstance;
  base: string;
}> {
  const app = testServer(options);
  servers.push(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  return { app, base: `http://127.0.0.1:${address.port}` };
}

type SseEvent = { id: string; event: string; data: string };

function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '' && !block.startsWith(':'))
    .map((block) => {
      const fields: Record<string, string> = {};
      for (const line of block.split('\n')) {
        const separator = line.indexOf(': ');
        if (separator !== -1) {
          fields[line.slice(0, separator)] = line.slice(separator + 2);
        }
      }
      return {
        id: fields['id'] ?? '',
        event: fields['event'] ?? '',
        data: fields['data'] ?? '',
      };
    });
}

async function readStream(
  base: string,
  jobId: string,
): Promise<{ status: number; contentType: string | null; accel: string | null; text: string }> {
  const res = await fetch(`${base}/v1/reviews/${jobId}/stream`, { headers: auth });
  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    accel: res.headers.get('x-accel-buffering'),
    text: await res.text(),
  };
}

async function submit(app: FastifyInstance, diff: string, options?: Record<string, unknown>) {
  const res = await post(app, body(diff, options));
  return (res.json() as { jobId: string }).jobId;
}

/** A provider that blocks until released, so a job can be observed mid flight. */
function gatedProvider(): { provider: Provider; release: () => void } {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });

  return {
    release: () => open(),
    provider: {
      name: 'mock',
      review: async (chunks: Chunk[], signal: AbortSignal): Promise<Finding[]> => {
        await gate;
        return mockProvider.review(chunks, signal);
      },
    },
  };
}

async function waitForStatus(base: string, jobId: string, status: string): Promise<void> {
  const deadline = Date.now() + 3000;

  for (;;) {
    const res = await fetch(`${base}/v1/reviews/${jobId}`, { headers: auth });
    if (((await res.json()) as { status: string }).status === status) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`job never reached ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

describe('probes 34, 39 and 42: the shape of a stream', () => {
  it('emits status transitions, one finding each, then done, and closes', async () => {
    const { app, base } = await listening();
    const jobId = await submit(app, sampleDiff('stream'));

    const stream = await readStream(base, jobId);
    const events = parseSse(stream.text);

    expect(stream.status).toBe(200);
    expect(stream.contentType).toMatch(/text\/event-stream/);
    expect(stream.accel).toBe('no');

    expect(events.map((e) => e.event)).toEqual([
      'status',
      'status',
      'finding',
      'finding',
      'finding',
      'status',
      'done',
    ]);

    expect(JSON.parse(events[0]?.data ?? '')).toEqual({ status: 'queued' });
    expect(JSON.parse(events[1]?.data ?? '')).toEqual({ status: 'running' });
    expect(JSON.parse(events[5]?.data ?? '')).toEqual({ status: 'done' });

    const done = JSON.parse(events[6]?.data ?? '') as { total: number; usage: unknown };
    expect(done.total).toBe(3);
    expect(done.usage).toEqual({ inputBytes: expect.any(Number), chunks: 1, cacheHit: false });
  });

  it('carries a sequence number on every event', async () => {
    const { app, base } = await listening();
    const jobId = await submit(app, sampleDiff('seq'));

    const events = parseSse((await readStream(base, jobId)).text);

    expect(events.map((e) => e.id)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
  });

  it('probe 39: total counts the events emitted, so truncation moves it', async () => {
    const { app, base } = await listening();
    const jobId = await submit(app, sampleDiff('total'), { maxFindings: 2 });

    const events = parseSse((await readStream(base, jobId)).text);
    const findings = events.filter((e) => e.event === 'finding');
    const done = JSON.parse(events.at(-1)?.data ?? '') as {
      total: number;
      usage: { chunks: number };
    };

    expect(findings).toHaveLength(2);
    expect(done.total).toBe(2);
    // usage still describes the full scan, unaffected by truncation.
    expect(done.usage.chunks).toBe(1);
  });
});

describe('probe 35: stream order matches the result order', () => {
  it('emits findings in the same order the JSON result returns them', async () => {
    const { app, base } = await listening();
    const diff = sampleDiff('zeta') + sampleDiff('alpha');
    const jobId = await submit(app, diff);

    const events = parseSse((await readStream(base, jobId)).text);
    const streamed = events
      .filter((e) => e.event === 'finding')
      .map((e) => (JSON.parse(e.data) as Finding).id);

    const polled = await fetch(`${base}/v1/reviews/${jobId}`, { headers: auth });
    const result = (await polled.json()) as { findings: Finding[] };

    // One ordering function, called once, feeding both. Invariant 4.
    expect(streamed).toEqual(result.findings.map((f) => f.id));

    // And that shared order is the contract's: path, then line, then ruleId.
    // Note this is not the order the ids sort in, since the id begins with the
    // ruleId, which is why the assertion is written on the fields.
    const keys = result.findings.map((f) => [f.path, f.line, f.ruleId] as const);
    expect(keys).toEqual(
      [...keys].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1])),
    );
    expect(keys[0]?.[0]).toBe('src/alpha.ts');
  });
});

describe('probe 36: replay', () => {
  it('gives a late connection byte for byte what a live one received', async () => {
    const gate = gatedProvider();
    const { app, base } = await listening({ providers: { mock: gate.provider } });
    const jobId = await submit(app, sampleDiff('replay'));

    // Opened while the job is still running, so this connection sees the
    // findings arrive live rather than as replay.
    const live = readStream(base, jobId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    gate.release();
    const liveResult = await live;

    // Opened after the job finished. Nothing about the two connections is the
    // same except the log they both read from.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const replayed = await readStream(base, jobId);

    expect(replayed.text).toBe(liveResult.text);
    expect(parseSse(replayed.text).at(-1)?.event).toBe('done');
  });

  it('replays identically however long the job has been finished', async () => {
    const { app, base } = await listening();
    const jobId = await submit(app, sampleDiff('twice'));

    const first = await readStream(base, jobId);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const second = await readStream(base, jobId);

    expect(second.text).toBe(first.text);
  });
});

describe('probe 37: connecting midway', () => {
  it('replays what happened, then delivers the rest, with no gap and no duplicate', async () => {
    const gate = gatedProvider();
    const { app, base } = await listening({ providers: { mock: gate.provider } });
    const jobId = await submit(app, sampleDiff('midway'));

    // Connect only once the worker has actually started, so the queued and
    // running events are already in the log and have to arrive as replay.
    await waitForStatus(base, jobId, 'running');

    const pending = readStream(base, jobId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    gate.release();
    const events = parseSse((await pending).text);

    expect(events.map((e) => e.event)).toEqual([
      'status',
      'status',
      'finding',
      'finding',
      'finding',
      'status',
      'done',
    ]);
    // Every sequence number appears exactly once and in order.
    expect(events.map((e) => e.id)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
  });
});

describe('probe 38: two concurrent streams on one job', () => {
  it('gives both the full sequence', async () => {
    const gate = gatedProvider();
    const { app, base } = await listening({ providers: { mock: gate.provider } });
    const jobId = await submit(app, sampleDiff('two'));

    const first = readStream(base, jobId);
    const second = readStream(base, jobId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    gate.release();

    const [a, b] = await Promise.all([first, second]);

    expect(a.text).toBe(b.text);
    expect(parseSse(a.text)).toHaveLength(7);
  });
});

describe('probe 40: streaming a failed job', () => {
  it('terminates cleanly at the failed status, with no done event', async () => {
    const { app, base } = await listening({
      providers: { mock: throwingProvider('stream failure') },
    });
    const jobId = await submit(app, sampleDiff('failstream'));

    const events = parseSse((await readStream(base, jobId)).text);

    expect(events.map((e) => e.event)).toEqual(['status', 'status', 'status']);
    expect(JSON.parse(events.at(-1)?.data ?? '')).toEqual({ status: 'failed' });
    expect(events.some((e) => e.event === 'done')).toBe(false);
  });
});

describe('probe 41: streaming a cached job', () => {
  it('produces the same full sequence as the job that did the work', async () => {
    const { app, base } = await listening();
    const diff = sampleDiff('cachedstream');

    const firstId = await submit(app, diff);
    const firstStream = await readStream(base, firstId);

    const secondId = await submit(app, diff);
    const secondStream = await readStream(base, secondId);

    const firstEvents = parseSse(firstStream.text);
    const secondEvents = parseSse(secondStream.text);

    expect(secondEvents.map((e) => e.event)).toEqual(firstEvents.map((e) => e.event));
    expect(
      secondEvents.filter((e) => e.event === 'finding').map((e) => e.data),
    ).toEqual(firstEvents.filter((e) => e.event === 'finding').map((e) => e.data));

    // The only difference between the two streams is the cacheHit flag.
    const done = JSON.parse(secondEvents.at(-1)?.data ?? '') as {
      usage: { cacheHit: boolean };
    };
    expect(done.usage.cacheHit).toBe(true);
  });
});

describe('the stream endpoint under the error taxonomy', () => {
  it('answers 404 through the envelope for an unknown job', async () => {
    const { base } = await listening();
    const res = await fetch(`${base}/v1/reviews/nope/stream`, { headers: auth });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'not_found', message: expect.any(String) },
    });
  });

  it('answers 401 with no token', async () => {
    const { base } = await listening();
    const res = await fetch(`${base}/v1/reviews/nope/stream`);

    expect(res.status).toBe(401);
  });
});

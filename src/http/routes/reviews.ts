import { createHash } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { defaults, limits } from '../../config';
import { chunkSegments } from '../../core/chunk';
import { parseDiff } from '../../core/parseDiff';
import type { Chunk } from '../../core/types';
import {
  createDeferred,
  type Job,
  type JobEvent,
  type JobStatus,
  type JobStore,
  type ScanResult,
} from '../../jobs/store';
import type { Queue } from '../../jobs/queue';
import { runJob } from '../../jobs/worker';
import type { Provider, ProviderName } from '../../providers/types';
import { ApiError } from '../errors';

export type ReviewsDeps = {
  store: JobStore;
  queue: Queue;
  providers: Record<ProviderName, Provider>;
};

/** Set by the JSON parser so idempotency can hash the bytes, not the object. */
type RequestWithRawBody = FastifyRequest & { rawBody?: Buffer };

function sha256(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Reads `options`, falling back to the documented default for any value we
 * cannot use. The taxonomy has no code for a bad option and `invalid_diff`
 * would misreport the cause, so leniency is the consistent reading. See D-015.
 */
function readOptions(body: Record<string, unknown>): {
  provider: ProviderName;
  maxFindings: number;
} {
  const options =
    typeof body['options'] === 'object' && body['options'] !== null
      ? (body['options'] as Record<string, unknown>)
      : {};

  const requestedProvider = options['provider'];
  const provider: ProviderName =
    requestedProvider === 'mock' || requestedProvider === 'llm'
      ? requestedProvider
      : defaults.provider;

  const requestedMax = options['maxFindings'];
  const maxFindings =
    typeof requestedMax === 'number' && Number.isInteger(requestedMax) && requestedMax >= 0
      ? requestedMax
      : defaults.maxFindings;

  return { provider, maxFindings };
}

/** Everything the worker needs, decided while the request is still in hand. */
function planJob(
  deps: ReviewsDeps,
  diff: string,
  provider: ProviderName,
  maxFindings: number,
  chunks: Chunk[],
): { job: Job; start: () => void } {
  const cacheKey = `${provider}:${sha256(diff)}`;
  const existing = deps.store.cache.get(cacheKey);

  const cacheHit = existing !== undefined;
  const cacheEntry = existing ?? createDeferred<ScanResult>();
  if (existing === undefined) {
    deps.store.cache.set(cacheKey, cacheEntry);
  }

  const job = deps.store.createJob({
    provider,
    maxFindings,
    usage: {
      inputBytes: Buffer.byteLength(diff, 'utf8'),
      chunks: chunks.length,
      cacheHit,
    },
  });

  return {
    job,
    start: () => {
      void runJob(
        { job, chunks, cacheKey, cacheEntry, isCacheOwner: !cacheHit },
        { store: deps.store, queue: deps.queue, provider: deps.providers[provider] },
      );
    },
  };
}

/** Long enough to be invisible on a normal job, short enough for any proxy. */
const HEARTBEAT_MS = 15_000;

function isTerminal(status: JobStatus): boolean {
  return status === 'done' || status === 'failed';
}

/**
 * The last event a stream will ever see.
 *
 * A successful job ends with `done`. A failed one ends at its status event,
 * because the contract defines `done` as a completion event and a failure does
 * not fabricate one. See D-028.
 */
function isFinalEvent(event: JobEvent): boolean {
  if (event.type === 'done') {
    return true;
  }
  return event.type === 'status' && event.data.status === 'failed';
}

/**
 * SSE framing. `id` carries the sequence number so the sequence is self
 * describing, though `Last-Event-ID` is deliberately not honored. See D-034.
 */
function formatEvent(event: JobEvent): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

function accepted(reply: FastifyReply, job: Job): FastifyReply {
  // Always `queued`, even for an idempotent replay of a finished job, because
  // the contract writes this body as a literal. See D-026.
  return reply.status(202).send({ jobId: job.id, status: 'queued' });
}

export function createReviewsRoutes(deps: ReviewsDeps): FastifyPluginAsync {
  return async (app) => {
    app.post('/v1/reviews', async (request, reply) => {
      const body = request.body;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new ApiError('invalid_diff', 'the request body must be a JSON object');
      }

      const record = body as Record<string, unknown>;
      const diff = record['diff'];

      if (typeof diff !== 'string' || diff === '') {
        throw new ApiError('invalid_diff', 'a non empty diff string is required');
      }

      // The one parse. It decides 422 here and its segments feed chunking, so
      // the worker never parses the whole document again. See D-024.
      const parsed = parseDiff(diff);
      if (parsed.hunkCount === 0) {
        throw new ApiError('invalid_diff', 'the diff could not be parsed as a unified diff');
      }

      const { provider, maxFindings } = readOptions(record);
      const chunks = chunkSegments(parsed.segments);

      const idempotencyKey = request.headers['idempotency-key'];
      const rawBody = (request as RequestWithRawBody).rawBody ?? Buffer.alloc(0);
      const bodyHash = sha256(rawBody);

      if (typeof idempotencyKey === 'string' && idempotencyKey !== '') {
        const previous = deps.store.idempotency.get(idempotencyKey);

        if (previous !== undefined) {
          if (previous.bodyHash !== bodyHash) {
            throw new ApiError(
              'idempotency_conflict',
              'this Idempotency-Key was already used with a different body',
            );
          }

          const existingJob = deps.store.getJob(previous.jobId);
          if (existingJob !== undefined) {
            return accepted(reply, existingJob);
          }
        }

        const planned = planJob(deps, diff, provider, maxFindings, chunks);
        deps.store.idempotency.set(idempotencyKey, { bodyHash, jobId: planned.job.id });
        planned.start();
        return accepted(reply, planned.job);
      }

      const planned = planJob(deps, diff, provider, maxFindings, chunks);
      planned.start();
      return accepted(reply, planned.job);
    });

    app.get<{ Params: { jobId: string } }>('/v1/reviews/:jobId', async (request, reply) => {
      const job = deps.store.getJob(request.params.jobId);
      if (job === undefined) {
        throw new ApiError('not_found', 'no job with that id');
      }

      // `findings` only when done, `error` only when failed. See D-027.
      const payload: Record<string, unknown> = {
        jobId: job.id,
        status: job.status,
        usage: job.usage,
      };

      if (job.status === 'done') {
        payload['findings'] = job.findings;
      }
      if (job.status === 'failed' && job.error !== undefined) {
        payload['error'] = job.error;
      }

      return reply.status(200).send(payload);
    });

    app.get<{ Params: { jobId: string } }>('/v1/reviews/:jobId/stream', async (request, reply) => {
      const job = deps.store.getJob(request.params.jobId);
      if (job === undefined) {
        // Thrown before hijacking, while Fastify can still send an envelope.
        throw new ApiError('not_found', 'no job with that id');
      }

      reply.hijack();
      const socket = reply.raw;

      socket.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        // The failure that survives local testing and breaks behind a proxy:
        // nginx buffers the stream and delivers it all at once on close.
        'X-Accel-Buffering': 'no',
      });

      /**
       * Replay, then subscribe, with no `await` between the two. Node runs this
       * block to completion before any worker can append, which is what makes
       * a mid flight connection see every event exactly once. See D-032.
       */
      for (const event of job.events) {
        socket.write(formatEvent(event));
      }

      if (isTerminal(job.status)) {
        socket.end();
        return;
      }

      let heartbeat: NodeJS.Timeout | undefined;
      const close = (): void => {
        unsubscribe();
        if (heartbeat !== undefined) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
      };

      const unsubscribe = deps.store.subscribe(job, (event) => {
        socket.write(formatEvent(event));
        if (isFinalEvent(event)) {
          close();
          socket.end();
        }
      });

      // A comment, never an event, so replay stays byte identical. See D-033.
      heartbeat = setInterval(() => socket.write(': heartbeat\n\n'), HEARTBEAT_MS);
      heartbeat.unref();

      // The client hanging up must not leave a subscriber or a timer behind.
      request.raw.on('close', close);
    });
  };
}

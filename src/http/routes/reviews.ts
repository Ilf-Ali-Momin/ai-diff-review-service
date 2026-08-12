import { createHash } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { defaults, limits } from '../../config';
import { chunkSegments } from '../../core/chunk';
import { parseDiff } from '../../core/parseDiff';
import type { Chunk } from '../../core/types';
import { createDeferred, type Job, type JobStore, type ScanResult } from '../../jobs/store';
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
  };
}

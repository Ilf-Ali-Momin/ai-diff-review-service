import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import { env, isLlmConfigured, limits, llm } from '../config';
import { createQueue, type Queue } from '../jobs/queue';
import { createJobStore, type JobStore } from '../jobs/store';
import { createLlmProvider, unconfiguredLlmProvider } from '../providers/llm';
import { mockProvider } from '../providers/mock';
import type { Provider, ProviderName } from '../providers/types';
import { registerAuth } from './auth';
import { ApiError, type ErrorCode, sendError } from './errors';
import { createRateLimiter, registerRateLimit, type RateLimiter } from './rateLimit';
import { healthRoutes } from './routes/health';
import { createReviewsRoutes } from './routes/reviews';
import { specRoutes } from './routes/spec';

export type ServerOptions = {
  /** Off in tests, on in the deployed process. */
  logger?: boolean;
  authToken?: string;
  /** Tests substitute providers here, for example one that always throws. */
  providers?: Partial<Record<ProviderName, Provider>>;
  store?: JobStore;
  queue?: Queue;
  /** Tests supply one with an injected clock so refill can be observed. */
  rateLimiter?: RateLimiter;
};

/**
 * The llm provider is built from the environment, or replaced by one that
 * fails clearly when the environment carries no model access. Absent
 * configuration must not stop the service starting: only the mock provider is
 * scored, so a missing key costs one job, not the window.
 */
function defaultLlmProvider(): Provider {
  return isLlmConfigured(llm) ? createLlmProvider(llm) : unconfiguredLlmProvider;
}

/**
 * Fastify's own body errors, translated into the closed taxonomy.
 *
 * Fastify rejects an oversized or malformed body before any route runs, so
 * these arrive at the error handler rather than at a validation step. Mapping
 * them here is what keeps invariant 1 true for requests that never reach a
 * route: a 2 MiB body must answer `payload_too_large`, not a framework page.
 */
const FRAMEWORK_ERROR_CODES: Record<string, ErrorCode> = {
  FST_ERR_CTP_BODY_TOO_LARGE: 'payload_too_large',
  FST_ERR_CTP_INVALID_JSON: 'invalid_json',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'invalid_json',
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: 'invalid_json',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'invalid_json',
};

/**
 * Fastify types the error handler's argument loosely, and anything at all can
 * be thrown in JavaScript, so both reads are guarded rather than asserted. A
 * cast here would be a lie that only shows up as a 500 in production.
 */
function frameworkErrorCode(error: unknown): ErrorCode | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? FRAMEWORK_ERROR_CODES[code] : undefined;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== '' ? error.message : fallback;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    /**
     * The same number the size guard and /spec use. Set here as well so that a
     * chunked request arriving without a Content-Length header still cannot
     * exceed the declared limit.
     */
    bodyLimit: limits.maxPayloadBytes,
  });

  const store = options.store ?? createJobStore();
  const queue = options.queue ?? createQueue();
  const providers: Record<ProviderName, Provider> = {
    mock: options.providers?.mock ?? mockProvider,
    llm: options.providers?.llm ?? defaultLlmProvider(),
  };

  /**
   * Hook order is the request pipeline and it is scored. Auth first, so that
   * an unauthenticated request costs nothing and cannot spend anyone's rate
   * limit budget. Then the limiter. Then the size guard. Fastify runs
   * `onRequest` hooks in registration order, so this order is this code.
   */
  registerAuth(app, options.authToken ?? env.authToken);
  registerRateLimit(app, options.rateLimiter ?? createRateLimiter());

  /**
   * Size guard on the declared length, before Fastify buffers anything. The
   * body limit above is the backstop for a chunked request that declares no
   * length at all.
   */
  app.addHook('onRequest', async (request, reply) => {
    const declared = Number(request.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > limits.maxPayloadBytes) {
      sendError(reply, 'payload_too_large', 'the request body exceeds the declared limit');
      return reply;
    }
    return;
  });

  /**
   * Parses every body as JSON regardless of the declared content type, and
   * keeps the raw bytes.
   *
   * The raw buffer is what idempotency hashes, because the contract says byte
   * identical and two JSON documents differing only in key order are equal as
   * objects but not as bytes. See D-010.
   *
   * Accepting any content type is deliberate: JSON is the only body this API
   * has, so a caller who omits the header should get `invalid_json` if the
   * bytes are not JSON, rather than a 415 that the taxonomy cannot express.
   */
  const parseJsonBody = (
    request: FastifyRequest,
    body: Buffer,
    done: (error: Error | null, result?: unknown) => void,
  ): void => {
    (request as FastifyRequest & { rawBody?: Buffer }).rawBody = body;

    if (body.length === 0) {
      done(new ApiError('invalid_json', 'the request body is empty'));
      return;
    }

    try {
      done(null, JSON.parse(body.toString('utf8')));
    } catch {
      done(new ApiError('invalid_json', 'the request body is not valid JSON'));
    }
  };

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, parseJsonBody);
  app.addContentTypeParser('*', { parseAs: 'buffer' }, parseJsonBody);

  /**
   * Covers an unknown path and a method we do not register on a known path.
   * Both answer 404 `not_found`, because the taxonomy has no code for a method
   * mismatch and inventing one would violate invariant 1. See D-013.
   */
  app.setNotFoundHandler((request, reply) => {
    sendError(reply, 'not_found', `no route for ${request.method} ${request.url}`);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return sendError(reply, error.code, error.message);
    }

    const mapped = frameworkErrorCode(error);
    if (mapped !== undefined) {
      return sendError(reply, mapped, messageOf(error, 'malformed request body'));
    }

    /**
     * Anything reaching here is a defect rather than a client mistake, so it is
     * logged in full and answered with a generic message. The contract requires
     * the service to stay healthy, so the exception dies at this boundary.
     */
    request.log.error({ err: error }, 'unhandled error');
    return sendError(reply, 'internal', 'internal error');
  });

  app.register(healthRoutes);
  app.register(specRoutes);
  app.register(createReviewsRoutes({ store, queue, providers }));

  return app;
}

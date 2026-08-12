import Fastify, { type FastifyInstance } from 'fastify';

import { limits } from '../config';
import { ApiError, type ErrorCode, sendError } from './errors';
import { healthRoutes } from './routes/health';
import { specRoutes } from './routes/spec';

export type ServerOptions = {
  /** Off in tests, on in the deployed process. */
  logger?: boolean;
};

/**
 * Fastify's own body errors, translated into the closed taxonomy.
 *
 * Fastify rejects an oversized or malformed body before any route runs, so
 * these arrive at the error handler rather than at a validation step. Mapping
 * them here is what keeps invariant 1 true for requests that never reach a
 * route: a 2 MiB body must answer `payload_too_large`, not a framework page,
 * and a truncated JSON document must answer `invalid_json`, not 500.
 *
 * `FST_ERR_CTP_INVALID_MEDIA_TYPE` has no exact counterpart in the taxonomy.
 * It means the body could not be read as JSON, so it shares `invalid_json`
 * rather than inventing a code the contract does not list.
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

  return app;
}

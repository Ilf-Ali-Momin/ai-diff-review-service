/**
 * The error envelope and the closed code taxonomy.
 *
 * A hard requirement: every non 2xx response in the service leaves
 * through `sendError`. No framework default pages, no bare strings, no code
 * outside the list below. That includes unknown routes, unregistered methods
 * and unhandled exceptions, which is why the not found handler and the error
 * handler in server.ts both call into this module.
 */

import type { FastifyReply } from 'fastify';

/**
 * The complete taxonomy from the API contract, paired with the status each one is
 * sent with. Deriving `ErrorCode` from these keys means a typo in a call site
 * is a compile error rather than a response the scorer rejects.
 */
export const ERROR_STATUS = {
  unauthorized: 401,
  payload_too_large: 413,
  invalid_json: 400,
  invalid_diff: 422,
  idempotency_conflict: 409,
  not_found: 404,
  rate_limited: 429,
  internal: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export type ErrorEnvelope = {
  error: {
    code: ErrorCode;
    message: string;
  };
};

export function errorEnvelope(code: ErrorCode, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

/**
 * Thrown anywhere in a route or hook to produce a specific envelope. The
 * error handler in server.ts recognizes it and preserves the code; anything
 * else it sees becomes `internal`.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/**
 * The only way a non 2xx body is written. `headers` exists for `Retry-After`
 * on `rate_limited`, which the contract requires alongside the envelope.
 */
export function sendError(
  reply: FastifyReply,
  code: ErrorCode,
  message: string,
  headers?: Record<string, string>,
): FastifyReply {
  if (headers) {
    reply.headers(headers);
  }
  return reply.status(ERROR_STATUS[code]).type('application/json').send(errorEnvelope(code, message));
}

/**
 * Bearer authentication for the `/v1` prefix.
 *
 * Registered as an `onRequest` hook, which is the earliest point Fastify
 * offers and, more importantly, earlier than body parsing. That ordering is
 * what makes a 2 MiB unauthenticated request cost nothing and answer 401
 * rather than 413. See D-012.
 *
 * The hook is keyed on the URL prefix rather than on a matched route, so a
 * request to a path under `/v1` that matches nothing still answers 401 without
 * a token, and 404 with one. An unauthenticated caller learns nothing about
 * which paths exist. See D-014.
 */

import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { sendError } from './errors';

const BEARER_PREFIX = 'Bearer ';

/**
 * Constant time comparison. The length check leaks the token length, which is
 * not a secret, and `timingSafeEqual` requires equal lengths anyway.
 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function isProtected(request: FastifyRequest): boolean {
  // `request.url` carries the query string, so compare on the path alone.
  const path = request.url.split('?')[0] ?? '';
  return path === '/v1' || path.startsWith('/v1/');
}

export function registerAuth(app: FastifyInstance, expectedToken: string): void {
  app.addHook('onRequest', async (request, reply) => {
    if (!isProtected(request)) {
      return;
    }

    const header = request.headers.authorization;
    if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
      sendError(reply, 'unauthorized', 'a bearer token is required');
      // Returning the reply is how an async hook tells Fastify the response is
      // already handled and the request must not continue to a route.
      return reply;
    }

    if (!tokenMatches(header.slice(BEARER_PREFIX.length), expectedToken)) {
      sendError(reply, 'unauthorized', 'the bearer token is not valid');
      return reply;
    }

    return;
  });
}

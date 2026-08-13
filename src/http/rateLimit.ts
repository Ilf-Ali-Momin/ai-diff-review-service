/**
 * Token bucket rate limiting for `POST /v1/reviews`.
 *
 * Continuous refill rather than fixed windows. A fixed window lets a caller
 * spend a whole window's budget at its end and the next window's at its start,
 * which is a burst of twice the declared rate arriving as a spike, and it also
 * rejects a perfectly paced caller who happens to straddle a boundary. The
 * contract requires that a sustained 30 per minute always succeeds, so the
 * spacing of the requests must not matter. See D-030.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { limits, rateLimitBurst } from '../config';
import { sendError } from './errors';

export type RateLimiterOptions = {
  /** Burst allowance. Larger than the refill rate on purpose. */
  capacity?: number;
  refillPerMinute?: number;
  /** Injected in tests so the refill can be observed without waiting. */
  now?: () => number;
};

export type RateLimitDecision = {
  allowed: boolean;
  /** Whole seconds until one token exists. Zero when allowed. */
  retryAfterSeconds: number;
};

export type RateLimiter = ReturnType<typeof createRateLimiter>;

export function createRateLimiter(options: RateLimiterOptions = {}) {
  const capacity = options.capacity ?? rateLimitBurst;
  const refillPerMinute = options.refillPerMinute ?? limits.rateLimitPerMinute;
  const now = options.now ?? Date.now;
  const refillPerMs = refillPerMinute / 60_000;

  const buckets = new Map<string, { tokens: number; updatedAt: number }>();

  /**
   * The level the bucket has reached by `at`, refill included. A bucket is
   * only ever written on a take, so the stored number is stale by definition
   * and every read has to age it forward.
   */
  function levelAt(key: string, at: number): number {
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      return capacity;
    }
    return Math.min(capacity, bucket.tokens + (at - bucket.updatedAt) * refillPerMs);
  }

  return {
    take(key: string): RateLimitDecision {
      const at = now();
      const refilled = levelAt(key, at);

      if (refilled >= 1) {
        buckets.set(key, { tokens: refilled - 1, updatedAt: at });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      buckets.set(key, { tokens: refilled, updatedAt: at });
      // Ceiling, so a client that waits exactly this long finds a whole token
      // rather than arriving a millisecond early and being rejected again.
      const secondsUntilOneToken = (1 - refilled) / (refillPerMs * 1000);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(secondsUntilOneToken)) };
    },

    /** Exposed for tests; the service itself never inspects a bucket. */
    tokensFor(key: string): number {
      return levelAt(key, now());
    },
  };
}

const BEARER_PREFIX = 'Bearer ';

function bucketKey(request: FastifyRequest): string {
  const header = request.headers.authorization ?? '';
  return header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : header;
}

/**
 * Registered after the auth hook, so an unauthenticated caller can never spend
 * the real client's budget. POST only: the contract is explicit that GETs are
 * never rate limited, which includes polling and the stream. See D-031.
 */
export function registerRateLimit(app: FastifyInstance, limiter: RateLimiter): void {
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'POST') {
      return;
    }
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/v1/')) {
      return;
    }

    const decision = limiter.take(bucketKey(request));
    if (decision.allowed) {
      return;
    }

    sendError(reply, 'rate_limited', 'too many submissions, retry shortly', {
      'Retry-After': String(decision.retryAfterSeconds),
    });
    return reply;
  });
}

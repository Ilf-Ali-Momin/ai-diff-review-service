/**
 * The single source of every limit this service declares and enforces.
 *
 * CONTRACT.md requires that "declared limits must match your actual behavior".
 * The way that guarantee is made structural rather than aspirational is that
 * `GET /spec` serializes the `spec` object below verbatim, while the rate
 * limiter, the chunker, the body size guard and the job semaphore all read
 * their numbers from the same `limits` object. There is no second place where
 * any of these values is written down, so they cannot drift.
 */

/** Reported by GET /health. Pinned to package.json by a unit test, see D-017. */
export const version = '1.0.0';

/**
 * Every value here is enforced somewhere in the runtime. The shape of this
 * object is fixed by the `limits` block of the /spec example in CONTRACT.md
 * and must not gain or lose keys.
 */
export const limits = {
  /** POST bodies above this are rejected with 413 before any parsing. */
  maxPayloadBytes: 1_048_576,
  /** Greedy pack target for file segments, measured in UTF 8 bytes. */
  chunkBytes: 65_536,
  /** Capacity of the job semaphore. A queued fifth job waits, it never fails. */
  maxConcurrentJobs: 4,
  /** Sustained submissions per minute. See `rateLimitBurst` for the burst allowance. */
  rateLimitPerMinute: 30,
} as const;

/**
 * The exact document served by GET /spec.
 *
 * Serving this object directly, rather than rebuilding a similar one in the
 * route, is what makes invariant 3 in CLAUDE.md hold by construction.
 */
export const spec = {
  specVersion: '1.0',
  providers: ['mock', 'llm'],
  limits,
} as const;

/**
 * Token bucket capacity, which is the real burst allowance.
 *
 * This is deliberately larger than `rateLimitPerMinute` so that a sustained 30
 * per minute always succeeds, which the contract requires. It is not part of
 * `/spec` because the contract fixes the shape of that document and it has no
 * field for a burst. The declared 30 is the sustained rate, which is the
 * question the contract's rate limiting section actually asks.
 */
export const rateLimitBurst = 40;

/**
 * Defaults the contract states for optional request fields. An unusable value
 * in a known option falls back to these rather than failing the request, since
 * the taxonomy has no code for a bad option. See D-015.
 */
export const defaults = {
  provider: 'mock',
  maxFindings: 100,
} as const;

/** Runtime environment. */
export const env = {
  port: Number.parseInt(process.env['PORT'] ?? '3000', 10),
  /** 0.0.0.0 rather than localhost, so the process is reachable inside a container. */
  host: '0.0.0.0',
  /** Required. The process refuses to start without it. See D-029. */
  authToken: process.env['AUTH_TOKEN'] ?? '',
} as const;

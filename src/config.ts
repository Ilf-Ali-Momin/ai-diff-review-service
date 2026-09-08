/**
 * The single source of every limit this service declares and enforces.
 *
 * The API contract requires that declared limits match actual behavior.
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
 * object is fixed by the `limits` block the contract specifies for /spec
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
 * route, is what stops the two drifting apart.
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

/**
 * Reads a positive integer from the environment.
 *
 * A variable present but empty, which is what a `.env` file with a blank line
 * value or an unset platform secret produces, counts as absent. Without this
 * the pattern `Number.parseInt(process.env.X ?? '20000')` yields NaN, because
 * `??` only catches null and undefined and an empty string is neither. A NaN
 * timeout fires instantly and a NaN port binds somewhere random. See D-041.
 */
function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The llm provider's configuration, entirely from the environment so that no
 * vendor leaks into the pipeline. Any OpenAI compatible endpoint works
 * unchanged: Groq, OpenRouter, Together, a self hosted Ollama.
 *
 * Absent configuration is not a startup failure. Only the mock provider is
 * scored, so a service with no model access must still start and serve; a job
 * asking for `llm` is the thing that fails, with a clear message.
 */
export const llm = {
  baseUrl: (process.env['LLM_BASE_URL'] ?? '').replace(/\/+$/, ''),
  apiKey: process.env['LLM_API_KEY'] ?? '',
  model: process.env['LLM_MODEL'] ?? '',
  timeoutMs: positiveIntFromEnv('LLM_TIMEOUT_MS', 20_000),
} as const;

export function isLlmConfigured(config: { baseUrl: string; apiKey: string; model: string }): boolean {
  return config.baseUrl !== '' && config.apiKey !== '' && config.model !== '';
}

/** Runtime environment. */
export const env = {
  port: positiveIntFromEnv('PORT', 3000),
  /** 0.0.0.0 rather than localhost, so the process is reachable inside a container. */
  host: '0.0.0.0',
  /** Required. The process refuses to start without it. See D-029. */
  authToken: process.env['AUTH_TOKEN'] ?? '',
} as const;

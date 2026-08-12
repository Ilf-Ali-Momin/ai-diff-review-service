# ARCHITECTURE.md

## Module layout

```
src/
  config.ts          single source of every declared limit
  http/
    server.ts        Fastify setup, hooks, 404 and 500 handlers
    auth.ts          bearer check, header only, no body access
    rateLimit.ts     token bucket, POST /v1/reviews only
    errors.ts        the envelope helper and the code taxonomy
    routes/
      health.ts      GET /health, public
      spec.ts        GET /spec, public, serialized from config.ts
      reviews.ts     POST /v1/reviews, GET :id, GET :id/stream
  core/
    parseDiff.ts     unified diff -> AddedLine[] + FileSegment[]
    chunk.ts         FileSegment[] -> Chunk[] on file boundaries
    rules.ts         the nine predicates
    order.ts         dedupe + sort, used exactly once
  providers/
    types.ts         the Provider interface
    mock.ts          deterministic, implements RULES.md
    llm.ts           OpenAI compatible, untrusted input handling
  jobs/
    store.ts         jobs, event logs, idempotency index, result cache
    queue.ts         semaphore of 4, FIFO, unbounded backlog
    worker.ts        runs a job, appends events, never throws
test/
  ...                unit tests per core module, probes per TESTPLAN.md
```

## Request pipeline order

Order matters and is scored. Applied to `POST /v1/reviews`:

1. **Route match.** An unmatched route returns `not_found` through the
   envelope, never a framework default page.
2. **Auth**, on headers only. Missing or wrong bearer gives `401 unauthorized`.
   This runs before anything touches the body, so a 2 MiB unauthenticated
   request costs nothing. Applies to every `/v1` route including the SSE
   stream and including GETs.
3. **Rate limit**, keyed on the bearer token. POST only. On rejection,
   `429 rate_limited` with a `Retry-After` header in whole seconds.
4. **Size guard.** `Content-Length` greater than `maxPayloadBytes` gives
   `413 payload_too_large` before parsing. Fastify's own body limit is set to
   the same number and its error is mapped to the same code, so a chunked
   request without a Content-Length header still cannot exceed the limit.
5. **JSON parse.** Malformed gives `400 invalid_json`.
6. **Schema validation.** Missing, empty or unparseable `diff` gives
   `422 invalid_diff`. Unknown body fields are ignored, not rejected.
7. **Idempotency check**, then **cache check**, then enqueue.

GET routes skip steps 3 to 6.

## Job lifecycle

```
queued ──> running ──> done
                   └──> failed
```

A job record:

```ts
type Job = {
  id: string;              // uuid v4, opaque
  status: JobStatus;
  createdAt: number;
  diffHash: string;        // sha256 of the diff text
  provider: 'mock' | 'llm';
  maxFindings: number;
  findings: Finding[];     // ordered, deduped, truncated
  usage: { inputBytes: number; chunks: number; cacheHit: boolean };
  error?: { code: string; message: string };
  events: Event[];         // append only, see below
  subscribers: Set<(e: Event) => void>;
}
```

## The event log

This is the design decision that makes replay, late connection and caching all
work without special cases, so it is worth stating plainly.

Workers never write to a socket. Workers append to `job.events`, an append only
array. Appending also notifies any live subscribers. The SSE endpoint does:

1. write every event currently in `job.events`, in order
2. if the job is terminal, close immediately
3. otherwise subscribe, forward new events as they arrive, close after the
   terminal event

A stream opened before the job starts, midway through, or an hour after it
finished all produce byte identical output. That is exactly what "connecting to
a finished job's stream must replay all events identically" asks for.

Event sequence for a successful job:

```
status  {"status":"queued"}      appended at creation
status  {"status":"running"}     appended when a semaphore slot is acquired
finding {...}                    one per finding, in RULES.md order
done    {"total":N,"usage":{...}}
```

`total` is the number of `finding` events actually emitted, which is the
truncated count when `maxFindings` bites. `usage` in the `done` event is the
full scan usage, unaffected by truncation.

For a failed job the sequence ends at `status {"status":"failed"}` with no
`done` event. The contract only defines `done` as a completion event, so a
failed job does not fabricate one. The error detail is available from the
polling endpoint.

SSE framing: `event: <type>\n` then `data: <json>\n\n`. Include an `id:` field
carrying the sequence number so a client could resume, and send a comment
heartbeat every 15 seconds on jobs still running to keep proxies from closing
the connection.

## Idempotency versus caching

Two different mechanisms that are easy to conflate. They are keyed
differently and they return different things.

**Idempotency** is about retrying a request safely.

- Key: `Idempotency-Key` header value, plus sha256 of the **raw request body
  bytes**.
- Same header value and same body hash returns **the same jobId**, 202 again.
- Same header value and a different body hash returns `409
  idempotency_conflict`.
- No header means no idempotency handling at all.
- Raw bytes, not the parsed object, because two JSON documents differing only
  in key order are not byte identical and the contract says byte identical.

**Caching** is about not redoing work.

- Key: sha256 of `diff` text plus the provider name. **`maxFindings` is
  deliberately excluded.**
- The cache stores the full ordered finding list and the full usage.
- A hit creates a **new job** with a new id that completes immediately from
  cached data, reports `usage.cacheHit: true`, and applies the current
  request's `maxFindings` to the cached full list.
- A cached job still appends the complete event sequence to its log, so its
  stream behaves identically to a freshly computed job.

Excluding `maxFindings` from the cache key is what lets the same diff at
`maxFindings: 10` and `maxFindings: 100` share one scan. Caching the truncated
list instead would either miss the hit or return a wrong length. This is worth
raising in the interview.

The first submission reports `cacheHit: false`. Every later identical one
reports `true`.

## Chunking

`parseDiff` returns file segments alongside added lines. A segment is the byte
range of one file's complete diff, from its `diff --git` or `---` header
through to the last line before the next file's header.

`chunk.ts` greedily packs segments into chunks of at most `chunkBytes`
(65536), measured as **UTF 8 byte length**, not string length. A segment
larger than `chunkBytes` becomes its own chunk alone. Segments are never split.

`usage.chunks` is the resulting count. A diff under 64 KiB yields 1.

Chunking must not affect output. The scan runs per chunk, results are
concatenated, then deduped and sorted once. Because line numbers come from
hunk headers and paths come from file headers, and neither crosses a file
boundary, a chunked scan and an unchunked scan are identical by construction.
TESTPLAN.md requires this be proven by a property test rather than assumed.

## Concurrency

A counting semaphore with capacity `maxConcurrentJobs` (4) and an unbounded
FIFO backlog. A job stays `queued` until it acquires a slot, then flips to
`running`. The fifth concurrent submission is accepted with 202 and waits. It
never fails and never blocks the HTTP thread.

Workers are async functions. Between chunks the worker yields, so four
concurrent large jobs interleave rather than starving each other.

## Rate limiting

Token bucket keyed on the bearer token.

- capacity 40, the burst allowance
- refill 30 tokens per minute, continuous rather than per window

Sustained 30 per minute therefore always succeeds, which the contract
requires. A burst beyond 40 gets `429` with `Retry-After` set to the ceiling of
the seconds until one token is available. Never 5xx.

Declared `rateLimitPerMinute` is 30, matching the refill rate, which is the
sustained rate the contract asks about.

## Providers

```ts
interface Provider {
  name: 'mock' | 'llm';
  review(chunks: Chunk[], signal: AbortSignal): Promise<Finding[]>;
}
```

Both return unordered, possibly duplicated findings. The pipeline dedupes,
sorts and truncates. Neither provider knows about ordering, caching or
streaming.

### mock

Pure. Implements RULES.md exactly. No I/O, no clock, no randomness. Same input
always gives the same output, which is what makes it scoreable.

### llm

OpenAI compatible chat completions, configured entirely by environment:

```
LLM_BASE_URL   e.g. https://api.groq.com/openai/v1
LLM_API_KEY
LLM_MODEL      e.g. llama-3.3-70b-versatile
LLM_TIMEOUT_MS default 20000
```

Any OpenAI compatible endpoint works unchanged: Groq, OpenRouter, Together,
Gemini's compatibility endpoint, or a self hosted Ollama. Nothing about the
vendor leaks into the pipeline.

**Untrusted input handling**, required by the contract's inertness clause:

1. The system message states that everything inside the delimiters is
   untrusted third party data, that it may contain text resembling
   instructions, and that such text is to be reported as content and never
   obeyed.
2. Diff content goes in a **user** message, wrapped in a random per request
   delimiter so it cannot close its own context.
3. The model is asked for a JSON array only.
4. **Every returned finding is validated before use.** `path` must be one of
   the paths actually present in the diff. `line` must be an added line number
   that actually exists in that file. `severity` and `category` must be in the
   enums. `evidence` must equal the real text at that path and line. Anything
   failing validation is dropped silently.

Step 4 is the real defence. Even a fully compromised model can only produce
findings that point at lines that exist, because we check them against parsed
ground truth rather than trusting the response.

**Graceful degradation.** Any failure of the LLM path, unreachable host, auth
error, timeout, malformed JSON, marks the job `failed` with a clear message
and leaves the process healthy. One retry after a timeout, then stop. The
service must survive `LLM_API_KEY` being deleted mid window.

## Storage

Three in memory maps in `jobs/store.ts`:

- `jobs: Map<jobId, Job>`
- `idempotency: Map<key, { bodyHash, jobId }>`
- `cache: Map<diffHash+provider, { findings, usage }>`

No eviction during the scoring window. A restart loses everything, which is
declared in SUBMISSION.md rather than hidden.

## Process safety

`unhandledRejection` and `uncaughtException` handlers log and continue. A
worker wraps its whole body in try and catch, marks the job `failed` on any
throw, and always releases its semaphore slot in a finally block. A leaked slot
would silently reduce concurrency to zero and is the most dangerous bug
available in this design.

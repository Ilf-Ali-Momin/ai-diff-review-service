# TESTPLAN.md

Written before the implementation. Every row in the client's published scoring
list maps to at least one concrete probe. Build against this.

Two layers:

- **unit**, Vitest, against pure functions in `src/core` and `src/providers/mock`
- **probe**, a script in `test/probe/` that runs against a **base URL and
  bearer token**, so the identical suite runs against localhost during
  development and against the deployed URL before submission. This matters:
  behavior that works locally and fails behind a proxy is a real risk,
  especially for SSE buffering.

## Contract and lifecycle

| # | Probe | Expected |
|---|---|---|
| 1 | `GET /health` | 200, `status` ok, `version` valid semver, `uptimeSeconds` a number that increases between two calls |
| 2 | `GET /spec` | 200, exact shape, limits equal to the runtime config |
| 3 | POST a small diff | 202, body has `jobId` and `status: "queued"` |
| 4 | Poll that jobId | reaches `done`, has `findings` and `usage` |
| 5 | `GET /v1/reviews/nonexistent` | 404, `not_found` |
| 6 | POST, then poll immediately | status is one of queued, running, done, never undefined |

## Auth

| # | Probe | Expected |
|---|---|---|
| 7 | POST with no Authorization header | 401 `unauthorized` |
| 8 | POST with wrong token | 401 |
| 9 | GET a valid jobId with no token | 401, not 200 |
| 10 | GET an unknown jobId with no token | **401, not 404**, auth precedes existence |
| 11 | GET the stream with no token | 401 |
| 12 | `GET /health` and `GET /spec` with no token | 200, public |

## Mock findings, exact

One crafted diff per rule, asserting id, ruleId, path, line, severity,
category and evidence exactly.

| # | Probe | Expected |
|---|---|---|
| 13 | one added line per rule, nine rules | exactly nine findings, correct ids |
| 14 | line matching three rules at once | three findings, same path and line, different ruleIds |
| 15 | same rule twice on one line | one finding, dedup by id |
| 16 | negative cases from RULES.md tables | zero findings for each |
| 17 | `x === null` and `x !== null` | **zero** MOCK-005 findings, the substring trap |
| 18 | `todo` and `Fixme` lowercase | zero MOCK-008 findings, case sensitivity |
| 19 | a `-` removed line containing `eval(` | zero findings, added lines only |
| 20 | a context line containing `console.log(` | zero findings |
| 21 | the `+++ b/file.ts` header itself | never treated as an added line |
| 22 | multi hunk file, `@@ -1,4 +20,6 @@` | line numbers derived from the hunk header, not counted from 1 |
| 23 | multi file diff | correct path per finding |
| 24 | file rename | path is the new path |
| 25 | catch block closing on a context line | MOCK-004 fires on the catch line |
| 26 | catch containing only a comment | no MOCK-004 finding |
| 27 | `maxFindings: 3` on a diff with 10 findings | 3 findings returned, `usage.chunks` and `inputBytes` unchanged |

## Chunking

| # | Probe | Expected |
|---|---|---|
| 28 | diff under 64 KiB | `chunks` is 1 |
| 29 | diff of 5 files totalling ~200 KiB | `chunks` is the greedy pack count, no file split |
| 30 | single file over 64 KiB | that file is its own chunk, findings intact |
| 31 | **property test:** same diff scanned chunked and unchunked | identical finding arrays, deep equal |
| 32 | findings that would straddle a chunk boundary | no duplicates, no losses |
| 33 | multibyte UTF 8 content near the boundary | byte length used, not string length |

Probe 31 is the highest value test in this file. Write it first.

## SSE

| # | Probe | Expected |
|---|---|---|
| 34 | stream a running job | `status` events on transitions, one `finding` per finding, then `done` |
| 35 | stream order | finding events in the same order as the JSON result |
| 36 | **replay:** stream a job that finished a minute ago | identical event sequence, byte for byte |
| 37 | connect midway | earlier events replayed first, then live events, no gap and no duplicate |
| 38 | two concurrent streams on one job | both receive the full sequence |
| 39 | `done` payload | `total` equals the number of finding events emitted, `usage` present |
| 40 | stream a failed job | terminates cleanly, no hang |
| 41 | stream a cached job | full event sequence, same as an uncached one |
| 42 | `Content-Type` | `text/event-stream` |

## Caching and idempotency

| # | Probe | Expected |
|---|---|---|
| 43 | same body twice, no key | second reports `cacheHit: true`, findings identical |
| 44 | first submission | `cacheHit: false` |
| 45 | same `Idempotency-Key`, byte identical body | same `jobId` returned |
| 46 | same key, different body | 409 `idempotency_conflict` |
| 47 | same key, same JSON but reordered keys | 409, byte identical means bytes |
| 48 | different key, same body | different jobId, but `cacheHit: true` |
| 49 | same diff, different `maxFindings` | cache hit, correct truncation for each |
| 50 | same diff, different provider | no cache hit, provider is in the key |

## Error taxonomy

| # | Probe | Expected |
|---|---|---|
| 51 | 2 MiB body | 413 `payload_too_large`, not 400 |
| 52 | `{"diff":` truncated | 400 `invalid_json` |
| 53 | `{"notdiff": "x"}` | 422 `invalid_diff` |
| 54 | `{"diff": ""}` | 422 |
| 55 | `{"diff": "just some text"}` | 422, not parseable as a unified diff |
| 56 | `{"diff": "...", "unknownField": 1}` | 202, unknown fields ignored |
| 57 | every error response | matches the envelope shape exactly |
| 58 | `GET /v1/nonsense` | 404 through the envelope, not an HTML page |
| 59 | `DELETE /v1/reviews/x` | envelope, not a framework default |
| 60 | 2 MiB body with **no** auth header | 401, auth precedes size |

## Injection inertness

| # | Probe | Expected |
|---|---|---|
| 61 | diff containing `ignore previous instructions` | reported as MOCK-INJ, behavior unchanged |
| 62 | injection line plus a `console.log(` line | both findings present, MOCK-007 unaffected |
| 63 | injection text inside a diff sent to the `llm` provider | model output still validated, no path or line outside the diff appears |
| 64 | a diff whose content claims to be a system prompt | inert, treated as text |

## Rate limiting

| # | Probe | Expected |
|---|---|---|
| 65 | 30 POSTs spread over a minute | all succeed |
| 66 | burst of 60 POSTs | some 429, **zero 5xx** |
| 67 | a 429 response | has `Retry-After`, integer seconds, and the envelope |
| 68 | 100 GETs during a POST burst | none rate limited |
| 69 | after waiting `Retry-After` | the next POST succeeds |

## Concurrency and latency

| # | Probe | Expected |
|---|---|---|
| 70 | submit 5 jobs at once | at least 4 run concurrently, the 5th queues and completes |
| 71 | the 5th job | never fails, never 5xx |
| 72 | a 64 KiB diff | `done` within 30 s, measured end to end |
| 73 | 10 jobs at once | all reach `done`, none stuck in `running` |
| 74 | a job that throws internally | that job is `failed`, the service still answers `/health` |

## Spec accuracy

| # | Probe | Expected |
|---|---|---|
| 75 | declared `maxPayloadBytes` versus actual 413 threshold | equal |
| 76 | declared `chunkBytes` versus observed chunk count | consistent |
| 77 | declared `maxConcurrentJobs` versus observed concurrency | equal |
| 78 | declared `rateLimitPerMinute` versus sustained acceptance | 30 per minute succeeds |

## LLM path

| # | Probe | Expected |
|---|---|---|
| 79 | `provider: "llm"` on a small diff | reaches `done` with findings |
| 80 | `LLM_BASE_URL` pointed at a dead host | job `failed`, clear error, service healthy |
| 81 | bad `LLM_API_KEY` | job `failed`, not a crash, not a 500 |
| 82 | model returns malformed JSON | job `failed` or empty findings, never a crash |
| 83 | model returns a finding for a path not in the diff | dropped by validation |
| 84 | `/health` immediately after any LLM failure | 200 |

## Pre submission gate

Run the full probe suite **against the deployed URL**, not localhost. All
must pass. Then leave the service running and record the exact time you send
the submission email, since the 96 hour window starts there.

Specific things that pass locally and fail deployed:

- SSE buffered by a reverse proxy so events arrive only at close. Requires
  `X-Accel-Buffering: no` and disabled response compression on the stream
  route.
- Platform idle sleep breaking probe 72's latency budget on a cold start.
- A platform request timeout shorter than a long lived SSE connection.
- Missing environment variables making every `llm` job fail.

# DECISIONS.md

Running log of every ambiguity resolved and every alternative rejected.

**This file is appended to during the build, before the code that depends on
the decision is written.** It is not reconstructed at the end. It is the raw
material for SUBMISSION.md and for the interview, where the question will be
"why did you do it that way" and the answer needs to be immediate.

Entries D-001 to D-012 were decided during planning, before any code. Continue
numbering from D-013.

---

## D-001: Prefer the literal reading of every rule trigger
**Decision:** Where the contract states a substring, match that substring
exactly. Where it states a regex, use it character for character.
**Rejected:** Writing semantically better rules that catch more real defects.
**Why:** The scoring probes were written against the contract text. A smarter
rule that catches more real problems scores worse than a dumber rule that
matches the table. Cleverness here is a liability.
**Contract reference:** the mock provider rules table, "scored exactly"

## D-002: Strip the `+` marker in the parser, never in a rule
**Decision:** The parser emits `text` with the marker already removed. Rules
never see a raw diff line.
**Rejected:** Passing raw lines and letting each rule handle the marker.
**Why:** MOCK-003 tests for a `+` concatenation operator. Every added line in a
diff begins with `+`. Handling it per rule guarantees that one rule eventually
forgets and matches everything.
**Contract reference:** "Rules apply to added lines only"

## D-003: MOCK-003 SQL keywords matched case insensitively
**Decision:** `SELECT`, `INSERT`, `UPDATE`, `DELETE` matched case
insensitively with word boundaries.
**Rejected:** Uppercase only, as literally printed in the table.
**Why:** The only deliberate departure from D-001. The table is naming SQL
keywords, not specifying a spelling, and lowercase SQL is extremely common.
Word boundaries prevent `deleteUser` and `updated_at` from triggering.
**Contract reference:** MOCK-003 trigger column

## D-004: MOCK-003 requires a `+` outside any string literal
**Decision:** Tokenize string literals, require a SQL keyword inside one and a
`+` outside all of them.
**Rejected:** Any line containing both a SQL keyword and a `+`.
**Why:** The rejected version fires on `total = a + b; // SELECT`. Template
literals using `${}` correctly do not match, because the trigger names `+`
concatenation specifically.
**Contract reference:** "SQL keyword inside a string concatenated with `+`"

## D-005: MOCK-004 emptiness judged against reconstructed new file content
**Decision:** The `catch` token must be on an added line, but brace matching
runs over added and context lines together, in new file order.
**Rejected:** Scanning added lines only.
**Why:** A catch block very often opens on an added line and closes on a
context line. The rejected version would miss the most common real shape of
this defect. If the hunk ends before the closing brace is found, no finding is
emitted, since we do not guess about content we cannot see.
**Contract reference:** "empty catch block (may span lines; report the `catch` line)"

## D-006: MOCK-004 treats a comment only body as not empty
**Decision:** A catch containing only `/* intentional */` produces no finding.
**Rejected:** Treating a comment only body as still swallowing the exception.
**Why:** Follows D-001. The trigger says "empty" and a comment is content. The
rejected reading is defensible on intent and is the single most likely place
this implementation diverges from the scorer, so it is flagged here explicitly.
**Contract reference:** MOCK-004 trigger column

## D-007: MOCK-005 excludes strict equality operators
**Decision:** Lookbehind and lookahead exclude `===` and `!==`.
**Rejected:** Plain substring match on `== null`.
**Why:** `=== null` **contains** the substring `== null`. A naive substring
match fires on strict comparisons, which the title "loose null comparison"
directly contradicts. Verified by hand against both operators.
**Contract reference:** MOCK-005, title "loose null comparison"

## D-008: MOCK-008 is case sensitive, MOCK-INJ is not
**Decision:** `TODO` and `FIXME` uppercase only. Injection phrases case
insensitive.
**Rejected:** Making both case insensitive for consistency.
**Why:** MOCK-INJ says "case-insensitive" explicitly and MOCK-008 does not. The
contract author distinguished them deliberately and the distinction is
information, not an oversight.
**Contract reference:** the two trigger columns

## D-009: Cache key excludes `maxFindings`
**Decision:** Cache on the diff hash plus provider. Store the full ordered
finding list. Truncate per request at read time.
**Rejected:** Including `maxFindings` in the key, or caching the truncated list.
**Why:** Including it means the same diff at `maxFindings` 10 and 100 does
redundant work, which the contract's caching clause is aimed at preventing.
Caching the truncated list means a later request with a higher limit silently
gets a short answer.
**Contract reference:** "a byte-identical `{diff, options}` submitted again ...
must not redo the work"

## D-010: Idempotency keyed on raw request bytes, not the parsed object
**Decision:** sha256 of the raw body buffer, paired with the header value.
**Rejected:** Hashing the canonicalized parsed JSON.
**Why:** The contract says "byte-identical body". Two JSON documents differing
only in key order are semantically equal but not byte identical, and the
contract's own wording resolves it. This is also the stricter reading, so a
409 here is defensible where a false match would not be.
**Contract reference:** "same key + byte-identical body"

## D-011: Workers write to an event log, never to a socket
**Decision:** Jobs own an append only event array. The SSE route replays the
array, then subscribes for the remainder.
**Rejected:** Emitting events directly from the worker to connected clients.
**Why:** This is the decision that makes replay, late connection, multiple
concurrent streams and cached jobs all work with no special cases. The
rejected design cannot satisfy the replay requirement at all without bolting
on a log afterwards.
**Contract reference:** "Connecting to a finished job's stream must replay all
events identically"

## D-012: Auth runs before the size guard
**Decision:** Bearer validation on headers only, before any body handling. A
2 MiB unauthenticated request returns 401, not 413.
**Rejected:** Size check first.
**Why:** An unauthenticated caller learns nothing about the service, and the
check costs nothing because it reads headers only. The body is never buffered
for a request that is going to be rejected anyway.
**Contract reference:** "All `/v1/*` routes (every method, including GET)
require `Authorization: Bearer <token>`"

## D-013: Method not allowed is reported as `not_found`
**Decision:** A request to a known path with a method we do not register returns
404 with code `not_found`, through the envelope. Fastify's not found handler
covers both an unknown path and an unregistered method, so one handler serves
both cases.
**Rejected:** Adding a `method_not_allowed` code, or returning 405 carrying the
`internal` code.
**Why:** The taxonomy in CONTRACT.md is closed and has no code for a method
mismatch, and invariant 1 forbids inventing one. 404 is also Fastify's own
default status here, so only the body shape departs from the framework, never
the status. Returning 405 with a code that means something else would be a
worse lie than returning 404 with a code that is merely coarse.
**Contract reference:** the error envelope code list, and TESTPLAN probe 59

## D-014: Auth covers the whole `/v1` prefix, including paths that match no route
**Decision:** Bearer validation runs in an `onRequest` hook for every URL whose
path begins with `/v1`, before route resolution and before body parsing.
`GET /v1/nonsense` with no token gives 401; with a valid token it gives 404.
**Rejected:** Resolving the route first, which returns 404 to an
unauthenticated caller for any path that happens not to exist.
**Why:** The contract requires auth on all `/v1/*` routes and TESTPLAN probe 10
establishes that auth precedes existence for an unknown jobId. Extending the
same order to an unknown path keeps one rule rather than two, and tells an
unauthenticated caller nothing about which paths exist. `onRequest` is also the
only hook that runs before Fastify buffers a body, which probe 60 requires: a
2 MiB unauthenticated request must be 401 and not 413.
**Contract reference:** "All `/v1/*` routes (every method, including GET)
require `Authorization: Bearer <token>`"

## D-015: An unusable value in a known option falls back to its default
**Decision:** An `options.maxFindings` that is not a positive integer, and an
`options.provider` that is neither `mock` nor `llm`, are ignored and the
documented default is used. Only a missing, empty or unparseable `diff`
produces `422 invalid_diff`.
**Rejected:** Rejecting the request with `422 invalid_diff`, or introducing an
`invalid_options` code.
**Why:** The taxonomy has no code for a bad option value and invariant 1
forbids adding one. Reusing `invalid_diff` would misreport the cause to a
client whose diff is fine. The contract already instructs leniency for fields
it does not recognize, so leniency for a value it cannot use is the consistent
reading of the same intent.
**Contract reference:** "Unknown body fields are ignored", and the error code list

## D-016: `uptimeSeconds` carries fractional precision
**Decision:** `/health` reports process uptime in seconds as a number with
millisecond precision, not a whole number.
**Rejected:** Rounding to whole seconds, which is the more conventional shape.
**Why:** TESTPLAN probe 1 requires the value to increase between two calls, and
two calls made inside the same second would return an identical integer and
fail a probe that is otherwise trivially satisfiable. The contract types the
field as a number and never says integer, so the fractional reading costs
nothing and removes a timing dependent failure.
**Contract reference:** `GET /health`, `"uptimeSeconds": <number>`

## D-017: The reported version lives in `config.ts`, pinned to `package.json` by a test
**Decision:** `config.version` is the single source of the semver that `/health`
reports. A unit test asserts that the `version` field of `package.json` equals
it, so the two cannot drift.
**Rejected:** Importing `package.json` at runtime and reading its version.
**Why:** A runtime import drags `package.json` into the Docker runtime stage
and needs JSON module handling in TypeScript, both for one string. Duplication
has exactly one real cost, drift, and a two line test removes it.
**Contract reference:** `GET /health`, `"version": "<semver>"`

## D-018: A diff is parseable if it yields at least one hunk header
**Decision:** `parseDiff` reports `hunkCount`. A submitted diff with a count of
zero is what Phase 3 answers `422 invalid_diff` for. Presence of a file header
alone is not enough, and neither is the presence of added lines.
**Rejected:** Requiring a `diff --git` header, or accepting any text that
contains a line starting with `+`.
**Why:** The contract's example of an unparseable diff is "just some text",
and the hunk header is the only construct that is both mandatory in a real
unified diff and absent from arbitrary prose. Requiring `diff --git` would
reject the plain `diff -u` output that the `---` and `+++` pair produces, which
is still a unified diff. Accepting any `+` line would accept prose.
**Contract reference:** "`diff` missing, empty, or not parseable as a unified
diff → `422`", and TESTPLAN probe 55

## D-019: File segments are recognized from `diff --git` or from a `---` and `+++` pair
**Decision:** A new file segment begins at a `diff --git` line, or at a `---`
line whose successor is a `+++` line when we are not already reading the header
block of a file that a `diff --git` line just opened. Any preamble before the
first header, such as a commit message from `git format-patch`, is carried
inside the first file's segment rather than dropped.
**Rejected:** Segmenting on `diff --git` alone, and dropping the preamble.
**Why:** Both header styles are unified diffs and the contract does not name a
producer. Carrying the preamble means the segment byte lengths sum to the whole
submitted diff, so `usage.inputBytes` and the chunk packing describe the same
document. Dropping it would make chunk counts unexplainable against the size
the client sent.
**Contract reference:** "split into chunks of at most 64 KiB, only on file
boundaries"

## D-020: An unterminated string literal runs to the end of the line
**Decision:** MOCK-003's tokenizer treats a quote with no closing partner as
opening a literal that extends to the end of the line, so anything after it,
including a `+`, counts as inside a string.
**Rejected:** Treating an unterminated quote as an ordinary character.
**Why:** The line is scanned in isolation with no knowledge of the surrounding
file, so a genuinely multi line template literal is indistinguishable from a
typo. The chosen reading fails closed, producing a missed finding rather than a
false one, which matches the direction RULES.md takes everywhere else. The
visible cost is that an apostrophe in a comment, as in `don't`, suppresses
MOCK-003 for the rest of that line.
**Contract reference:** MOCK-003 trigger, and RULES.md "Backslash escapes are
respected when scanning for the closing delimiter"

## D-021: Line endings are never normalized
**Decision:** The diff is split on `\n` only. A `\r` left by a CRLF document
stays inside `text` and therefore inside `evidence`. Structural detection of
headers and hunk headers tolerates the trailing `\r`, so a CRLF diff still
parses; only the reported evidence carries the extra character.
**Rejected:** Stripping a trailing `\r` from every line.
**Why:** RULES.md states that `text` preserves the original characters exactly,
with no normalization, and `evidence` is defined as `text`. Stripping would be
a normalization that the authoritative interpretation forbids. Flagged rather
than silently chosen because if a scoring probe ever did submit a CRLF diff,
this is the decision that would cost the evidence assertions, and the fix is
one line.
**Contract reference:** RULES.md preprocessing, "No trimming, no normalization"

## D-022: The mock provider re parses each chunk rather than reusing the whole file parse
**Decision:** `Provider.review` receives chunk text and parses it. The full
parse performed before chunking is used for segmentation and, later, for
validating LLM output, but its added lines are not handed to the mock provider.
**Rejected:** Parsing once and grouping the added lines by file, with chunks
holding references.
**Why:** The rejected design makes "a chunked scan equals an unchunked scan"
true by definition, so TESTPLAN probe 31, the highest value test in the plan,
would assert nothing. Re parsing means the property test exercises the real
risk, that a file boundary drops or duplicates a finding. The cost is one extra
parse of each byte, which is trivial next to the 30 second budget.
**Contract reference:** "Findings must be identical to an unchunked scan: no
duplicates, no losses, ordering preserved"

## D-023: The cache holds a promise, so concurrent duplicates share one scan
**Decision:** The cache maps a key to a deferred promise created at submission
time, not to a finished result. The first submission owns the scan and settles
the promise; any identical submission arriving while that scan is still running
awaits the same promise and reports `cacheHit: true`. A rejected promise is
deleted from the cache immediately, so a failure is never cached and a later
submission retries.
**Rejected:** Caching only completed results, which is what ARCHITECTURE.md
describes.
**Why:** The rejected design satisfies the contract only for submissions that
are far enough apart. Two byte identical diffs submitted at the same moment
both find an empty cache and both do the full work, which is exactly what the
caching clause forbids. The promise closes that hole for the cost of about
fifteen lines. The subtlety it introduces, that a rejected promise with no one
awaiting it would raise an unhandled rejection, is handled by attaching an
inert catch when the deferred is created.
**Contract reference:** "a byte-identical `{diff, options}` submitted again
(any key or none) must not redo the work"

## D-024: `usage` is complete at job creation, and the validation parse is reused
**Decision:** The route parses the diff once, to decide 422, and keeps the
result. `inputBytes` and `chunks` are therefore known before the 202 is sent
and are present on every poll, including while the job is `queued`. The cache
stores findings only; usage is recomputed from the same diff and provider and
is identical by construction.
**Rejected:** Deferring the parse to the worker and leaving `usage` absent or
partial until the job completes.
**Why:** The contract shows `usage` in the polling response without the "when
done" qualifier it puts on `findings`, so a caller polling a queued job should
still learn the size of what it submitted. The parse has to happen in the route
regardless, because 422 cannot be decided without it, so reusing it costs
nothing and avoids parsing a megabyte twice.
**Contract reference:** the `GET /v1/reviews/{jobId}` response body, where
`findings` is marked "when done" and `usage` is not

## D-025: A cache hit travels the same path as a fresh scan
**Decision:** Every job is enqueued, acquires a semaphore slot, and runs
through the same worker, whether it computes findings or reads them from the
cache. Nothing special cases a cached job.
**Rejected:** Completing a cached job inline in the route and skipping the
queue.
**Why:** The contract requires a cached job's stream to replay the full event
sequence exactly like a computed one. One code path gets that for free; two
paths mean the event sequence is written twice and will eventually differ. A
cached job holds its slot for microseconds, so the concurrency cost is nil.
**Contract reference:** TESTPLAN probe 41, and "Connecting to a finished job's
stream must replay all events identically"

## D-026: The 202 body always reports `status: "queued"`
**Decision:** `POST /v1/reviews` answers `{ jobId, status: "queued" }` even
when the request is an idempotent replay of a job that has since finished.
**Rejected:** Reporting the job's live status on a replay, which is more
truthful.
**Why:** The contract writes the 202 body as a literal, with `queued` spelled
out rather than described as a variable. Following D-001, the literal reading
governs. A client that wants the live status has the polling endpoint, which is
the endpoint that documents a variable status field.
**Contract reference:** "`202` → `{ "jobId": "<opaque>", "status": "queued" }`"

## D-027: `findings` appears only on a done job, `error` only on a failed one
**Decision:** The polling response always carries `jobId`, `status` and
`usage`. `findings` is present only when the status is `done`. `error` is
present only when the status is `failed`.
**Rejected:** Always sending `findings`, as an empty array before completion.
**Why:** The contract annotates `findings` with "when done" and annotates
nothing else, so an empty array on a running job would assert that the scan
found nothing rather than that it has not finished. The distinction matters to
a caller polling a large job.
**Contract reference:** `"findings": [ ... ],  // when done`

## D-028: Every status transition emits a status event, including the last one
**Decision:** The event sequence is `status queued`, `status running`, one
`finding` per finding, `status done`, then `done`. A failed job ends at
`status failed` with no `done` event.
**Rejected:** ARCHITECTURE.md's sequence, which goes straight from the last
finding to `done` with no `status done` event.
**Why:** This is a conflict between two of our own files, flagged here rather
than resolved silently. The contract says the `status` event fires "at least on
status transitions", and reaching `done` is a transition. CLAUDE.md sets the
precedence: the contract outranks ARCHITECTURE.md, so the extra event is
emitted. It cannot break a consumer that keys on the `done` event, since that
event is still the terminator and still carries `total` and `usage`.
**Contract reference:** "event `status` — at least on status transitions"

## D-029: The bearer token is required at boot and compared in constant time
**Decision:** The process refuses to start when `AUTH_TOKEN` is unset or empty,
logging the reason. The comparison itself checks length first and then uses
`timingSafeEqual`.
**Rejected:** Starting with an empty token, or generating a random one at boot.
**Why:** An empty configured token compared naively would authenticate a
request whose header is a bare `Bearer `, turning a missing environment
variable into an open service. A random token would start cleanly and then
reject every scored request for 96 hours, which is a far worse failure than not
starting at all. Constant time comparison costs nothing and removes the only
credential oracle in the service.
**Contract reference:** "Missing/wrong token → `401` with the error envelope"

## D-030: The declared rate limit is the sustained rate, and the burst is larger
**Decision:** The token bucket has a capacity of 40 and refills continuously at
30 tokens per minute. `/spec` declares `rateLimitPerMinute: 30`.
**Rejected:** A capacity of 30, so that the declared number is also the
observable ceiling.
**Why:** The contract requires that a sustained 30 per minute always succeeds.
A bucket whose capacity equals its refill rate cannot guarantee that, because
any jitter in arrival times rejects a request that the contract says must
succeed. The contract also speaks of "your declared burst" as something
separate from the per minute figure, while fixing the shape of `/spec` so that
there is no field to declare a burst in. This is the one place where invariant
3 in CLAUDE.md, that declared limits cannot drift from actual behavior, is not
fully achievable, and it is recorded here rather than left to be discovered. A
probe reading `rateLimitPerMinute` as a hard ceiling would see requests 31
through 40 succeed.
**Contract reference:** "Sustained 30 submissions/minute must succeed; beyond
your declared burst, respond `429`"

## D-031: The bucket is keyed on the bearer token, behind auth
**Decision:** The limiter runs as an `onRequest` hook after the auth hook, on
`POST` only, keyed on the bearer token value.
**Rejected:** Keying on the client IP address, or running the limiter before
auth.
**Why:** Every scored request carries the same single token, so the token is
the only meaningful key the service has; an IP key would behave differently
behind a proxy, which is exactly where this will run. Placing it after auth
means an unauthenticated caller can never consume another caller's budget, so
the limiter cannot be used to deny service to the real client.
**Contract reference:** "Applies to `POST /v1/reviews` only — GETs are never
rate limited"

## D-032: The stream is written directly to the socket, not through the reply
**Decision:** The SSE route calls `reply.hijack()` and writes to `reply.raw`.
**Rejected:** Returning a Node stream from the handler and letting Fastify
serialize it.
**Why:** Fastify's reply lifecycle is built to produce one response body, and
the framing here has to be flushed event by event. Writing to the socket
directly is also what lets the route set `X-Accel-Buffering: no` and keep the
connection open with no serializer sitting between the event log and the wire.
The replay loop and the subscription happen in the same synchronous block, with
no `await` between them, which is what guarantees an event appended in that
window cannot be either missed or delivered twice.
**Contract reference:** "Server-Sent Events (`Content-Type: text/event-stream`)"

## D-033: The heartbeat is a comment and never enters the event log
**Decision:** A running job's stream emits `: heartbeat` every 15 seconds. It
is written straight to the socket, is never appended to `job.events`, and is
never emitted for a job that has already reached a terminal state.
**Rejected:** Modelling the heartbeat as an event type.
**Why:** Invariant 5 says the event log is the only source of stream content,
and a heartbeat is not content: it exists to stop a proxy closing an idle
connection. Keeping it out of the log is also what keeps replay byte identical,
since a job replayed an hour later must produce exactly what it produced live,
and a logged heartbeat would make the two differ by however long the job ran.
**Contract reference:** "Connecting to a finished job's stream must replay all
events identically"

## D-034: `Last-Event-ID` is ignored and every connection replays from the start
**Decision:** Each event carries an `id:` field holding its sequence number,
but a `Last-Event-ID` request header is not honored. Every connection replays
the whole log.
**Rejected:** Resuming from the sequence number a reconnecting client sends,
which is what the `id:` field conventionally enables.
**Why:** The contract asks that connecting to a finished job's stream replays
all events. A client, or a probe, that reconnected after a dropped connection
would then receive a partial sequence and the contract's requirement would fail
in exactly the case it was written for. The `id:` field is still emitted
because it costs nothing and makes the sequence self describing.
**Contract reference:** "Connecting to a finished job's stream must replay all
events identically"

## D-035: A model finding must land on a real added line, and its evidence is replaced with ours
**Decision:** A returned finding is dropped unless its `path` is a path the
diff actually adds to and its `line` is an added line number in that file. The
evidence it claims is compared with the real line after trimming both, and a
mismatch drops the finding. What we emit is always the parsed line verbatim,
never the model's string.
**Rejected:** Requiring exact equality of the claimed evidence, which is what
ARCHITECTURE.md specifies. Also rejected: accepting the model's evidence once
the path and line check out.
**Why:** Exact equality drops a correct finding whenever the model trims
indentation, which they routinely do. Accepting the model's evidence is worse
than either, because a hallucinated finding would then arrive carrying text
that looks real. Comparing trimmed keeps the hallucination check while
tolerating whitespace, and emitting our own text means no bytes the model
invented ever reach the client.
**Contract reference:** "Injection content must never alter your service's
behavior", and the finding object's `evidence` field

## D-036: The model's ruleId is sanitized and namespaced, not trusted or discarded
**Decision:** A returned `ruleId` must match `[A-Za-z0-9_-]{1,32}`, is
uppercased, and gains an `LLM-` prefix unless it already has one. A finding
whose ruleId fails the pattern is dropped.
**Rejected:** Assigning every model finding the same fixed ruleId, and passing
the model's string through unchanged.
**Why:** A fixed ruleId would make the id `LLM-001:path:line` for every finding
on a line, so two genuinely different findings on one line would collapse into
one during deduplication. Passing the string through unchanged lets the model
put a colon in it and forge an id that parses as a different path or line. The
pattern excludes the colon, which is the character the id format is built on.
**Contract reference:** the finding `id` format `"MOCK-003:src/db.ts:41"`, and
"Deduplicate by `id`"

## D-037: Free text from the model is capped and stripped of control characters
**Decision:** `title` is truncated to 200 characters and has line breaks and
control characters removed. A non string or empty title drops the finding.
**Rejected:** Passing the title through as received.
**Why:** `title` is the one field with no ground truth to check against, so it
is the only place a model can put arbitrary text into our response. Capping and
flattening it means the worst a compromised model achieves is a short odd
sentence in a field that is documented as short prose, rather than an injected
payload aimed at whatever reads our output next.
**Contract reference:** `"title": "<short>"`

## D-038: One retry, and only after a timeout
**Decision:** A request that times out is retried exactly once. Any other
failure, a refused connection, a 401, a 500 from the provider, malformed JSON,
is final and fails the job immediately.
**Rejected:** Retrying every failure, and retrying none.
**Why:** A timeout is the only failure mode where the same request might
plausibly succeed unchanged. A rejected key will be rejected again, and a
retry against a dead host just spends the client's 30 second budget twice
before failing anyway. Retrying only the recoverable case keeps the latency
budget intact.
**Contract reference:** "If the model is unreachable at runtime, the job must
fail gracefully", and ARCHITECTURE.md "One retry after a timeout, then stop"

## D-039: One request per chunk, sequential, and any chunk failing fails the job
**Decision:** The llm provider issues one completion per chunk in order, and
propagates the first failure rather than returning partial findings.
**Rejected:** Issuing the chunk requests in parallel, and returning whatever
succeeded when one chunk fails.
**Why:** Partial results are indistinguishable from a clean scan at the API
boundary: the client would receive a `done` job whose findings silently omit
half the diff. A `failed` job with a clear message is the honest answer, and it
is what the contract asks for. Sequential rather than parallel keeps us inside
the free tier rate limits that any hosted endpoint applies, at a latency cost
that only matters for diffs far larger than the scored ones.
**Contract reference:** "the job must fail gracefully (a `failed` job with a
clear error), never crash"

## D-040: The model response is parsed leniently, then validated strictly
**Decision:** The response text is accepted as a bare JSON array, as an object
with a `findings` array, or as either of those wrapped in a markdown code
fence. Anything else fails the job. Every finding inside then goes through the
full validation above.
**Rejected:** Requiring a bare JSON array exactly, and requesting
`response_format: json_object` from the endpoint.
**Why:** The three accepted shapes are what OpenAI compatible models actually
emit when asked for JSON, and rejecting the fenced form would fail jobs for a
formatting habit rather than a real problem. `response_format` is not
implemented uniformly across the vendors ARCHITECTURE.md says must work
unchanged, so depending on it would tie the service to one of them. Leniency
about the envelope costs nothing because the contents are validated against
parsed ground truth regardless.
**Contract reference:** "a real-LLM code path behind the same pipeline (any
vendor)"

## D-041: An environment variable that is present but empty counts as absent
**Decision:** Numeric configuration goes through a reader that treats an empty
or whitespace only value as missing and falls back to the documented default,
and that rejects a parsed value which is not a positive safe integer.
**Rejected:** The idiomatic `Number.parseInt(process.env.X ?? 'default', 10)`.
**Why:** Found by the first live run rather than by reasoning, which is the
reason it is recorded rather than quietly patched. `??` catches null and
undefined, and an empty string is neither, so a `.env` written from
`.env.example` with `LLM_TIMEOUT_MS=` left blank produced `NaN`. A NaN timeout
makes `setTimeout` fire on the next tick, so every model request timed out
instantly and the retry did too. The same expression governs `PORT`, where a
blank value would have bound the deployed service to a random port and passed
every local test first.
**Contract reference:** DEPLOY.md environment table, where `LLM_TIMEOUT_MS` and
`PORT` are both documented as optional with defaults

---

## Template for new entries

```
## D-0NN: <short title>
**Decision:**
**Rejected:**
**Why:**
**Contract reference:**
```

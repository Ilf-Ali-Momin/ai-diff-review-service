# SUBMISSION.md

AI Diff Review Service. Base URL `https://ilf-diff-review.duckdns.org`, bearer
token sent separately by email.

## Architecture

A request enters through a fixed pipeline, and the order is deliberate: route
match, then auth on headers only, then the rate limiter, then the size guard,
then JSON parsing, then schema validation. Auth runs first so a 2 MiB
unauthenticated request costs nothing and answers `401` rather than `413`, and
so an anonymous caller can never spend the real client's rate limit budget.

The code splits into a pure core and a service layer. The parser, the nine
rules, the ordering function and the chunker are pure functions with no I/O, no
clock and no randomness, and they were finished and fully tested before any
HTTP route existed. That is where exactness lives and it is far cheaper to get
right in isolation.

A submission creates a job, which is enqueued behind a counting semaphore of
four with an unbounded FIFO backlog. Workers never write to a socket. They
append to an append only event log on the job, and the SSE route reads that
log. That single decision is what makes replay, late connection, multiple
concurrent streams and cached jobs all work with no special cases.

Everything is in memory: jobs, the idempotency index and the result cache. A
restart loses all of it, which is stated below rather than hidden.

## Provider design

The `Provider` interface takes chunks and returns findings. It deliberately
knows nothing about ordering, deduplication, truncation, caching or streaming;
the pipeline owns all of those, once, for every provider.

`mock` is a pure function. Same diff, same findings, same order, every time,
which is what makes it scoreable at all.

`llm` speaks to any OpenAI compatible chat completions endpoint, configured
entirely by environment variables, so no vendor leaks into the pipeline. It
currently runs against Groq.

Diff content is kept inert in two layers. The weak layer is the prompt: content
travels in a user message wrapped in a delimiter generated per request, under a
system message stating the block is untrusted data that must never be obeyed.
The layer that actually matters is validation. Every finding the model returns
is checked against the diff the service parsed itself. The path must be one the
diff adds to, the line must be an added line in that file, the claimed evidence
must match the real line, and severity and category must be in the enums.
Anything failing is dropped silently, and the evidence we emit is our parsed
text rather than the model's string. A test covers the case where the model is
fully subverted by the diff and returns a finding for `/etc/passwd`: it is
dropped, because that path is not in the diff.

Degradation: a timeout is retried exactly once, and nothing else is retried,
because a refused connection or a rejected key will fail identically the second
time. Any failure marks one job `failed` with a clear message and leaves the
process healthy. Verified against the live server by pointing `LLM_BASE_URL` at
an unroutable host and confirming a failed job, a healthy `/health` and an
unaffected mock path.

## Verification of the cross cutting behaviors

219 in process tests, plus a 50 case black box probe suite in `test/probe` that
runs over real HTTP against a base URL and a token. The same suite runs against
localhost and against the deployed service, and it was run against the deployed
HTTPS URL before submission.

### Chunking

The property test in `test/core/chunk.test.ts`, "produces deep equal findings
at every chunk size", scans one diff chunked and unchunked and compares the
finding arrays. It runs at six chunk sizes from 64 bytes to 64 KiB, then a
second test sweeps the boundary across every position in 137 byte steps.

That test is only meaningful because of a design choice: the mock provider re
parses each chunk rather than sharing one parse of the whole diff. Sharing the
parse would have made "a chunked scan equals an unchunked scan" true by
definition, and the test would have asserted nothing. The fixture also names
its files out of lexicographic order, so a chunked scan returning findings in
discovery order fails rather than passing by luck.

Boundary cases are covered separately: a single file larger than the whole
budget becomes its own chunk, and a multibyte UTF 8 test confirms the budget is
measured in bytes rather than string length, by using characters that are three
bytes each.

### Caching

`test/http/cache.test.ts` asserts that the first submission reports
`cacheHit: false` and every later identical one reports `true` with identical
findings, and a counting provider proves the scan itself ran once rather than
twice.

The decisive test is "shares one scan across two limits and truncates correctly
for each". The same diff at `maxFindings: 1` and then at `maxFindings: 100`
shares a single scan and still returns nine findings on the second call.
Caching the truncated list instead of the full one would have silently answered
that second request with one finding. The cache key is the diff hash plus the
provider, and excludes `maxFindings` for exactly this reason.

One case goes beyond the contract. The cache stores a promise rather than a
finished result, so three byte identical diffs submitted at the same instant
produce three jobs, three full event sequences and one provider call. Caching
completed results only would have satisfied the contract for submissions far
enough apart and quietly failed it under concurrency. A rejected scan is
deleted from the cache, so a failure is never cached.

### Idempotency

`test/http/cache.test.ts` again. The same key with a byte identical body
returns the same `jobId`; a different body returns `409`; and the same JSON
with reordered keys also returns `409`, because the hash is over the raw
request bytes and the contract says byte identical. That last test asserts the
two documents are equal as objects and unequal as bytes before submitting them,
so it cannot pass by accident. A different key with the same body produces a
new job that still reports `cacheHit: true`, which is the case that shows
idempotency and caching are two mechanisms and not one.

### SSE replay

`test/http/sse.test.ts`, "gives a late connection byte for byte what a live one
received". A gated provider holds a job open; one stream is opened while it is
still running and collects the events as they arrive live; a second stream is
opened after the job has finished. The two responses are compared byte for
byte. Nothing is shared between the connections except the log they both read.

Also covered: connecting midway, where the sequence numbers must appear exactly
once each and in order; two concurrent streams on one job; a cached job
producing the same sequence as the job that did the work; and a failed job
terminating cleanly at its status event with no fabricated `done`.

The heartbeat is a comment written straight to the socket and never appended to
the log, which is what keeps replay byte identical: a logged heartbeat would
make a replayed stream differ from the live one by however long the job ran.

Buffering was verified against the deployed service rather than assumed. A job
in flight, streamed through the reverse proxy with `curl -N`, delivered its
status events at 123 ms and its findings at 976 ms. A proxy buffering the
stream would have delivered all six events together at the end.

## AI tools used

Claude Code, used heavily and throughout, for essentially all of the
implementation and the tests.

The workflow is the part worth describing, because it is a judgment call rather
than a tool choice. The context files were written before any code:
`CONTRACT.md` verbatim from the task, then `RULES.md` resolving every rule
ambiguity, `ARCHITECTURE.md` for the designs that matter, `TESTPLAN.md`
enumerating 84 probes, and `DECISIONS.md` starting at D-001. Implementation
then ran against those documents phase by phase, with a stop and a report at
each phase gate, and `DECISIONS.md` appended to before writing the code that
depended on a decision rather than reconstructed afterwards. It now holds 42
entries.

Resolving the rule ambiguities in writing first is what kept the implementation
and the tests from drifting apart. Both were written against the same
resolutions, so a test passing means the resolution was implemented rather than
that the test was written to match whatever the code happened to do.

Two bugs are worth naming because they show where the process caught things and
where it did not. Neither was found by a test.

The first: `LLM_TIMEOUT_MS=` left blank in an environment file is an empty
string, not undefined, so `Number.parseInt(process.env.X ?? '20000')` yields
`NaN` and `setTimeout` with a `NaN` delay fires on the next tick. Every model
request timed out instantly. The same expression governed `PORT`, where it
would have bound the deployed service to a random port while every local test
still passed. Found by the first live run against a real model, not by 208
passing tests.

The second: a failed job whose model host was unreachable reported the message
`fetch failed`, which is what `fetch` says for every network fault while hiding
the real reason on `cause`. The contract asks a failed job to carry a clear
error. Found while working the deployment checklist against the live server.

## An AI suggestion I rejected

The naive implementation of MOCK-005 is a substring match on `== null`. It is
what a coding assistant proposes first and it is what the contract literally
says in the trigger column. It is also wrong: `=== null` contains the substring
`== null`, so a substring match fires on strict equality, which the rule's own
title, "loose null comparison", directly contradicts. The implementation uses a
lookbehind excluding `=!<>` and a lookahead excluding a third `=`, and there is
a test asserting zero findings for `x === null` and `x !== null`. Recorded as
D-007.

A second one, from the build rather than the planning, cuts the other way.
`ARCHITECTURE.md` specified that a model returned finding must be dropped
unless its claimed evidence exactly equals the real line. Implemented literally
that drops correct findings whenever the model trims indentation, which they
routinely do. The implementation compares the two after trimming and then emits
the parsed line verbatim, so whitespace is tolerated while nothing the model
wrote reaches the client. Recorded as D-035, along with why accepting the
model's evidence once the path and line check out would have been worse than
either option.

D-006 is the decision I am least certain about and it is worth stating.
MOCK-004 treats a catch block containing only a comment as not empty, because
the trigger says "empty" and a comment is content. The opposite reading, that a
comment only catch still swallows the exception, is defensible on intent. The
literal reading governs everywhere else in the rule table, so it governs here,
but this is the single most likely place this implementation diverges from the
scorer.

## What I would do next with more time

- Persistence, so a restart does not lose jobs, and the horizontal scaling that
  follows once the semaphore and the rate limiter stop being process local.
  These are the same piece of work and it is the largest gap.
- Streaming request body parsing, rather than rejecting on `Content-Length`.
- A richer llm path: chunk level parallelism, structured output enforcement
  where the endpoint supports it, and a confidence signal on findings.
- Cache and job eviction. Neither store evicts, which is bounded and safe for a
  96 hour window and wrong beyond it.
- Observability: structured per stage timings rather than a verified latency
  budget. The 30 second budget is currently tested, not monitored.

## Deliberately out of scope

Stated plainly rather than left to be discovered.

- Persistence across restarts. Single instance, in memory. A restart loses
  every job. Acceptable behind an always restart policy for a bounded window,
  wrong for production.
- Horizontal scaling. The semaphore and the rate limiter are process local, so
  a second instance would enforce neither limit correctly.
- Auth beyond one static bearer token. No users, no rotation, no scopes.
- LLM retries beyond a single attempt after a timeout.
- `Last-Event-ID` resumption. Every stream connection replays from the start,
  because the contract requires a finished job's stream to replay all events
  and a partial replay would fail that in exactly the case it was written for.

One declared limit deserves its own line. `/spec` reports
`rateLimitPerMinute: 30`, which is the sustained rate the contract asks about,
while the token bucket holds a burst of 40. A bucket whose capacity equals its
refill rate cannot guarantee that a sustained 30 per minute always succeeds,
which the contract requires, and the shape of `/spec` is fixed by the contract
with no field for a burst. So requests 31 to 40 in a single burst succeed. That
is the one place where declared limits and actual behavior are not identical,
and it is recorded as D-030 rather than left to be found.

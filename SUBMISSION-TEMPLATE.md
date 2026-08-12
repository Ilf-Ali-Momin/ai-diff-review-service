# SUBMISSION-TEMPLATE.md

Skeleton for the `SUBMISSION.md` that ships in the repo root. The section list
comes from the client's email, which is more specific than the task file: it
names **chunking, caching, idempotency and SSE replay** as the four cross
cutting behaviors to account for.

Fill this in **as each phase completes**, not at the end. Most of it comes
straight out of `DECISIONS.md`, which is why that file is written continuously.

Delete this instruction block when copying to `SUBMISSION.md`.

---

## Architecture

About ten lines, as the contract permits. Cover:

- the request pipeline and the order of its stages, since the ordering of auth,
  rate limit, size guard, parse and validate is a deliberate choice
- the split between the pure core (parser, rules, chunker, ordering) and the
  service layer, and why the core has no I/O
- the job lifecycle and the event log, which is the single design decision that
  makes replay, late connection, multiple concurrent streams and cached jobs
  all work without special cases
- the semaphore and the queue
- what is in memory and therefore what a restart loses

## Provider design

- the `Provider` interface and what it deliberately does not know about:
  ordering, caching, streaming, truncation
- `mock` as a pure function, no I/O, no clock, no randomness, which is what
  makes it scoreable
- `llm` against any OpenAI compatible endpoint, configured entirely by
  environment variables, so the vendor never leaks into the pipeline
- how diff content is kept inert: delimited as untrusted data, plus validation
  of every returned finding against parsed ground truth, so a path or line that
  does not exist in the diff is dropped regardless of what the model claims
- how the path degrades: timeout, one retry, then a `failed` job with a clear
  message and a process that stays healthy

## Verification of the cross cutting behaviors

One subsection each. Name the specific test, not a general statement that
testing happened.

### Chunking

The property test: the same diff scanned chunked and unchunked produces deep
equal finding arrays. Plus the boundary cases, a single file over 64 KiB
becoming its own chunk, and multibyte UTF 8 near a boundary confirming byte
length rather than string length.

### Caching

First submission reports `cacheHit: false`, every later identical one reports
`true` with identical findings. The key excludes `maxFindings` deliberately,
so the same diff at limits of 10 and 100 shares one scan and truncates at read
time. Cross reference D-009.

### Idempotency

Same key and byte identical body returns the same `jobId`. Same key and a
different body returns 409. Same JSON with reordered keys returns 409, because
the contract says byte identical and the hash is over raw request bytes.
Cross reference D-010.

### SSE replay

A stream opened on a job that finished minutes earlier produces the identical
event sequence to one opened before the job started. Also covered: connecting
midway, two concurrent streams on one job, and a cached job streaming the same
full sequence as a computed one. Cross reference D-011.

## AI tools used

Be specific and honest. Which tool, for what, and what you did yourself. The
task explicitly encourages AI use, so there is nothing to soften. What reads
badly is vagueness.

Worth stating plainly: the context file set (`CONTRACT.md`, `RULES.md`,
`ARCHITECTURE.md`, `TESTPLAN.md`, `DECISIONS.md`) was written before any code,
and the rule ambiguities were resolved in `RULES.md` first so that the
implementation and the tests could not drift apart. That workflow is itself a
judgment call worth describing.

## An AI suggestion I rejected

At least one, from `DECISIONS.md`, real rather than invented.

**D-007 is the strongest candidate.** The naive implementation of MOCK-005 is
a substring match on `== null`, which is what a coding assistant proposes
first and what the contract literally says. It is wrong: `=== null` contains
the substring `== null`, so a substring match fires on strict equality, which
the rule title "loose null comparison" directly contradicts. The fix is a
lookbehind and lookahead excluding the strict operators.

This one is good because it is concrete, it is verifiable by anyone reading
the rule table, and it shows the contract was read closely rather than fed to
a model wholesale.

D-006 is a good second, since it goes the other way: a comment only catch
block is arguably a swallowed exception, but the trigger says "empty" and the
literal reading governs. Naming a decision you are less certain about reads as
honesty rather than weakness, and it is a good thing to have ready before
someone asks.

## What I would do next with more time

Rank by what you would actually reach for first. Candidates:

- persistence, so a restart does not lose jobs, and the horizontal scaling that
  follows once the semaphore and the rate limiter stop being process local
- streaming request body parsing rather than rejecting on `Content-Length`
- a richer LLM path: chunk level parallelism, structured output enforcement,
  a confidence signal on findings
- cache eviction and job retention policy, which the current design omits
  because the scoring window is bounded
- observability, meaning structured logs and per stage timings, since the
  latency budget is currently verified rather than monitored

## Deliberately out of scope

State these plainly rather than leaving them to be discovered. The contract
invites prioritization, so an explicit list reads as judgment and an
unexplained gap reads as an oversight.

- persistence across restarts, single instance and in memory
- horizontal scaling
- auth beyond one static bearer token, no users, no rotation, no scopes
- LLM retries beyond a single attempt after timeout

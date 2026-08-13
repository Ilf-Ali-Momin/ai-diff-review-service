# KICKOFF.md

Build order. Work through the phases in sequence. **Stop at the end of each
phase and report before continuing.** Do not run ahead.

## Reading order, before writing any code

1. `BRIEF.md` first. It records the client's covering email and **supersedes
   the task file where they conflict.** The live conflict is the scoring
   window: the task file says 48 hours, the email says 96.
2. `CONTRACT.md` in full. This is the client's task, verbatim.
3. `CLAUDE.md` for stack, invariants and working method.
4. `RULES.md` in full. Every rule ambiguity is already resolved there.
5. `ARCHITECTURE.md` for module layout and the designs that matter.
6. `TESTPLAN.md`, which is written before the code deliberately.
7. `DECISIONS.md`, entries D-001 to D-012, so you know what has been settled.
8. `SUBMISSION.md`, so you know from the start what evidence the final write up
   will need and can collect it as you go. It began as a skeleton whose section
   list came from the client's email, and was filled in as each phase completed.

Then confirm you have read them and state anything you believe is
contradictory **before** starting phase 1.

---

## Phase 1: skeleton and config

- `package.json`, TypeScript strict, Vitest, Fastify
- `src/config.ts` holding every declared limit as the single source
- `src/http/errors.ts`, the envelope helper and the code taxonomy
- `GET /health` and `GET /spec`, both public, spec serialized from config
- global handlers for 404, method not allowed, and unhandled errors, all
  routed through the envelope
- `unhandledRejection` and `uncaughtException` handlers

**Gate:** probes 1, 2, 58, 59 pass. No route returns a framework default page.

---

## Phase 2: the pure core

No HTTP in this phase. Pure functions and unit tests only. This is where
exactness lives and it is far cheaper to get right in isolation.

- `src/core/parseDiff.ts`, producing `AddedLine[]` and `FileSegment[]`
- `src/core/rules.ts`, all nine predicates exactly as RULES.md specifies
- `src/core/order.ts`, dedupe by id then sort, one function used everywhere
- `src/core/chunk.ts`, greedy pack on file boundaries, UTF 8 byte length
- `src/providers/mock.ts`, wiring the above behind the Provider interface

Write the unit tests from TESTPLAN.md rows 13 to 33 **as you go**, not after.
Row 31, the chunked versus unchunked property test, is the highest value test
in the plan. Write it early.

**Gate:** every unit test green, including every negative case in the RULES.md
tables and every substring trap (rows 17, 18, 19, 20, 21).

---

## Phase 3: jobs, queue and the event log

- `src/jobs/store.ts`, the three maps
- `src/jobs/queue.ts`, semaphore of 4 with an unbounded FIFO backlog
- `src/jobs/worker.ts`, appends events, releases its slot in a `finally`,
  never throws
- `POST /v1/reviews` with validation, idempotency and caching
- `GET /v1/reviews/:id`

**Gate:** probes 3 to 6, 43 to 56, 70 to 74 pass. Pay attention to the
distinction between idempotency and caching, D-009 and D-010. They are
different mechanisms with different keys returning different things.

---

## Phase 4: streaming and rate limiting

- `GET /v1/reviews/:id/stream`, replay then subscribe
- SSE headers including `X-Accel-Buffering: no`, compression disabled on this
  route, heartbeat every 15 seconds on running jobs
- `src/http/rateLimit.ts`, token bucket, POST only

**Gate:** probes 34 to 42 and 65 to 69 pass. Verify replay on a job that
finished minutes earlier, and verify GETs are never rate limited.

---

## Phase 5: the llm provider

- `src/providers/llm.ts` against any OpenAI compatible endpoint
- untrusted input wrapping exactly as ARCHITECTURE.md specifies
- validation of every returned finding against parsed ground truth, dropping
  anything whose path or line does not exist in the diff
- timeout, one retry, then a `failed` job with a clear message

**Gate:** probes 61 to 64 and 79 to 84 pass. Test the failure path by pointing
`LLM_BASE_URL` at an unroutable host and confirming a `failed` job with
`/health` still returning 200.

---

## Phase 6: deployment and submission

- Dockerfile, multi stage, non root, health check on `/health`
- `.env.example` with key names and empty values
- run the **full** probe suite against the deployed URL, not localhost
- work through the DEPLOY.md pre submission checklist top to bottom
- write `SUBMISSION.md`

Write `SUBMISSION.md`. The client's email is more
specific than the task file about what it must contain, and **names the four
cross cutting behaviors explicitly**: chunking, caching, idempotency and SSE
replay. Each gets its own subsection naming the specific test that proves it,
not a general paragraph about testing.

For the rejected AI suggestion, use a real entry from `DECISIONS.md`. D-007 is
the strongest: the naive substring reading of MOCK-005 is exactly what a coding
assistant proposes first, and it is wrong because `=== null` contains the
substring `== null`. Do not invent one.

Deployment, per `DEPLOY.md`: the window is **96 hours**, which rules out a
tunnel and makes the restart policy and an uptime monitor part of the job
rather than a nicety.

---

## Throughout

Append to `DECISIONS.md` before writing code that depends on a decision. If a
phase produces no new entries, say so explicitly at the gate, so the absence
is visible rather than assumed.

If you run short of time, stop and report what is unfinished. Do not ship a
stub that looks complete. The contract explicitly invites prioritization and
an honest account of what was skipped.

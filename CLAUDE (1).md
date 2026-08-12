# CLAUDE.md

Master context for the AI Diff Review Service. Read this first, then KICKOFF.md.

## What this is

A take home task for an internship application at Xsolla, for an AI First
Engineering Intern role. A live HTTP service will be scored by automated probes
over a **96 hour window**, then defended in an interview. Correctness of cross
cutting behavior matters more than features.

The repository is **read by humans and never executed**. Code clarity is
therefore scored implicitly even though it does not appear in the published
scoring list. A reviewer forms a judgement from reading alone.

## Source of truth and precedence

`CONTRACT.md` is the task as given by the client, verbatim. It is never
edited, never paraphrased, never summarized into code comments.

`BRIEF.md` records the covering email the client sent afterwards. Where the
email and the task file disagree, **the email wins**, because it is the more
recent instruction. The one live conflict is the scoring window: the task file
says 48 hours, the email says 96, and 96 is correct.

Precedence, highest first: `BRIEF.md`, then `CONTRACT.md`, then everything
else. When any other file disagrees with those two, flag the conflict rather
than silently choosing.

`RULES.md` is the authoritative interpretation of the nine mock rules. Every
ambiguity in the contract has already been resolved there. Do not re resolve
them. Do not "improve" a rule you think is wrong. If you believe a resolution
in RULES.md is a mistake, say so and wait, do not act.

## Stack

- Node 20 LTS, TypeScript, strict mode
- Fastify for HTTP (native SSE support, low overhead, good error hooks)
- Vitest for tests
- Zero database. In memory stores only.
- Docker for deployment

Do not add dependencies beyond these without asking. No ORM, no Redis, no
queue library. The job queue is forty lines of TypeScript and writing it
yourself is the point of the exercise.

## Hard invariants

These are non negotiable. A violation is a bug even if tests pass.

1. **Every non 2xx response goes through the error envelope helper.** No
   framework default error pages. No bare strings. Unknown routes, method not
   allowed, unhandled exceptions, all of them. The shape is exactly
   `{ "error": { "code": "...", "message": "..." } }` and `code` is drawn only
   from the taxonomy in CONTRACT.md.

2. **No rule ever evaluates a raw diff line.** The leading `+` marker is
   stripped exactly once, in the parser, before any rule sees the text. A rule
   receiving text that still carries its marker is a parser bug.

3. **`/spec` is generated from the same config object the runtime enforces.**
   The rate limiter, the chunker, the body size guard and the semaphore all
   read their numbers from `src/config.ts`. Declared limits cannot drift from
   actual behavior because they are the same values.

4. **Ordering is applied in exactly one place.** A single `sortFindings`
   function, called once, feeding both the JSON result and the event log.
   Never sort twice, never sort differently in two places.

5. **The event log is the only source of stream content.** Workers append
   events to a job's log. The SSE endpoint reads the log. It never receives
   events directly from a worker. This is what makes replay work.

6. **Diff content is data, never instruction.** This holds for the mock
   provider trivially and for the LLM provider deliberately. See
   `ARCHITECTURE.md` for the wrapping and validation requirements.

7. **The service never crashes.** Unhandled rejection and uncaught exception
   handlers are installed. A provider failure marks one job `failed` and
   leaves the process healthy.

## Working method

Build in the order given by KICKOFF.md. Stop at the end of each phase and
report. Do not run ahead.

Pure logic first, service second. The parser, the rules and the chunker are
pure functions with no I/O and they are fully tested before any HTTP route
exists. This is where exactness lives and it is much cheaper to get right in
isolation.

### DECISIONS.md is mandatory and continuous

Every time you resolve an ambiguity, choose between two viable designs, or
reject an approach, append an entry to `DECISIONS.md` **before writing the
code that depends on it**. Format:

```
## D-0NN: <short title>
**Decision:** what you did
**Rejected:** the alternative
**Why:** one or two sentences
**Contract reference:** the line in CONTRACT.md that forced or permitted this
```

This file is a deliverable. It is the raw material for SUBMISSION.md and for
the interview. Reconstructing it afterwards from finished code does not work
and is not acceptable. If a phase produces no new entries, say so explicitly
so the omission is visible rather than assumed.

## Writing style for all documentation and comments

No hyphens in prose. Write "cross cutting" not "cross-cutting", "free tier"
not "free-tier". This does not apply to literal protocol strings, identifiers
or code, where `Retry-After`, `MOCK-001`, `text/event-stream` and
`Idempotency-Key` are spelled exactly as the contract spells them.

Comments explain why, not what. A comment restating the line below it is
noise. A comment recording which contract clause forced an odd looking choice
is valuable.

## Scope

In scope: everything in the "What we score" list in CONTRACT.md.

Deliberately out of scope, to be declared in SUBMISSION.md rather than hidden:

- Persistence across restarts. Single instance, in memory. A restart loses
  jobs. Acceptable for a 96 hour scored window given an always restart policy,
  wrong for production, and saying so is better than pretending otherwise.
- Horizontal scaling. The semaphore and rate limiter are process local.
- Auth beyond one static bearer token. No users, no rotation, no scopes.
- LLM retries beyond a single attempt after timeout.
- Streaming request body parsing. We reject on Content-Length instead.

Do not silently skip anything else. If you run short on time, stop and report
what is unfinished rather than shipping a stub that looks complete.

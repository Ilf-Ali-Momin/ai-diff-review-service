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

---

## Template for new entries

```
## D-0NN: <short title>
**Decision:**
**Rejected:**
**Why:**
**Contract reference:**
```

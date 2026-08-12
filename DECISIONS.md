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

---

## Template for new entries

```
## D-0NN: <short title>
**Decision:**
**Rejected:**
**Why:**
**Contract reference:**
```

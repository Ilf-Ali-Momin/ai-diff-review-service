# BRIEF.md

The client sent a covering email alongside `CANDIDATE-TASK.md`. Where the two
disagree, **this file wins**, because it is the more recent instruction.
`CONTRACT.md` remains verbatim and is not edited.

Role: AI First Engineering Intern, Xsolla.

## Material differences from CONTRACT.md

### 1. The scoring window is 96 hours, not 48

`CONTRACT.md` line 20 says 48. The email says 96, starting when the submission
email is sent. **96 is correct.** Four days of continuous uptime.

Consequences, all of them deployment consequences:

- A tunnel from a laptop is now effectively disqualified. Four days without a
  closed lid, a sleep, a wifi drop or a router reboot is not a bet worth taking.
- Idle sleep matters more, since a four day window contains far more idle
  periods where a probe can land on a cold start.
- Any in memory growth that would be harmless over 48 hours needs a second
  look. The stores in `ARCHITECTURE.md` have no eviction, which is fine for a
  bounded probe run but should be sanity checked against four days of traffic.
- The service should survive a host restart without manual intervention.
  Restart policy set to always.

### 2. The four cross cutting behaviors are named explicitly

`CONTRACT.md` asks generally how cross cutting behaviors were verified. The
email names four:

**chunking, caching, idempotency, SSE replay.**

`SUBMISSION.md` needs a dedicated section for each of the four, each naming the
specific test that proves it. Not a general paragraph about testing. This is
the clearest signal in the email about where the interview questions will come
from, so the answers should be sharp enough to say out loud.

### 3. The repository is read by humans, never executed

Stated in both the task file and the email. This means code clarity is scored
implicitly even though it is not in the published scoring list. Naming, module
boundaries and comments explaining why rather than what all carry weight,
because a reviewer forms a judgement from reading alone and cannot run anything
to see it work.

### 4. The llm provider is phrased more softly, but is still scored

The email says "if you also wire up a real llm provider". `CONTRACT.md` says it
**must** be fully configured, and the published scoring list includes "that the
llm path exists and degrades gracefully".

**Build it.** The stricter reading governs. The softer email phrasing is not
permission to skip a scored item.

## Submission mechanics

Reply to the original email, keeping the cc list intact. Include:

1. Base URL and bearer token
2. Repository URL, public or with access granted
3. Confirmation that `SUBMISSION.md` is complete

Record the exact send time. The 96 hour clock starts there.

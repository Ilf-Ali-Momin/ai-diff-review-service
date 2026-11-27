# Proofline review of PR #1

Proofline raised ten findings on the benchmark pull request. This records what
it said, what was done, and where the response differed from the suggestion.

All ten were addressed in commit `c9cf807`.

## The findings

### 1. Case ids in reviewer facing pull requests expose the answer key

**Proofline said:** `push-cases.ts` puts the case id in pull request titles,
and the generated README links back to the repository holding the labelled
fixtures, so a reviewer can look up the expected finding instead of finding it.

**Verdict:** accepted.

**Why:** correct, and worse than stated. The id also appeared in branch names
and file paths, so three channels leaked it rather than one. A reviewer with
repository access could have read `groundTruth` and the written diagnosis under
that id, and would then have been scored on an easier task than the model,
which only ever sees diff text. Reviewer facing output now uses an opaque slug
derived from the id, the README no longer names the source repository, and the
slug to id mapping is written to `results/`, which is evaluator only. Nothing
had been pushed when this was found, so no case was exposed.

**Commit:** `c9cf807`

### 2. Generated pull requests point reviewers at the answer key

**Proofline said:** the same leak, reported against a second case file.

**Verdict:** accepted, fixed by the change above.

**Why:** one defect reported twice, once per case file it showed up in.

**Commit:** `c9cf807`

### 3. Removed benchmark cases still run after a rebuild

**Proofline said:** taking an id out of `cases.config.json` leaves its fixture
directory on disk, and `loadCases` keeps loading it.

**Verdict:** accepted.

**Why:** correct. `build()` only replaces the directory of the case it is
building, so a removed case kept being scored. A rebuild now deletes any case
directory whose id is absent from the manifest.

**Commit:** `c9cf807`

### 4. A line past the end of the diff counts as context

**Proofline said:** `parseDiff` turns a fixture's terminating newline into a
context row, and `groundingOf` then labels a finding there `context` rather
than `fabricated`.

**Verdict:** accepted, and the fix goes further than suggested.

**Why:** correct, and reproduced directly: a diff ending in a newline produced
a context row one line past the last real line. Proofline framed this as a
benchmark scoring problem. It is really a parser problem, and the benchmark
only inherits it, because `indexDiff` is built from `parseDiff`. The fix is in
`src/core/parseDiff.ts`, so the service is corrected too, not only the scorer.
The service was never affected in practice, because `groundTruthFor` indexes
added lines alone and a phantom context row never reached it. Genuine blank
context lines inside a hunk still count, with a test for each case.

**Commit:** `c9cf807`

### 5. Case validation accepts snapshots that disagree with the patch

**Proofline said:** `cases.test.ts` checks labelled lines against a pooled list
of additions and never checks the base snapshot, so two labelled lines could be
swapped in the head snapshot and still pass.

**Verdict:** accepted.

**Why:** correct. The test now applies the stored patch to the base snapshot
and asserts the result equals the head snapshot exactly, for all fifteen cases,
which ties patch, snapshots and ground truth together. The weaker pooled check
is kept alongside it, since it gives a clearer failure message when a single
line is wrong. All fifteen fixtures pass the new check, so no case was broken.

**Commit:** `c9cf807`

### 6. Documentation implies reviewers receive the diagnoses

**Proofline said:** the README and `cases.config.json` call the diagnoses
reviewer facing, but neither review path sends them.

**Verdict:** accepted.

**Why:** correct, and the wording was misleading about the benchmark's central
claim. Both files now describe the diagnoses as report explanations and say
plainly that no reviewer is given them.

**Commit:** `c9cf807`

### 7. The benchmark can count findings the service would reject

**Proofline said:** the README says the scoring rule and `validateFinding` are
the same rule, but scoring can count a correctly located finding that carries
no quote, which `validateFinding` rejects.

**Verdict:** accepted.

**Why:** correct, and the most useful finding of the ten, because it corrects a
claim in the opening paragraph rather than a detail. The difference is
deliberate: most GitHub review apps never quote the line they comment on, so
judging them on location is the only fair option. The README now states the
difference and that a benchmark catch is not always a finding the service would
return.

**Commit:** `c9cf807`

### 8. The three run command is undocumented

**Proofline said:** the README presents one run per reviewer as a limitation,
but the published model numbers use three, so the documented commands cannot
reproduce them.

**Verdict:** accepted.

**Why:** correct. `--runs` was added in the previous commit and the README was
not updated with it. It now shows one run as the default and
`npm run bench:model -- --runs 3` for the published numbers.

**Commit:** `c9cf807`

### 9. The reviewer table omits the strict baseline and misstates call count

**Proofline said:** the table does not list `diff-review-service-strict`, and
the text claims one model call per case where the runner shares each chunk's
response across all three model derived rows.

**Verdict:** accepted.

**Why:** correct on both points. The strict row was added in the previous
commit without updating the table. The table now lists all three rows and the
text says they share one response per chunk.

**Commit:** `c9cf807`

### 10. The reviewer table omits the strict row and misstates granularity

**Proofline said:** the same two problems, reported a second time against an
overlapping line range.

**Verdict:** accepted, fixed by the change above.

**Why:** one defect reported twice.

**Commit:** `c9cf807`

## Second review, after `c9cf807`

Proofline re-reviewed the fixes and raised seven more, six of them about the
documentation written in the first round. One is a rejection.

### 11. The limits section still says one run per reviewer

**Proofline said:** the running instructions now document three runs, but the
limits bullet still states one run, so the published ranges read as single run
results.

**Verdict:** accepted.

**Why:** correct, and a miss in the first round: the `--runs` flag was
documented in one place and contradicted two sections later. The bullet now
says three runs for the model and one for hosted reviewers, and explains that
bugs caught is min / median / max across runs while the finding counts beside
it are totals, so the two columns are not read the same way.

**Commit:** `91e1426`

### 12. The quickstart produces four samples, not three

**Proofline said:** the quickstart lists both `bench:model` and
`bench:model -- --runs 3`. The first writes unsuffixed files, the second
writes suffixed ones, `loadRuns` reads all of them, and each model reviewer
ends up with four samples.

**Verdict:** accepted, and the fix goes further than suggested.

**Why:** correct, and a defect introduced by the first round's own
documentation fix. Proofline suggested showing only the three run command.
That leaves the trap in place for anyone who runs the single form first, so
`bench:model` now deletes its own previous output before writing, for its
three reviewers only. The quickstart also shows one path rather than two.

**Commit:** `91e1426`

### 13. The push command cannot be pasted into a shell

**Proofline said:** the unquoted `<you>` placeholder in the `bench:push`
example is redirection syntax to Bash, so pasting the command fails before
anything is pushed.

**Verdict:** accepted.

**Why:** correct. Replaced with `YOUR_GITHUB_OWNER` and an instruction to
substitute it. Reported twice, against two lines of the same block.

**Commit:** `91e1426`

### 14. karma-3 scores a correct finding as a miss

**Proofline said:** karma-3 labels line 99, but the return that appends the
unwanted newline is line 102, outside `LINE_TOLERANCE`, so a reviewer that
correctly flags the return gets no credit. It suggested adding the return as
an explicit alternate scoring location.

**Verdict:** rejected, limitation documented instead.

**Why:** the facts are right and the remedy is not. The reversal changes line
99 only; line 102 is context, identical in the base and head snapshots, so
crediting it means crediting a reviewer for a line the pull request never
touched. More importantly, an alternate location would be the first hand
written label in the set, and the benchmark's claim to usable ground truth
rests on every label being derived from the reversed fix. Adding one by hand
where a reviewer happened to miss also biases the set toward whichever
reviewer prompted the addition. The README now records this as a limit, with
karma-3 named as the example, so a reader can see the cost rather than
discover it.

**Commit:** `91e1426`

## What the review changed

Seventeen findings across two rounds, covering twelve distinct problems, since
three pairs were the same defect reported twice.

**Four were real defects in behaviour.** The answer key leak, the stale fixture
directories, the phantom context line, and the weak snapshot validation. Of
these, the answer key leak was the one that would have invalidated the
benchmark's results rather than merely producing a wrong number, and it was
found before anything was pushed. The phantom context line was the only finding
that reached outside the benchmark into the service's own parser.

**Four were documentation that claimed more than the code did.** The scoring
rule described as identical to `validateFinding`, the diagnoses described as
reviewer facing, the missing strict row with the wrong call granularity, and
the undocumented `--runs` flag. None of these change what the code does, and
all four would have misled someone reading the results.

One finding was rejected: the karma-3 alternate scoring location, because the
remedy would have introduced the first hand written label into a set whose
value depends on not having any. The limit is documented instead.

The second round is worth noting on its own. Six of its seven findings were
about documentation written in the first round, and one of those, the
quickstart producing four samples instead of three, was a real defect created
by a documentation fix. Fixing the words introduced a way to get the numbers
wrong, which is a useful reminder that a documentation change to a benchmark
can be a behavioural change.

The rate of real defects is high across both rounds, which is partly a
reflection of the benchmark having been written quickly around a result rather
than the other way round.

### A mistake made while fixing finding 1

Moving to opaque slugs meant `normalizePath` had to strip `cases/<slug>/` as
well as `cases/<id>/`, or every finding from a GitHub reviewer would have been
labelled fabricated. The first attempt stripped any `cases/<segment>/` prefix,
which was wrong: it also stripped another case's directory, so a finding
pointing into a different case would have been quietly remapped onto the
current one instead of being labelled fabricated.

An existing test caught it immediately, the one asserting that
`cases/demo-2/...` under case `demo-1` is left alone. The fix strips only this
case's own directory, under either its id or its slug, and two tests were added
for the slug form of both cases. Worth recording because the broken version
would have inflated scores rather than failing loudly.

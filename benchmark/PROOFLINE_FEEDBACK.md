# Proofline review of PR #1

Proofline reviewed this pull request five times. This records what it said,
what was done, and where the response differed from the suggestion.

## How to read the counts

Proofline reports a finding per location, so one defect can arrive as several
comments, in one round or across rounds, and a fixed one can be re reported
later. So **reports** are comments Proofline posted and **problems** are
distinct defects. Every number in this document is derived from the ledger
below rather than counted by hand, because getting those two mixed up is
itself entry 17.

One numbered entry is one problem. Entries 1 and 2, and 9 and 10, are the
exception: each pair is a single problem that arrived as two comments before
this convention existed, and both numbers are kept so earlier replies on the
pull request still point somewhere. An entry's prose mentions a report count
only when it is more than one; the ledger carries the exact figure either way.

| Entry | Problem | Reports | Rounds | Disposition | Commit |
|---|---|---|---|---|---|
| 1, 2 | Reviewer facing artifacts carry the case id | 2 | 1 | fixed | `c9cf807` |
| 3 | Removed cases still run after a rebuild | 2 | 1, 3 | fixed | `c9cf807`, hardened in `1675e71` |
| 4 | A line past the end of the diff counts as context | 1 | 1 | fixed | `c9cf807` |
| 5 | Case validation accepts snapshots that disagree with the patch | 1 | 1 | fixed | `c9cf807` |
| 6 | Documentation implies reviewers receive the diagnoses | 1 | 1 | fixed | `c9cf807` |
| 7 | The benchmark can count findings the service would reject | 1 | 1 | fixed | `c9cf807` |
| 8 | The three run command is undocumented | 1 | 1 | fixed | `c9cf807` |
| 9, 10 | The reviewer table omits the strict row and misstates granularity | 2 | 1 | fixed | `c9cf807` |
| 11 | The limits section says one run per reviewer | 4 | 2, 3 | fixed | `91e1426` |
| 12 | The quickstart produces four samples, not three | 1 | 2 | fixed | `91e1426` |
| 13 | The push command cannot be pasted into a shell | 3 | 2, 4 | fixed | `91e1426` |
| 14 | karma-3 scores a correct finding as a miss | 2 | 2, 3 | rejected | documented in `91e1426` |
| 15 | The alternate pull command cannot be pasted into a shell | 1 | 3 | fixed | `1675e71` |
| 16 | A missing finding on one rerun erases its manual label | 1 | 3 | fixed | `1675e71` |
| 17 | This file's counts do not add up | 3 | 3 | fixed | `1675e71` |
| 18 | Prompts carry blob hashes that identify the upstream fix | 1 | 3 | fixed | `1675e71` |
| 19 | The strict row validated metadata differently | 1 | 3 | fixed | `1675e71` |
| 20 | The entry numbering convention was never stated | 1 | 4 | fixed | `343f804` |
| 21 | Round 3 rows point at commits the entries do not name | 1 | 4 | fixed | `343f804` |
| 22 | The recap's repeat counts are wrong and call a rejection fixed | 2 | 4 | fixed | `343f804` |
| 23 | The manifest note says descriptions appear only in the report | 1 | 4 | fixed | `852b0cd` |
| 24 | Published slugs are an unsalted hash of committed ids | 1 | 4 | fixed | `852b0cd` |
| 25 | The fixture test compares ids only | 1 | 4 | fixed | `852b0cd` |
| 26 | The root README names test counts that drifted | 2 | 4 | fixed | `852b0cd` |
| 27 | The report counts an unreviewed case as missed by everyone | 1 | 4 | fixed | `852b0cd` |
| 28 | A rerun aborts at the first pull request already open | 1 | 5 | fixed | `abe70ba` |
| 29 | The example env file promises an unsalted fallback | 2 | 5 | fixed | `abe70ba` |
| 30 | The round 1 account of slug stripping is written as current | 1 | 5 | fixed | DOC5COMMIT |
| 31 | The manifest overstates which misses get a description | 1 | 5 | fixed | `abe70ba` |
| 32 | The manifest calls published source snapshots evaluator only | 1 | 5 | fixed | `abe70ba` |
| 33 | Hosted reviewers can reach other cases' fixtures | 1 | 5 | accepted in part | `abe70ba` |
| 34 | loadCases does not notice a missing fixture directory | 1 | 5 | fixed | `abe70ba` |
| 35 | The round 3 heading labels entry 3 unchanged | 1 | 5 | fixed | DOC5COMMIT |
| 36 | The opening blurs rejected and fixed repeats | 1 | 5 | fixed | DOC5COMMIT |

48 reports, 34 problems. Round 1 produced 10 reports and 8 new problems,
round 2 produced 7 and 4, round 3 produced 10 and 5, round 4 produced 11 and 8,
round 5 produced 10 and 9. Ten problems were reported more than once. Eight of
those arrived more than once inside a single round, and four were re reported
in a later round after being dealt with: entries 3, 11 and 13 after being
fixed, and entry 14 after being rejected.

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

Proofline reviewed the fixes again and posted seven reports covering four
problems: the run count documentation (three reports, entry 11), the quickstart
sample count (entry 12), the unpastable push command (two reports, entry 13),
and the karma-3 scoring location (entry 14). Six of the seven were about
documentation written in the first round. Entry 14 is a rejection.

### 11. The limits section still says one run per reviewer

**Proofline said:** the running instructions now document three runs, but the
limits bullet still states one run, so the published ranges read as single run
results.

**Verdict:** accepted.

**Why:** correct, and a miss in the first round: the `--runs` flag was
documented in one place and contradicted two sections later. The bullet now
says three runs for the model and one for hosted reviewers, and explains that
bugs caught is min / median / max across runs while the finding counts beside
it are totals, so the two columns are not read the same way. Reported three
times, against three lines describing the same claim.

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

## Third review, after `91e1426` and `000e40d`

Ten reports covering five new problems (entries 15 to 19), plus three re
reports: entries 3 and 11, both already fixed, and entry 14, which had been
rejected rather than fixed. The count problem below was itself reported three
times.

### 15. The alternate `bench:pull` command cannot be pasted into a shell

**Proofline said:** the alternate invocation omits `npm run`, and Bash reads
its unquoted angle brackets as redirections, so pasting it fails before the
script starts.

**Verdict:** accepted.

**Why:** correct, and the same defect as entry 13 one paragraph further down
the same file. Fixing the push example in round two left the pull example
beside it untouched, which is the ordinary way a documentation fix misses:
the reported line was fixed instead of the pattern. It is now a fenced command
reading `npm run bench:pull -- --reviewer example-reviewer --login
example-app`, with both values named as examples to replace.

**Commit:** `1675e71`

### 16. A missing finding on one rerun erases its manual label

**Proofline said:** `report.ts` rewrites `triage.json` from the current scores
only, so a labelled finding that does not reappear loses its entry, and with it
the label the README promises survives reruns.

**Verdict:** accepted.

**Why:** correct, and a real defect rather than a documentation one. The model
is not deterministic, so a finding disappearing for one report and returning in
the next is expected, and the first report would have silently discarded the
human judgement attached to it. `mergeTriage` now carries forward any
previously labelled entry the current report did not produce, marked
`"present": false` so a reader can tell a kept label from a current finding.
Unlabelled entries are still dropped, because there is nothing in them to lose.
Four tests cover it.

**Commit:** `1675e71`

### 17. This file's own counts do not add up

**Proofline said:** the document claims seven second round findings but lists
four entries, and the overall total of seventeen cannot be reconciled with
twelve distinct problems and three duplicate reports.

**Verdict:** accepted.

**Why:** correct, and the most uncomfortable finding in the set, because this
is the document that argues documentation accuracy matters. The two numbers
were counting different things, reports and problems, without saying so, and
"three pairs" was simply wrong: four problems were reported more than once, one
of them three times. The opening now separates reports from problems in a table
per round, each entry states how many reports it took, and the recap counts
from the same figures. Reported three times, against three lines of the same
summary.

**Commit:** `1675e71`

### 18. Benchmark prompts carry Git blob hashes that identify the upstream fix

**Proofline said:** the stored diffs keep their `index <old>..<new>` headers,
which identify the exact file versions on either side of a public BugsJS fix,
so a reviewer able to search those repositories could score by lookup rather
than by review.

**Verdict:** accepted in part.

**Why:** the leak is real and the same class as entry 1, so it is stripped:
`build-cases.ts` drops those headers and the fifteen stored cases were
rewritten without them. Two details are worth stating. The headers carry no
review signal, and hosted reviewers never saw them anyway, because `bench:push`
commits file contents and GitHub computes its own headers, so removing them
makes the model's input and the hosted reviewers' input more alike rather than
less. Proofline's second remedy, unpublished holdout cases, is not adopted:
a benchmark nobody can rerun is worth less than one with a documented leak, and
the leak is now documented in `benchmark/README.md`. Stripping the headers
changed the prompt text, so all three rows were rerun; the table moved from
12 / 12 / 14 to 11 / 12 / 13 for the service row, which is run to run variance,
not an effect of the change.

**Commit:** `1675e71`

### 19. The strict row validated metadata differently from the row it is compared against

**Proofline said:** `strictValidate` in the benchmark runner accepts a finding
with an invalid severity or category, which `validateFinding` rejects, so the
two rows can differ for reasons other than where the quote sits.

**Verdict:** accepted, and the fix goes further than suggested.

**Why:** correct, and it undercut the one claim the strict row exists to
support. Proofline offered a choice of applying the same metadata checks or
documenting the difference; documenting it would have left a comparison that
measures two things at once. `validateFinding` now takes `exactLineOnly`, which
turns off the re anchor and nothing else, and the runner calls it instead of
keeping a second copy of the rule. A second implementation drifting from the
first is what caused this, so the second implementation is gone. Six tests
assert the two rules agree on every check except anchoring.

**Commit:** `1675e71`

### Re reports

Entry 3 prompted a change, entries 11 and 14 did not.

**Entry 3, removed cases still run after a rebuild. Hardened.** Reported again at
`000e40d`. The prune has been in `build-cases.ts` since `c9cf807` and works.
The honest residue was narrower than the report: the prune only runs when
someone runs `bench:cases`, so a stale directory was still loaded until then.
`loadCases` now refuses to load at all when `benchmark/cases` holds a directory
`cases.config.json` does not list, and a test asserts the built set equals the
manifest.

**Entry 11, the limits section and the run count.** Reported again at
`000e40d`, re anchored onto `caughtCell` in `report.ts`. That function is the
code that makes the distinction: a plain count for one run, min / median / max
for several. The README bullet says three runs for the model and one for hosted
reviewers. No change.

**Entry 14, karma-3.** Raised again as a new finding after being dismissed.
The reasoning in entry 14 stands unchanged, and that thread is deliberately
left unresolved on the pull request so the disagreement is visible.

## Fourth review, after `1675e71`

Eleven reports covering eight new problems (entries 20 to 27), plus one re
report of entry 13. Four of the eight are about this file and the root README,
which is to say about the previous round's own repairs again.

### 20. The entry numbering convention was never stated

**Proofline said:** the document says each entry is one distinct problem and
gives a report count, but entries 2 and 10 repeat earlier problems and entries
such as 3 give no count, so a reader cannot use the convention to tally
anything.

**Verdict:** accepted.

**Why:** correct on both halves. The convention was in my head and not on the
page. The "How to read the counts" section now states it: one entry is one
problem, except the two legacy pairs, which are kept as pairs so earlier
replies on the pull request still point somewhere, and an entry's prose gives
a report count only when it is more than one, with the ledger carrying the
exact figure for every entry either way.

### 21. Round 3 rows point at commits the entries do not name

**Proofline said:** the round table's commit column said to see each entry, but
entries 15 to 19 never named a fix commit.

**Verdict:** accepted.

**Why:** correct and plainly careless: the column pointed at entries that
pointed nowhere. Entries 15 to 19 now carry `1675e71`, and the ledger names a
commit on every row, so neither place defers to the other.

### 22. The recap's repeat counts are wrong and call a rejection fixed

**Proofline said:** the recap counts four problems reported more than once
where the real figure is higher, leaves entry 17 out of its repeated report
counts although it was reported three times, and describes all three of the
third round's re reports as previously fixed when one of them was rejected.

**Verdict:** accepted, and the fix is structural rather than arithmetic.

**Why:** correct on every point, and this is the second round in a row where
this file's own counting was the finding. Recomputing the numbers by hand
would have fixed this round and broken the next one, which is what happened
between rounds 3 and 4. The counts now come from a ledger with one row per
problem, and the figures in the prose are generated from it rather than
counted: nine problems reported more than once, seven of them more than once
inside a single round, four re reported in a later round, of which entry 14 is
a rejection and not a fix. Reported twice, from two angles on the same
summary.

### 23. The manifest note says descriptions appear only in the report

**Proofline said:** `cases.config.json` says descriptions appear only in the
report, but `build-cases.ts` copies them into the committed fixtures, where
anyone can read the diagnosis without opening a report.

**Verdict:** accepted.

**Why:** correct. The claim that mattered, that no review path sends a
description to a reviewer, is true and stays. The claim about where they live
was wrong: they are in `benchmark/cases`, which is evaluator only, and that is
where the report reads them from. The note now says both.

**Commit:** `852b0cd`

### 24. Published slugs are an unsalted hash of committed ids

**Proofline said:** `caseSlug` hashes the case id and nothing else, and the ids
are committed beside the diagnoses, so a reviewer with benchmark source access
can recover the mapping and match a published pull request to its answer.

**Verdict:** accepted, by a different route than suggested.

**Why:** correct, and it undercuts entry 1's fix rather than merely weakening
it: fifteen hashes recover the whole mapping. Proofline suggested random per
case slugs in evaluator only storage. A random slug has to be persisted and
reused by publishing and scoring alike, and losing that file breaks scoring for
pull requests already open. A salt gives the same property with nothing extra
to lose: `caseSlug(id, salt)` is deterministic, so a rerun still updates a
case's existing pull request, and without the salt the mapping is not
recoverable. The salt is `BENCH_SLUG_SALT` in `.env`, which is not committed,
and `caseSlug` throws on an empty one rather than falling back to the old
unsalted hash.

Two consequences worth stating. The scorer can no longer recompute a slug, so
`bench:pull` strips the published prefix as it reads each comment, using the
slug recorded in `prs.json`, and `normalizePath` stops guessing; a model only
run needs no salt at all. And the slug still only hides the id: a reviewer
holding this repository could line a case up by its file contents, which the
README now says.

**Commit:** `852b0cd`

### 25. The fixture test compares ids only

**Proofline said:** the test comparing built cases against the manifest
compares ids, so changing a case's `repo` or `bug` without rebuilding passes
while the benchmark keeps scoring the old upstream bug.

**Verdict:** accepted.

**Why:** correct, and a gap I opened in the third round: the test added for
entry 3 compared exactly the field entry 3 was about and no others. It now
compares `id`, `repo` and `bug`.

**Commit:** `852b0cd`

### 26. The root README names test counts that drifted

**Proofline said:** the README says the benchmark adds 57 tests where the suite
registers 80, and omits the report tests entirely.

**Verdict:** accepted, and the remedy is the one Proofline offered second.

**Why:** correct, and it was already stale before this round. Updating the
number would have made it accurate until the next test, so it is gone: the
README now says what `npm test` covers and lets the command report the count.
Reported twice, against two lines of the same section.

**Commit:** `852b0cd`

### 27. The report counts an unreviewed case as missed by everyone

**Proofline said:** the benchmark report conflates missing reviews with misses.

**Verdict:** accepted.

**Why:** correct, and the worst of this round, because it would have published
an infrastructure failure as a result about the reviewers. A case that errors
is left out of a run's `caseIds` by design, so it has no score, and
`missedByAll` tested for the absence of a catch, which an absent score
satisfies. "Missed by every reviewer" now covers only cases at least one
reviewer was scored on, and `summary.md` gained a "Not reviewed" section and an
"Errors" section listing every per case failure, so a timeout is visible as a
timeout. It has not bitten the published numbers: all three rows carry all
fifteen cases and both new sections read "None".

**Commit:** `852b0cd`

### Re reported and not changed

**Entry 13, the push command.** Reported again at `1675e71`, re anchored onto
the quickstart block. The command there reads `npm run bench:push -- --dir
../ai-review-benchmark-cases --repo
YOUR_GITHUB_OWNER/ai-review-benchmark-cases`, which pastes into a shell as is.
The round three change added a `bench:pull` example beside it, which is
probably what moved the anchor. No change.

## Fifth review, after `ab1cec0`

Ten reports covering nine new problems, entries 28 to 36. Six of the nine are
consequences of the fourth round's own changes, which is the pattern by now.

### 28. A rerun aborts at the first pull request already open

**Proofline said:** `bench:push` pushes the branch and then calls `gh pr
create` unconditionally, which fails when a pull request for that branch is
already open, so a rerun stops at the first case and never writes a refreshed
mapping.

**Verdict:** accepted.

**Why:** correct, and it contradicted what I had just written in
`.env.example`, which told the reader to keep the salt stable so a rerun would
update the existing pull requests. Keeping the salt stable is exactly the case
that broke. `pullRequestFor` now asks `gh pr list --head <branch> --state
open` first and creates one only when there is none.

**Commit:** `abe70ba`

### 29. The example env file promises an unsalted fallback

**Proofline said:** `.env.example` describes what an unsalted slug would be,
which reads as a fallback, while `bench:push` refuses to run on a missing or
blank salt.

**Verdict:** accepted.

**Why:** correct. The paragraph explained why the salt matters by describing
the behaviour it replaced, and left the reader expecting that behaviour on a
blank value. It now says `bench:push` refuses to run without a non blank salt
and that there is no unsalted fallback, before explaining why. The claim about
reruns is corrected at the same time: a changed salt publishes a second set of
branches rather than updating the first, which is a different statement from
the one entry 28 falsified. Reported twice, against one block.

**Commit:** `abe70ba`

### 30. The round 1 account of slug stripping is written as current

**Proofline said:** the closing section describes `normalizePath` stripping
published slugs as present behaviour, but it strips only the case id prefix
now.

**Verdict:** accepted.

**Why:** correct, and a predictable cost of keeping a historical note in a
living document. Entry 24 moved slug stripping out of the scorer, which made
that section a true story about the past written in the present tense. It now
says so at the top and points at entry 24, and the account itself is in the
past tense.

**Commit:** DOC5COMMIT

### 31. The manifest overstates which misses get a description

**Proofline said:** the note says descriptions explain cases every reviewer
missed, but the report prints them for cases at least one reviewer was scored
on and none caught.

**Verdict:** accepted.

**Why:** correct, and it is my own round four change that made the note wrong:
entry 27 narrowed "missed by every reviewer" to exclude cases nobody reviewed,
and the note still described the old behaviour. Reworded to match.

**Commit:** `abe70ba`

### 32. The manifest calls published source snapshots evaluator only

**Proofline said:** the note calls the fixture directory evaluator only, but
`bench:push` copies whole source files out of it into the review repository.

**Verdict:** accepted.

**Why:** correct, and the distinction matters for reading the results: hosted
reviewers get whole files while the model gets diff chunks, so the comparison
is not one of equal context. The note now says the descriptions stay
unpublished and the source snapshots do not.

**Commit:** `abe70ba`

### 33. Hosted reviewers can reach other cases' fixtures

**Proofline said:** every case's fixed source sat on the default branch, so a
reviewer of one case could read the labelled fix for another. express-4's base
holds the parsing fix that express-22 reverses.

**Verdict:** accepted in part.

**Why:** correct, and the sharpest finding of this round, because it is about
the measurement rather than the prose. The default branch now holds a README
and nothing else, each case gets an orphan `base/<slug>` branch carrying only
its own files, and its pull request is opened against that branch. A reviewer
working from the pull request, or from the repository root, sees one case.

Not adopted: one repository per case, which is the only way to close this
rather than narrow it. The other branches are still in the same repository and
a reviewer that goes looking will find them. Fifteen repositories to publish,
install an app on and collect from is a real cost, and the honest summary is
that this benchmark cannot stop a reviewer that sets out to cheat, only one
that would have stumbled into the answer. That is recorded as a limit rather
than claimed as a fix.

This code has not been run against a live repository: the benchmark
infrastructure was torn down after the exercise, so the change is reviewed and
type checked but not exercised end to end.

**Commit:** `abe70ba`

### 34. loadCases does not notice a missing fixture directory

**Proofline said:** `loadCases` refuses a directory the manifest does not
list, but never checks that every manifest id has a directory, so the runner,
report and publisher can quietly work on a smaller set than the manifest
declares.

**Verdict:** accepted.

**Why:** correct, and the same half measure as entry 25: the round three guard
checked the direction the round three finding was about. Fourteen cases
running as if they were the benchmark is worse than the stale directory case,
because nothing downstream says the count is short. `loadCases` now fails on
either mismatch, naming the ids, and a test asserts both directions.

**Commit:** `abe70ba`

### 35. The round 3 heading labels entry 3 unchanged

**Proofline said:** the round three section groups entry 3 under re reports
that changed nothing, while the entry itself records a new guard and a test.

**Verdict:** accepted.

**Why:** correct. The heading was written for entries 11 and 14 and entry 3
was filed under it for convenience. The section is now "Re reports", says
which of the three prompted a change, and entry 3 is marked hardened.

**Commit:** DOC5COMMIT

### 36. The opening blurs rejected and fixed repeats

**Proofline said:** the opening counts four later round repeats as reports
made after the problems were addressed, without separating entry 14, which was
rejected rather than fixed.

**Verdict:** accepted.

**Why:** correct, and the third round in a row where this file's own
bookkeeping is a finding, though a smaller one each time. The sentence now
reads: entries 3, 11 and 13 after being fixed, and entry 14 after being
rejected. The total of four is unchanged, which was Proofline's point.

**Commit:** DOC5COMMIT

## What the review changed

Every figure here comes from the ledger at the top. 48 reports, 34 problems.

**Fourteen were real defects in behaviour.** The answer key leak, the stale
fixture directories, the phantom context line, the weak snapshot validation,
the quickstart's four samples, the lost triage labels, the blob hashes in the
prompts, the strict row's divergent metadata checks, the unsalted slugs, the
fixture test that compared only ids, the report counting an unreviewed case as
missed, the rerun that aborted on an open pull request, the missing fixture
directory nothing noticed, and every case's fixed source sitting where a
reviewer of another case could read it. Three of those would have published a
wrong result rather than a wrong number: the answer key leak, found before
anything was pushed; the unreviewed case counted as a miss, which would have
turned a timeout into a finding about the reviewers; and the shared base
branch, which would have let a hosted reviewer score on a lookup. The phantom
context line was the only one that reached outside the benchmark into the
service's own parser.

**Nineteen were documentation that claimed more than the code did.** The
scoring rule described as identical to `validateFinding`, the diagnoses
described as reviewer facing, the missing strict row with the wrong call
granularity, the undocumented `--runs` flag, the limits section's run count,
the push and pull examples that could not be pasted into a shell, this file's
arithmetic three times over, its unstated numbering convention, its commit
column pointing at entries that named no commit, its round three heading, its
account of slug stripping left in the present tense, the manifest note on
where descriptions live, on which misses get one and on what publishing
copies, the promised unsalted fallback, and the root README's test counts.
None of these change what the code does, and all of them would have misled
someone reading the results.

**One was rejected.** The karma-3 alternate scoring location, because the
remedy would have introduced the first hand written label into a set whose
value depends on not having any. The limit is documented instead, and that
thread is deliberately left unresolved on the pull request.

The later rounds mostly found the earlier rounds' repairs, and that is the
pattern worth keeping. Six of round 2's seven reports were about documentation
written in round 1, and one of those, the quickstart producing four samples,
was a real defect created by a documentation fix. Round 3 found the pull
example sitting beside the push example that round 2 had fixed, and found this
file's arithmetic. Round 4 found this file's arithmetic again, the commit
references added to fix it, and the fixture test added for entry 3 checking
only the field entry 3 was about. Round 5 found six consequences of round 4:
the salt documentation, the rerun the salt documentation promised, two
manifest claims the report change had made stale, the guard that checked one
direction, and the historical note left in the present tense.

Each of those is the same mistake in a different place: fixing the reported
instance instead of the pattern. Twice the answer was structural rather than
another correction, and those are the two that have held. The counts in this
file are generated from one ledger, and the root README states no test count
at all, so neither can drift again. Nothing structural yet prevents the rest:
a change still has to be chased through the prose that describes it by hand,
which is what rounds 4 and 5 kept catching.

The rate of real defects is high across all five rounds, which is partly a
reflection of the benchmark having been written quickly around a result rather
than the other way round, and partly that each repair was scoped to its report.

### A mistake made while fixing finding 1

This is the fix as it was in round 1. It no longer describes the code:
entry 24 moved slug stripping out of the scorer entirely, and `normalizePath`
now strips only `cases/<id>/`. Kept because the mistake is worth recording, not
as a description of current behaviour.

Moving to opaque slugs meant `normalizePath` had to strip `cases/<slug>/` as
well as `cases/<id>/`, or every finding from a GitHub reviewer would have been
labelled fabricated. The first attempt stripped any `cases/<segment>/` prefix,
which was wrong: it also stripped another case's directory, so a finding
pointing into a different case would have been quietly remapped onto the
current one instead of being labelled fabricated.

An existing test caught it immediately, the one asserting that
`cases/demo-2/...` under case `demo-1` is left alone. The fix stripped only
this case's own directory, under either its id or its slug, and two tests were
added for the slug form of both cases. Worth recording because the broken
version would have inflated scores rather than failing loudly.

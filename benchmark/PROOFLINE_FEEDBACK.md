# Proofline review of PR #1

Proofline reviewed this pull request three times. This records what it said,
what was done, and where the response differed from the suggestion.

Proofline reports a finding per location, so the same defect can arrive more
than once and a fixed one can be re reported in a later round. The counts below
therefore separate **reports** (comments Proofline posted) from **problems**
(distinct defects). Every entry here is one problem, and names how many reports
it took.

| Round | Reports | New problems | Commit |
|---|---|---|---|
| 1 | 10 | 8 (entries 1 to 10, two of them reported twice) | `c9cf807` |
| 2 | 7 | 4 (entries 11 to 14) | `91e1426` |
| 3 | 10 | 5 (entries 15 to 19) | see each entry |
| **Total** | **27** | **17** | |

The first round's ten reports were all addressed in `c9cf807`.

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
reports of problems already fixed: entry 3, entry 11, and entry 14's
rejection. The count problem below was itself reported three times.

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

### Re reported and not changed

**Entry 3, removed cases still run after a rebuild.** Reported again at
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

## What the review changed

Twenty seven reports across three rounds, covering seventeen distinct
problems. Four problems were reported more than once, one of them three times,
and three already fixed problems were reported again in the third round.

**Eight were real defects in behaviour.** The answer key leak, the stale
fixture directories, the phantom context line, the weak snapshot validation,
the quickstart's four samples, the lost triage labels, the blob hashes in the
prompts, and the strict row's divergent metadata checks. Of these, the answer
key leak was the one that would have invalidated the benchmark's results
rather than merely producing a wrong number, and it was found before anything
was pushed. The phantom context line was the only finding that reached outside
the benchmark into the service's own parser.

**Eight were documentation that claimed more than the code did.** The scoring
rule described as identical to `validateFinding`, the diagnoses described as
reviewer facing, the missing strict row with the wrong call granularity, the
undocumented `--runs` flag, the limits section's run count, the push example
and the pull example that could not be pasted into a shell, and this file's own
arithmetic. None of these change what the code does, and all of them would
have misled someone reading the results.

Eight real defects and eight documentation problems account for sixteen of the
seventeen. The seventeenth was rejected: the karma-3 alternate scoring
location, because the remedy would have introduced the first hand written
label into a set whose value depends on not having any. The limit is documented
instead.

The later rounds are worth noting on their own, because each one mostly found
the previous one's repairs. Six of the second round's seven reports were about
documentation written in the first, and one of those, the quickstart producing
four samples instead of three, was a real defect created by a documentation
fix. The third round then found the pull example beside the push example fixed
in the second, and the arithmetic of this file. Fixing words introduced ways to
get numbers wrong twice, which is a useful reminder that a documentation change
to a benchmark can be a behavioural change.

The rate of real defects is high across all three rounds, which is partly a
reflection of the benchmark having been written quickly around a result rather
than the other way round. The third round is the clearest case: two of its five
problems, the lost triage labels and the strict row's metadata checks, were
places where the code did not do what this file already claimed it did.

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

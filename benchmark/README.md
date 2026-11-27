# AI Review Benchmark

Several AI code reviewers on the same pull requests, scored by one rule: a
finding counts only if it points at something that is really in the diff, and
a bug counts as caught only if a finding points at the line where it lives.

This is the rule the service applies to its own model (`validateFinding` in
`src/providers/llm.ts`), turned around and pointed at every reviewer, the
service included.

The two are close but not identical, and the difference matters when reading
the table. `validateFinding` requires a quote and anchors on it, so a finding
without one never reaches a client. Scoring here accepts a correctly located
finding that quotes nothing, because most GitHub review apps never quote the
line they comment on and judging them on location is the only fair option. So
a benchmark catch is not always a finding the service would return.

Results: [`results/summary.md`](results/summary.md).

## The cases

15 real bugs from [BugsJS](https://bugsjs.github.io), a peer reviewed dataset of
bugs in popular JavaScript projects (express, karma, mongoose, hexo). Each
case takes an upstream bug fix and **reverses it**, so the pull request reads
like a small refactor that quietly reintroduces the bug.

That gives ground truth for free: the lines the reversed fix adds are exactly
the lines the real fix removed. No labels were written by hand, which matters,
because hand labelled ground truth is where benchmarks usually cheat.

The set covers a range on purpose: a query that deletes every document
(mongoose-22), an XSS in a table of contents (hexo-7), IPv6 parsing
(express-22), a dropped `return` (mongoose-8), and several bugs that are only
visible if you know the surrounding code. Descriptions are in
[`cases.config.json`](cases.config.json).

## How findings are judged

Every finding gets one grounding label, computed from the diff we parse
ourselves and never from what the reviewer says about it:

| Label | Meaning |
|---|---|
| added | points at a line the PR adds |
| context | points at an unchanged line shown in the diff |
| fabricated | points at a path or line that is not in the diff |
| misquoted | points at a real line but quotes it as saying something it does not |
| unlocated | no path or line (a summary comment) |

A bug is **caught** when an added or context finding lands within 2 lines of a
bug line on the same file. Fabricated and misquoted findings can never catch a
bug, even when their line number happens to land on one.

Grounded findings that miss the bug are not assumed to be noise: a reviewer
may have found a real issue the ground truth does not cover. Those go to
`results/triage.json` for a human to label `valid` or `noise`, and the labels
survive reruns.

## The reviewers

| Reviewer | What it is |
|---|---|
| `model-raw` | the service's prompt and model, output taken at its word |
| `diff-review-service` | the same response after `validateFinding`, which anchors a finding on its quote |
| `diff-review-service-strict` | the same response under the earlier rule: the quote had to match the line the model named, exactly |
| `proofline` | Proofline reviewing the same cases as real pull requests |

The three model rows share **one response per chunk** (a case is one chunk
unless its diff exceeds the chunk budget, so for these cases it is one call
each). `bench:model` sends the request once and feeds the same response to all
three, so the only thing separating those rows is the rule applied afterwards.
That isolates what verification buys, with nothing else changing, and it is
why the strict row has to be produced by the same run rather than by an
earlier one: the model is not deterministic across runs.

## Running it

```bash
npm install

# 1. the service: raw, validated, and under the earlier strict rule
#    (needs LLM_* in .env, see .env.example). One run by default.
npm run bench:model

#    The model is not deterministic, so one run is an anecdote. The published
#    numbers use three, and bench:report then reports bugs caught as
#    min / median / max across them.
npm run bench:model -- --runs 3

# 2. Proofline: push every case as a PR to an empty repo with Proofline installed
npm run bench:push -- --dir ../ai-review-benchmark-cases --repo <you>/ai-review-benchmark-cases
#    wait for the reviews, then collect them
npm run bench:pull -- --reviewer proofline --login proofline

# 3. score everything and write results/summary.md
npm run bench:report
```

Any other GitHub review app can be added the same way with
`bench:pull -- --reviewer <name> --login <app login>`.

The cases are committed, so none of this needs BugsJS. `npm run bench:cases`
rebuilds them from scratch.

## Limits, stated plainly

- **15 cases is small.** Enough to show differences in kind (does a reviewer
  invent lines, does it catch the obvious data loss bug), not to rank
  reviewers to a decimal place.
- **Reviewers see only the touched files**, not the whole project. Bugs that
  need cross file knowledge are harder for everyone, equally.
- **One run per reviewer.** The model runs at temperature 0, but hosted
  reviewers are not deterministic, so a rerun can move a case either way.
- **Location, not explanation.** A finding on the right line with the wrong
  reason still counts as a catch. The triage file is where a human can be
  stricter.
- **BugsJS projects are public**, so a model may have seen the original fixes
  in training. That favours every reviewer equally, and the reversal means the
  exact diff shown is not the one that was published.

## Code

```
benchmark/
  cases.config.json     which BugsJS bugs, with a diagnosis of each for the report
  cases/<id>/           case.json (diff + ground truth), base/ and head/ files
  core/score.ts         the referee: grounding, matching, summaries (pure)
  runners/model.ts      the service, raw and validated
  runners/github-pr.ts  any GitHub review app: inline comments, check annotations, summaries
  scripts/              build-cases (from BugsJS), push-cases (to a PR repo)
  report.ts             summary.md, scores.json, triage.json
test/benchmark/         scorer tests, and checks that the committed cases are sound
```

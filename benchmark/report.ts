/**
 * Scores every run in results/runs and writes:
 *
 *   results/summary.md   the tables that go in the PR
 *   results/triage.json  grounded findings that miss the bug, for a human to
 *                        label "valid" (a real issue the ground truth does not
 *                        cover) or "noise". Labels survive reruns.
 *
 *   npm run bench:report
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CASES_DIR, loadCases, loadRuns, readJson, RESULTS_DIR, writeJson } from './core/io';
import { LINE_TOLERANCE, normalizePath, scoreCase, summarize, type ReviewerSummary } from './core/score';
import type { BenchCase, CaseScore, ScoredFinding, TriageLabel } from './core/types';

export type TriageEntry = {
  key: string;
  reviewer: string;
  caseId: string;
  location: string;
  title: string;
  code: string;
  label: TriageLabel | null;
  /**
   * False when this report's runs did not produce the finding. The entry is
   * kept anyway, because the label on it is a human judgement and the model is
   * not deterministic: a finding can vanish from one set of runs and return in
   * the next.
   */
  present?: boolean;
};

const TRIAGE_PATH = join(RESULTS_DIR, 'triage.json');

function codeAt(benchCase: BenchCase, finding: ScoredFinding): string {
  if (finding.path === null || finding.line === null) {
    return '';
  }
  const file = join(CASES_DIR, benchCase.id, 'head', normalizePath(finding.path, benchCase.id));
  if (!existsSync(file)) {
    return '';
  }
  return (readFileSync(file, 'utf8').split('\n')[finding.line - 1] ?? '').trim();
}

const pct = (n: number, d: number): string => (d === 0 ? '0%' : `${Math.round((100 * n) / d)}%`);

/** One reviewer, however many runs it has. */
type ReviewerAggregate = {
  reviewer: string;
  runs: ReviewerSummary[];
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

const round1 = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Bugs caught, across runs. A single run prints the plain count; several
 * print min / median / max, because one run of a non deterministic model is
 * an anecdote and the spread is the honest summary.
 */
function caughtCell(aggregate: ReviewerAggregate): string {
  const caught = aggregate.runs.map((r) => r.caught);
  const cases = aggregate.runs[0]?.cases ?? 0;
  if (caught.length === 1) {
    return `**${caught[0]}/${cases}** (${pct(caught[0] as number, cases)})`;
  }
  const lo = Math.min(...caught);
  const hi = Math.max(...caught);
  const mid = median(caught);
  return `**${lo} / ${round1(mid)} / ${hi}** of ${cases}`;
}

const total = (aggregate: ReviewerAggregate, pick: (s: ReviewerSummary) => number): number =>
  aggregate.runs.reduce((sum, run) => sum + pick(run), 0);

function summaryTable(rows: ReviewerAggregate[]): string[] {
  const multi = rows.some((r) => r.runs.length > 1);
  const caughtHeader = multi ? 'Bugs caught (min / median / max)' : 'Bugs caught';
  return [
    `| Reviewer | Runs | ${caughtHeader} | Findings | On added lines | On context lines | Fabricated | Misquoted | No location | Extra: valid / noise / unlabeled |`,
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (a) =>
        `| ${a.reviewer} | ${a.runs.length} | ${caughtCell(a)} | ${total(a, (s) => s.findings)} | ${total(a, (s) => s.added)} | ${total(a, (s) => s.context)} | ${total(a, (s) => s.fabricated)} | ${total(a, (s) => s.misquoted)} | ${total(a, (s) => s.unlocated)} | ${total(a, (s) => s.extraValid)} / ${total(a, (s) => s.extraNoise)} / ${total(a, (s) => s.extraUnlabeled)} |`,
    ),
  ];
}

export function render(
  cases: BenchCase[],
  scores: CaseScore[],
  aggregates: ReviewerAggregate[],
  sources: Map<string, string>,
): string {
  const reviewers = aggregates.map((a) => a.reviewer);
  const runsFor = (reviewer: string): number =>
    aggregates.find((a) => a.reviewer === reviewer)?.runs.length ?? 1;

  /** With several runs, how often the case was caught, not just whether. */
  const caughtBy = (caseId: string, reviewer: string): string => {
    const mine = scores.filter((s) => s.caseId === caseId && s.reviewer === reviewer);
    if (mine.length === 0) {
      return 'n/a';
    }
    const hits = mine.filter((s) => s.caught).length;
    return runsFor(reviewer) === 1 ? (hits > 0 ? 'caught' : 'missed') : `${hits}/${mine.length}`;
  };

  const missedByAll = cases.filter((c) =>
    reviewers.every((r) => !scores.some((s) => s.caseId === c.id && s.reviewer === r && s.caught)),
  );

  const fabricated = [
    ...new Map(
      scores
        .flatMap((s) => s.findings)
        .filter((f) => f.grounding === 'fabricated' || f.grounding === 'misquoted')
        .map((f) => [f.key, f]),
    ).values(),
  ];

  return [
    '# Results',
    '',
    `${cases.length} real bugs from BugsJS, each reintroduced by reversing its upstream fix. A bug counts as caught when a finding points within ${LINE_TOLERANCE} lines of a line the fix had removed, on a line that is really in the diff.`,
    '',
    ...summaryTable(aggregates),
    '',
    'What ran:',
    '',
    ...aggregates.map((a) => `- **${a.reviewer}**: ${sources.get(a.reviewer) ?? ''}`),
    '',
    '## Per case',
    '',
    `| Case | Severity | ${reviewers.join(' | ')} |`,
    `|---|---|${reviewers.map(() => '---').join('|')}|`,
    ...cases.map((c) => `| ${c.id} | ${c.severity} | ${reviewers.map((r) => caughtBy(c.id, r)).join(' | ')} |`),
    '',
    '## Missed by every reviewer',
    '',
    ...(missedByAll.length === 0
      ? ['None.']
      : missedByAll.map((c) => `- **${c.id}** (${c.severity}): ${c.description}`)),
    '',
    '## Fabricated and misquoted findings',
    '',
    'Findings that point at a path or line that is not in the diff, or quote a line as saying something it does not. These are what validateFinding exists to drop.',
    '',
    ...(fabricated.length === 0
      ? ['None.']
      : fabricated.map((f) => `- ${f.reviewer} on ${f.caseId} (${f.grounding}): \`${f.path ?? '?'}:${f.line ?? '?'}\` "${f.title}"`)),
    '',
  ].join('\n');
}

/**
 * This report's triage entries, plus the labelled entries it did not produce.
 *
 * A label is a human judgement and README promises labels survive reruns.
 * Writing only the current findings would break that promise the first time a
 * labelled finding failed to reappear: the entry would go, and with it the
 * label, so the same finding would come back unlabelled in a later run. An
 * unlabelled entry that disappeared is dropped, because there is nothing in it
 * to lose.
 */
export function mergeTriage(previous: TriageEntry[], current: TriageEntry[]): TriageEntry[] {
  const emitted = new Set(current.map((entry) => entry.key));
  return [
    ...current,
    ...previous
      .filter((entry) => entry.label !== null && !emitted.has(entry.key))
      .map((entry) => ({ ...entry, present: false })),
  ];
}

function main(): void {
  const cases = loadCases();
  const runs = loadRuns();
  if (runs.length === 0) {
    console.log('no runs in results/runs yet: run bench:model and/or bench:pull first');
    return;
  }

  const previous = existsSync(TRIAGE_PATH) ? readJson<TriageEntry[]>(TRIAGE_PATH) : [];
  const labels = new Map<string, TriageLabel>(
    previous.filter((e) => e.label !== null).map((e) => [e.key, e.label as TriageLabel]),
  );

  // Several runs of one reviewer are separate samples, so each is scored on
  // its own findings and only combined at the summary.
  const scores: CaseScore[] = [];
  const aggregates: ReviewerAggregate[] = [];
  const byReviewer = new Map<string, typeof runs>();
  for (const run of runs) {
    byReviewer.set(run.reviewer, [...(byReviewer.get(run.reviewer) ?? []), run]);
  }

  for (const [reviewer, reviewerRuns] of byReviewer) {
    const perRun: ReviewerSummary[] = [];
    for (const run of reviewerRuns) {
      const runScores = cases
        .filter((c) => run.caseIds.includes(c.id))
        .map((benchCase) => scoreCase(benchCase, reviewer, run.findings));
      scores.push(...runScores);
      perRun.push(summarize(reviewer, runScores, labels));
    }
    aggregates.push({ reviewer, runs: perRun });
  }
  aggregates.sort((a, b) => a.reviewer.localeCompare(b.reviewer));

  const seenTriage = new Set<string>();
  const triage: TriageEntry[] = scores.flatMap((score) => {
    const benchCase = cases.find((c) => c.id === score.caseId) as BenchCase;
    return score.findings
      .filter((f) => !f.hitsBug && (f.grounding === 'added' || f.grounding === 'context'))
      // The same finding can appear in several runs; triage it once.
      .filter((f) => !seenTriage.has(f.key) && seenTriage.add(f.key) !== undefined)
      .map((f) => ({
        key: f.key,
        reviewer: f.reviewer,
        caseId: f.caseId,
        location: `${normalizePath(f.path ?? '', f.caseId)}:${f.line}`,
        title: f.title,
        code: codeAt(benchCase, f),
        label: labels.get(f.key) ?? null,
        present: true,
      }));
  });

  writeJson(TRIAGE_PATH, mergeTriage(previous, triage));
  writeJson(join(RESULTS_DIR, 'scores.json'), { aggregates, scores });
  const sources = new Map(runs.map((run) => [run.reviewer, run.source]));
  writeFileSync(join(RESULTS_DIR, 'summary.md'), render(cases, scores, aggregates, sources));

  for (const a of aggregates) {
    const caught = a.runs.map((r) => r.caught);
    const spread =
      caught.length === 1
        ? `${caught[0]}/${a.runs[0]?.cases ?? 0}`
        : `${Math.min(...caught)} / ${round1(median(caught))} / ${Math.max(...caught)} of ${a.runs[0]?.cases ?? 0}`;
    console.log(
      `${a.reviewer.padEnd(26)} ${a.runs.length} run(s), caught ${spread}, fabricated ${total(a, (r) => r.fabricated)}, misquoted ${total(a, (r) => r.misquoted)}`,
    );
  }
  for (const run of runs.filter((r) => r.errors.length > 0)) {
    console.log(`${run.reviewer}: ${run.errors.length} case(s) errored`);
  }
  console.log('\nwrote results/summary.md, results/scores.json, results/triage.json');
}

if (require.main === module) {
  main();
}

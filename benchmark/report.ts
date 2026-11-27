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

type TriageEntry = {
  key: string;
  reviewer: string;
  caseId: string;
  location: string;
  title: string;
  code: string;
  label: TriageLabel | null;
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

function summaryTable(rows: ReviewerSummary[]): string[] {
  return [
    '| Reviewer | Bugs caught | Findings | On added lines | On context lines | Fabricated | Misquoted | No location | Extra: valid / noise / unlabeled |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (s) =>
        `| ${s.reviewer} | **${s.caught}/${s.cases}** (${pct(s.caught, s.cases)}) | ${s.findings} | ${s.added} | ${s.context} | ${s.fabricated} | ${s.misquoted} | ${s.unlocated} | ${s.extraValid} / ${s.extraNoise} / ${s.extraUnlabeled} |`,
    ),
  ];
}

export function render(cases: BenchCase[], scores: CaseScore[], summaries: ReviewerSummary[], sources: Map<string, string>): string {
  const reviewers = summaries.map((s) => s.reviewer);
  const caughtBy = (caseId: string, reviewer: string): string => {
    const score = scores.find((s) => s.caseId === caseId && s.reviewer === reviewer);
    return score === undefined ? 'n/a' : score.caught ? 'caught' : 'missed';
  };

  const missedByAll = cases.filter((c) =>
    reviewers.every((r) => scores.find((s) => s.caseId === c.id && s.reviewer === r)?.caught !== true),
  );

  const fabricated = scores.flatMap((s) =>
    s.findings.filter((f) => f.grounding === 'fabricated' || f.grounding === 'misquoted'),
  );

  return [
    '# Results',
    '',
    `${cases.length} real bugs from BugsJS, each reintroduced by reversing its upstream fix. A bug counts as caught when a finding points within ${LINE_TOLERANCE} lines of a line the fix had removed, on a line that is really in the diff.`,
    '',
    ...summaryTable(summaries),
    '',
    'What ran:',
    '',
    ...summaries.map((s) => `- **${s.reviewer}**: ${sources.get(s.reviewer) ?? ''}`),
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

  const scores: CaseScore[] = [];
  for (const run of runs) {
    for (const benchCase of cases.filter((c) => run.caseIds.includes(c.id))) {
      scores.push(scoreCase(benchCase, run.reviewer, run.findings));
    }
  }
  const summaries = runs.map((run) => summarize(run.reviewer, scores, labels));

  const triage: TriageEntry[] = scores.flatMap((score) => {
    const benchCase = cases.find((c) => c.id === score.caseId) as BenchCase;
    return score.findings
      .filter((f) => !f.hitsBug && (f.grounding === 'added' || f.grounding === 'context'))
      .map((f) => ({
        key: f.key,
        reviewer: f.reviewer,
        caseId: f.caseId,
        location: `${normalizePath(f.path ?? '', f.caseId)}:${f.line}`,
        title: f.title,
        code: codeAt(benchCase, f),
        label: labels.get(f.key) ?? null,
      }));
  });

  writeJson(TRIAGE_PATH, triage);
  writeJson(join(RESULTS_DIR, 'scores.json'), { summaries, scores });
  const sources = new Map(runs.map((run) => [run.reviewer, run.source]));
  writeFileSync(join(RESULTS_DIR, 'summary.md'), render(cases, scores, summaries, sources));

  for (const s of summaries) {
    console.log(`${s.reviewer.padEnd(22)} caught ${s.caught}/${s.cases}, fabricated ${s.fabricated}, unlabeled extras ${s.extraUnlabeled}`);
  }
  for (const run of runs.filter((r) => r.errors.length > 0)) {
    console.log(`${run.reviewer}: ${run.errors.length} case(s) errored, see results/runs/${run.reviewer}.json`);
  }
  console.log('\nwrote results/summary.md, results/scores.json, results/triage.json');
}

if (require.main === module) {
  main();
}

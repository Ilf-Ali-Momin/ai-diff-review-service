/**
 * The referee. Pure functions, no I/O.
 *
 * Every reviewer is judged the same way, against the diff we parsed ourselves
 * and never against what the reviewer claims about it. That is the same rule
 * the service applies to its own model (see validateFinding in
 * src/providers/llm.ts), turned around and pointed at every reviewer.
 *
 * Two questions per finding:
 *   1. Grounding: does it point at something that is really in the diff, and
 *      if it quotes that line, does it quote it correctly?
 *   2. Match: does it point at the line where the known bug lives?
 *
 * A finding that is grounded but does not match the bug is not automatically
 * noise: it may be a real issue the ground truth does not cover. Those are
 * left for a human to label (see triage in report.ts) rather than guessed at.
 */

import { createHash } from 'node:crypto';

import { parseDiff } from '../../src/core/parseDiff';
import type {
  BenchCase,
  BugLocation,
  CaseScore,
  Grounding,
  ReviewerFinding,
  ScoredFinding,
} from './types';

/**
 * How far from a bug line a finding may point and still count as catching it.
 * Reviewers often anchor a comment on the first line of a statement or on the
 * line above, so an exact match would undercount real catches.
 */
export const LINE_TOLERANCE = 2;

/** Ground truth for a reversed fix: every line it adds is a line the fix removed. */
export function groundTruthFromDiff(diff: string): BugLocation[] {
  const byPath = new Map<string, number[]>();
  for (const added of parseDiff(diff).addedLines) {
    const lines = byPath.get(added.path) ?? [];
    lines.push(added.line);
    byPath.set(added.path, lines);
  }
  return [...byPath].map(([path, lines]) => ({ path, lines }));
}

/** path to the new file lines the diff shows: which are added, which are context, and their text. */
export type DiffIndex = Map<
  string,
  { added: Set<number>; context: Set<number>; text: Map<number, string> }
>;

export function indexDiff(diff: string): DiffIndex {
  const index: DiffIndex = new Map();
  for (const hunk of parseDiff(diff).hunks) {
    const entry = index.get(hunk.path) ?? {
      added: new Set<number>(),
      context: new Set<number>(),
      text: new Map<number, string>(),
    };
    for (const line of hunk.lines) {
      (line.added ? entry.added : entry.context).add(line.line);
      entry.text.set(line.line, line.text);
    }
    index.set(hunk.path, entry);
  }
  return index;
}

/**
 * Pull request reviewers see the case under cases/<id>/ in the cases repo, so
 * their paths carry that prefix. Strip it, and any a/ or b/ diff prefix, so
 * every reviewer is compared on the project's own paths.
 */
/**
 * The opaque directory name a case is published under in the cases
 * repository. Reviewer facing artifacts never carry the case id, because the
 * id would let a reviewer look the answer up instead of finding the bug.
 * Stable, so a rerun updates a case's pull request rather than opening another.
 */
export function caseSlug(caseId: string): string {
  return createHash('sha256').update(caseId).digest('hex').slice(0, 8);
}

export function normalizePath(path: string, caseId: string): string {
  let result = path.trim().replace(/^\.\//, '');
  // Only this case's own directory is stripped, under either the id or the
  // slug it is published as. A path under another case's directory is left
  // alone, so a finding pointing into a different case stays fabricated
  // rather than being quietly remapped onto this one.
  for (const prefix of [`cases/${caseId}/`, `cases/${caseSlug(caseId)}/`]) {
    if (result.startsWith(prefix)) {
      result = result.slice(prefix.length);
      break;
    }
  }
  if (result.startsWith('a/') || result.startsWith('b/')) {
    result = result.slice(2);
  }
  return result;
}

export function groundingOf(finding: ReviewerFinding, index: DiffIndex): Grounding {
  if (finding.path === null || finding.line === null) {
    return 'unlocated';
  }
  const entry = index.get(normalizePath(finding.path, finding.caseId));
  if (entry === undefined) {
    return 'fabricated';
  }
  const shown = entry.text.get(finding.line);
  if (shown === undefined) {
    return 'fabricated';
  }
  // A reviewer that quotes the line must quote it correctly. Reviewers that
  // quote nothing (most GitHub apps) are judged on location alone.
  if (finding.evidence !== undefined && finding.evidence.trim() !== shown.trim()) {
    return 'misquoted';
  }
  if (entry.added.has(finding.line)) {
    return 'added';
  }
  if (entry.context.has(finding.line)) {
    return 'context';
  }
  return 'fabricated';
}

export function hitsBug(finding: ReviewerFinding, benchCase: BenchCase): boolean {
  if (finding.path === null || finding.line === null) {
    return false;
  }
  const path = normalizePath(finding.path, benchCase.id);
  const line = finding.line;
  return benchCase.groundTruth.some(
    (location) =>
      location.path === path &&
      location.lines.some((bugLine) => Math.abs(bugLine - line) <= LINE_TOLERANCE),
  );
}

/** Stable across reruns, so a human's triage label stays attached to its finding. */
export function findingKey(finding: ReviewerFinding): string {
  const path = finding.path === null ? '-' : normalizePath(finding.path, finding.caseId);
  const title = finding.title.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${finding.reviewer}|${finding.caseId}|${path}|${finding.line ?? '-'}|${title}`;
}

export function scoreCase(
  benchCase: BenchCase,
  reviewer: string,
  findings: ReviewerFinding[],
): CaseScore {
  const index = indexDiff(benchCase.diff);

  const scored: ScoredFinding[] = findings
    .filter((finding) => finding.caseId === benchCase.id && finding.reviewer === reviewer)
    .map((finding) => {
      const grounding = groundingOf(finding, index);
      return {
        ...finding,
        grounding,
        // A finding that points at a line not in the diff, or misquotes the
        // line it points at, cannot catch the bug even if its number lands on it.
        hitsBug: (grounding === 'added' || grounding === 'context') && hitsBug(finding, benchCase),
        key: findingKey(finding),
      };
    });

  return {
    caseId: benchCase.id,
    reviewer,
    caught: scored.some((finding) => finding.hitsBug),
    findings: scored,
  };
}

export type ReviewerSummary = {
  reviewer: string;
  cases: number;
  caught: number;
  findings: number;
  added: number;
  context: number;
  fabricated: number;
  misquoted: number;
  unlocated: number;
  /** Grounded findings that do not point at the bug, split by human label. */
  extraValid: number;
  extraNoise: number;
  extraUnlabeled: number;
};

export function summarize(
  reviewer: string,
  scores: CaseScore[],
  labels: ReadonlyMap<string, 'valid' | 'noise'>,
): ReviewerSummary {
  const mine = scores.filter((score) => score.reviewer === reviewer);
  const all = mine.flatMap((score) => score.findings);
  const extras = all.filter(
    (finding) =>
      !finding.hitsBug && (finding.grounding === 'added' || finding.grounding === 'context'),
  );

  return {
    reviewer,
    cases: mine.length,
    caught: mine.filter((score) => score.caught).length,
    findings: all.length,
    added: all.filter((finding) => finding.grounding === 'added').length,
    context: all.filter((finding) => finding.grounding === 'context').length,
    fabricated: all.filter((finding) => finding.grounding === 'fabricated').length,
    misquoted: all.filter((finding) => finding.grounding === 'misquoted').length,
    unlocated: all.filter((finding) => finding.grounding === 'unlocated').length,
    extraValid: extras.filter((finding) => labels.get(finding.key) === 'valid').length,
    extraNoise: extras.filter((finding) => labels.get(finding.key) === 'noise').length,
    extraUnlabeled: extras.filter((finding) => !labels.has(finding.key)).length,
  };
}

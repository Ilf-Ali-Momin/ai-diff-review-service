/**
 * Types shared by the benchmark. Kept apart from src/ so the service itself
 * never depends on anything here.
 */

/** One place in the buggy code where the bug lives. */
export type BugLocation = {
  /** Path as it appears in the case diff, for example lib/request.js. */
  path: string;
  /** Line numbers in the buggy (head) version of the file. */
  lines: number[];
};

export type BenchCase = {
  id: string;
  repo: string;
  bug: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  /** Upstream commit that fixed the bug, as tagged by BugsJS. */
  upstreamFixSha: string;
  upstreamFixSubject: string;
  /** The fix, reversed: a unified diff that reintroduces the bug. */
  diff: string;
  /** Files the diff touches, relative to the project root. */
  files: string[];
  groundTruth: BugLocation[];
};

/**
 * Anything a reviewer said, reduced to the only fields every reviewer has.
 * `line` is null when the reviewer gave no location, for example a summary
 * comment on the pull request.
 */
export type ReviewerFinding = {
  reviewer: string;
  caseId: string;
  path: string | null;
  line: number | null;
  title: string;
  /** What the reviewer claims the line says, when it claims anything. */
  evidence?: string;
};

/**
 * Where a finding points, judged only against the diff we parsed ourselves.
 *
 * added      on a line the PR adds
 * context    on an unchanged line shown in the diff
 * fabricated on a path or line that is not in the diff at all
 * misquoted  on a real line, but the text it claims is there is not
 * unlocated  no path or line given
 */
export type Grounding = 'added' | 'context' | 'fabricated' | 'misquoted' | 'unlocated';

/** A finding that is grounded but does not match the bug needs a human verdict. */
export type TriageLabel = 'valid' | 'noise';

export type ScoredFinding = ReviewerFinding & {
  grounding: Grounding;
  /** True when it points at (or within tolerance of) a ground truth line. */
  hitsBug: boolean;
  /** Stable key, so triage labels survive a rerun of the scorer. */
  key: string;
};

export type CaseScore = {
  caseId: string;
  reviewer: string;
  caught: boolean;
  findings: ScoredFinding[];
};

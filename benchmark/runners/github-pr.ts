/**
 * Collects what a GitHub review app said on the case pull requests and turns
 * it into findings the scorer understands.
 *
 * It reads all three places a review app can speak:
 *   inline review comments   path + line, the normal case
 *   check run annotations    path + line, used by apps that report via Checks
 *   review and PR comments   no location, recorded as unlocated (summaries)
 *
 * Only comments from accounts whose login matches --login are kept, so a
 * human comment on a PR never leaks into a reviewer's score.
 *
 *   npm run bench:pull -- --reviewer proofline --login proofline
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { readJson, RESULTS_DIR, RUNS_DIR, titleFrom, writeJson, type RunFile } from '../core/io';
import type { ReviewerFinding } from '../core/types';

type Pr = { caseId: string; repo: string; number: number };

type InlineComment = { user: { login: string }; path: string; line: number | null; original_line: number | null; body: string };
type BodyComment = { user: { login: string } | null; body: string | null };
type CheckRun = { app: { slug: string } | null; id: number };
type Annotation = { path: string; start_line: number; title: string | null; message: string };

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined) {
    throw new Error(`missing --${name}`);
  }
  return value;
}

function gh<T>(path: string): T {
  // --paginate with --slurp returns one array per page; flatten them.
  const out = execFileSync('gh', ['api', '--paginate', '--slurp', path], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const pages = JSON.parse(out) as unknown[];
  return pages.flatMap((page) => (Array.isArray(page) ? page : [page])) as T;
}

export function fromInline(c: InlineComment, reviewer: string, caseId: string): ReviewerFinding {
  return { reviewer, caseId, path: c.path, line: c.line ?? c.original_line, title: titleFrom(c.body) };
}

function main(): void {
  const reviewer = arg('reviewer');
  const login = new RegExp(arg('login'), 'i');
  const prs = readJson<Pr[]>(join(RESULTS_DIR, 'prs.json'));
  const run: RunFile = {
    reviewer,
    source: `GitHub app matching /${login.source}/i`,
    ranAt: new Date().toISOString(),
    caseIds: [],
    findings: [],
    errors: [],
  };

  for (const pr of prs) {
    try {
      const base = `repos/${pr.repo}`;
      const inline = gh<InlineComment[]>(`${base}/pulls/${pr.number}/comments`);
      const reviews = gh<BodyComment[]>(`${base}/pulls/${pr.number}/reviews`);
      const issueComments = gh<BodyComment[]>(`${base}/issues/${pr.number}/comments`);

      for (const c of inline.filter((c) => login.test(c.user.login))) {
        run.findings.push(fromInline(c, reviewer, pr.caseId));
      }
      for (const c of [...reviews, ...issueComments]) {
        if (c.user && login.test(c.user.login) && c.body && c.body.trim() !== '') {
          run.findings.push({ reviewer, caseId: pr.caseId, path: null, line: null, title: titleFrom(c.body) });
        }
      }

      const head = execFileSync('gh', ['api', `${base}/pulls/${pr.number}`, '--jq', '.head.sha'], { encoding: 'utf8' }).trim();
      const checks = execFileSync('gh', ['api', `${base}/commits/${head}/check-runs`, '--jq', '.check_runs'], { encoding: 'utf8' });
      for (const check of (JSON.parse(checks) as CheckRun[]).filter((c) => c.app && login.test(c.app.slug))) {
        for (const a of gh<Annotation[]>(`${base}/check-runs/${check.id}/annotations`)) {
          run.findings.push({ reviewer, caseId: pr.caseId, path: a.path, line: a.start_line, title: titleFrom(a.title ?? a.message) });
        }
      }

      run.caseIds.push(pr.caseId);
      console.log(`${pr.caseId.padEnd(14)} ${run.findings.filter((f) => f.caseId === pr.caseId).length} findings`);
    } catch (error) {
      run.errors.push({ caseId: pr.caseId, message: error instanceof Error ? error.message : String(error) });
    }
  }

  writeJson(join(RUNS_DIR, `${reviewer}.json`), run);
  console.log(`\nwrote ${join(RUNS_DIR, `${reviewer}.json`)}`);
}

if (require.main === module) {
  main();
}

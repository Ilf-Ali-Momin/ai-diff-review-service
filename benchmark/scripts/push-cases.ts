/**
 * Turns every case into a real pull request, so reviewers that only work on
 * GitHub (Proofline, or any review bot) see exactly what the model runner saw.
 *
 * Needs an empty repository you own, with the reviewer app installed on it,
 * cloned locally, and the GitHub CLI signed in:
 *
 *   npm run bench:push -- --dir ../ai-review-benchmark-cases --repo you/ai-review-benchmark-cases
 *
 * Layout in that repository:
 *   main             a README and nothing else
 *   base/<slug>      cases/<slug>/<file> at the fixed version, that case only
 *   case/<slug>      the same files at the buggy version, one PR per case
 *
 * One base branch per case, rather than every case's fixed source sitting on
 * the default branch. A reviewer looking at one case used to be able to browse
 * the repository root and read the correct implementation of a different case,
 * because several of these bugs are in the same parsing code: express-4's base
 * holds the fix that express-22 reverses. It is a reduction, not a seal. The
 * other branches are still in the same repository and a reviewer that goes
 * looking can find them. Publishing one repository per case is the only way to
 * close it, and it is not done here.
 *
 * PR titles and bodies are deliberately neutral ("Simplify lib/request.js").
 * Saying what the change does wrong would hand every reviewer the answer.
 *
 * Nothing a reviewer can see carries the case id. The id names a directory in
 * this repository holding `groundTruth` and a written diagnosis, so a reviewer
 * that read `express-16` off a branch name could fetch the answer instead of
 * finding the bug, and would be scored on an easier task than the model, which
 * only ever sees diff text. Reviewer facing artifacts use an opaque slug; the
 * slug to id mapping is written to results/, which is evaluator only.
 *
 * The slug is salted with BENCH_SLUG_SALT from .env, which is not committed.
 * Without a salt the slug is a hash of a committed id, so anyone holding this
 * repository could recompute the mapping and the slug would hide the answer
 * only from someone who did not need it hidden.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { CASES_DIR, loadCases, RESULTS_DIR, writeJson } from '../core/io';
import { caseSlug } from '../core/score';
import type { BenchCase } from '../core/types';

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined) {
    throw new Error(`missing --${name}`);
  }
  return value;
}

/** Every orphan commit is built here, then the real branch is moved onto it. */
const SCRATCH_BRANCH = 'bench-scratch';

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
}

function copyVersion(benchCase: BenchCase, version: 'base' | 'head', repoDir: string, salt: string): void {
  for (const file of benchCase.files) {
    const target = join(repoDir, 'cases', caseSlug(benchCase.id, salt), file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(CASES_DIR, benchCase.id, version, file), target);
  }
}

export function neutralTitle(benchCase: BenchCase): string {
  return `Simplify ${benchCase.files.join(', ')}`;
}

/**
 * The pull request for this case, opened only if it is not already open.
 *
 * A rerun under the same salt pushes the same branch names on purpose, so the
 * existing pull request updates rather than a second one appearing beside it.
 * `gh pr create` fails outright when one is already open for the branch, which
 * would have stopped a rerun at the first case and left prs.json stale.
 */
/**
 * Replaces `branch` with a fresh orphan commit holding `files`, whatever
 * state the clone is in.
 *
 * `git checkout --orphan <name>` refuses when a local branch of that name
 * already exists, which is every rerun in the same clone: the slug is
 * deterministic, so the second run asks for the branch the first one left
 * behind and stops before it reaches any pull request. Building on a fixed
 * scratch branch and moving the ref afterwards works the first time and every
 * time after.
 */
function orphanBranch(branch: string, dir: string, write: () => void): void {
  run('git', ['checkout', '-q', '--orphan', SCRATCH_BRANCH], dir);
  run('git', ['rm', '-rq', '--cached', '.', '--ignore-unmatch'], dir);
  rmSync(join(dir, 'cases'), { recursive: true, force: true });
  rmSync(join(dir, 'README.md'), { force: true });
  write();
  run('git', ['add', '-A'], dir);
  run('git', ['commit', '-q', '-m', `Add ${branch}`, '--allow-empty'], dir);
  // -B moves an existing branch rather than failing on it.
  run('git', ['checkout', '-q', '-B', branch], dir);
  run('git', ['branch', '-q', '-D', SCRATCH_BRANCH], dir);
}

function pullRequestFor(
  repo: string,
  base: string,
  branch: string,
  benchCase: BenchCase,
  dir: string,
): string {
  const existing = run(
    'gh',
    ['pr', 'list', '--repo', repo, '--head', branch, '--state', 'open', '--json', 'url', '--jq', '.[0].url // ""'],
    dir,
  );
  if (existing !== '') {
    return existing;
  }
  return run(
    'gh',
    [
      'pr', 'create', '--repo', repo, '--base', base, '--head', branch,
      '--title', neutralTitle(benchCase),
      '--body', `Small cleanup in ${benchCase.files.join(', ')}.`,
    ],
    dir,
  );
}

function slugSalt(): string {
  const salt = process.env['BENCH_SLUG_SALT'];
  if (salt === undefined || salt.trim() === '') {
    throw new Error(
      'set BENCH_SLUG_SALT in .env to a secret of your own. It salts the published ' +
        'case slugs, and it has to stay the same for the life of a published set.',
    );
  }
  return salt;
}

function main(): void {
  const dir = arg('dir');
  const repo = arg('repo');
  const salt = slugSalt();
  if (!existsSync(join(dir, '.git'))) {
    throw new Error(`${dir} is not a git clone`);
  }
  const cases = loadCases();

  // The default branch carries no case source at all, so the repository root
  // shows a reviewer nothing about any case but the one it is reviewing.
  orphanBranch('main', dir, () => {
    writeFileSync(
      join(dir, 'README.md'),
      [
        '# AI review benchmark cases',
        '',
        'Each pull request in this repository is one benchmark case: a small change to',
        'real open source code.',
        '',
      ].join('\n'),
    );
  });
  run('git', ['push', '-q', '-f', '-u', 'origin', 'main'], dir);

  const prs: Array<{ caseId: string; slug: string; repo: string; number: number; url: string }> = [];
  for (const benchCase of cases) {
    const slug = caseSlug(benchCase.id, salt);
    const base = `base/${slug}`;
    const branch = `case/${slug}`;

    // Orphan, so the base branch holds this case's fixed files and nothing
    // else: no other case, and no history leading to one.
    orphanBranch(base, dir, () => copyVersion(benchCase, 'base', dir, salt));
    run('git', ['push', '-q', '-f', '-u', 'origin', base], dir);

    run('git', ['checkout', '-q', '-B', branch, base], dir);
    copyVersion(benchCase, 'head', dir, salt);
    run('git', ['add', '-A'], dir);
    run('git', ['commit', '-q', '-m', neutralTitle(benchCase)], dir);
    run('git', ['push', '-q', '-f', '-u', 'origin', branch], dir);

    const url = pullRequestFor(repo, base, branch, benchCase, dir);
    const number = Number(url.split('/').pop());
    prs.push({ caseId: benchCase.id, slug, repo, number, url });
    console.log(`${benchCase.id.padEnd(14)} ${url}`);
  }
  run('git', ['checkout', '-q', 'main'], dir);

  writeJson(join(RESULTS_DIR, 'prs.json'), prs);
  console.log(`\nwrote ${join(RESULTS_DIR, 'prs.json')}. Wait for the reviewer to finish, then run bench:pull.`);
}

if (require.main === module) {
  main();
}

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
 *   main             cases/<slug>/<file> at the fixed version, for every case
 *   case/<slug>      the same files at the buggy version, one PR per case
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
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
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

  run('git', ['checkout', '-B', 'main'], dir);
  for (const benchCase of cases) {
    copyVersion(benchCase, 'base', dir, salt);
  }
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
  run('git', ['add', '-A'], dir);
  run('git', ['commit', '-q', '-m', 'Add case base versions', '--allow-empty'], dir);
  run('git', ['push', '-q', '-u', 'origin', 'main'], dir);

  const prs: Array<{ caseId: string; slug: string; repo: string; number: number; url: string }> = [];
  for (const benchCase of cases) {
    const slug = caseSlug(benchCase.id, salt);
    const branch = `case/${slug}`;
    run('git', ['checkout', '-q', '-B', branch, 'main'], dir);
    copyVersion(benchCase, 'head', dir, salt);
    run('git', ['add', '-A'], dir);
    run('git', ['commit', '-q', '-m', neutralTitle(benchCase)], dir);
    run('git', ['push', '-q', '-f', '-u', 'origin', branch], dir);

    const url = run(
      'gh',
      [
        'pr', 'create', '--repo', repo, '--base', 'main', '--head', branch,
        '--title', neutralTitle(benchCase),
        '--body', `Small cleanup in ${benchCase.files.join(', ')}.`,
      ],
      dir,
    );
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

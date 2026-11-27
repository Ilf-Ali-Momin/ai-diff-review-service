/**
 * Runs the service's own model path over every case, once, and records two
 * reviewers from the same responses:
 *
 *   model-raw            everything the model returned, taken at its word
 *   diff-review-service  what survives validateFinding, which is what the
 *                        service would actually return to a client
 *
 * Same model, same prompt, same temperature, same response. The only
 * difference between the two rows of the results table is the validation
 * step, which is the point: it isolates what verification buys.
 *
 *   npm run bench:model        (reads LLM_BASE_URL, LLM_API_KEY, LLM_MODEL from .env)
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { chunkSegments } from '../../src/core/chunk';
import { parseDiff } from '../../src/core/parseDiff';
import {
  buildMessages,
  extractFindingArray,
  groundTruthFor,
  validateFinding,
} from '../../src/providers/llm';
import { loadCases, RUNS_DIR, writeJson, type RunFile } from '../core/io';
import type { ReviewerFinding } from '../core/types';

/**
 * The rule validateFinding used before re anchoring: the quote must match the
 * line at exactly the number the model gave. Kept here so a run records both
 * rules against the same responses, which is the only way the two rows are
 * comparable: the model is not deterministic across runs.
 */
function strictValidate(
  item: Record<string, unknown>,
  truth: ReturnType<typeof groundTruthFor>,
): { path: string; line: number; text: string } | null {
  const path = item['path'];
  const line = item['line'];
  const evidence = item['evidence'];
  if (typeof path !== 'string' || typeof line !== 'number' || !Number.isInteger(line)) {
    return null;
  }
  if (typeof evidence !== 'string') {
    return null;
  }
  const actual = truth.get(path)?.get(line);
  if (actual === undefined || actual.trim() !== evidence.trim()) {
    return null;
  }
  return { path, line, text: actual };
}

/** `--runs N`, default 1. Each run writes its own files. */
function runCountFromArgv(): number {
  const flag = process.argv.indexOf('--runs');
  if (flag === -1) {
    return 1;
  }
  const parsed = Number.parseInt(process.argv[flag + 1] ?? '', 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('--runs needs a positive integer, for example --runs 3');
  }
  return parsed;
}

type Config = { baseUrl: string; apiKey: string; model: string; timeoutMs: number };

/**
 * A variable present but empty is not absent: `??` catches null and undefined,
 * and an empty string is neither. `Number('')` is 0, and a 0 ms
 * `AbortSignal.timeout` aborts every request before it leaves. Same guard as
 * `positiveIntFromEnv` in src/config.ts.
 */
function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function configFromEnv(): Config {
  const baseUrl = process.env['LLM_BASE_URL'];
  const apiKey = process.env['LLM_API_KEY'];
  const model = process.env['LLM_MODEL'];
  if (!baseUrl || !apiKey || !model) {
    throw new Error('set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL (see .env.example)');
  }
  return { baseUrl, apiKey, model, timeoutMs: positiveIntFromEnv('LLM_TIMEOUT_MS', 60_000) };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function complete(config: Config, chunkText: string): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: buildMessages(chunkText, `----UNTRUSTED-DIFF-${randomBytes(16).toString('hex')}----`),
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    // Free tiers rate limit hard. Back off and retry a few times rather than
    // record a rate limit as the reviewer missing the bug.
    if (response.status === 429 && attempt < 5) {
      const wait = Number(response.headers.get('retry-after') ?? 0) * 1000 || 5_000 * attempt;
      await sleep(wait);
      continue;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('response had no message content');
    }
    return content;
  }
}

/** Takes the model at its word, as a client with no validation would. */
function asRawFinding(raw: unknown, caseId: string): ReviewerFinding | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const lineNumber = typeof r['line'] === 'string' ? Number(r['line']) : r['line'];
  return {
    reviewer: 'model-raw',
    caseId,
    path: typeof r['path'] === 'string' ? r['path'] : null,
    line: typeof lineNumber === 'number' && Number.isInteger(lineNumber) ? lineNumber : null,
    title: typeof r['title'] === 'string' ? r['title'].slice(0, 200) : '(no title)',
    ...(typeof r['evidence'] === 'string' ? { evidence: r['evidence'] } : {}),
  };
}

async function runOnce(
  config: Config,
  cases: ReturnType<typeof loadCases>,
  runIndex: number,
  totalRuns: number,
): Promise<void> {
  const ranAt = new Date().toISOString();
  const blank = (reviewer: string, source: string): RunFile => ({
    reviewer,
    source,
    ranAt,
    caseIds: [],
    findings: [],
    errors: [],
  });

  const raw = blank('model-raw', config.model);
  const service = blank('diff-review-service', `${config.model} + validateFinding`);
  const strict = blank(
    'diff-review-service-strict',
    `${config.model} + validateFinding (strict: exact line and quote)`,
  );

  for (const benchCase of cases) {
    const chunks = chunkSegments(parseDiff(benchCase.diff).segments);
    try {
      let kept = 0;
      let keptStrict = 0;
      let returned = 0;
      for (const chunk of chunks) {
        const items = extractFindingArray(await complete(config, chunk.text));
        const truth = groundTruthFor(chunk.text);
        for (const item of items) {
          returned += 1;
          const rawFinding = asRawFinding(item, benchCase.id);
          if (rawFinding !== null) {
            raw.findings.push(rawFinding);
          }

          const validated = validateFinding(item, truth);
          if (validated !== null) {
            kept += 1;
            service.findings.push({
              reviewer: service.reviewer,
              caseId: benchCase.id,
              path: validated.path,
              line: validated.line,
              title: validated.title,
              evidence: validated.evidence,
            });
          }

          // Same response, the rule as it was before re anchoring.
          if (typeof item === 'object' && item !== null) {
            const strictHit = strictValidate(item as Record<string, unknown>, truth);
            if (strictHit !== null) {
              keptStrict += 1;
              strict.findings.push({
                reviewer: strict.reviewer,
                caseId: benchCase.id,
                path: strictHit.path,
                line: strictHit.line,
                title: validated?.title ?? String(((item as Record<string, unknown>)['title'] ?? '')).slice(0, 200),
                evidence: strictHit.text,
              });
            }
          }
        }
      }
      for (const file of [raw, service, strict]) {
        file.caseIds.push(benchCase.id);
      }
      console.log(
        `${benchCase.id.padEnd(14)} returned ${returned}, re anchored kept ${kept}, strict kept ${keptStrict}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const file of [raw, service, strict]) {
        file.errors.push({ caseId: benchCase.id, message });
      }
      console.log(`${benchCase.id.padEnd(14)} ERROR ${message}`);
    }
  }

  // One file per reviewer per run. A single run keeps the plain name so an
  // existing results directory and bench:pull output stay readable.
  const suffix = totalRuns === 1 ? '' : `.run${runIndex}`;
  for (const file of [raw, service, strict]) {
    writeJson(join(RUNS_DIR, `${file.reviewer}${suffix}.json`), file);
  }
  console.log(`  wrote ${raw.reviewer}${suffix}.json, ${service.reviewer}${suffix}.json, ${strict.reviewer}${suffix}.json\n`);
}

async function main(): Promise<void> {
  const config = configFromEnv();
  const cases = loadCases();
  const totalRuns = runCountFromArgv();

  for (let runIndex = 1; runIndex <= totalRuns; runIndex += 1) {
    if (totalRuns > 1) {
      console.log(`--- run ${runIndex} of ${totalRuns} ---`);
    }
    await runOnce(config, cases, runIndex, totalRuns);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

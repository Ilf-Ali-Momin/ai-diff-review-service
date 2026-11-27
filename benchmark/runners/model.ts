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

type Config = { baseUrl: string; apiKey: string; model: string; timeoutMs: number };

function configFromEnv(): Config {
  const baseUrl = process.env['LLM_BASE_URL'];
  const apiKey = process.env['LLM_API_KEY'];
  const model = process.env['LLM_MODEL'];
  if (!baseUrl || !apiKey || !model) {
    throw new Error('set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL (see .env.example)');
  }
  return { baseUrl, apiKey, model, timeoutMs: Number(process.env['LLM_TIMEOUT_MS'] ?? 60_000) };
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

async function main(): Promise<void> {
  const config = configFromEnv();
  const cases = loadCases();
  const ranAt = new Date().toISOString();
  const raw: RunFile = { reviewer: 'model-raw', source: config.model, ranAt, caseIds: [], findings: [], errors: [] };
  const service: RunFile = {
    reviewer: 'diff-review-service',
    source: `${config.model} + validateFinding`,
    ranAt,
    caseIds: [],
    findings: [],
    errors: [],
  };

  for (const benchCase of cases) {
    const chunks = chunkSegments(parseDiff(benchCase.diff).segments);
    try {
      let kept = 0;
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
              reviewer: 'diff-review-service',
              caseId: benchCase.id,
              path: validated.path,
              line: validated.line,
              title: validated.title,
              evidence: validated.evidence,
            });
          }
        }
      }
      raw.caseIds.push(benchCase.id);
      service.caseIds.push(benchCase.id);
      console.log(`${benchCase.id.padEnd(14)} model returned ${returned}, validation kept ${kept}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      raw.errors.push({ caseId: benchCase.id, message });
      service.errors.push({ caseId: benchCase.id, message });
      console.log(`${benchCase.id.padEnd(14)} ERROR ${message}`);
    }
  }

  writeJson(join(RUNS_DIR, 'model-raw.json'), raw);
  writeJson(join(RUNS_DIR, 'diff-review-service.json'), service);
  console.log(`\nwrote ${RUNS_DIR}/model-raw.json and diff-review-service.json`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

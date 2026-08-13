/**
 * A thin client for the probe suite.
 *
 * Everything here goes over real HTTP to a base URL, so the same suite runs
 * against localhost during development and against the deployed URL before
 * submission. That is the point: behavior that works locally and fails behind
 * a proxy is a real risk, especially for the stream.
 */

const base = process.env['PROBE_BASE_URL'];
const token = process.env['PROBE_TOKEN'];

if (base === undefined || base === '' || token === undefined || token === '') {
  throw new Error(
    'PROBE_BASE_URL and PROBE_TOKEN must both be set, for example:\n' +
      '  PROBE_BASE_URL=http://127.0.0.1:3000 PROBE_TOKEN=... npm run probe',
  );
}

export const baseUrl = base.replace(/\/+$/, '');
export const authHeader = { authorization: `Bearer ${token}` };

export type JobView = {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  findings?: Array<{
    id: string;
    ruleId: string;
    path: string;
    line: number;
    severity: string;
    category: string;
    title: string;
    evidence: string;
  }>;
  usage: { inputBytes: number; chunks: number; cacheHit: boolean };
  error?: { code: string; message: string };
};

export function url(path: string): string {
  return `${baseUrl}${path}`;
}

/** A POST with no retry and no token unless one is given. Used by the auth and limit probes. */
export function rawPost(
  body: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url('/v1/reviews'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

/**
 * A POST that survives the rate limiter by waiting out a `Retry-After`.
 *
 * The suite submits more times than the burst allows, so without this every
 * section after the first would be testing the limiter rather than itself.
 * The limiter is still exercised directly, by the probes that mean to.
 */
export async function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  // Generous, because the whole suite shares one bucket and the sections that
  // deliberately exhaust it run last. A client that honours Retry-After should
  // always get through eventually, and if it does not, that is worth failing on.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await rawPost(body, { ...authHeader, ...headers });
    if (response.status !== 429) {
      return response;
    }

    const retryAfter = Number(response.headers.get('retry-after') ?? '2');
    await sleep((Number.isFinite(retryAfter) ? retryAfter : 2) * 1000 + 250);
  }

  throw new Error('still rate limited after twelve attempts honouring Retry-After');
}

export function getJob(jobId: string, headers: Record<string, string> = authHeader): Promise<Response> {
  return fetch(url(`/v1/reviews/${jobId}`), { headers });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function body(diff: string, options?: Record<string, unknown>): string {
  return JSON.stringify(options === undefined ? { diff } : { diff, options });
}

export async function submit(diff: string, options?: Record<string, unknown>): Promise<string> {
  const response = await post(body(diff, options));
  if (response.status !== 202) {
    throw new Error(`submit returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return ((await response.json()) as { jobId: string }).jobId;
}

export async function waitForTerminal(jobId: string, timeoutMs = 30_000): Promise<JobView> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const view = (await (await getJob(jobId)).json()) as JobView;
    if (view.status === 'done' || view.status === 'failed') {
      return view;
    }
    if (Date.now() > deadline) {
      throw new Error(`job ${jobId} was still ${view.status} after ${timeoutMs}ms`);
    }
    await sleep(150);
  }
}

export async function review(diff: string, options?: Record<string, unknown>): Promise<JobView> {
  return waitForTerminal(await submit(diff, options));
}

export type SseEvent = { id: string; event: string; data: string };

export function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '' && !block.startsWith(':'))
    .map((block) => {
      const fields: Record<string, string> = {};
      for (const line of block.split('\n')) {
        const separator = line.indexOf(': ');
        if (separator !== -1) {
          fields[line.slice(0, separator)] = line.slice(separator + 2);
        }
      }
      return { id: fields['id'] ?? '', event: fields['event'] ?? '', data: fields['data'] ?? '' };
    });
}

export async function readStream(jobId: string): Promise<{
  status: number;
  contentType: string | null;
  text: string;
  events: SseEvent[];
}> {
  const response = await fetch(url(`/v1/reviews/${jobId}/stream`), { headers: authHeader });
  const text = await response.text();

  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    text,
    events: parseSse(text),
  };
}

/** Builds a single file diff whose added lines are exactly those given. */
export function fileDiff(path: string, marked: string[], newStart = 1): string {
  const oldCount = marked.filter((line) => !line.startsWith('+')).length;
  const newCount = marked.filter((line) => !line.startsWith('-')).length;

  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${newStart},${oldCount} +${newStart},${newCount} @@`,
    ...marked,
    '',
  ].join('\n');
}

/** Unique per run, so a rerun against the same live service is never a cache hit. */
export const runId = Math.random().toString(36).slice(2, 10);

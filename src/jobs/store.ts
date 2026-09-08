/**
 * The three in memory stores, plus the event log that makes streaming work.
 *
 * Nothing here is persisted. A restart loses every job, which is declared in
 * the README rather than hidden: it is acceptable for a bounded scoring
 * window behind an always restart policy, and wrong for production.
 *
 * The store is created by a factory rather than living at module scope so that
 * each test gets its own, and so that two instances cannot silently share
 * state through an import.
 */

import { randomUUID } from 'node:crypto';

import type { Finding } from '../core/types';
import type { ProviderName } from '../providers/types';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export type Usage = {
  inputBytes: number;
  chunks: number;
  cacheHit: boolean;
};

export type JobEvent =
  | { seq: number; type: 'status'; data: { status: JobStatus } }
  | { seq: number; type: 'finding'; data: Finding }
  | { seq: number; type: 'done'; data: { total: number; usage: Usage } };

/** What one scan produces and what the cache shares between duplicate jobs. */
export type ScanResult = {
  /** The complete ordered, deduplicated list, before any truncation. */
  findings: Finding[];
};

export type Job = {
  id: string;
  status: JobStatus;
  createdAt: number;
  provider: ProviderName;
  maxFindings: number;
  /** Ordered, deduplicated and truncated. Empty until the job completes. */
  findings: Finding[];
  usage: Usage;
  error?: { code: string; message: string };
  /** Append only. The single source of everything the stream emits. */
  events: JobEvent[];
  subscribers: Set<(event: JobEvent) => void>;
};

/**
 * A promise whose settlement is controlled from outside. The cache stores one
 * of these per scan so that duplicate submissions arriving during a scan wait
 * for it instead of repeating it. See D-023.
 */
export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  // When a scan fails and no duplicate submission is waiting on it, nothing
  // else would ever attach a handler and Node would report an unhandled
  // rejection. This inert handler is what keeps the never crash rule true here.
  promise.catch(() => undefined);

  return { promise, resolve, reject };
}

export type JobStore = ReturnType<typeof createJobStore>;

export function createJobStore() {
  const jobs = new Map<string, Job>();
  /** Idempotency-Key value to the body it was first used with. */
  const idempotency = new Map<string, { bodyHash: string; jobId: string }>();
  /** sha256 of the diff plus the provider name, to the scan that is producing it. */
  const cache = new Map<string, Deferred<ScanResult>>();

  function createJob(input: {
    provider: ProviderName;
    maxFindings: number;
    usage: Usage;
  }): Job {
    const job: Job = {
      id: randomUUID(),
      status: 'queued',
      createdAt: Date.now(),
      provider: input.provider,
      maxFindings: input.maxFindings,
      findings: [],
      usage: input.usage,
      events: [],
      subscribers: new Set(),
    };

    jobs.set(job.id, job);
    // The queued transition is an event like any other, so a stream opened
    // before the worker starts still replays the complete sequence.
    appendEvent(job, { type: 'status', data: { status: 'queued' } });
    return job;
  }

  /**
   * The only way an event enters the log.
   *
   * Workers call this; they never write to a socket. The SSE route reads
   * `job.events` and subscribes for the remainder, which is what makes replay,
   * late connection and multiple concurrent streams work with no special
   * cases. See D-011.
   */
  function appendEvent(job: Job, event: Omit<JobEvent, 'seq'>): void {
    const stored = { ...event, seq: job.events.length } as JobEvent;
    job.events.push(stored);

    for (const notify of job.subscribers) {
      // A misbehaving subscriber must not take down the worker that is
      // appending, so each notification is isolated.
      try {
        notify(stored);
      } catch {
        // Ignored deliberately: a broken stream is the stream's problem.
      }
    }
  }

  function setStatus(job: Job, status: JobStatus): void {
    job.status = status;
    appendEvent(job, { type: 'status', data: { status } });
  }

  function subscribe(job: Job, listener: (event: JobEvent) => void): () => void {
    job.subscribers.add(listener);
    return () => job.subscribers.delete(listener);
  }

  return {
    jobs,
    idempotency,
    cache,
    createJob,
    appendEvent,
    setStatus,
    subscribe,
    getJob: (id: string): Job | undefined => jobs.get(id),
  };
}

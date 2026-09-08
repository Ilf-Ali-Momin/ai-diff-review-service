/**
 * Runs one job.
 *
 * Three things this function guarantees, in order of how expensive they are to
 * get wrong: it never throws, it never writes to a socket, and it never
 * touches the semaphore counter. The queue owns the slot, the event log owns
 * the output, and the caller owns nothing but the promise.
 */

import { orderFindings, truncateFindings } from '../core/order';
import type { Chunk } from '../core/types';
import type { Provider } from '../providers/types';
import type { Queue } from './queue';
import type { Deferred, Job, JobStore, ScanResult } from './store';

export type JobPlan = {
  job: Job;
  chunks: Chunk[];
  cacheKey: string;
  cacheEntry: Deferred<ScanResult>;
  /** True for the submission that must actually perform the scan. See D-023. */
  isCacheOwner: boolean;
};

export type WorkerDeps = {
  store: JobStore;
  queue: Queue;
  provider: Provider;
};

function describe(error: unknown): string {
  if (error instanceof Error && error.message !== '') {
    return error.message;
  }
  return 'the provider failed';
}

/**
 * Produces the scan result, either by doing the work or by waiting on the
 * submission that is already doing it.
 *
 * A rejection is removed from the cache before it is propagated, so a failure
 * is never cached and the next submission of the same diff starts fresh.
 */
async function resolveScan(plan: JobPlan, deps: WorkerDeps, signal: AbortSignal): Promise<ScanResult> {
  if (!plan.isCacheOwner) {
    return plan.cacheEntry.promise;
  }

  try {
    const raw = await deps.provider.review(plan.chunks, signal);
    // The one call to the ordering function. Both the JSON result and the
    // event log are derived from this list, never sorted again. Invariant 4.
    const result: ScanResult = { findings: orderFindings(raw) };
    plan.cacheEntry.resolve(result);
    return result;
  } catch (error) {
    deps.store.cache.delete(plan.cacheKey);
    plan.cacheEntry.reject(error);
    throw error;
  }
}

export async function runJob(plan: JobPlan, deps: WorkerDeps): Promise<void> {
  const { job } = plan;
  const controller = new AbortController();

  try {
    await deps.queue.run(async () => {
      try {
        deps.store.setStatus(job, 'running');

        const result = await resolveScan(plan, deps, controller.signal);
        const truncated = truncateFindings(result.findings, job.maxFindings);
        job.findings = truncated;

        for (const finding of truncated) {
          deps.store.appendEvent(job, { type: 'finding', data: finding });
        }

        deps.store.setStatus(job, 'done');
        // `total` counts the events actually emitted, so it follows
        // truncation. `usage` describes the full scan and does not.
        deps.store.appendEvent(job, {
          type: 'done',
          data: { total: truncated.length, usage: job.usage },
        });
      } catch (error) {
        job.error = { code: 'internal', message: describe(error) };
        // A failed job ends at its status event. The contract defines `done`
        // as a completion event, so a failure does not fabricate one.
        deps.store.setStatus(job, 'failed');
      }
    });
  } catch {
    // Unreachable in practice: the inner handler catches everything the task
    // can raise. Present so that a fire and forget call site cannot produce an
    // unhandled rejection, which the never crash rule forbids.
    if (job.status !== 'failed') {
      job.error = { code: 'internal', message: 'the job could not be scheduled' };
      deps.store.setStatus(job, 'failed');
    }
  }
}

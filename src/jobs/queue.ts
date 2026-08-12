/**
 * A counting semaphore with an unbounded FIFO backlog.
 *
 * Forty lines instead of a queue library, which is the point of the exercise.
 * The contract asks for at least four jobs running at once and a queued fifth
 * that does not fail, which is exactly a semaphore plus a waiting list.
 *
 * The release lives in a `finally` inside `run`, and nowhere else. A worker
 * cannot leak a slot even if it throws, because a worker never touches the
 * counter. A leaked slot would silently reduce concurrency toward zero and is
 * the most dangerous bug available in this design.
 */

import { limits } from '../config';

export type Queue = ReturnType<typeof createQueue>;

export function createQueue(capacity: number = limits.maxConcurrentJobs) {
  const waiting: Array<() => void> = [];
  let available = capacity;
  let active = 0;
  let peakActive = 0;

  function acquire(): Promise<void> {
    if (available > 0) {
      available -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
  }

  function release(): void {
    const next = waiting.shift();
    if (next === undefined) {
      available += 1;
      return;
    }
    // Hand the slot straight to the next waiter rather than returning it to
    // the pool. Returning it first would let a later arrival overtake, which
    // would make the backlog not FIFO.
    next();
  }

  return {
    /** Runs `task` once a slot is free, always releasing the slot afterwards. */
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire();
      active += 1;
      peakActive = Math.max(peakActive, active);

      try {
        return await task();
      } finally {
        active -= 1;
        release();
      }
    },

    get capacity(): number {
      return capacity;
    },
    /** Jobs currently holding a slot. */
    get active(): number {
      return active;
    },
    /** Jobs accepted and waiting for a slot. The backlog is unbounded. */
    get waiting(): number {
      return waiting.length;
    },
    /** Highest concurrent count observed, used to verify probe 70 and 77. */
    get peakActive(): number {
      return peakActive;
    },
  };
}

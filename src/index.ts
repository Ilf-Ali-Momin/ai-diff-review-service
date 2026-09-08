import { env } from './config';
import { buildServer } from './http/server';

/**
 * Refuse to start without a token rather than start and reject everything, and
 * rather than accept a bare `Bearer ` because the configured value is empty.
 * See D-029.
 */
if (env.authToken === '') {
  process.stderr.write('AUTH_TOKEN is not set. Refusing to start.\n');
  process.exit(1);
}

const app = buildServer({ logger: true });

/**
 * A hard requirement: the service never crashes.
 *
 * These handlers are the last line rather than the first. A worker already
 * wraps its own body and marks its job `failed`, so anything arriving here has
 * escaped every intended path and is a defect. Logging and continuing is still
 * correct: the alternative is a dead port for the rest of a 96 hour scoring
 * window because one job hit an edge case at hour three.
 */
process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'unhandled rejection, continuing');
});

process.on('uncaughtException', (error) => {
  app.log.error({ err: error }, 'uncaught exception, continuing');
});

/** SIGTERM arrives from Docker on stop and on restart. Close the socket cleanly. */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => process.exit(0));
  });
}

async function start(): Promise<void> {
  try {
    await app.listen({ port: env.port, host: env.host });
  } catch (error) {
    // A port that will not bind is not survivable, so this one does exit.
    app.log.error({ err: error }, 'failed to bind, exiting');
    process.exit(1);
  }
}

void start();

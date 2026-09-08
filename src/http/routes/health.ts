import type { FastifyPluginAsync } from 'fastify';

import { version } from '../../config';

/**
 * GET /health, public. Never behind auth, as the contract requires.
 *
 * `uptimeSeconds` keeps millisecond precision rather than rounding to whole
 * seconds. Two probes fired inside the same second must see the number
 * increase, and an integer would not. See D-016.
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({
    status: 'ok',
    version,
    uptimeSeconds: Math.round(process.uptime() * 1000) / 1000,
  }));
};

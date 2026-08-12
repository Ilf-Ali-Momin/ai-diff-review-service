import type { FastifyPluginAsync } from 'fastify';

import { spec } from '../../config';

/**
 * GET /spec, public.
 *
 * The route serializes the config object itself. It deliberately does not
 * rebuild an equivalent document, because a rebuilt one could drift from the
 * numbers the runtime enforces and the contract scores that drift.
 */
export const specRoutes: FastifyPluginAsync = async (app) => {
  app.get('/spec', async () => spec);
};

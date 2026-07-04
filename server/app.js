// Construction de l'application Fastify : routes API, endpoint de santé
// et service des fichiers statiques du frontend. Le pool est injecté
// pour garder l'application testable.

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyRateLimit from '@fastify/rate-limit';
import { registerWarehouseRoutes } from './routes/warehouses.js';
import { registerScenarioRoutes } from './routes/scenarios.js';
import { registerRunRoutes } from './routes/runs.js';

/**
 * @param {{pool: import('pg').Pool, webRoot?: string, threeRoot?: string, simRoot?: string, logger?: boolean|object}} options
 *        threeRoot : dossier node_modules/three, servi sous /vendor/three
 *        pour que le frontend importe Three.js sans étape de build.
 *        simRoot : dossier sim/, servi sous /sim — le moteur est pur et
 *        s'exécute aussi dans le navigateur pour l'animation.
 *        rateLimit : limitation de débit par IP (déni de service) ;
 *        surchargable pour les tests.
 */
export async function buildApp({
  pool,
  webRoot,
  threeRoot,
  simRoot,
  logger = false,
  rateLimit = { max: 300, timeWindow: '1 minute' },
}) {
  const app = Fastify({ logger });

  // Limitation de débit globale (routes API et statiques)
  await app.register(fastifyRateLimit, rateLimit);

  // Sonde de santé (docker compose healthcheck, probes Kubernetes)
  app.get('/health', async (request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch {
      return reply.code(503).send({ status: 'error', database: 'down' });
    }
  });

  registerWarehouseRoutes(app, pool);
  registerScenarioRoutes(app, pool);
  registerRunRoutes(app, pool);

  if (webRoot) {
    await app.register(fastifyStatic, { root: webRoot });
  }
  if (threeRoot) {
    await app.register(fastifyStatic, {
      root: threeRoot,
      prefix: '/vendor/three/',
      decorateReply: false,
    });
  }
  if (simRoot) {
    await app.register(fastifyStatic, {
      root: simRoot,
      prefix: '/sim/',
      decorateReply: false,
    });
  }

  return app;
}

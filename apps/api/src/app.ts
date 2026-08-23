import cors from '@fastify/cors';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { healthStatusSchema } from '@isuv/contracts';
import { checkDatabase } from './db/client.js';

export type ReadinessCheck = () => Promise<void>;

export function createApp(
  readinessCheck: ReadinessCheck = () => checkDatabase(process.env.DATABASE_URL),
  logger: boolean | FastifyBaseLogger = true,
): FastifyInstance {
  const app = Fastify({
    logger,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  void app.register(cors, { origin: false });
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.get('/health/live', async () =>
    healthStatusSchema.parse({
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    }),
  );

  app.get('/health/ready', async (_request, reply) => {
    try {
      await readinessCheck();
      return healthStatusSchema.parse({
        status: 'ok',
        service: 'api',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      app.log.warn({ err: error }, 'readiness check failed');
      return reply.code(503).send({ status: 'unavailable', service: 'api' });
    }
  });

  app.get('/metrics', async (_request, reply) => {
    reply.type('text/plain; version=0.0.4; charset=utf-8');
    return '# HELP isuv_api_up API process liveness\n# TYPE isuv_api_up gauge\nisuv_api_up 1\n';
  });

  return app;
}

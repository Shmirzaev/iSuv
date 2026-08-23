import cors from '@fastify/cors';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { healthStatusSchema } from '@isuv/contracts';
import { checkDatabase } from './db/client.js';
import { createLocalDevelopmentIdentityProvider } from './modules/identity/provider.js';
import type { IdentityProvider } from './modules/identity/provider.js';
import { PostgresIdentitySessionRepository } from './modules/identity/repository.js';
import type { IdentitySessionRepository } from './modules/identity/repository.js';
import { registerIdentityRoutes } from './modules/identity/routes.js';
import { PostgresTerritoryAuthorizationRepository } from './modules/authorization/service.js';
import type { TerritoryAuthorizationRepository } from './modules/authorization/service.js';
import { PostgresNetworkReadRepository } from './modules/network/repository.js';
import type { NetworkReadRepository } from './modules/network/repository.js';
import { registerNetworkRoutes } from './modules/network/routes.js';

export type ReadinessCheck = () => Promise<void>;

export interface AppOptions {
  identityProvider?: IdentityProvider;
  identitySessionRepository?: IdentitySessionRepository;
  territoryAuthorizationRepository?: TerritoryAuthorizationRepository;
  networkReadRepository?: NetworkReadRepository;
}

export function createApp(
  readinessCheck: ReadinessCheck = () => checkDatabase(process.env.DATABASE_URL),
  logger: boolean | FastifyBaseLogger = true,
  options: AppOptions = {},
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

  const identityProvider = options.identityProvider ?? createLocalDevelopmentIdentityProvider();
  const identitySessionRepository =
    options.identitySessionRepository ??
    new PostgresIdentitySessionRepository(process.env.DATABASE_URL);

  registerIdentityRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
  });
  registerNetworkRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    networkRepository:
      options.networkReadRepository ?? new PostgresNetworkReadRepository(process.env.DATABASE_URL),
  });

  return app;
}

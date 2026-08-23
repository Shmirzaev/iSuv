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
import { PostgresAuditEventRepository } from './modules/audit/repository.js';
import { registerAuditRoutes } from './modules/audit/routes.js';
import { PostgresRoleGrantAdministrationService } from './modules/administration/service.js';
import { registerAdministrationRoutes } from './modules/administration/routes.js';
import { PostgresObservationService } from './modules/observations/service.js';
import { registerObservationRoutes } from './modules/observations/routes.js';
import { registerTelemetrySimulatorRoutes } from './modules/telemetry/routes.js';
import { PostgresValidationService } from './modules/validation/service.js';
import { registerValidationRoutes } from './modules/validation/routes.js';
import { PostgresDeviceHealthService } from './modules/device-health/service.js';
import { registerDeviceHealthRoutes } from './modules/device-health/routes.js';

export type ReadinessCheck = () => Promise<void>;

export interface AppOptions {
  identityProvider?: IdentityProvider;
  identitySessionRepository?: IdentitySessionRepository;
  territoryAuthorizationRepository?: TerritoryAuthorizationRepository;
  networkReadRepository?: NetworkReadRepository;
  auditEventRepository?: PostgresAuditEventRepository;
  roleGrantAdministrationService?: PostgresRoleGrantAdministrationService;
  observationService?: PostgresObservationService;
  validationService?: PostgresValidationService;
  deviceHealthService?: PostgresDeviceHealthService;
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
  const deviceHealthService =
    options.deviceHealthService ?? new PostgresDeviceHealthService(process.env.DATABASE_URL);

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
  registerAuditRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    auditRepository:
      options.auditEventRepository ?? new PostgresAuditEventRepository(process.env.DATABASE_URL),
  });
  registerAdministrationRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    service:
      options.roleGrantAdministrationService ??
      new PostgresRoleGrantAdministrationService(process.env.DATABASE_URL),
  });
  registerObservationRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    observationService:
      options.observationService ?? new PostgresObservationService(process.env.DATABASE_URL),
  });
  registerTelemetrySimulatorRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    observationService:
      options.observationService ?? new PostgresObservationService(process.env.DATABASE_URL),
    ...(options.deviceHealthService || process.env.DATABASE_URL ? { deviceHealthService } : {}),
  });
  registerValidationRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    validationService:
      options.validationService ?? new PostgresValidationService(process.env.DATABASE_URL),
  });
  registerDeviceHealthRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    service: deviceHealthService,
  });

  return app;
}

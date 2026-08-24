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
import { PostgresAllocationPlanService } from './modules/allocation-plans/service.js';
import { registerAllocationPlanRoutes } from './modules/allocation-plans/routes.js';
import { PostgresQuantityDerivationService } from './modules/quantity-derivation/service.js';
import { registerQuantityDerivationRoutes } from './modules/quantity-derivation/routes.js';
import { PostgresAllocationDeviationService } from './modules/allocation-deviation/service.js';
import { registerAllocationDeviationRoutes } from './modules/allocation-deviation/routes.js';
import { PostgresWaterBalanceService } from './modules/water-balance/service.js';
import { registerWaterBalanceRoutes } from './modules/water-balance/routes.js';
import { PostgresAlarmRuleService } from './modules/alarm-rules/service.js';
import { registerAlarmRuleRoutes } from './modules/alarm-rules/routes.js';
import { PostgresAlarmService } from './modules/alarms/service.js';
import { registerAlarmRoutes } from './modules/alarms/routes.js';
import { PostgresIncidentService } from './modules/incidents/service.js';
import { registerIncidentRoutes } from './modules/incidents/routes.js';
import { PostgresDashboardService } from './modules/dashboard/service.js';
import { registerDashboardRoutes } from './modules/dashboard/routes.js';
import { PostgresLiveOperationsService } from './modules/live-operations/service.js';
import { registerLiveOperationsRoutes } from './modules/live-operations/routes.js';
import { PostgresMapNetworkService } from './modules/map-network/service.js';
import { registerMapNetworkRoutes } from './modules/map-network/routes.js';
import { PostgresAlarmIncidentCenterService } from './modules/alarm-incident-center/service.js';
import { registerAlarmIncidentCenterRoutes } from './modules/alarm-incident-center/routes.js';

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
  allocationPlanService?: PostgresAllocationPlanService;
  quantityDerivationService?: PostgresQuantityDerivationService;
  allocationDeviationService?: PostgresAllocationDeviationService;
  waterBalanceService?: PostgresWaterBalanceService;
  alarmRuleService?: PostgresAlarmRuleService;
  alarmService?: PostgresAlarmService;
  incidentService?: PostgresIncidentService;
  dashboardService?: PostgresDashboardService;
  liveOperationsService?: PostgresLiveOperationsService;
  mapNetworkService?: PostgresMapNetworkService;
  alarmIncidentCenterService?: PostgresAlarmIncidentCenterService;
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
  const allocationPlanService =
    options.allocationPlanService ?? new PostgresAllocationPlanService(process.env.DATABASE_URL);
  const quantityDerivationService =
    options.quantityDerivationService ??
    new PostgresQuantityDerivationService(process.env.DATABASE_URL);
  const allocationDeviationService =
    options.allocationDeviationService ??
    new PostgresAllocationDeviationService(process.env.DATABASE_URL);
  const waterBalanceService =
    options.waterBalanceService ?? new PostgresWaterBalanceService(process.env.DATABASE_URL);
  const alarmRuleService =
    options.alarmRuleService ?? new PostgresAlarmRuleService(process.env.DATABASE_URL);
  const alarmService = options.alarmService ?? new PostgresAlarmService(process.env.DATABASE_URL);
  const incidentService =
    options.incidentService ?? new PostgresIncidentService(process.env.DATABASE_URL);
  const dashboardService =
    options.dashboardService ?? new PostgresDashboardService(process.env.DATABASE_URL);
  const liveOperationsService =
    options.liveOperationsService ??
    new PostgresLiveOperationsService(process.env.DATABASE_URL, deviceHealthService);
  const mapNetworkService =
    options.mapNetworkService ?? new PostgresMapNetworkService(process.env.DATABASE_URL);
  const alarmIncidentCenterService =
    options.alarmIncidentCenterService ??
    new PostgresAlarmIncidentCenterService(process.env.DATABASE_URL);

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
  registerAllocationPlanRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    service: allocationPlanService,
  });
  registerQuantityDerivationRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    service: quantityDerivationService,
  });
  registerAllocationDeviationRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    service: allocationDeviationService,
  });
  registerWaterBalanceRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    service: waterBalanceService,
  });
  registerAlarmRuleRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    service: alarmRuleService,
  });
  registerAlarmRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    service: alarmService,
  });
  registerIncidentRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    service: incidentService,
  });
  registerDashboardRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    service: dashboardService,
  });
  registerLiveOperationsRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    service: liveOperationsService,
  });
  registerMapNetworkRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    service: mapNetworkService,
  });
  registerAlarmIncidentCenterRoutes(app, {
    identityProvider,
    sessionRepository: identitySessionRepository,
    authorizationRepository:
      options.territoryAuthorizationRepository ??
      new PostgresTerritoryAuthorizationRepository(process.env.DATABASE_URL),
    service: alarmIncidentCenterService,
  });

  return app;
}

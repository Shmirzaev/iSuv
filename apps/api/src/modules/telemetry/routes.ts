import {
  apiErrorSchema,
  simulatorPreviewRequestSchema,
  simulatorRequestSchema,
  type ApiError,
} from '@isuv/contracts';
import { simulateTelemetryEnvelope } from '@isuv/domain';
import type { FastifyInstance } from 'fastify';
import { ingestSyntheticBatch } from './adapter.js';
import {
  authorizeTerritoryAction,
  type TerritoryAuthorizationRepository,
} from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import type { PostgresObservationService } from '../observations/service.js';

interface TelemetryRoutesOptions {
  identityProvider: IdentityProvider;
  sessionRepository: IdentitySessionRepository;
  authorizationRepository: TerritoryAuthorizationRepository;
  observationService: PostgresObservationService;
  now?: () => Date;
}

function apiError(code: ApiError['error']['code'], message: string, requestId: string): ApiError {
  return apiErrorSchema.parse({ error: { code, message, requestId } });
}

/** Deliberately opt-in local synthetic simulator; it has no production/control route. */
export function registerTelemetrySimulatorRoutes(
  app: FastifyInstance,
  options: TelemetryRoutesOptions,
): void {
  const now = options.now ?? (() => new Date());
  const enabled = () =>
    process.env.NODE_ENV !== 'production' && process.env.ISUV_ENABLE_SYNTHETIC_SIMULATOR === 'true';
  async function authenticate(
    request: { headers: Record<string, string | string[] | undefined>; id: string },
    reply: { code(status: number): { send(value: ApiError): unknown } },
  ): Promise<{ userId: string } | null> {
    const identity = await options.identityProvider.resolve(request);
    if (!identity) {
      reply.code(401).send(apiError('UNAUTHENTICATED', 'Authentication is required.', request.id));
      return null;
    }
    const session = await options.sessionRepository.findCurrentSession(identity.userId, now());
    if (!session) {
      reply.code(401).send(apiError('UNAUTHENTICATED', 'Authentication is required.', request.id));
      return null;
    }
    return { userId: session.user.id };
  }
  async function authorizeAll(
    userId: string,
    action: 'telemetry:read' | 'telemetry:write',
    seed: string,
    at: string,
    step: number,
    scenario: Parameters<typeof simulateTelemetryEnvelope>[3],
  ): Promise<Map<string, string> | null> {
    const envelope = simulateTelemetryEnvelope(seed, at, step, scenario);
    const territories = new Map<string, string>();
    for (const point of envelope.points) {
      const territoryId = await options.observationService.resolveIngestionTerritory(
        point.sensorId,
        point.deviceId,
        point.observedAt,
      );
      if (!territoryId) return null;
      territories.set(point.sourceEventId, territoryId);
    }
    // Status-only offline scenarios still derive authorization from their seeded
    // device sensors at the status timestamp, without manufacturing readings.
    for (const status of envelope.statuses) {
      const territoryId = await options.observationService.resolveIngestionTerritory(
        `f10a${status.hotspot.toString(16).padStart(4, '0')}-0000-4000-8000-000000000001`,
        status.deviceId,
        status.observedAt,
      );
      if (!territoryId) return null;
      territories.set(status.sourceEventId, territoryId);
    }
    for (const territoryId of new Set(territories.values())) {
      const decision = await authorizeTerritoryAction(
        options.authorizationRepository,
        userId,
        action,
        territoryId,
        now(),
      );
      if (!decision.allowed) return null;
    }
    return territories;
  }

  app.get('/api/v1/telemetry/simulator/preview', async (request, reply) => {
    if (!enabled())
      return reply.code(404).send(apiError('NOT_FOUND', 'Simulator was not found.', request.id));
    const identity = await authenticate(request, reply);
    if (!identity) return;
    const parsed = simulatorPreviewRequestSchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'Simulator request is invalid.', request.id));
    const territories = await authorizeAll(
      identity.userId,
      'telemetry:read',
      parsed.data.seed,
      parsed.data.at,
      parsed.data.step,
      parsed.data.scenario,
    );
    if (!territories)
      return reply.code(404).send(apiError('NOT_FOUND', 'Simulator was not found.', request.id));
    const envelope = simulateTelemetryEnvelope(
      parsed.data.seed,
      parsed.data.at,
      parsed.data.step,
      parsed.data.scenario,
    );
    return {
      version: envelope.version,
      classification: envelope.classification,
      seed: envelope.seed,
      scenario: envelope.scenario,
      generatedAt: envelope.generatedAt,
      points: envelope.points.slice(0, parsed.data.limit),
      statuses: envelope.statuses,
    };
  });
  app.post('/api/v1/telemetry/simulator/run', async (request, reply) => {
    if (!enabled())
      return reply.code(404).send(apiError('NOT_FOUND', 'Simulator was not found.', request.id));
    const identity = await authenticate(request, reply);
    if (!identity) return;
    const parsed = simulatorRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'Simulator request is invalid.', request.id));
    const territories = await authorizeAll(
      identity.userId,
      'telemetry:write',
      parsed.data.seed,
      parsed.data.at,
      parsed.data.step,
      parsed.data.scenario,
    );
    if (!territories)
      return reply.code(404).send(apiError('NOT_FOUND', 'Simulator was not found.', request.id));
    return {
      version: 'v1',
      classification: 'synthetic',
      result: await ingestSyntheticBatch(
        options.observationService,
        parsed.data.seed,
        parsed.data.at,
        parsed.data.step,
        parsed.data.scenario,
        territories,
      ),
    };
  });
}

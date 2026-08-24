import {
  apiErrorSchema,
  correctObservationRequestSchema,
  ingestObservationRequestSchema,
  ingestObservationResponseSchema,
  observationHistoryQuerySchema,
  observationHistoryResponseSchema,
  observationAsOfQuerySchema,
  observationResponseSchema,
  type ApiError,
} from '@isuv/contracts';
import type { FastifyInstance } from 'fastify';
import {
  authorizeTerritoryAction,
  type TerritoryAuthorizationRepository,
} from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { ObservationError, type PostgresObservationService } from './service.js';

interface ObservationRoutesOptions {
  identityProvider: IdentityProvider;
  sessionRepository: IdentitySessionRepository;
  authorizationRepository: TerritoryAuthorizationRepository;
  observationService: PostgresObservationService;
  now?: () => Date;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function apiError(code: ApiError['error']['code'], message: string, requestId: string): ApiError {
  return apiErrorSchema.parse({ error: { code, message, requestId } });
}

function status(error: ObservationError): 400 | 404 | 409 {
  if (error.kind === 'NOT_FOUND') return 404;
  if (error.kind === 'CONFLICT') return 409;
  return 400;
}

function errorCode(error: ObservationError): ApiError['error']['code'] {
  if (error.kind === 'NOT_FOUND') return 'NOT_FOUND';
  if (error.kind === 'CONFLICT') return 'CONFLICT';
  return 'VALIDATION_ERROR';
}

export function registerObservationRoutes(
  app: FastifyInstance,
  options: ObservationRoutesOptions,
): void {
  const now = options.now ?? (() => new Date());
  async function authenticate(
    request: { headers: Record<string, string | string[] | undefined>; id: string },
    reply: { code(statusCode: number): { send(value: ApiError): unknown } },
  ): Promise<boolean> {
    const identity = await options.identityProvider.resolve(request);
    if (!identity) {
      reply.code(401).send(apiError('UNAUTHENTICATED', 'Authentication is required.', request.id));
      return false;
    }
    const session = await options.sessionRepository.findCurrentSession(identity.userId, now());
    if (!session) {
      reply.code(401).send(apiError('UNAUTHENTICATED', 'Authentication is required.', request.id));
      return false;
    }
    return true;
  }
  async function authorize(
    request: { headers: Record<string, string | string[] | undefined>; id: string },
    reply: { code(statusCode: number): { send(value: ApiError): unknown } },
    territoryId: string,
    action: 'telemetry:read' | 'telemetry:write' | 'telemetry:correct',
  ): Promise<{ userId: string } | null> {
    const identity = await options.identityProvider.resolve(request);
    if (!identity) {
      reply.code(401).send(apiError('UNAUTHENTICATED', 'Authentication is required.', request.id));
      return null;
    }
    const evaluatedAt = now();
    const session = await options.sessionRepository.findCurrentSession(
      identity.userId,
      evaluatedAt,
    );
    if (!session) {
      reply.code(401).send(apiError('UNAUTHENTICATED', 'Authentication is required.', request.id));
      return null;
    }
    const decision = await authorizeTerritoryAction(
      options.authorizationRepository,
      session.user.id,
      action,
      territoryId,
      evaluatedAt,
    );
    if (!decision.allowed) {
      reply.code(404).send(apiError('NOT_FOUND', 'Observation was not found.', request.id));
      return null;
    }
    return { userId: session.user.id };
  }

  app.post('/api/v1/observations', async (request, reply) => {
    if (!(await authenticate(request, reply))) return;
    const parsed = ingestObservationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'The observation is invalid.', request.id));
    }
    const territoryId = await options.observationService.resolveIngestionTerritory(
      parsed.data.sensorId,
      parsed.data.deviceId,
      parsed.data.observedAt,
    );
    const authorization = territoryId
      ? await authorize(request, reply, territoryId, 'telemetry:write')
      : null;
    if (!authorization) {
      if (!territoryId)
        return reply
          .code(404)
          .send(apiError('NOT_FOUND', 'Observation was not found.', request.id));
      return;
    }
    try {
      return ingestObservationResponseSchema.parse(
        await options.observationService.ingest(parsed.data, territoryId ?? undefined),
      );
    } catch (error) {
      if (error instanceof ObservationError) {
        return reply
          .code(status(error))
          .send(apiError(errorCode(error), error.message, request.id));
      }
      throw error;
    }
  });

  app.post('/api/v1/observations/:lineageId/corrections', async (request, reply) => {
    if (!(await authenticate(request, reply))) return;
    const lineageId = (request.params as { lineageId?: string }).lineageId;
    const parsed = correctObservationRequestSchema.safeParse(request.body);
    if (!lineageId || !uuidPattern.test(lineageId) || !parsed.success) {
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'The correction is invalid.', request.id));
    }
    const territoryId = await options.observationService.findObservationTerritory(lineageId);
    const authorization = territoryId
      ? await authorize(request, reply, territoryId, 'telemetry:correct')
      : null;
    if (!authorization) {
      if (!territoryId)
        return reply
          .code(404)
          .send(apiError('NOT_FOUND', 'Observation was not found.', request.id));
      return;
    }
    try {
      return observationResponseSchema.parse({
        observation: await options.observationService.correct(
          lineageId,
          parsed.data,
          authorization.userId,
          request.id,
        ),
      });
    } catch (error) {
      if (error instanceof ObservationError) {
        return reply
          .code(status(error))
          .send(apiError(errorCode(error), error.message, request.id));
      }
      throw error;
    }
  });

  app.get('/api/v1/observations/:lineageId', async (request, reply) => {
    if (!(await authenticate(request, reply))) return;
    const lineageId = (request.params as { lineageId?: string }).lineageId;
    const asOfQuery = observationAsOfQuerySchema.safeParse(request.query);
    if (!lineageId || !uuidPattern.test(lineageId) || !asOfQuery.success) {
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'The observation query is invalid.', request.id));
    }
    const territoryId = await options.observationService.findObservationTerritory(lineageId);
    const authorization = territoryId
      ? await authorize(request, reply, territoryId, 'telemetry:read')
      : null;
    if (!authorization) {
      if (!territoryId)
        return reply
          .code(404)
          .send(apiError('NOT_FOUND', 'Observation was not found.', request.id));
      return;
    }
    const observation = await options.observationService.find(lineageId, asOfQuery.data.asOf);
    if (!observation)
      return reply.code(404).send(apiError('NOT_FOUND', 'Observation was not found.', request.id));
    return observationResponseSchema.parse({ observation });
  });

  app.get('/api/v1/observations/:lineageId/history', async (request, reply) => {
    if (!(await authenticate(request, reply))) return;
    const lineageId = (request.params as { lineageId?: string }).lineageId;
    const parsed = observationHistoryQuerySchema.safeParse(request.query);
    if (!lineageId || !uuidPattern.test(lineageId) || !parsed.success)
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'The observation query is invalid.', request.id));
    const territoryId = await options.observationService.findObservationTerritory(lineageId);
    const authorization = territoryId
      ? await authorize(request, reply, territoryId, 'telemetry:read')
      : null;
    if (!authorization) {
      if (!territoryId)
        return reply
          .code(404)
          .send(apiError('NOT_FOUND', 'Observation was not found.', request.id));
      return;
    }
    try {
      return observationHistoryResponseSchema.parse(
        await options.observationService.history(lineageId, parsed.data),
      );
    } catch (error) {
      if (error instanceof ObservationError)
        return reply
          .code(status(error))
          .send(apiError(errorCode(error), error.message, request.id));
      throw error;
    }
  });
}

import {
  apiErrorSchema,
  mapNetworkQuerySchema,
  mapNetworkResponseSchema,
  playbackQuerySchema,
  playbackResponseSchema,
  traceQuerySchema,
  traceResponseSchema,
  type ApiError,
} from '@isuv/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authorizeTerritoryAction,
  type TerritoryAuthorizationRepository,
} from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { PostgresMapNetworkService } from './service.js';

const error = (code: ApiError['error']['code'], message: string, requestId: string) =>
  apiErrorSchema.parse({ error: { code, message, requestId } });

export function registerMapNetworkRoutes(
  app: FastifyInstance,
  options: {
    identityProvider: IdentityProvider;
    sessionRepository: IdentitySessionRepository;
    authorizationRepository: TerritoryAuthorizationRepository;
    service: PostgresMapNetworkService;
    now?: () => Date;
  },
): void {
  const now = options.now ?? (() => new Date());

  async function session(request: FastifyRequest, reply: FastifyReply) {
    try {
      const identity = await options.identityProvider.resolve(request);
      const value = identity
        ? await options.sessionRepository.findCurrentSession(identity.userId, now())
        : null;
      if (value) return value;
      reply.code(401).send(error('UNAUTHENTICATED', 'Authentication is required.', request.id));
      return null;
    } catch (err) {
      request.log.error({ err }, 'Map identity resolution failed');
      reply
        .code(503)
        .send(error('UNAVAILABLE', 'Map network is temporarily unavailable.', request.id));
      return null;
    }
  }

  async function allowed(userId: string, territoryId: string): Promise<boolean> {
    return (
      await authorizeTerritoryAction(
        options.authorizationRepository,
        userId,
        'telemetry:read',
        territoryId,
        now(),
      )
    ).allowed;
  }

  async function resolveScope(
    userId: string,
    organizationId: string,
    requestedTerritoryId: string | undefined,
  ): Promise<string | null> {
    const territoryId =
      requestedTerritoryId ??
      (await options.service.findDefaultTerritory(userId, organizationId, now()));
    if (!territoryId || !(await allowed(userId, territoryId))) return null;
    return territoryId;
  }

  app.get('/api/v1/map-network', async (request, reply) => {
    const current = await session(request, reply);
    if (!current) return;
    const query = mapNetworkQuerySchema.safeParse(request.query);
    if (!query.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'Map network query is invalid.', request.id));
    try {
      const territoryId = await resolveScope(
        current.user.id,
        current.user.organizationId,
        query.data.territoryId,
      );
      if (!territoryId)
        return reply.code(404).send(error('NOT_FOUND', 'Map resource was not found.', request.id));
      const value = await options.service.map(territoryId, query.data);
      return value
        ? mapNetworkResponseSchema.parse(value)
        : reply.code(404).send(error('NOT_FOUND', 'Map resource was not found.', request.id));
    } catch (err) {
      request.log.error({ err }, 'Map network composition failed');
      return reply
        .code(503)
        .send(error('UNAVAILABLE', 'Map network is temporarily unavailable.', request.id));
    }
  });

  app.get('/api/v1/map-network/trace', async (request, reply) => {
    const current = await session(request, reply);
    if (!current) return;
    const query = traceQuerySchema.safeParse(request.query);
    if (!query.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'Topology trace query is invalid.', request.id));
    try {
      const territoryId = await resolveScope(
        current.user.id,
        current.user.organizationId,
        query.data.territoryId,
      );
      if (!territoryId)
        return reply.code(404).send(error('NOT_FOUND', 'Map resource was not found.', request.id));
      const value = await options.service.trace(
        territoryId,
        query.data.stationId,
        query.data.direction,
      );
      return value
        ? traceResponseSchema.parse(value)
        : reply.code(404).send(error('NOT_FOUND', 'Map resource was not found.', request.id));
    } catch (err) {
      request.log.error({ err }, 'Map network trace failed');
      return reply
        .code(503)
        .send(error('UNAVAILABLE', 'Map network is temporarily unavailable.', request.id));
    }
  });

  app.get('/api/v1/map-network/playback', async (request, reply) => {
    const current = await session(request, reply);
    if (!current) return;
    const query = playbackQuerySchema.safeParse(request.query);
    if (!query.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'Map playback query is invalid.', request.id));
    try {
      const territoryId = await resolveScope(
        current.user.id,
        current.user.organizationId,
        query.data.territoryId,
      );
      if (!territoryId)
        return reply.code(404).send(error('NOT_FOUND', 'Map resource was not found.', request.id));
      const value = await options.service.playback(territoryId, query.data.stationId);
      return value
        ? playbackResponseSchema.parse(value)
        : reply.code(404).send(error('NOT_FOUND', 'Map resource was not found.', request.id));
    } catch (err) {
      request.log.error({ err }, 'Map network playback failed');
      return reply
        .code(503)
        .send(error('UNAVAILABLE', 'Map network is temporarily unavailable.', request.id));
    }
  });
}

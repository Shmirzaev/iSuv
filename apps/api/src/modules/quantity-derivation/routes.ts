import {
  apiErrorSchema,
  derivedVolumeResponseSchema,
  deriveVolumeQuerySchema,
  ratingCurveLookupQuerySchema,
  ratingCurveLookupResponseSchema,
  type ApiError,
} from '@isuv/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authorizeTerritoryAction,
  type TerritoryAuthorizationRepository,
} from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { PostgresQuantityDerivationService, QuantityDerivationError } from './service.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const error = (code: ApiError['error']['code'], message: string, requestId: string) =>
  apiErrorSchema.parse({ error: { code, message, requestId } });
export function registerQuantityDerivationRoutes(
  app: FastifyInstance,
  options: {
    identityProvider: IdentityProvider;
    sessionRepository: IdentitySessionRepository;
    authorizationRepository: TerritoryAuthorizationRepository;
    service: PostgresQuantityDerivationService;
    now?: () => Date;
  },
): void {
  const now = options.now ?? (() => new Date());
  async function session(request: FastifyRequest, reply: FastifyReply) {
    const identity = await options.identityProvider.resolve(request);
    if (!identity) {
      reply.code(401).send(error('UNAUTHENTICATED', 'Authentication is required.', request.id));
      return null;
    }
    const result = await options.sessionRepository.findCurrentSession(identity.userId, now());
    if (!result) {
      reply.code(401).send(error('UNAUTHENTICATED', 'Authentication is required.', request.id));
      return null;
    }
    return result;
  }
  async function readStation(
    request: FastifyRequest,
    reply: FastifyReply,
    stationId: string,
    userId: string,
  ) {
    const territory = await options.service.findStationTerritory(stationId);
    if (!territory) {
      reply
        .code(404)
        .send(error('NOT_FOUND', 'Quantity derivation resource was not found.', request.id));
      return false;
    }
    const allowed = await authorizeTerritoryAction(
      options.authorizationRepository,
      userId,
      'water_balance:read',
      territory,
      now(),
    );
    if (!allowed.allowed) {
      reply
        .code(404)
        .send(error('NOT_FOUND', 'Quantity derivation resource was not found.', request.id));
      return false;
    }
    return true;
  }
  app.get('/api/v1/stations/:stationId/derived-volume', async (request, reply) => {
    const current = await session(request, reply);
    if (!current) return;
    const stationId = (request.params as { stationId?: string }).stationId;
    const parsed = deriveVolumeQuerySchema.safeParse(request.query);
    if (!stationId || !uuid.test(stationId) || !parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The quantity derivation query is invalid.', request.id));
    try {
      if (!(await readStation(request, reply, stationId, current.user.id))) return;
      return derivedVolumeResponseSchema.parse({
        result: await options.service.derive(stationId, parsed.data),
      });
    } catch (e) {
      if (e instanceof QuantityDerivationError)
        return reply
          .code(e.kind === 'NOT_FOUND' ? 404 : 400)
          .send(
            error(e.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION_ERROR', e.message, request.id),
          );
      return reply
        .code(503)
        .send(error('UNAVAILABLE', 'Quantity derivation is temporarily unavailable.', request.id));
    }
  });
  app.get('/api/v1/rating-curves/:curveId', async (request, reply) => {
    const current = await session(request, reply);
    if (!current) return;
    const curveId = (request.params as { curveId?: string }).curveId;
    const parsed = ratingCurveLookupQuerySchema.safeParse(request.query);
    if (!curveId || !uuid.test(curveId) || !parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The rating curve query is invalid.', request.id));
    try {
      const found = await options.service.findRatingCurve(
        curveId,
        parsed.data.effectiveAt,
        parsed.data.knownAt ?? now().toISOString(),
      );
      if (!found)
        return reply.code(404).send(error('NOT_FOUND', 'Rating curve was not found.', request.id));
      const allowed = await authorizeTerritoryAction(
        options.authorizationRepository,
        current.user.id,
        'water_balance:read',
        found.territoryId,
        now(),
      );
      if (!allowed.allowed)
        return reply.code(404).send(error('NOT_FOUND', 'Rating curve was not found.', request.id));
      return ratingCurveLookupResponseSchema.parse({ ratingCurveVersion: found });
    } catch {
      return reply
        .code(503)
        .send(error('UNAVAILABLE', 'Quantity derivation is temporarily unavailable.', request.id));
    }
  });
}

import {
  analyticsQuerySchema,
  analyticsResponseSchema,
  apiErrorSchema,
  type ApiError,
} from '@isuv/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authorizeTerritoryAction,
  type TerritoryAuthorizationRepository,
} from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { PostgresAnalyticsService } from './service.js';

const error = (code: ApiError['error']['code'], message: string, requestId: string) =>
  apiErrorSchema.parse({ error: { code, message, requestId } });
export function registerAnalyticsRoutes(
  app: FastifyInstance,
  options: {
    identityProvider: IdentityProvider;
    sessionRepository: IdentitySessionRepository;
    authorizationRepository: TerritoryAuthorizationRepository;
    service: PostgresAnalyticsService;
    now?: () => Date;
  },
) {
  const now = options.now ?? (() => new Date());
  async function resolve(request: FastifyRequest, reply: FastifyReply) {
    try {
      const identity = await options.identityProvider.resolve(request);
      const session = identity
        ? await options.sessionRepository.findCurrentSession(identity.userId, now())
        : null;
      if (!session) {
        reply.code(401).send(error('UNAUTHENTICATED', 'Authentication is required.', request.id));
        return null;
      }
      return session;
    } catch {
      reply
        .code(503)
        .send(error('UNAVAILABLE', 'Analytics is temporarily unavailable.', request.id));
      return null;
    }
  }
  app.get('/api/v1/analytics', async (request, reply) => {
    // Authentication intentionally precedes parse/scope lookup to preserve nonenumeration.
    const session = await resolve(request, reply);
    if (!session) return;
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'Analytics query is invalid.', request.id));
    try {
      const territoryId =
        parsed.data.territoryId ??
        (await options.service.findDefaultTerritory(
          session.user.id,
          session.user.organizationId,
          now(),
        ));
      if (!territoryId)
        return reply
          .code(404)
          .send(error('NOT_FOUND', 'Analytics resource was not found.', request.id));
      const decision = await authorizeTerritoryAction(
        options.authorizationRepository,
        session.user.id,
        'telemetry:read',
        territoryId,
        now(),
      );
      if (!decision.allowed)
        return reply
          .code(404)
          .send(error('NOT_FOUND', 'Analytics resource was not found.', request.id));
      const result = await options.service.analytics(territoryId, parsed.data);
      if (!result)
        return reply
          .code(404)
          .send(error('NOT_FOUND', 'Analytics resource was not found.', request.id));
      return analyticsResponseSchema.parse(result);
    } catch {
      return reply
        .code(503)
        .send(error('UNAVAILABLE', 'Analytics is temporarily unavailable.', request.id));
    }
  });
}

import {
  apiErrorSchema,
  dashboardQuerySchema,
  dashboardResponseSchema,
  type ApiError,
} from '@isuv/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authorizeTerritoryAction,
  type TerritoryAuthorizationRepository,
} from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { PostgresDashboardService } from './service.js';

const error = (code: ApiError['error']['code'], message: string, requestId: string) =>
  apiErrorSchema.parse({ error: { code, message, requestId } });

export function registerDashboardRoutes(
  app: FastifyInstance,
  options: {
    identityProvider: IdentityProvider;
    sessionRepository: IdentitySessionRepository;
    authorizationRepository: TerritoryAuthorizationRepository;
    service: PostgresDashboardService;
    now?: () => Date;
  },
) {
  const now = options.now ?? (() => new Date());
  const unavailable = (reply: FastifyReply, requestId: string) =>
    reply.code(503).send(error('UNAVAILABLE', 'Dashboard is temporarily unavailable.', requestId));
  async function session(request: FastifyRequest, reply: FastifyReply) {
    try {
      const identity = await options.identityProvider.resolve(request);
      const resolved = identity
        ? await options.sessionRepository.findCurrentSession(identity.userId, now())
        : null;
      if (!resolved)
        return (
          reply.code(401).send(error('UNAUTHENTICATED', 'Authentication is required.', request.id)),
          null
        );
      return resolved;
    } catch {
      unavailable(reply, request.id);
      return null;
    }
  }
  app.get('/api/v1/dashboard', async (request, reply) => {
    // Resolve identity before parsing client-directed scope/query fields.  This
    // keeps the endpoint's externally visible behavior non-enumerating for
    // anonymous callers as well as for callers outside the requested scope.
    const resolved = await session(request, reply);
    if (!resolved) return;
    const parsed = dashboardQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'Dashboard query is invalid.', request.id));
    try {
      const targetTerritoryId =
        parsed.data.territoryId ??
        (await options.service.findDefaultTerritory(
          resolved.user.id,
          resolved.user.organizationId,
          now(),
        ));
      if (!targetTerritoryId)
        return reply
          .code(404)
          .send(error('NOT_FOUND', 'Dashboard resource was not found.', request.id));
      const decision = await authorizeTerritoryAction(
        options.authorizationRepository,
        resolved.user.id,
        'telemetry:read',
        targetTerritoryId,
        now(),
      );
      if (!decision.allowed)
        return reply
          .code(404)
          .send(error('NOT_FOUND', 'Dashboard resource was not found.', request.id));
      const dashboard = await options.service.dashboard(targetTerritoryId, parsed.data.period);
      if (!dashboard)
        return reply
          .code(404)
          .send(error('NOT_FOUND', 'Dashboard resource was not found.', request.id));
      return dashboardResponseSchema.parse(dashboard);
    } catch {
      return unavailable(reply, request.id);
    }
  });
}

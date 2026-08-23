import {
  apiErrorSchema,
  auditEventsResponseSchema,
  listAuditEventsQuerySchema,
  type ApiError,
} from '@isuv/contracts';
import type { FastifyInstance } from 'fastify';
import {
  authorizeTerritoryAction,
  type TerritoryAuthorizationRepository,
} from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import type { PostgresAuditEventRepository } from './repository.js';

interface AuditRoutesOptions {
  identityProvider: IdentityProvider;
  sessionRepository: IdentitySessionRepository;
  authorizationRepository: TerritoryAuthorizationRepository;
  auditRepository: PostgresAuditEventRepository;
  now?: () => Date;
}

function apiError(code: ApiError['error']['code'], message: string, requestId: string): ApiError {
  return apiErrorSchema.parse({ error: { code, message, requestId } });
}

export function registerAuditRoutes(app: FastifyInstance, options: AuditRoutesOptions): void {
  const now = options.now ?? (() => new Date());
  app.get('/api/v1/audit/events', async (request, reply) => {
    const parsed = listAuditEventsQuerySchema.safeParse(request.query);
    if (!parsed.success || !parsed.data.territoryId) {
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'A valid territoryId is required.', request.id));
    }
    const identity = await options.identityProvider.resolve(request);
    if (!identity) {
      return reply
        .code(401)
        .send(apiError('UNAUTHENTICATED', 'Authentication is required.', request.id));
    }
    const evaluatedAt = now();
    const session = await options.sessionRepository.findCurrentSession(
      identity.userId,
      evaluatedAt,
    );
    if (!session) {
      return reply
        .code(401)
        .send(apiError('UNAUTHENTICATED', 'Authentication is required.', request.id));
    }
    const decision = await authorizeTerritoryAction(
      options.authorizationRepository,
      session.user.id,
      'audit:read',
      parsed.data.territoryId,
      evaluatedAt,
    );
    // A missing territory and a territory outside the caller's authority are
    // intentionally indistinguishable to prevent scope enumeration.
    if (!decision.allowed) {
      return reply
        .code(404)
        .send(apiError('NOT_FOUND', 'Audit events were not found.', request.id));
    }
    try {
      return auditEventsResponseSchema.parse({
        ...(await options.auditRepository.list({
          ...parsed.data,
          territoryId: parsed.data.territoryId,
        })),
      });
    } catch (error) {
      if ((error as Error).message === 'Invalid audit cursor.') {
        return reply.code(400).send(apiError('VALIDATION_ERROR', 'cursor is invalid.', request.id));
      }
      throw error;
    }
  });
}

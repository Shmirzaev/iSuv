import {
  apiErrorSchema,
  auditEventResponseSchema,
  auditEventsResponseSchema,
  getAuditEventParamsSchema,
  getAuditEventQuerySchema,
  listAuditEventsQuerySchema,
  type ApiError,
} from '@isuv/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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

  // Authentication intentionally precedes parsing caller-controlled filters
  // and path values so malformed input cannot probe the protected endpoint.
  async function currentSession(request: FastifyRequest, reply: FastifyReply) {
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
    return { session, evaluatedAt };
  }

  async function selectedScope(
    requestedTerritoryId: string | undefined,
    userId: string,
    organizationId: string,
    evaluatedAt: Date,
    requestId: string,
    reply: FastifyReply,
  ): Promise<string | null> {
    const territoryId =
      requestedTerritoryId ??
      (await options.auditRepository.resolveDefaultTerritory(userId, organizationId, evaluatedAt));
    if (!territoryId) {
      reply.code(404).send(apiError('NOT_FOUND', 'Audit events were not found.', requestId));
      return null;
    }
    const decision = await authorizeTerritoryAction(
      options.authorizationRepository,
      userId,
      'audit:read',
      territoryId,
      evaluatedAt,
    );
    // A missing territory and a territory outside the caller's authority are
    // intentionally indistinguishable to prevent scope enumeration.
    if (!decision.allowed) {
      reply.code(404).send(apiError('NOT_FOUND', 'Audit events were not found.', requestId));
      return null;
    }
    return territoryId;
  }

  app.get('/api/v1/audit/events', async (request, reply) => {
    const current = await currentSession(request, reply);
    if (!current) return;
    const parsed = listAuditEventsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'Audit filters are invalid.', request.id));
    }
    const territoryId = await selectedScope(
      parsed.data.territoryId,
      current.session.user.id,
      current.session.organization.id,
      current.evaluatedAt,
      request.id,
      reply,
    );
    if (!territoryId) return;
    try {
      return auditEventsResponseSchema.parse({
        scope: { territoryId, includesDescendants: true },
        ...(await options.auditRepository.list({ ...parsed.data, territoryId })),
      });
    } catch (error) {
      if ((error as Error).message === 'Invalid audit cursor.') {
        return reply.code(400).send(apiError('VALIDATION_ERROR', 'cursor is invalid.', request.id));
      }
      throw error;
    }
  });

  app.get('/api/v1/audit/events/:eventId', async (request, reply) => {
    const current = await currentSession(request, reply);
    if (!current) return;
    const params = getAuditEventParamsSchema.safeParse(request.params);
    const query = getAuditEventQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'Audit event reference is invalid.', request.id));
    }
    const territoryId = await selectedScope(
      query.data.territoryId,
      current.session.user.id,
      current.session.organization.id,
      current.evaluatedAt,
      request.id,
      reply,
    );
    if (!territoryId) return;
    const event = await options.auditRepository.findById(params.data.eventId, territoryId);
    if (!event) {
      return reply.code(404).send(apiError('NOT_FOUND', 'Audit event was not found.', request.id));
    }
    return auditEventResponseSchema.parse({
      scope: { territoryId, includesDescendants: true },
      event,
    });
  });
}

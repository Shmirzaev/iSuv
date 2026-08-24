import {
  apiErrorSchema,
  networkEntitiesResponseSchema,
  networkEntityResponseSchema,
  networkEntityTypeSchema,
  networkTopologyResponseSchema,
  type ApiError,
  type Session,
} from '@isuv/contracts';
import type { FastifyInstance } from 'fastify';
import {
  authorizeTerritoryAction,
  type TerritoryAuthorizationRepository,
} from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import type { NetworkReadRepository } from './repository.js';

interface NetworkRoutesOptions {
  identityProvider: IdentityProvider;
  sessionRepository: IdentitySessionRepository;
  authorizationRepository: TerritoryAuthorizationRepository;
  networkRepository: NetworkReadRepository;
  now?: () => Date;
}

interface AuthenticatedSession {
  session: Session;
  evaluatedAt: Date;
}

function apiError(code: ApiError['error']['code'], message: string, requestId: string): ApiError {
  return apiErrorSchema.parse({ error: { code, message, requestId } });
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseUuid(value: unknown): string | null {
  return typeof value === 'string' && uuidPattern.test(value) ? value : null;
}

export function registerNetworkRoutes(app: FastifyInstance, options: NetworkRoutesOptions): void {
  const now = options.now ?? (() => new Date());

  async function authenticate(
    request: { headers: Record<string, string | string[] | undefined>; id: string },
    reply: { code(statusCode: number): { send(value: ApiError): unknown } },
  ): Promise<AuthenticatedSession | null> {
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

  async function authorizeRead(
    authenticated: AuthenticatedSession,
    request: { id: string },
    reply: { code(statusCode: number): { send(value: ApiError): unknown } },
    territoryId: string,
    hideUnauthorizedResource = false,
  ): Promise<boolean> {
    const decision = await authorizeTerritoryAction(
      options.authorizationRepository,
      authenticated.session.user.id,
      'network:read',
      territoryId,
      authenticated.evaluatedAt,
    );
    if (!decision.allowed) {
      if (hideUnauthorizedResource) {
        reply.code(404).send(apiError('NOT_FOUND', 'Network entity was not found.', request.id));
      } else {
        reply
          .code(403)
          .send(apiError('FORBIDDEN', 'You are not authorized for this territory.', request.id));
      }
      return false;
    }
    return true;
  }

  app.get('/api/v1/network/topology', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const territoryId = parseUuid((request.query as { territoryId?: string }).territoryId);
    if (!territoryId) {
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'territoryId must be a UUID.', request.id));
    }
    if (!(await authorizeRead(session, request, reply, territoryId))) return;
    return networkTopologyResponseSchema.parse({
      edges: await options.networkRepository.listTopology(territoryId),
    });
  });

  app.get('/api/v1/network/entities/:entityType', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const type = networkEntityTypeSchema.safeParse(
      (request.params as { entityType?: string }).entityType,
    );
    const territoryId = parseUuid((request.query as { territoryId?: string }).territoryId);
    if (!type.success || !territoryId) {
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'entityType and territoryId are invalid.', request.id));
    }
    if (!(await authorizeRead(session, request, reply, territoryId))) return;
    return networkEntitiesResponseSchema.parse({
      entities: await options.networkRepository.listEntities(type.data, territoryId),
    });
  });

  app.get('/api/v1/network/entities/:entityType/:id', async (request, reply) => {
    const session = await authenticate(request, reply);
    if (!session) return;
    const type = networkEntityTypeSchema.safeParse(
      (request.params as { entityType?: string }).entityType,
    );
    const id = parseUuid((request.params as { id?: string }).id);
    if (!type.success || !id) {
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'entityType and id are invalid.', request.id));
    }
    const entity = await options.networkRepository.findEntity(type.data, id);
    if (!entity) {
      return reply
        .code(404)
        .send(apiError('NOT_FOUND', 'Network entity was not found.', request.id));
    }
    // Resolve the owning territory internally, but return the same response as
    // an unknown identifier when scope does not permit seeing this entity.
    if (!(await authorizeRead(session, request, reply, entity.territoryId, true))) return;
    return networkEntityResponseSchema.parse({ entity });
  });
}

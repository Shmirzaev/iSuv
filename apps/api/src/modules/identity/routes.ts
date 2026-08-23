import {
  apiErrorSchema,
  currentGrantsResponseSchema,
  sessionResponseSchema,
  type ApiError,
} from '@isuv/contracts';
import type { FastifyInstance } from 'fastify';
import type { IdentityProvider } from './provider.js';
import type { IdentitySessionRepository } from './repository.js';

interface IdentityRoutesOptions {
  identityProvider: IdentityProvider;
  sessionRepository: IdentitySessionRepository;
  now?: () => Date;
}

function unauthenticated(requestId: string): ApiError {
  return apiErrorSchema.parse({
    error: {
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required.',
      requestId,
    },
  });
}

export function registerIdentityRoutes(app: FastifyInstance, options: IdentityRoutesOptions): void {
  const now = options.now ?? (() => new Date());

  async function resolveSession(request: {
    headers: Record<string, string | string[] | undefined>;
    id: string;
  }) {
    const identity = await options.identityProvider.resolve(request);
    if (!identity) return { error: unauthenticated(request.id) };
    const session = await options.sessionRepository.findCurrentSession(identity.userId, now());
    if (!session) return { error: unauthenticated(request.id) };
    return { session };
  }

  app.get('/api/v1/session', async (request, reply) => {
    const result = await resolveSession(request);
    if ('error' in result) return reply.code(401).send(result.error);
    return sessionResponseSchema.parse({ session: result.session });
  });

  app.get('/api/v1/session/current-grants', async (request, reply) => {
    const result = await resolveSession(request);
    if ('error' in result) return reply.code(401).send(result.error);
    return currentGrantsResponseSchema.parse({ currentGrants: result.session.currentGrants });
  });
}

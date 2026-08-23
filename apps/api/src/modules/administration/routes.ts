import {
  apiErrorSchema,
  createRoleGrantRequestSchema,
  revokeRoleGrantRequestSchema,
  roleGrantMutationResponseSchema,
  type ApiError,
} from '@isuv/contracts';
import type { FastifyInstance } from 'fastify';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { AdministrationError, type PostgresRoleGrantAdministrationService } from './service.js';

interface AdministrationRoutesOptions {
  identityProvider: IdentityProvider;
  sessionRepository: IdentitySessionRepository;
  service: PostgresRoleGrantAdministrationService;
  now?: () => Date;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function apiError(code: ApiError['error']['code'], message: string, requestId: string): ApiError {
  return apiErrorSchema.parse({ error: { code, message, requestId } });
}

function statusFor(error: AdministrationError): 400 | 403 | 404 | 409 {
  if (error.kind === 'FORBIDDEN') return 403;
  if (error.kind === 'NOT_FOUND') return 404;
  if (error.kind === 'CONFLICT') return 409;
  return 400;
}

function errorCodeFor(error: AdministrationError): ApiError['error']['code'] {
  if (error.kind === 'FORBIDDEN') return 'FORBIDDEN';
  if (error.kind === 'NOT_FOUND') return 'NOT_FOUND';
  if (error.kind === 'CONFLICT') return 'CONFLICT';
  return 'VALIDATION_ERROR';
}

export function registerAdministrationRoutes(
  app: FastifyInstance,
  options: AdministrationRoutesOptions,
): void {
  const now = options.now ?? (() => new Date());
  const resolveActor = async (request: {
    headers: Record<string, string | string[] | undefined>;
    id: string;
  }) => {
    const identity = await options.identityProvider.resolve(request);
    if (!identity) return null;
    const session = await options.sessionRepository.findCurrentSession(identity.userId, now());
    return session?.user.id ?? null;
  };
  app.post('/api/v1/admin/role-grants', async (request, reply) => {
    const actorUserId = await resolveActor(request);
    if (!actorUserId)
      return reply
        .code(401)
        .send(apiError('UNAUTHENTICATED', 'Authentication is required.', request.id));
    const parsed = createRoleGrantRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'The role grant is invalid.', request.id));
    try {
      return roleGrantMutationResponseSchema.parse(
        await options.service.create(actorUserId, request.id, parsed.data, now()),
      );
    } catch (error) {
      if (error instanceof AdministrationError) {
        return reply
          .code(statusFor(error))
          .send(apiError(errorCodeFor(error), error.message, request.id));
      }
      throw error;
    }
  });

  app.post('/api/v1/admin/role-grants/:id/revocations', async (request, reply) => {
    const actorUserId = await resolveActor(request);
    if (!actorUserId)
      return reply
        .code(401)
        .send(apiError('UNAUTHENTICATED', 'Authentication is required.', request.id));
    const grantId = (request.params as { id?: string }).id;
    const parsed = revokeRoleGrantRequestSchema.safeParse(request.body);
    if (!grantId || !uuidPattern.test(grantId) || !parsed.success) {
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'The revocation is invalid.', request.id));
    }
    try {
      return roleGrantMutationResponseSchema.parse(
        await options.service.revoke(actorUserId, request.id, grantId, parsed.data, now()),
      );
    } catch (error) {
      if (error instanceof AdministrationError) {
        return reply
          .code(statusFor(error))
          .send(apiError(errorCodeFor(error), error.message, request.id));
      }
      throw error;
    }
  });
}

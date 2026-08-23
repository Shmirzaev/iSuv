import {
  apiErrorSchema,
  approveValidationProfileVersionRequestSchema,
  automaticValidationResponseSchema,
  createValidationProfileRequestSchema,
  createValidationProfileVersionRequestSchema,
  validateObservationRequestSchema,
  validationProfileVersionResponseSchema,
  type ApiError,
} from '@isuv/contracts';
import type { FastifyInstance } from 'fastify';
import {
  authorizeTerritoryAction,
  type TerritoryAuthorizationRepository,
} from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { ValidationError, type PostgresValidationService } from './service.js';

interface Options {
  identityProvider: IdentityProvider;
  sessionRepository: IdentitySessionRepository;
  authorizationRepository: TerritoryAuthorizationRepository;
  validationService: PostgresValidationService;
  now?: () => Date;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function error(code: ApiError['error']['code'], message: string, requestId: string): ApiError {
  return apiErrorSchema.parse({ error: { code, message, requestId } });
}
function failure(
  reply: { code(status: number): { send(value: ApiError): unknown } },
  requestId: string,
  issue: ValidationError,
): unknown {
  const status = issue.kind === 'NOT_FOUND' ? 404 : issue.kind === 'CONFLICT' ? 409 : 400;
  return reply
    .code(status)
    .send(
      error(
        issue.kind === 'NOT_FOUND'
          ? 'NOT_FOUND'
          : issue.kind === 'CONFLICT'
            ? 'CONFLICT'
            : 'VALIDATION_ERROR',
        issue.message,
        requestId,
      ),
    );
}
export function registerValidationRoutes(app: FastifyInstance, options: Options): void {
  const now = options.now ?? (() => new Date());
  async function authority(
    request: { headers: Record<string, string | string[] | undefined>; id: string },
    reply: { code(status: number): { send(value: ApiError): unknown } },
    territoryId: string,
    action:
      | 'validation_profile:read'
      | 'validation_profile:write'
      | 'validation_profile:approve'
      | 'telemetry:correct',
  ): Promise<{ userId: string } | null> {
    const identity = await options.identityProvider.resolve(request);
    if (!identity) {
      reply.code(401).send(error('UNAUTHENTICATED', 'Authentication is required.', request.id));
      return null;
    }
    const evaluatedAt = now();
    const session = await options.sessionRepository.findCurrentSession(
      identity.userId,
      evaluatedAt,
    );
    if (!session) {
      reply.code(401).send(error('UNAUTHENTICATED', 'Authentication is required.', request.id));
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
      reply.code(404).send(error('NOT_FOUND', 'Validation resource was not found.', request.id));
      return null;
    }
    return { userId: session.user.id };
  }
  app.post('/api/v1/validation/profiles', async (request, reply) => {
    const parsed = createValidationProfileRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The validation profile is invalid.', request.id));
    const actor = await authority(
      request,
      reply,
      parsed.data.territoryId,
      'validation_profile:write',
    );
    if (!actor) return;
    try {
      return validationProfileVersionResponseSchema.parse({
        profileVersion: await options.validationService.createProfile(
          parsed.data,
          actor.userId,
          request.id,
        ),
      });
    } catch (issue) {
      if (issue instanceof ValidationError) return failure(reply, request.id, issue);
      throw issue;
    }
  });
  app.post('/api/v1/validation/profiles/:profileId/versions', async (request, reply) => {
    const profileId = (request.params as { profileId?: string }).profileId;
    const parsed = createValidationProfileVersionRequestSchema.safeParse(request.body);
    if (!profileId || !uuid.test(profileId) || !parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The validation profile is invalid.', request.id));
    const actor = await authority(
      request,
      reply,
      parsed.data.territoryId,
      'validation_profile:write',
    );
    if (!actor) return;
    try {
      return validationProfileVersionResponseSchema.parse({
        profileVersion: await options.validationService.createVersion(
          profileId,
          parsed.data.territoryId,
          parsed.data,
          actor.userId,
          request.id,
        ),
      });
    } catch (issue) {
      if (issue instanceof ValidationError) return failure(reply, request.id, issue);
      throw issue;
    }
  });
  app.post(
    '/api/v1/validation/profiles/:profileId/versions/:version/approve',
    async (request, reply) => {
      const { profileId, version } = request.params as { profileId?: string; version?: string };
      const parsed = approveValidationProfileVersionRequestSchema.safeParse(request.body);
      if (
        !profileId ||
        !uuid.test(profileId) ||
        !Number.isInteger(Number(version)) ||
        Number(version) < 1 ||
        !parsed.success
      )
        return reply
          .code(400)
          .send(error('VALIDATION_ERROR', 'The validation profile is invalid.', request.id));
      const actor = await authority(
        request,
        reply,
        parsed.data.territoryId,
        'validation_profile:approve',
      );
      if (!actor) return;
      try {
        return validationProfileVersionResponseSchema.parse({
          profileVersion: await options.validationService.approveVersion(
            profileId,
            Number(version),
            parsed.data.territoryId,
            parsed.data.reason,
            actor.userId,
            request.id,
          ),
        });
      } catch (issue) {
        if (issue instanceof ValidationError) return failure(reply, request.id, issue);
        throw issue;
      }
    },
  );
  app.post('/api/v1/observations/:lineageId/validate', async (request, reply) => {
    const lineageId = (request.params as { lineageId?: string }).lineageId;
    const parsed = validateObservationRequestSchema.safeParse(request.body);
    if (!lineageId || !uuid.test(lineageId) || !parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The validation request is invalid.', request.id));
    const actor = await authority(request, reply, parsed.data.territoryId, 'telemetry:correct');
    if (!actor) return;
    try {
      return automaticValidationResponseSchema.parse(
        await options.validationService.validate(
          lineageId,
          parsed.data.territoryId,
          actor.userId,
          request.id,
          now(),
          parsed.data.algorithmVersion,
        ),
      );
    } catch (issue) {
      if (issue instanceof ValidationError) return failure(reply, request.id, issue);
      throw issue;
    }
  });
}

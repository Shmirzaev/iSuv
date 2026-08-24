import {
  alarmIncidentCenterQuerySchema,
  alarmIncidentCenterResponseSchema,
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
import { PostgresAlarmIncidentCenterService } from './service.js';
const error = (code: ApiError['error']['code'], message: string, requestId: string) =>
  apiErrorSchema.parse({ error: { code, message, requestId } });
export function registerAlarmIncidentCenterRoutes(
  app: FastifyInstance,
  options: {
    identityProvider: IdentityProvider;
    sessionRepository: IdentitySessionRepository;
    authorizationRepository: TerritoryAuthorizationRepository;
    service: PostgresAlarmIncidentCenterService;
    now?: () => Date;
  },
) {
  const now = options.now ?? (() => new Date());
  async function session(req: FastifyRequest, reply: FastifyReply) {
    try {
      const identity = await options.identityProvider.resolve(req);
      const current = identity
        ? await options.sessionRepository.findCurrentSession(identity.userId, now())
        : null;
      if (current) return current;
      reply.code(401).send(error('UNAUTHENTICATED', 'Authentication is required.', req.id));
      return null;
    } catch {
      reply
        .code(503)
        .send(
          error('UNAVAILABLE', 'Alarm and incident center is temporarily unavailable.', req.id),
        );
      return null;
    }
  }
  app.get('/api/v1/alarm-incident-center', async (req, reply) => {
    const current = await session(req, reply);
    if (!current) return;
    const parsed = alarmIncidentCenterQuerySchema.safeParse(req.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'Alarm and incident center query is invalid.', req.id));
    try {
      const territoryId =
        parsed.data.territoryId ??
        (await options.service.findDefaultTerritory(
          current.user.id,
          current.user.organizationId,
          now(),
        ));
      if (!territoryId)
        return reply
          .code(404)
          .send(error('NOT_FOUND', 'Alarm and incident center resource was not found.', req.id));
      const allowed = await Promise.all(
        ['alarm:read', 'incident:read'].map((action) =>
          authorizeTerritoryAction(
            options.authorizationRepository,
            current.user.id,
            action as 'alarm:read' | 'incident:read',
            territoryId,
            now(),
          ),
        ),
      );
      if (allowed.some((x) => !x.allowed))
        return reply
          .code(404)
          .send(error('NOT_FOUND', 'Alarm and incident center resource was not found.', req.id));
      const value = await options.service.list(territoryId, current.user.id, parsed.data);
      return value
        ? alarmIncidentCenterResponseSchema.parse(value)
        : reply
            .code(404)
            .send(error('NOT_FOUND', 'Alarm and incident center resource was not found.', req.id));
    } catch (e) {
      if (e instanceof Error && e.message === 'CURSOR')
        return reply
          .code(400)
          .send(error('VALIDATION_ERROR', 'Alarm and incident center cursor is invalid.', req.id));
      req.log.error({ err: e }, 'Alarm and incident center composition failed');
      return reply
        .code(503)
        .send(
          error('UNAVAILABLE', 'Alarm and incident center is temporarily unavailable.', req.id),
        );
    }
  });
}

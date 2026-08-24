import {
  alarmCatalogReadQuerySchema,
  alarmCatalogReadResponseSchema,
  alarmCatalogVersionResponseSchema,
  alarmMaterializationResponseSchema,
  apiErrorSchema,
  approveAlarmCatalogVersionRequestSchema,
  createAlarmCatalogRequestSchema,
  materializeAlarmRequestSchema,
  requestAlarmCatalogVersionRequestSchema,
  type ApiError,
} from '@isuv/contracts';
import type { AuthorizationAction } from '@isuv/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authorizeTerritoryAction,
  type TerritoryAuthorizationRepository,
} from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { AlarmError, PostgresAlarmService } from './service.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const error = (code: ApiError['error']['code'], message: string, requestId: string) =>
  apiErrorSchema.parse({ error: { code, message, requestId } });

export function registerAlarmRoutes(
  app: FastifyInstance,
  options: {
    identityProvider: IdentityProvider;
    sessionRepository: IdentitySessionRepository;
    authorizationRepository: TerritoryAuthorizationRepository;
    service: PostgresAlarmService;
    now?: () => Date;
  },
) {
  const now = options.now ?? (() => new Date());
  const unavailable = (reply: FastifyReply, requestId: string) =>
    reply
      .code(503)
      .send(error('UNAVAILABLE', 'Alarm service is temporarily unavailable.', requestId));
  const failure = (reply: FastifyReply, requestId: string, issue: unknown) => {
    if (!(issue instanceof AlarmError)) return unavailable(reply, requestId);
    const status = issue.kind === 'NOT_FOUND' ? 404 : issue.kind === 'CONFLICT' ? 409 : 400;
    const code =
      issue.kind === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : issue.kind === 'CONFLICT'
          ? 'CONFLICT'
          : 'VALIDATION_ERROR';
    return reply.code(status).send(error(code, issue.message, requestId));
  };
  async function session(request: FastifyRequest, reply: FastifyReply) {
    const identity = await options.identityProvider.resolve(request);
    const resolved = identity
      ? await options.sessionRepository.findCurrentSession(identity.userId, now())
      : null;
    if (!resolved) {
      reply.code(401).send(error('UNAUTHENTICATED', 'Authentication is required.', request.id));
      return null;
    }
    return resolved;
  }
  async function authorize(
    request: FastifyRequest,
    reply: FastifyReply,
    territoryId: string,
    actorId: string,
    actions: AuthorizationAction[],
  ) {
    try {
      const decisions = await Promise.all(
        actions.map((action) =>
          authorizeTerritoryAction(
            options.authorizationRepository,
            actorId,
            action,
            territoryId,
            now(),
          ),
        ),
      );
      if (decisions.some((decision) => !decision.allowed)) {
        reply.code(404).send(error('NOT_FOUND', 'Alarm resource was not found.', request.id));
        return false;
      }
      return true;
    } catch {
      unavailable(reply, request.id);
      return false;
    }
  }
  async function catalogActor(
    request: FastifyRequest,
    reply: FastifyReply,
    catalogId: string,
    action: 'alarm:write' | 'alarm:approve' | 'alarm:read',
  ) {
    const resolved = await session(request, reply);
    if (!resolved) return null;
    let scope;
    try {
      scope = await options.service.findCatalogScope(catalogId);
    } catch {
      unavailable(reply, request.id);
      return null;
    }
    if (
      !scope ||
      !(await authorize(request, reply, scope.territoryId, resolved.user.id, [action]))
    ) {
      if (!scope)
        reply.code(404).send(error('NOT_FOUND', 'Alarm catalog was not found.', request.id));
      return null;
    }
    return resolved.user.id;
  }

  app.post('/api/v1/alarm-catalog', async (request, reply) => {
    const parsed = createAlarmCatalogRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The alarm catalog is invalid.', request.id));
    const resolved = await session(request, reply);
    if (!resolved) return;
    let territory;
    try {
      territory = await options.service.findTerritory(parsed.data.territoryId);
    } catch {
      return unavailable(reply, request.id);
    }
    if (
      !territory ||
      !(await authorize(request, reply, territory, resolved.user.id, ['alarm:write']))
    ) {
      if (!territory)
        return reply.code(404).send(error('NOT_FOUND', 'Alarm catalog was not found.', request.id));
      return;
    }
    try {
      return await options.service.create(parsed.data, resolved.user.id, request.id);
    } catch (issue) {
      return failure(reply, request.id, issue);
    }
  });

  app.post('/api/v1/alarm-catalog/:catalogId/versions/request', async (request, reply) => {
    const catalogId = (request.params as { catalogId?: string }).catalogId;
    const parsed = requestAlarmCatalogVersionRequestSchema.safeParse(request.body);
    if (!uuid.test(catalogId ?? '') || !parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The alarm catalog version is invalid.', request.id));
    const actor = await catalogActor(request, reply, catalogId!, 'alarm:write');
    if (!actor) return;
    try {
      return await options.service.requestVersion(catalogId!, parsed.data, actor, request.id);
    } catch (issue) {
      return failure(reply, request.id, issue);
    }
  });

  app.post('/api/v1/alarm-catalog/:catalogId/versions/:version/approve', async (request, reply) => {
    const { catalogId, version } = request.params as { catalogId?: string; version?: string };
    const parsed = approveAlarmCatalogVersionRequestSchema.safeParse(request.body);
    if (
      !uuid.test(catalogId ?? '') ||
      !/^[1-9]\d*$/.test(version ?? '') ||
      !Number.isSafeInteger(Number(version)) ||
      !parsed.success
    )
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The alarm catalog approval is invalid.', request.id));
    const actor = await catalogActor(request, reply, catalogId!, 'alarm:approve');
    if (!actor) return;
    try {
      return await options.service.approveVersion(
        catalogId!,
        Number(version),
        parsed.data.reason,
        actor,
        request.id,
      );
    } catch (issue) {
      return failure(reply, request.id, issue);
    }
  });

  app.get('/api/v1/alarm-catalog/:catalogId', async (request, reply) => {
    const catalogId = (request.params as { catalogId?: string }).catalogId;
    const parsed = alarmCatalogReadQuerySchema.safeParse(request.query);
    if (!uuid.test(catalogId ?? '') || !parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The alarm catalog query is invalid.', request.id));
    const actor = await catalogActor(request, reply, catalogId!, 'alarm:read');
    if (!actor) return;
    try {
      const knownAt = parsed.data.knownAt ?? now().toISOString();
      const version = await options.service.catalogVersion(
        catalogId!,
        parsed.data.effectiveAt,
        knownAt,
      );
      return version
        ? alarmCatalogVersionResponseSchema.parse({ catalogVersion: version })
        : alarmCatalogReadResponseSchema.parse({
            resolution: 'unconfigured',
            effectiveAt: parsed.data.effectiveAt,
            knownAt,
            catalogVersion: null,
            reason: 'no_approved_catalog_version',
          });
    } catch (issue) {
      return failure(reply, request.id, issue);
    }
  });

  app.post('/api/v1/alarms/materialize', async (request, reply) => {
    const parsed = materializeAlarmRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The alarm materialization is invalid.', request.id));
    const resolved = await session(request, reply);
    if (!resolved) return;
    let scope;
    try {
      scope = await options.service.findRuleScope(parsed.data.ruleId);
    } catch {
      return unavailable(reply, request.id);
    }
    if (!scope)
      return reply.code(404).send(error('NOT_FOUND', 'Alarm rule was not found.', request.id));
    const sourceRead: AuthorizationAction =
      scope.subjectKind === 'observation_sensor' ? 'telemetry:read' : 'allocation_plan:read';
    if (
      !(await authorize(request, reply, scope.territoryId, resolved.user.id, [
        'alarm:write',
        sourceRead,
      ]))
    )
      return;
    try {
      return alarmMaterializationResponseSchema.parse({
        materialization: await options.service.materialize(
          parsed.data.ruleId,
          parsed.data.effectiveAt,
          parsed.data.knownAt,
          resolved.user.id,
          request.id,
        ),
      });
    } catch (issue) {
      return failure(reply, request.id, issue);
    }
  });
}

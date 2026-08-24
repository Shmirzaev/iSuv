import {
  alarmRuleEvaluationQuerySchema,
  alarmRuleEvaluationResponseSchema,
  apiErrorSchema,
  approveAlarmRuleVersionRequestSchema,
  createAlarmRuleRequestSchema,
  requestAlarmRuleVersionRequestSchema,
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
import { AlarmRuleError, PostgresAlarmRuleService } from './service.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const error = (code: ApiError['error']['code'], message: string, requestId: string) =>
  apiErrorSchema.parse({ error: { code, message, requestId } });

export function registerAlarmRuleRoutes(
  app: FastifyInstance,
  options: {
    identityProvider: IdentityProvider;
    sessionRepository: IdentitySessionRepository;
    authorizationRepository: TerritoryAuthorizationRepository;
    service: PostgresAlarmRuleService;
    now?: () => Date;
  },
) {
  const now = options.now ?? (() => new Date());
  const unavailable = (reply: FastifyReply, requestId: string) =>
    reply
      .code(503)
      .send(error('UNAVAILABLE', 'Alarm rule service is temporarily unavailable.', requestId));
  const failure = (reply: FastifyReply, requestId: string, issue: unknown) => {
    if (!(issue instanceof AlarmRuleError)) return unavailable(reply, requestId);
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
        reply.code(404).send(error('NOT_FOUND', 'Alarm rule was not found.', request.id));
        return false;
      }
      return true;
    } catch {
      unavailable(reply, request.id);
      return false;
    }
  }
  const sourceRead = (kind: 'observation_sensor' | 'allocation_plan'): AuthorizationAction =>
    kind === 'observation_sensor' ? 'telemetry:read' : 'allocation_plan:read';
  async function ruleActor(
    request: FastifyRequest,
    reply: FastifyReply,
    ruleId: string,
    action: 'alarm:write' | 'alarm:approve',
  ) {
    const resolved = await session(request, reply);
    if (!resolved) return null;
    let scope;
    try {
      scope = await options.service.findRuleScope(ruleId);
    } catch {
      unavailable(reply, request.id);
      return null;
    }
    if (!scope) {
      reply.code(404).send(error('NOT_FOUND', 'Alarm rule was not found.', request.id));
      return null;
    }
    if (
      !(await authorize(request, reply, scope.territoryId, resolved.user.id, [
        action,
        sourceRead(scope.subjectKind),
      ]))
    )
      return null;
    return resolved.user.id;
  }

  app.post('/api/v1/alarm-rules', async (request, reply) => {
    const parsed = createAlarmRuleRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The alarm rule is invalid.', request.id));
    const resolved = await session(request, reply);
    if (!resolved) return;
    let territory;
    try {
      territory = await options.service.findTerritory(parsed.data.territoryId);
    } catch {
      return unavailable(reply, request.id);
    }
    if (!territory)
      return reply.code(404).send(error('NOT_FOUND', 'Alarm rule was not found.', request.id));
    if (
      !(await authorize(request, reply, territory, resolved.user.id, [
        'alarm:write',
        sourceRead(parsed.data.subjectKind),
      ]))
    )
      return;
    try {
      return await options.service.create(parsed.data, resolved.user.id, request.id);
    } catch (issue) {
      return failure(reply, request.id, issue);
    }
  });

  app.post('/api/v1/alarm-rules/:ruleId/versions/request', async (request, reply) => {
    const ruleId = (request.params as { ruleId?: string }).ruleId;
    const parsed = requestAlarmRuleVersionRequestSchema.safeParse(request.body);
    if (!uuid.test(ruleId ?? '') || !parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The alarm rule version is invalid.', request.id));
    const actor = await ruleActor(request, reply, ruleId!, 'alarm:write');
    if (!actor) return;
    try {
      return await options.service.request(ruleId!, parsed.data, actor, request.id);
    } catch (issue) {
      return failure(reply, request.id, issue);
    }
  });

  app.post('/api/v1/alarm-rules/:ruleId/versions/:version/approve', async (request, reply) => {
    const { ruleId, version } = request.params as { ruleId?: string; version?: string };
    const parsed = approveAlarmRuleVersionRequestSchema.safeParse(request.body);
    if (
      !uuid.test(ruleId ?? '') ||
      !/^[1-9]\d*$/.test(version ?? '') ||
      !Number.isSafeInteger(Number(version)) ||
      !parsed.success
    )
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The alarm rule approval is invalid.', request.id));
    const actor = await ruleActor(request, reply, ruleId!, 'alarm:approve');
    if (!actor) return;
    try {
      return await options.service.approve(
        ruleId!,
        Number(version),
        parsed.data.reason,
        actor,
        request.id,
      );
    } catch (issue) {
      return failure(reply, request.id, issue);
    }
  });

  app.post('/api/v1/alarm-rules/:ruleId/evaluate', async (request, reply) => {
    const ruleId = (request.params as { ruleId?: string }).ruleId;
    const parsed = alarmRuleEvaluationQuerySchema.safeParse(request.body);
    if (!uuid.test(ruleId ?? '') || !parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The alarm rule evaluation is invalid.', request.id));
    const actor = await ruleActor(request, reply, ruleId!, 'alarm:write');
    if (!actor) return;
    try {
      return alarmRuleEvaluationResponseSchema.parse({
        evaluation: await options.service.evaluate(ruleId!, {
          effectiveAt: parsed.data.effectiveAt,
          knownAt: parsed.data.knownAt ?? now().toISOString(),
        }),
      });
    } catch (issue) {
      return failure(reply, request.id, issue);
    }
  });
}

import {
  apiErrorSchema,
  approveEscalationPolicyVersionRequestSchema,
  createEscalationPolicyRequestSchema,
  createIncidentRequestSchema,
  escalationPolicyReadQuerySchema,
  escalationPolicyResponseSchema,
  escalationPolicyVersionResponseSchema,
  incidentActionRequestSchema,
  incidentCommentRequestSchema,
  incidentCorrectiveActionRequestSchema,
  incidentReadQuerySchema,
  incidentResponseSchema,
  assignIncidentRequestSchema,
  linkIncidentAlarmRequestSchema,
  requestEscalationPolicyVersionRequestSchema,
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
import { IncidentError, PostgresIncidentService } from './service.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const error = (code: ApiError['error']['code'], message: string, requestId: string) =>
  apiErrorSchema.parse({ error: { code, message, requestId } });
export function registerIncidentRoutes(
  app: FastifyInstance,
  options: {
    identityProvider: IdentityProvider;
    sessionRepository: IdentitySessionRepository;
    authorizationRepository: TerritoryAuthorizationRepository;
    service: PostgresIncidentService;
    now?: () => Date;
  },
) {
  const now = options.now ?? (() => new Date());
  const unavailable = (r: FastifyReply, id: string) =>
    r.code(503).send(error('UNAVAILABLE', 'Incident service is temporarily unavailable.', id));
  const failure = (r: FastifyReply, id: string, e: unknown) => {
    if (!(e instanceof IncidentError)) return unavailable(r, id);
    const status = e.kind === 'NOT_FOUND' ? 404 : e.kind === 'CONFLICT' ? 409 : 400;
    return r
      .code(status)
      .send(
        error(
          e.kind === 'NOT_FOUND'
            ? 'NOT_FOUND'
            : e.kind === 'CONFLICT'
              ? 'CONFLICT'
              : 'VALIDATION_ERROR',
          e.message,
          id,
        ),
      );
  };
  async function session(q: FastifyRequest, r: FastifyReply) {
    let s: Awaited<ReturnType<typeof options.sessionRepository.findCurrentSession>>;
    try {
      const identity = await options.identityProvider.resolve(q);
      s = identity
        ? await options.sessionRepository.findCurrentSession(identity.userId, now())
        : null;
    } catch {
      unavailable(r, q.id);
      return null;
    }
    if (!s) {
      r.code(401).send(error('UNAUTHENTICATED', 'Authentication is required.', q.id));
      return null;
    }
    return s;
  }
  async function authorize(
    q: FastifyRequest,
    r: FastifyReply,
    territory: string,
    user: string,
    action: AuthorizationAction,
  ) {
    try {
      const d = await authorizeTerritoryAction(
        options.authorizationRepository,
        user,
        action,
        territory,
        now(),
      );
      if (!d.allowed) {
        r.code(404).send(error('NOT_FOUND', 'Incident resource was not found.', q.id));
        return false;
      }
      return true;
    } catch {
      return (unavailable(r, q.id), false);
    }
  }
  async function scoped(
    q: FastifyRequest,
    r: FastifyReply,
    actor: string,
    id: string,
    kind: 'incident' | 'policy' | 'alarm',
    actions: AuthorizationAction | AuthorizationAction[],
  ) {
    try {
      const scope =
        kind === 'incident'
          ? await options.service.findIncidentScope(id)
          : kind === 'policy'
            ? await options.service.findPolicyScope(id)
            : await options.service.findAlarmScope(id);
      if (!scope) {
        r.code(404).send(error('NOT_FOUND', 'Incident resource was not found.', q.id));
        return null;
      }
      for (const action of Array.isArray(actions) ? actions : [actions])
        if (!(await authorize(q, r, scope.territory_id, actor, action))) return null;
      return actor;
    } catch {
      return (unavailable(r, q.id), null);
    }
  }
  app.post('/api/v1/escalation-policies', async (q, r) => {
    const s = await session(q, r);
    if (!s) return;
    const p = createEscalationPolicyRequestSchema.safeParse(q.body);
    if (!p.success)
      return r.code(400).send(error('VALIDATION_ERROR', 'Escalation policy is invalid.', q.id));
    try {
      const t = await options.service.findTerritory(p.data.territoryId);
      if (!t) return r.code(404).send(error('NOT_FOUND', 'Escalation policy was not found.', q.id));
      if (!(await authorize(q, r, p.data.territoryId, s.user.id, 'incident:write'))) return;
      return r.send(
        escalationPolicyResponseSchema.parse(
          await options.service.createPolicy(p.data, s.user.id, q.id),
        ),
      );
    } catch (e) {
      return failure(r, q.id, e);
    }
  });
  app.post('/api/v1/escalation-policies/:policyId/versions/request', async (q, r) => {
    const s = await session(q, r);
    if (!s) return;
    const id = (q.params as { policyId?: string }).policyId ?? '';
    const p = requestEscalationPolicyVersionRequestSchema.safeParse(q.body);
    if (!uuid.test(id) || !p.success)
      return r
        .code(400)
        .send(error('VALIDATION_ERROR', 'Escalation policy version is invalid.', q.id));
    const a = await scoped(q, r, s.user.id, id, 'policy', 'incident:write');
    if (!a) return;
    try {
      return r.send(
        escalationPolicyVersionResponseSchema.parse(
          await options.service.requestPolicyVersion(id, p.data, a, q.id),
        ),
      );
    } catch (e) {
      return failure(r, q.id, e);
    }
  });
  app.post('/api/v1/escalation-policies/:policyId/versions/:version/approve', async (q, r) => {
    const s = await session(q, r);
    if (!s) return;
    const { policyId = '', version = '' } = q.params as { policyId?: string; version?: string };
    const p = approveEscalationPolicyVersionRequestSchema.safeParse(q.body);
    if (
      !uuid.test(policyId) ||
      !/^[1-9]\d*$/.test(version) ||
      !Number.isSafeInteger(Number(version)) ||
      !p.success
    )
      return r
        .code(400)
        .send(error('VALIDATION_ERROR', 'Escalation policy approval is invalid.', q.id));
    const a = await scoped(q, r, s.user.id, policyId, 'policy', 'incident:approve');
    if (!a) return;
    try {
      return r.send(
        escalationPolicyVersionResponseSchema.parse(
          await options.service.approvePolicyVersion(
            policyId,
            Number(version),
            p.data.reason,
            a,
            q.id,
          ),
        ),
      );
    } catch (e) {
      return failure(r, q.id, e);
    }
  });
  app.get('/api/v1/escalation-policies/:policyId', async (q, r) => {
    const s = await session(q, r);
    if (!s) return;
    const id = (q.params as { policyId?: string }).policyId ?? '';
    const p = escalationPolicyReadQuerySchema.safeParse(q.query);
    if (!uuid.test(id) || !p.success)
      return r
        .code(400)
        .send(error('VALIDATION_ERROR', 'Escalation policy query is invalid.', q.id));
    const a = await scoped(q, r, s.user.id, id, 'policy', 'incident:read');
    if (!a) return;
    try {
      const x = await options.service.getPolicy(
        id,
        p.data.effectiveAt,
        p.data.knownAt ?? now().toISOString(),
      );
      if (!x)
        return r
          .code(404)
          .send(error('NOT_FOUND', 'Escalation policy version was not found.', q.id));
      return r.send(escalationPolicyVersionResponseSchema.parse(x));
    } catch (e) {
      return failure(r, q.id, e);
    }
  });
  app.post('/api/v1/incidents', async (q, r) => {
    const s = await session(q, r);
    if (!s) return;
    const p = createIncidentRequestSchema.safeParse(q.body);
    if (!p.success)
      return r.code(400).send(error('VALIDATION_ERROR', 'Incident is invalid.', q.id));
    const a = await scoped(q, r, s.user.id, p.data.alarmId, 'alarm', [
      'alarm:read',
      'incident:write',
    ]);
    if (!a) return;
    try {
      return r.send(
        incidentResponseSchema.parse(
          await options.service.createIncident(p.data.alarmId, p.data.reason, a, q.id),
        ),
      );
    } catch (e) {
      return failure(r, q.id, e);
    }
  });
  const operation = (
    path: string,
    kind: 'acknowledged' | 'investigating' | 'resolved' | 'closed',
  ) =>
    app.post(path, async (q, r) => {
      const s = await session(q, r);
      if (!s) return;
      const id = (q.params as { incidentId?: string }).incidentId ?? '';
      const p = incidentActionRequestSchema.safeParse(q.body);
      if (!uuid.test(id) || !p.success)
        return r.code(400).send(error('VALIDATION_ERROR', 'Incident action is invalid.', q.id));
      const a = await scoped(q, r, s.user.id, id, 'incident', 'incident:write');
      if (!a) return;
      try {
        return r.send(
          incidentResponseSchema.parse(
            await options.service.action(id, kind, p.data.reason, a, q.id),
          ),
        );
      } catch (e) {
        return failure(r, q.id, e);
      }
    });
  operation('/api/v1/incidents/:incidentId/acknowledge', 'acknowledged');
  operation('/api/v1/incidents/:incidentId/investigate', 'investigating');
  operation('/api/v1/incidents/:incidentId/resolve', 'resolved');
  operation('/api/v1/incidents/:incidentId/close', 'closed');
  app.post('/api/v1/incidents/:incidentId/alarms', async (q, r) => {
    const s = await session(q, r);
    if (!s) return;
    const id = (q.params as { incidentId?: string }).incidentId ?? '',
      p = linkIncidentAlarmRequestSchema.safeParse(q.body);
    if (!uuid.test(id) || !p.success)
      return r.code(400).send(error('VALIDATION_ERROR', 'Incident alarm link is invalid.', q.id));
    const a = await scoped(q, r, s.user.id, id, 'incident', 'incident:write');
    if (!a) return;
    const alarmActor = await scoped(q, r, s.user.id, p.data.alarmId, 'alarm', 'alarm:read');
    if (!alarmActor) return;
    try {
      return r.send(
        incidentResponseSchema.parse(
          await options.service.link(id, p.data.alarmId, p.data.reason, a, q.id),
        ),
      );
    } catch (e) {
      return failure(r, q.id, e);
    }
  });
  app.post('/api/v1/incidents/:incidentId/assign', async (q, r) => {
    const s = await session(q, r);
    if (!s) return;
    const id = (q.params as { incidentId?: string }).incidentId ?? '',
      p = assignIncidentRequestSchema.safeParse(q.body);
    if (!uuid.test(id) || !p.success)
      return r.code(400).send(error('VALIDATION_ERROR', 'Incident assignment is invalid.', q.id));
    const a = await scoped(q, r, s.user.id, id, 'incident', 'incident:write');
    if (!a) return;
    try {
      return r.send(
        incidentResponseSchema.parse(
          await options.service.assign(id, p.data.assigneeUserId, p.data.reason, a, q.id),
        ),
      );
    } catch (e) {
      return failure(r, q.id, e);
    }
  });
  for (const [path, schema, kind] of [
    ['comments', incidentCommentRequestSchema, 'commented'],
    ['corrective-actions', incidentCorrectiveActionRequestSchema, 'corrective_action'],
  ] as const)
    app.post(`/api/v1/incidents/:incidentId/${path}`, async (q, r) => {
      const s = await session(q, r);
      if (!s) return;
      const id = (q.params as { incidentId?: string }).incidentId ?? '',
        p = schema.safeParse(q.body);
      if (!uuid.test(id) || !p.success)
        return r.code(400).send(error('VALIDATION_ERROR', 'Incident note is invalid.', q.id));
      const a = await scoped(q, r, s.user.id, id, 'incident', 'incident:write');
      if (!a) return;
      try {
        return r.send(
          incidentResponseSchema.parse(
            await options.service.note(id, kind, p.data.body, p.data.reason, a, q.id),
          ),
        );
      } catch (e) {
        return failure(r, q.id, e);
      }
    });
  app.get('/api/v1/incidents/:incidentId', async (q, r) => {
    const s = await session(q, r);
    if (!s) return;
    const id = (q.params as { incidentId?: string }).incidentId ?? '',
      p = incidentReadQuerySchema.safeParse(q.query);
    if (!uuid.test(id) || !p.success)
      return r.code(400).send(error('VALIDATION_ERROR', 'Incident query is invalid.', q.id));
    const a = await scoped(q, r, s.user.id, id, 'incident', 'incident:read');
    if (!a) return;
    try {
      return r.send(
        incidentResponseSchema.parse(
          await options.service.getIncident(id, p.data.evaluatedAt ?? now().toISOString()),
        ),
      );
    } catch (e) {
      return failure(r, q.id, e);
    }
  });
}

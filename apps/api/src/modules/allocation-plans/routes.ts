import {
  allocationPlanCurrentQuerySchema,
  allocationPlanHistoryQuerySchema,
  allocationPlanHistoryResponseSchema,
  allocationPlanResolutionSchema,
  allocationPlanVersionResponseSchema,
  apiErrorSchema,
  appendAllocationPlanVersionRequestSchema,
  approveAllocationPlanVersionRequestSchema,
  createAllocationPlanRequestSchema,
  requestAllocationPlanVersionRequestSchema,
  type ApiError,
} from '@isuv/contracts';
import type { FastifyInstance } from 'fastify';
import {
  authorizeTerritoryAction,
  type TerritoryAuthorizationRepository,
} from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { AllocationPlanError, type PostgresAllocationPlanService } from './service.js';
interface Options {
  identityProvider: IdentityProvider;
  sessionRepository: IdentitySessionRepository;
  authorizationRepository: TerritoryAuthorizationRepository;
  service: PostgresAllocationPlanService;
  now?: () => Date;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const error = (code: ApiError['error']['code'], message: string, requestId: string): ApiError =>
  apiErrorSchema.parse({ error: { code, message, requestId } });
function fail(
  reply: { code: (status: number) => { send: (value: ApiError) => unknown } },
  requestId: string,
  issue: AllocationPlanError,
) {
  return reply
    .code(issue.kind === 'NOT_FOUND' ? 404 : issue.kind === 'CONFLICT' ? 409 : 400)
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
function unavailable(
  reply: { code: (status: number) => { send: (value: ApiError) => unknown } },
  requestId: string,
) {
  return reply
    .code(503)
    .send(error('UNAVAILABLE', 'Allocation plan service is temporarily unavailable.', requestId));
}
export function registerAllocationPlanRoutes(app: FastifyInstance, options: Options): void {
  const now = options.now ?? (() => new Date());
  async function authenticatedActor(
    request: { headers: Record<string, string | string[] | undefined>; id: string },
    reply: { code: (status: number) => { send: (value: ApiError) => unknown } },
  ): Promise<string | null> {
    const identity = await options.identityProvider.resolve(request);
    const session = identity
      ? await options.sessionRepository.findCurrentSession(identity.userId, now())
      : null;
    if (!session) {
      reply.code(401).send(error('UNAUTHENTICATED', 'Authentication is required.', request.id));
      return null;
    }
    return session.user.id;
  }
  async function authorizePlanActor(
    request: { id: string },
    reply: { code: (status: number) => { send: (value: ApiError) => unknown } },
    actor: string,
    planId: string,
    action: 'allocation_plan:read' | 'allocation_plan:write' | 'allocation_plan:approve',
  ): Promise<string | null> {
    let territory: string | null;
    try {
      territory = await options.service.findPlanTerritory(planId);
    } catch {
      unavailable(reply, request.id);
      return null;
    }
    if (!territory) {
      reply.code(404).send(error('NOT_FOUND', 'Allocation plan was not found.', request.id));
      return null;
    }
    let decision;
    try {
      decision = await authorizeTerritoryAction(
        options.authorizationRepository,
        actor,
        action,
        territory,
        now(),
      );
    } catch {
      unavailable(reply, request.id);
      return null;
    }
    if (!decision.allowed) {
      reply.code(404).send(error('NOT_FOUND', 'Allocation plan was not found.', request.id));
      return null;
    }
    return actor;
  }
  app.post('/api/v1/allocation-plans', async (request, reply) => {
    const actor = await authenticatedActor(request, reply);
    if (!actor) return;
    const parsed = createAllocationPlanRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The allocation plan is invalid.', request.id));
    let territory: string | null;
    try {
      territory = await options.service.findSectionTerritory(parsed.data.waterSectionId);
    } catch {
      return unavailable(reply, request.id);
    }
    if (!territory)
      return reply.code(404).send(error('NOT_FOUND', 'Allocation plan was not found.', request.id));
    let decision;
    try {
      decision = await authorizeTerritoryAction(
        options.authorizationRepository,
        actor,
        'allocation_plan:write',
        territory,
        now(),
      );
    } catch {
      return unavailable(reply, request.id);
    }
    if (!decision.allowed)
      return reply.code(404).send(error('NOT_FOUND', 'Allocation plan was not found.', request.id));
    try {
      return allocationPlanVersionResponseSchema.parse({
        planVersion: await options.service.create(parsed.data, actor, request.id),
      });
    } catch (issue) {
      if (issue instanceof AllocationPlanError) return fail(reply, request.id, issue);
      return unavailable(reply, request.id);
    }
  });
  app.post('/api/v1/allocation-plans/:planId/versions', async (request, reply) => {
    const authenticated = await authenticatedActor(request, reply);
    if (!authenticated) return;
    const planId = (request.params as { planId?: string }).planId;
    const parsed = appendAllocationPlanVersionRequestSchema.safeParse(request.body);
    if (!planId || !uuid.test(planId) || !parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The allocation plan is invalid.', request.id));
    const actor = await authorizePlanActor(
      request,
      reply,
      authenticated,
      planId,
      'allocation_plan:write',
    );
    if (!actor) return;
    try {
      return allocationPlanVersionResponseSchema.parse({
        planVersion: await options.service.append(planId, parsed.data, actor, request.id),
      });
    } catch (issue) {
      if (issue instanceof AllocationPlanError) return fail(reply, request.id, issue);
      return unavailable(reply, request.id);
    }
  });
  app.post('/api/v1/allocation-plans/:planId/versions/:version/request', async (request, reply) => {
    const authenticated = await authenticatedActor(request, reply);
    if (!authenticated) return;
    const { planId, version } = request.params as { planId?: string; version?: string };
    const parsed = requestAllocationPlanVersionRequestSchema.safeParse(request.body);
    if (
      !planId ||
      !uuid.test(planId) ||
      !Number.isInteger(Number(version)) ||
      Number(version) < 1 ||
      !parsed.success
    )
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The allocation plan is invalid.', request.id));
    const actor = await authorizePlanActor(
      request,
      reply,
      authenticated,
      planId,
      'allocation_plan:write',
    );
    if (!actor) return;
    try {
      return allocationPlanVersionResponseSchema.parse({
        planVersion: await options.service.request(
          planId,
          Number(version),
          parsed.data.reason,
          actor,
          request.id,
        ),
      });
    } catch (issue) {
      if (issue instanceof AllocationPlanError) return fail(reply, request.id, issue);
      return unavailable(reply, request.id);
    }
  });
  app.post('/api/v1/allocation-plans/:planId/versions/:version/approve', async (request, reply) => {
    const authenticated = await authenticatedActor(request, reply);
    if (!authenticated) return;
    const { planId, version } = request.params as { planId?: string; version?: string };
    const parsed = approveAllocationPlanVersionRequestSchema.safeParse(request.body);
    if (
      !planId ||
      !uuid.test(planId) ||
      !Number.isInteger(Number(version)) ||
      Number(version) < 1 ||
      !parsed.success
    )
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The allocation plan is invalid.', request.id));
    const actor = await authorizePlanActor(
      request,
      reply,
      authenticated,
      planId,
      'allocation_plan:approve',
    );
    if (!actor) return;
    try {
      return allocationPlanVersionResponseSchema.parse({
        planVersion: await options.service.approve(
          planId,
          Number(version),
          parsed.data,
          actor,
          request.id,
        ),
      });
    } catch (issue) {
      if (issue instanceof AllocationPlanError) return fail(reply, request.id, issue);
      return unavailable(reply, request.id);
    }
  });
  app.get('/api/v1/allocation-plans/:planId/current', async (request, reply) => {
    const authenticated = await authenticatedActor(request, reply);
    if (!authenticated) return;
    const planId = (request.params as { planId?: string }).planId;
    const parsed = allocationPlanCurrentQuerySchema.safeParse(request.query);
    if (!planId || !uuid.test(planId) || !parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The allocation plan query is invalid.', request.id));
    const actor = await authorizePlanActor(
      request,
      reply,
      authenticated,
      planId,
      'allocation_plan:read',
    );
    if (!actor) return;
    try {
      return allocationPlanResolutionSchema.parse(
        await options.service.current(
          planId,
          parsed.data.effectiveAt,
          parsed.data.knownAt ?? now().toISOString(),
        ),
      );
    } catch {
      return unavailable(reply, request.id);
    }
  });
  app.get('/api/v1/allocation-plans/:planId/history', async (request, reply) => {
    const authenticated = await authenticatedActor(request, reply);
    if (!authenticated) return;
    const planId = (request.params as { planId?: string }).planId;
    const parsed = allocationPlanHistoryQuerySchema.safeParse(request.query);
    if (!planId || !uuid.test(planId) || !parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The allocation plan query is invalid.', request.id));
    const actor = await authorizePlanActor(
      request,
      reply,
      authenticated,
      planId,
      'allocation_plan:read',
    );
    if (!actor) return;
    try {
      return allocationPlanHistoryResponseSchema.parse(
        await options.service.history(planId, parsed.data),
      );
    } catch (issue) {
      if (issue instanceof AllocationPlanError) return fail(reply, request.id, issue);
      return unavailable(reply, request.id);
    }
  });
}

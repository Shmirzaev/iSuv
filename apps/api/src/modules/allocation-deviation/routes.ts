import {
  allocationDeviationQuerySchema,
  allocationDeviationResponseSchema,
  apiErrorSchema,
  allocationEntryMeasurementBindingResponseSchema,
  approveSectionTolerancePolicyVersionRequestSchema,
  createAllocationEntryMeasurementBindingRequestSchema,
  createSectionTolerancePolicyRequestSchema,
  requestSectionTolerancePolicyVersionRequestSchema,
  sectionTolerancePolicyRecordResponseSchema,
  sectionTolerancePolicyVersionResponseSchema,
  type ApiError,
} from '@isuv/contracts';
import type { FastifyInstance } from 'fastify';
import {
  authorizeTerritoryAction,
  type TerritoryAuthorizationRepository,
} from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { AllocationDeviationError, PostgresAllocationDeviationService } from './service.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const error = (code: ApiError['error']['code'], message: string, requestId: string) =>
  apiErrorSchema.parse({ error: { code, message, requestId } });
export function registerAllocationDeviationRoutes(
  app: FastifyInstance,
  options: {
    identityProvider: IdentityProvider;
    sessionRepository: IdentitySessionRepository;
    authorizationRepository: TerritoryAuthorizationRepository;
    service: PostgresAllocationDeviationService;
    now?: () => Date;
  },
) {
  const now = options.now ?? (() => new Date());
  const unavailable = (
    reply: { code: (status: number) => { send: (value: ApiError) => unknown } },
    requestId: string,
  ) =>
    reply
      .code(503)
      .send(error('UNAVAILABLE', 'Allocation deviation is temporarily unavailable.', requestId));
  const failure = (
    reply: { code: (status: number) => { send: (value: ApiError) => unknown } },
    requestId: string,
    issue: AllocationDeviationError,
  ) =>
    reply
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
  async function actorFor(
    request: { headers: Record<string, string | string[] | undefined>; id: string },
    reply: { code: (status: number) => { send: (value: ApiError) => unknown } },
    findTerritory: () => Promise<string | null>,
    action: 'allocation_plan:read' | 'allocation_plan:write' | 'allocation_plan:approve',
    message: string,
  ): Promise<string | null> {
    const identity = await options.identityProvider.resolve(request);
    const session = identity
      ? await options.sessionRepository.findCurrentSession(identity.userId, now())
      : null;
    if (!session) {
      reply.code(401).send(error('UNAUTHENTICATED', 'Authentication is required.', request.id));
      return null;
    }
    try {
      const territory = await findTerritory();
      if (!territory) {
        reply.code(404).send(error('NOT_FOUND', message, request.id));
        return null;
      }
      const decision = await authorizeTerritoryAction(
        options.authorizationRepository,
        session.user.id,
        action,
        territory,
        now(),
      );
      if (!decision.allowed) {
        reply.code(404).send(error('NOT_FOUND', message, request.id));
        return null;
      }
      return session.user.id;
    } catch {
      unavailable(reply, request.id);
      return null;
    }
  }
  app.get('/api/v1/allocation-plans/:planId/deviation', async (request, reply) => {
    const planId = (request.params as { planId?: string }).planId;
    const parsed = allocationDeviationQuerySchema.safeParse(request.query);
    if (!planId || !uuid.test(planId) || !parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The allocation deviation query is invalid.', request.id));
    const identity = await options.identityProvider.resolve(request);
    if (!identity)
      return reply
        .code(401)
        .send(error('UNAUTHENTICATED', 'Authentication is required.', request.id));
    const current = await options.sessionRepository.findCurrentSession(identity.userId, now());
    if (!current)
      return reply
        .code(401)
        .send(error('UNAUTHENTICATED', 'Authentication is required.', request.id));
    try {
      const territory = await options.service.findPlanTerritory(planId);
      if (!territory)
        return reply
          .code(404)
          .send(error('NOT_FOUND', 'Allocation deviation resource was not found.', request.id));
      const [planAllowed, balanceAllowed] = await Promise.all([
        authorizeTerritoryAction(
          options.authorizationRepository,
          current.user.id,
          'allocation_plan:read',
          territory,
          now(),
        ),
        authorizeTerritoryAction(
          options.authorizationRepository,
          current.user.id,
          'water_balance:read',
          territory,
          now(),
        ),
      ]);
      if (!planAllowed.allowed || !balanceAllowed.allowed)
        return reply
          .code(404)
          .send(error('NOT_FOUND', 'Allocation deviation resource was not found.', request.id));
      return allocationDeviationResponseSchema.parse({
        result: await options.service.deviation(
          planId,
          parsed.data.knownAt === undefined
            ? { intervalStart: parsed.data.intervalStart, intervalEnd: parsed.data.intervalEnd }
            : {
                intervalStart: parsed.data.intervalStart,
                intervalEnd: parsed.data.intervalEnd,
                knownAt: parsed.data.knownAt,
              },
        ),
      });
    } catch {
      return reply
        .code(503)
        .send(error('UNAVAILABLE', 'Allocation deviation is temporarily unavailable.', request.id));
    }
  });
  app.post(
    '/api/v1/allocation-plan-entries/:entryId/measurement-binding',
    async (request, reply) => {
      const entryId = (request.params as { entryId?: string }).entryId;
      const parsed = createAllocationEntryMeasurementBindingRequestSchema.safeParse(request.body);
      if (!entryId || !uuid.test(entryId) || !parsed.success)
        return reply
          .code(400)
          .send(error('VALIDATION_ERROR', 'The measurement binding is invalid.', request.id));
      const actor = await actorFor(
        request,
        reply,
        () => options.service.findEntryTerritory(entryId),
        'allocation_plan:write',
        'Allocation plan entry was not found.',
      );
      if (!actor) return;
      try {
        return allocationEntryMeasurementBindingResponseSchema.parse({
          binding: await options.service.createBinding(entryId, parsed.data, actor, request.id),
        });
      } catch (issue) {
        if (issue instanceof AllocationDeviationError) return failure(reply, request.id, issue);
        return unavailable(reply, request.id);
      }
    },
  );
  app.post('/api/v1/section-tolerance-policies', async (request, reply) => {
    const parsed = createSectionTolerancePolicyRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'The tolerance policy is invalid.', request.id));
    const actor = await actorFor(
      request,
      reply,
      () => options.service.findSectionTerritory(parsed.data.waterSectionId),
      'allocation_plan:write',
      'Water section was not found.',
    );
    if (!actor) return;
    try {
      return sectionTolerancePolicyRecordResponseSchema.parse({
        policy: await options.service.createTolerancePolicy(parsed.data, actor, request.id),
      });
    } catch (issue) {
      if (issue instanceof AllocationDeviationError) return failure(reply, request.id, issue);
      return unavailable(reply, request.id);
    }
  });
  app.post(
    '/api/v1/section-tolerance-policies/:policyId/versions/request',
    async (request, reply) => {
      const policyId = (request.params as { policyId?: string }).policyId;
      const parsed = requestSectionTolerancePolicyVersionRequestSchema.safeParse(request.body);
      if (!policyId || !uuid.test(policyId) || !parsed.success)
        return reply
          .code(400)
          .send(error('VALIDATION_ERROR', 'The tolerance policy version is invalid.', request.id));
      const actor = await actorFor(
        request,
        reply,
        () => options.service.findTolerancePolicyTerritory(policyId),
        'allocation_plan:write',
        'Tolerance policy was not found.',
      );
      if (!actor) return;
      try {
        return sectionTolerancePolicyVersionResponseSchema.parse({
          version: await options.service.requestToleranceVersion(
            policyId,
            parsed.data,
            actor,
            request.id,
          ),
        });
      } catch (issue) {
        if (issue instanceof AllocationDeviationError) return failure(reply, request.id, issue);
        return unavailable(reply, request.id);
      }
    },
  );
  app.post(
    '/api/v1/section-tolerance-policies/:policyId/versions/:version/approve',
    async (request, reply) => {
      const { policyId, version } = request.params as { policyId?: string; version?: string };
      const parsed = approveSectionTolerancePolicyVersionRequestSchema.safeParse(request.body);
      if (
        !policyId ||
        !uuid.test(policyId) ||
        !Number.isInteger(Number(version)) ||
        Number(version) < 1 ||
        !parsed.success
      )
        return reply
          .code(400)
          .send(error('VALIDATION_ERROR', 'The tolerance policy version is invalid.', request.id));
      const actor = await actorFor(
        request,
        reply,
        () => options.service.findTolerancePolicyTerritory(policyId),
        'allocation_plan:approve',
        'Tolerance policy was not found.',
      );
      if (!actor) return;
      try {
        return sectionTolerancePolicyVersionResponseSchema.parse({
          version: await options.service.approveToleranceVersion(
            policyId,
            Number(version),
            parsed.data.reason,
            actor,
            request.id,
          ),
        });
      } catch (issue) {
        if (issue instanceof AllocationDeviationError) return failure(reply, request.id, issue);
        return unavailable(reply, request.id);
      }
    },
  );
}

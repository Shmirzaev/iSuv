import {
  approveWaterBalanceVersionRequestSchema,
  apiErrorSchema,
  createWaterBalanceModelRequestSchema,
  requestWaterBalanceVersionRequestSchema,
  waterBalanceQuerySchema,
  waterBalanceResponseSchema,
  type ApiError,
} from '@isuv/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authorizeTerritoryAction,
  type TerritoryAuthorizationRepository,
} from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { PostgresWaterBalanceService, WaterBalanceError } from './service.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const err = (code: ApiError['error']['code'], message: string, requestId: string) =>
  apiErrorSchema.parse({ error: { code, message, requestId } });
export function registerWaterBalanceRoutes(
  app: FastifyInstance,
  options: {
    identityProvider: IdentityProvider;
    sessionRepository: IdentitySessionRepository;
    authorizationRepository: TerritoryAuthorizationRepository;
    service: PostgresWaterBalanceService;
    now?: () => Date;
  },
) {
  const now = options.now ?? (() => new Date());
  const mutationFailure = (reply: FastifyReply, requestId: string, issue: unknown) => {
    if (!(issue instanceof WaterBalanceError))
      return reply
        .code(503)
        .send(err('UNAVAILABLE', 'Water balance is temporarily unavailable.', requestId));
    const status = issue.kind === 'NOT_FOUND' ? 404 : issue.kind === 'CONFLICT' ? 409 : 400;
    const code =
      issue.kind === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : issue.kind === 'CONFLICT'
          ? 'CONFLICT'
          : 'VALIDATION_ERROR';
    return reply.code(status).send(err(code, issue.message, requestId));
  };
  async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<string | null> {
    const identity = await options.identityProvider.resolve(request);
    if (!identity) {
      reply.code(401).send(err('UNAUTHENTICATED', 'Authentication is required.', request.id));
      return null;
    }
    const s = await options.sessionRepository.findCurrentSession(identity.userId, now());
    if (!s) {
      reply.code(401).send(err('UNAUTHENTICATED', 'Authentication is required.', request.id));
      return null;
    }
    return s.user.id;
  }
  async function authorize(
    reply: FastifyReply,
    requestId: string,
    userId: string,
    territories: () => Promise<string[]>,
    action: 'water_balance:read' | 'water_balance:write' | 'water_balance:approve',
  ): Promise<boolean> {
    try {
      const ts = await territories();
      if (
        !ts.length ||
        (
          await Promise.all(
            ts.map((t) =>
              authorizeTerritoryAction(options.authorizationRepository, userId, action, t, now()),
            ),
          )
        ).some((x) => !x.allowed)
      ) {
        reply.code(404).send(err('NOT_FOUND', 'Water balance resource was not found.', requestId));
        return false;
      }
    } catch {
      reply
        .code(503)
        .send(err('UNAVAILABLE', 'Water balance is temporarily unavailable.', requestId));
      return false;
    }
    return true;
  }
  app.get('/api/v1/network/junctions/:junctionId/water-balance', async (request, reply) => {
    const userId = await authenticate(request, reply);
    if (!userId) return;
    const id = (request.params as { junctionId?: string }).junctionId;
    const parsed = waterBalanceQuerySchema.safeParse(request.query);
    if (!uuid.test(id ?? '') || !parsed.success)
      return reply
        .code(400)
        .send(err('VALIDATION_ERROR', 'Water balance query is invalid.', request.id));
    const calculationInput = {
      ...parsed.data,
      knownAt: parsed.data.knownAt ?? now().toISOString(),
    };
    const authorized = await authorize(
      reply,
      request.id,
      userId,
      () => options.service.findCalculationTerritories(id!, calculationInput),
      'water_balance:read',
    );
    if (!authorized) return;
    try {
      return waterBalanceResponseSchema.parse({
        result: await options.service.calculate(id!, calculationInput),
      });
    } catch {
      return reply
        .code(503)
        .send(err('UNAVAILABLE', 'Water balance is temporarily unavailable.', request.id));
    }
  });
  app.post('/api/v1/water-balance-models', async (request, reply) => {
    const userId = await authenticate(request, reply);
    if (!userId) return;
    const parsed = createWaterBalanceModelRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send(err('VALIDATION_ERROR', 'Water balance model is invalid.', request.id));
    const authorized = await authorize(
      reply,
      request.id,
      userId,
      () => options.service.findJunctionTerritories(parsed.data.junctionId),
      'water_balance:write',
    );
    if (!authorized) return;
    try {
      return await options.service.create(parsed.data, userId, request.id);
    } catch (e) {
      return mutationFailure(reply, request.id, e);
    }
  });
  app.post('/api/v1/water-balance-models/:modelId/versions/request', async (request, reply) => {
    const userId = await authenticate(request, reply);
    if (!userId) return;
    const id = (request.params as { modelId?: string }).modelId;
    const parsed = requestWaterBalanceVersionRequestSchema.safeParse(request.body);
    if (!uuid.test(id ?? '') || !parsed.success)
      return reply
        .code(400)
        .send(err('VALIDATION_ERROR', 'Water balance version is invalid.', request.id));
    const authorized = await authorize(
      reply,
      request.id,
      userId,
      () => options.service.findModelTerritories(id!),
      'water_balance:write',
    );
    if (!authorized) return;
    try {
      return await options.service.request(id!, parsed.data, userId, request.id);
    } catch (e) {
      return mutationFailure(reply, request.id, e);
    }
  });
  app.post(
    '/api/v1/water-balance-models/:modelId/versions/:version/approve',
    async (request, reply) => {
      const userId = await authenticate(request, reply);
      if (!userId) return;
      const { modelId, version } = request.params as { modelId?: string; version?: string };
      const parsed = approveWaterBalanceVersionRequestSchema.safeParse(request.body);
      if (
        !uuid.test(modelId ?? '') ||
        !/^[1-9]\d*$/.test(version ?? '') ||
        !Number.isSafeInteger(Number(version)) ||
        !parsed.success
      )
        return reply
          .code(400)
          .send(err('VALIDATION_ERROR', 'Water balance approval is invalid.', request.id));
      const authorized = await authorize(
        reply,
        request.id,
        userId,
        () => options.service.findModelTerritories(modelId!),
        'water_balance:approve',
      );
      if (!authorized) return;
      try {
        return await options.service.approve(
          modelId!,
          Number(version),
          parsed.data.reason,
          userId,
          request.id,
        );
      } catch (e) {
        return mutationFailure(reply, request.id, e);
      }
    },
  );
}

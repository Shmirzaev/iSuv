import {
  apiErrorSchema,
  liveOperationsQuerySchema,
  liveOperationsScopeQuerySchema,
  liveOperationsResponseSchema,
  liveOperationsInspectorSchema,
  type ApiError,
} from '@isuv/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authorizeTerritoryAction,
  type TerritoryAuthorizationRepository,
} from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { PostgresLiveOperationsService } from './service.js';
const err = (code: ApiError['error']['code'], message: string, requestId: string) =>
  apiErrorSchema.parse({ error: { code, message, requestId } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function registerLiveOperationsRoutes(
  app: FastifyInstance,
  options: {
    identityProvider: IdentityProvider;
    sessionRepository: IdentitySessionRepository;
    authorizationRepository: TerritoryAuthorizationRepository;
    service: PostgresLiveOperationsService;
    now?: () => Date;
  },
) {
  const now = options.now ?? (() => new Date());
  async function session(req: FastifyRequest, reply: FastifyReply) {
    try {
      const i = await options.identityProvider.resolve(req);
      const s = i ? await options.sessionRepository.findCurrentSession(i.userId, now()) : null;
      if (!s) {
        reply.code(401).send(err('UNAUTHENTICATED', 'Authentication is required.', req.id));
        return null;
      }
      return s;
    } catch {
      reply
        .code(503)
        .send(err('UNAVAILABLE', 'Live operations is temporarily unavailable.', req.id));
      return null;
    }
  }
  async function allowed(user: string, territory: string) {
    return (
      await authorizeTerritoryAction(
        options.authorizationRepository,
        user,
        'telemetry:read',
        territory,
        now(),
      )
    ).allowed;
  }
  app.get('/api/v1/live-operations', async (req, reply) => {
    const s = await session(req, reply);
    if (!s) return;
    const q = liveOperationsQuerySchema.safeParse(req.query);
    if (!q.success)
      return reply
        .code(400)
        .send(err('VALIDATION_ERROR', 'Live operations query is invalid.', req.id));
    try {
      const territory =
        q.data.territoryId ??
        (await options.service.findDefaultTerritory(s.user.id, s.user.organizationId, now()));
      if (!territory || !(await allowed(s.user.id, territory)))
        return reply
          .code(404)
          .send(err('NOT_FOUND', 'Live operations resource was not found.', req.id));
      const value = await options.service.list(territory, q.data);
      return value
        ? liveOperationsResponseSchema.parse(value)
        : reply.code(404).send(err('NOT_FOUND', 'Live operations resource was not found.', req.id));
    } catch (e) {
      if (e instanceof Error && e.message === 'CURSOR')
        return reply
          .code(400)
          .send(err('VALIDATION_ERROR', 'Live operations cursor is invalid.', req.id));
      req.log.error({ err: e }, 'Live operations list failed');
      return reply
        .code(503)
        .send(err('UNAVAILABLE', 'Live operations is temporarily unavailable.', req.id));
    }
  });
  app.get('/api/v1/live-operations/:deviceId', async (req, reply) => {
    const s = await session(req, reply);
    if (!s) return;
    const deviceId = (req.params as { deviceId?: string }).deviceId;
    if (!deviceId || !uuid.test(deviceId))
      return reply.code(400).send(err('VALIDATION_ERROR', 'Device identifier is invalid.', req.id));
    const q = liveOperationsScopeQuerySchema.safeParse(req.query);
    if (!q.success)
      return reply
        .code(400)
        .send(err('VALIDATION_ERROR', 'Live operations query is invalid.', req.id));
    try {
      const territory =
        q.data.territoryId ??
        (await options.service.findDefaultTerritory(s.user.id, s.user.organizationId, now()));
      if (!territory || !(await allowed(s.user.id, territory)))
        return reply
          .code(404)
          .send(err('NOT_FOUND', 'Live operations resource was not found.', req.id));
      const value = await options.service.inspector(deviceId, territory);
      return value
        ? liveOperationsInspectorSchema.parse(value)
        : reply.code(404).send(err('NOT_FOUND', 'Live operations resource was not found.', req.id));
    } catch (error) {
      req.log.error({ err: error }, 'Live operations inspector failed');
      return reply
        .code(503)
        .send(err('UNAVAILABLE', 'Live operations is temporarily unavailable.', req.id));
    }
  });
  app.get('/api/v1/live-operations/live', async (req, reply) => {
    const s = await session(req, reply);
    if (!s) return;
    const q = liveOperationsScopeQuerySchema.safeParse(req.query);
    if (!q.success)
      return reply
        .code(400)
        .send(err('VALIDATION_ERROR', 'Live operations query is invalid.', req.id));
    const h = req.headers['last-event-id'];
    const v = Array.isArray(h) ? h[0] : h;
    if (v !== undefined && !/^\d+$/.test(v))
      return reply.code(400).send(err('VALIDATION_ERROR', 'Last-Event-ID is invalid.', req.id));
    try {
      const territory =
        q.data.territoryId ??
        (await options.service.findDefaultTerritory(s.user.id, s.user.organizationId, now()));
      if (!territory || !(await allowed(s.user.id, territory)))
        return reply
          .code(404)
          .send(err('NOT_FOUND', 'Live operations resource was not found.', req.id));
      const list = await options.service.list(territory, { limit: 1 });
      if (!list)
        return reply
          .code(404)
          .send(err('NOT_FOUND', 'Live operations resource was not found.', req.id));
      const territoryIds = await options.service.descendantTerritoryIds(territory);
      const stream = await options.service.live(
        s.user.organizationId,
        v ? BigInt(v) : null,
        territoryIds,
      );
      reply
        .type('text/event-stream; charset=utf-8')
        .header('cache-control', 'no-cache')
        .header('x-isuv-live-reconnect', 'Last-Event-ID')
        .header('x-isuv-live-batch-limit', '250');
      return `${stream.reset ? `event: reset\ndata: ${JSON.stringify({ reason: 'cursor_expired', action: 'resync', snapshotUrl: '/api/v1/live-operations' })}\n\n` : ''}${stream.events.map((x) => `id: ${x.id}\nevent: invalidate\ndata: ${JSON.stringify({ deviceId: x.event.deviceId, source: 'device_health' })}\n\n`).join('')}event: complete\ndata: ${JSON.stringify({ action: 'reconnect', cursor: stream.events.at(-1)?.id ?? v ?? null })}\n\n: heartbeat\n\n`;
    } catch (error) {
      req.log.error({ err: error }, 'Live operations stream failed');
      return reply
        .code(503)
        .send(err('UNAVAILABLE', 'Live operations stream is temporarily unavailable.', req.id));
    }
  });
}

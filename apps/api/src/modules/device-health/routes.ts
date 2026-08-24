import {
  apiErrorSchema,
  deviceHealthHistoryQuerySchema,
  ingestDeviceHealthEventRequestSchema,
  type ApiError,
} from '@isuv/contracts';
import type { FastifyInstance } from 'fastify';
import {
  authorizeTerritoryAction,
  type TerritoryAuthorizationRepository,
} from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { DeviceHealthError, type PostgresDeviceHealthService } from './service.js';

interface Options {
  identityProvider: IdentityProvider;
  sessionRepository: IdentitySessionRepository;
  authorizationRepository: TerritoryAuthorizationRepository;
  service: PostgresDeviceHealthService;
  now?: () => Date;
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const apiError = (code: ApiError['error']['code'], message: string, requestId: string): ApiError =>
  apiErrorSchema.parse({ error: { code, message, requestId } });

export function registerDeviceHealthRoutes(app: FastifyInstance, options: Options): void {
  const now = options.now ?? (() => new Date());
  async function user(
    request: { headers: Record<string, string | string[] | undefined>; id: string },
    reply: { code(status: number): { send(value: ApiError): unknown } },
  ) {
    const identity = await options.identityProvider.resolve(request);
    const session = identity
      ? await options.sessionRepository.findCurrentSession(identity.userId, now())
      : null;
    if (!session) {
      reply.code(401).send(apiError('UNAUTHENTICATED', 'Authentication is required.', request.id));
      return null;
    }
    return session;
  }
  async function permitted(
    request: { id: string },
    reply: { code(status: number): { send(value: ApiError): unknown } },
    userId: string,
    territoryId: string,
    action: 'device:read' | 'device:write',
  ) {
    const decision = await authorizeTerritoryAction(
      options.authorizationRepository,
      userId,
      action,
      territoryId,
      now(),
    );
    if (!decision.allowed) {
      reply.code(404).send(apiError('NOT_FOUND', 'Device health was not found.', request.id));
      return false;
    }
    return true;
  }
  app.post('/api/v1/device-health/events', async (request, reply) => {
    const session = await user(request, reply);
    if (!session) return;
    const parsed = ingestDeviceHealthEventRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'The device health fact is invalid.', request.id));
    if (parsed.data.dataCondition !== 'unconfigured')
      return reply
        .code(400)
        .send(
          apiError(
            'VALIDATION_ERROR',
            'Only governed numeric observations may set data condition.',
            request.id,
          ),
        );
    try {
      const territory = await options.service.resolveDeviceTerritory(
        parsed.data.deviceId,
        parsed.data.occurredAt,
      );
      if (
        !territory ||
        !(await permitted(request, reply, session.user.id, territory, 'device:write'))
      ) {
        if (!territory)
          return reply
            .code(404)
            .send(apiError('NOT_FOUND', 'Device health was not found.', request.id));
        return;
      }
      return await options.service.ingest(parsed.data, territory);
    } catch (error) {
      if (error instanceof DeviceHealthError)
        return reply
          .code(error.kind === 'CONFLICT' ? 409 : error.kind === 'UNAVAILABLE' ? 503 : 404)
          .send(
            apiError(
              error.kind === 'CONFLICT'
                ? 'CONFLICT'
                : error.kind === 'UNAVAILABLE'
                  ? 'UNAVAILABLE'
                  : 'NOT_FOUND',
              error.message,
              request.id,
            ),
          );
      app.log.error({ err: error, deviceId: parsed.data.deviceId }, 'device health write failed');
      return reply
        .code(503)
        .send(
          apiError('UNAVAILABLE', 'Device health service is temporarily unavailable.', request.id),
        );
    }
  });
  async function readDevice(
    request: {
      headers: Record<string, string | string[] | undefined>;
      id: string;
      params: unknown;
    },
    reply: { code(status: number): { send(value: ApiError): unknown } },
  ) {
    const session = await user(request, reply);
    if (!session) return null;
    const deviceId = (request.params as { deviceId?: string }).deviceId;
    if (!deviceId || !uuidPattern.test(deviceId)) {
      reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'The device identifier is invalid.', request.id));
      return null;
    }
    try {
      const territory = await options.service.findCurrentTerritory(deviceId);
      if (
        !territory ||
        !(await permitted(request, reply, session.user.id, territory, 'device:read'))
      ) {
        if (!territory)
          reply.code(404).send(apiError('NOT_FOUND', 'Device health was not found.', request.id));
        return null;
      }
      return { deviceId, session };
    } catch (error) {
      app.log.warn({ err: error }, 'device health authorization scope unavailable');
      reply
        .code(503)
        .send(
          apiError('UNAVAILABLE', 'Device health service is temporarily unavailable.', request.id),
        );
      return null;
    }
  }
  app.get('/api/v1/device-health/:deviceId', async (request, reply) => {
    const context = await readDevice(request, reply);
    if (!context) return;
    try {
      const current = await options.service.current(context.deviceId);
      return (
        current ??
        reply.code(404).send(apiError('NOT_FOUND', 'Device health was not found.', request.id))
      );
    } catch (error) {
      app.log.warn({ err: error }, 'device health current unavailable');
      return reply
        .code(503)
        .send(
          apiError('UNAVAILABLE', 'Device health service is temporarily unavailable.', request.id),
        );
    }
  });
  app.get('/api/v1/device-health/:deviceId/history', async (request, reply) => {
    const context = await authenticatedDevice(request, reply);
    if (!context) return;
    const query = deviceHealthHistoryQuerySchema.safeParse(request.query);
    if (!query.success)
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'The history query is invalid.', request.id));
    try {
      const territories = await authorizedOccurrenceTerritories(
        context.deviceId,
        context.session.user.id,
      );
      if (!territories.length)
        return reply
          .code(404)
          .send(apiError('NOT_FOUND', 'Device health was not found.', request.id));
      const history = await options.service.history(context.deviceId, query.data, territories);
      return { events: history.events, nextCursor: history.nextCursor };
    } catch (error) {
      app.log.warn({ err: error }, 'device health history unavailable');
      return reply
        .code(503)
        .send(
          apiError('UNAVAILABLE', 'Device health service is temporarily unavailable.', request.id),
        );
    }
  });
  app.get('/api/v1/device-health/:deviceId/live', async (request, reply) => {
    const context = await authenticatedDevice(request, reply);
    if (!context) return;
    const rawId = request.headers['last-event-id'];
    const candidate = Array.isArray(rawId) ? rawId[0] : rawId;
    if (candidate !== undefined && !/^\d+$/.test(candidate))
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'Last-Event-ID is invalid.', request.id));
    const after = candidate ? BigInt(candidate) : null;
    try {
      const territories = await authorizedOccurrenceTerritories(
        context.deviceId,
        context.session.user.id,
      );
      if (!territories.length)
        return reply
          .code(404)
          .send(apiError('NOT_FOUND', 'Device health was not found.', request.id));
      const stream = await options.service.live(
        context.session.user.organizationId,
        after,
        250,
        context.deviceId,
        territories,
      );
      reply
        .type('text/event-stream; charset=utf-8')
        .header('cache-control', 'no-cache')
        .header('connection', 'keep-alive')
        .header('x-isuv-live-reconnect', 'Last-Event-ID')
        .header('x-isuv-live-batch-limit', '250');
      const reset = stream.reset
        ? `event: reset\ndata: ${JSON.stringify({ reason: 'cursor_expired', action: 'resync', snapshotUrl: `/api/v1/device-health/${context.deviceId}` })}\n\n`
        : '';
      const records = stream.events
        .map(
          (record) =>
            `id: ${record.id}\nevent: device-health\ndata: ${JSON.stringify(record.event)}\n\n`,
        )
        .join('');
      // Short polling response is intentionally bounded: it never retains a
      // slow consumer in process memory; clients reconnect with Last-Event-ID.
      return `${reset}${records}: heartbeat\n\n`;
    } catch (error) {
      app.log.warn({ err: error }, 'device health live stream degraded');
      return reply
        .code(503)
        .send(
          apiError('UNAVAILABLE', 'Device health stream is temporarily unavailable.', request.id),
        );
    }
  });

  async function authenticatedDevice(
    request: {
      headers: Record<string, string | string[] | undefined>;
      id: string;
      params: unknown;
    },
    reply: { code(status: number): { send(value: ApiError): unknown } },
  ) {
    const session = await user(request, reply);
    if (!session) return null;
    const deviceId = (request.params as { deviceId?: string }).deviceId;
    if (!deviceId || !uuidPattern.test(deviceId)) {
      reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'The device identifier is invalid.', request.id));
      return null;
    }
    return session ? { deviceId, session } : null;
  }
  async function authorizedOccurrenceTerritories(
    deviceId: string,
    userId: string,
  ): Promise<string[]> {
    const candidates = await options.service.listOccurrenceTerritories(deviceId);
    const visible: string[] = [];
    for (const territoryId of candidates) {
      const decision = await authorizeTerritoryAction(
        options.authorizationRepository,
        userId,
        'device:read',
        territoryId,
        now(),
      );
      if (decision.allowed) visible.push(territoryId);
    }
    return visible;
  }
}

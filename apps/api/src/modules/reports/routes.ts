import {
  apiErrorSchema,
  generateReportRequestSchema,
  reportExportRequestSchema,
  reportListQuerySchema,
  reportListResponseSchema,
  reportResponseSchema,
  type ApiError,
} from '@isuv/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authorizeTerritoryAction,
  type TerritoryAuthorizationRepository,
} from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { PostgresReportService, ReportError } from './service.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const error = (code: ApiError['error']['code'], message: string, requestId: string) =>
  apiErrorSchema.parse({ error: { code, message, requestId } });
export function registerReportRoutes(
  app: FastifyInstance,
  options: {
    identityProvider: IdentityProvider;
    sessionRepository: IdentitySessionRepository;
    authorizationRepository: TerritoryAuthorizationRepository;
    service: PostgresReportService;
    now?: () => Date;
  },
) {
  const now = options.now ?? (() => new Date());
  async function session(request: FastifyRequest, reply: FastifyReply) {
    try {
      const identity = await options.identityProvider.resolve(request);
      const current = identity
        ? await options.sessionRepository.findCurrentSession(identity.userId, now())
        : null;
      if (!current) {
        reply.code(401).send(error('UNAUTHENTICATED', 'Authentication is required.', request.id));
        return null;
      }
      return current;
    } catch {
      reply
        .code(503)
        .send(error('UNAVAILABLE', 'Report service is temporarily unavailable.', request.id));
      return null;
    }
  }
  async function allow(
    reply: FastifyReply,
    request: FastifyRequest,
    user: string,
    territory: string,
  ) {
    try {
      const d = await authorizeTerritoryAction(
        options.authorizationRepository,
        user,
        'report:read',
        territory,
        now(),
      );
      if (!d.allowed) {
        reply.code(404).send(error('NOT_FOUND', 'Report resource was not found.', request.id));
        return false;
      }
      return true;
    } catch {
      reply
        .code(503)
        .send(error('UNAVAILABLE', 'Report service is temporarily unavailable.', request.id));
      return false;
    }
  }
  function failure(reply: FastifyReply, request: FastifyRequest, e: unknown) {
    if (e instanceof ReportError)
      return reply
        .code(e.kind === 'NOT_FOUND' ? 404 : e.kind === 'CONFLICT' ? 409 : 400)
        .send(
          error(
            e.kind === 'NOT_FOUND'
              ? 'NOT_FOUND'
              : e.kind === 'CONFLICT'
                ? 'CONFLICT'
                : 'VALIDATION_ERROR',
            e.message,
            request.id,
          ),
        );
    return reply
      .code(503)
      .send(error('UNAVAILABLE', 'Report service is temporarily unavailable.', request.id));
  }
  app.post('/api/v1/reports', async (request, reply) => {
    // Identity always precedes parsing so malformed selectors do not probe protected state.
    const current = await session(request, reply);
    if (!current) return;
    const parsed = generateReportRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'Report generation request is invalid.', request.id));
    try {
      let incidentTerritory: string | null = null;
      if (parsed.data.incidentId) {
        const scope = await options.service.findIncidentScope(parsed.data.incidentId);
        if (!scope || !(await allow(reply, request, current.user.id, scope.territory_id)))
          return reply
            .code(404)
            .send(error('NOT_FOUND', 'Report resource was not found.', request.id));
        incidentTerritory = scope.territory_id;
        if (parsed.data.territoryId && scope.territory_id !== parsed.data.territoryId)
          return reply
            .code(404)
            .send(error('NOT_FOUND', 'Report resource was not found.', request.id));
      }
      const territory =
        parsed.data.territoryId ??
        incidentTerritory ??
        (await options.service.findDefaultTerritory(
          current.user.id,
          current.user.organizationId,
          now(),
        ));
      if (!territory)
        return reply
          .code(404)
          .send(error('NOT_FOUND', 'Report resource was not found.', request.id));
      if (!incidentTerritory && !(await allow(reply, request, current.user.id, territory))) return;
      return reply.send(
        reportResponseSchema.parse({
          report: await options.service.generate(
            parsed.data,
            territory,
            current.user.id,
            request.id,
          ),
        }),
      );
    } catch (e) {
      return failure(reply, request, e);
    }
  });
  app.get('/api/v1/reports', async (request, reply) => {
    const current = await session(request, reply);
    if (!current) return;
    const parsed = reportListQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'Report list query is invalid.', request.id));
    try {
      const territory =
        parsed.data.territoryId ??
        (await options.service.findDefaultTerritory(
          current.user.id,
          current.user.organizationId,
          now(),
        ));
      if (!territory || !(await allow(reply, request, current.user.id, territory))) return;
      return reply.send(
        reportListResponseSchema.parse({
          reports: await options.service.list(territory, parsed.data.kind, parsed.data.limit),
        }),
      );
    } catch (e) {
      return failure(reply, request, e);
    }
  });
  async function snapshot(request: FastifyRequest, reply: FastifyReply) {
    const current = await session(request, reply);
    if (!current) return null;
    const id = (request.params as { reportId?: string }).reportId ?? '';
    if (!uuid.test(id)) {
      reply.code(400).send(error('VALIDATION_ERROR', 'Report identifier is invalid.', request.id));
      return null;
    }
    try {
      const scope = await options.service.findScope(id);
      if (!scope) {
        reply.code(404).send(error('NOT_FOUND', 'Report resource was not found.', request.id));
        return null;
      }
      if (!(await allow(reply, request, current.user.id, scope.territory_id))) return null;
      return { id, user: current.user.id };
    } catch (e) {
      failure(reply, request, e);
      return null;
    }
  }
  app.get('/api/v1/reports/:reportId', async (request, reply) => {
    const scoped = await snapshot(request, reply);
    if (!scoped) return;
    try {
      const report = await options.service.get(scoped.id);
      if (!report)
        return reply
          .code(404)
          .send(error('NOT_FOUND', 'Report resource was not found.', request.id));
      return reply.send(reportResponseSchema.parse({ report }));
    } catch (e) {
      return failure(reply, request, e);
    }
  });
  app.post('/api/v1/reports/:reportId/export', async (request, reply) => {
    const scoped = await snapshot(request, reply);
    if (!scoped) return;
    const parsed = reportExportRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send(error('VALIDATION_ERROR', 'Report export request is invalid.', request.id));
    try {
      const out = await options.service.export(
        scoped.id,
        parsed.data.format,
        scoped.user,
        request.id,
      );
      return reply.type(out.contentType).send(out.body);
    } catch (e) {
      return failure(reply, request, e);
    }
  });
}

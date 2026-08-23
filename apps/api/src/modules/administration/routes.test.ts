import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Session } from '@isuv/contracts';
import { registerAdministrationRoutes } from './routes.js';

const targetId = 'd3000000-0000-4000-8000-000000000001';
const territoryId = 'd2000000-0000-4000-8000-000000000001';
const actorId = 'd3000000-0000-4000-8000-000000000002';
const organizationId = 'd1000000-0000-4000-8000-000000000001';

const session: Session = {
  user: {
    id: actorId,
    organizationId,
    externalSubject: 'synthetic:admin-route',
    displayName: 'Administrative route actor',
    isActive: true,
    dataClassification: 'synthetic',
  },
  organization: {
    id: organizationId,
    code: 'ADMIN',
    name: 'Administration',
    dataClassification: 'synthetic',
  },
  currentGrants: [],
  resolvedAt: '2026-06-01T00:00:00.000Z',
};

test('administration routes treat inactive or unknown resolved identities as unauthenticated', async () => {
  const app = Fastify({ requestIdHeader: 'x-request-id', genReqId: () => crypto.randomUUID() });
  registerAdministrationRoutes(app, {
    identityProvider: {
      async resolve() {
        return {
          userId: 'd3000000-0000-4000-8000-000000000002',
          provider: 'local-development' as const,
        };
      },
    },
    sessionRepository: {
      async findCurrentSession() {
        return null;
      },
    },
    service: {
      async create() {
        throw new Error('must not reach service');
      },
    } as never,
  });
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/role-grants',
    payload: {
      userId: targetId,
      role: 'district_operator',
      scope: 'territory',
      territoryId,
      effectiveFrom: '2026-06-01T00:00:00.000Z',
      reason: 'Synthetic test.',
    },
    headers: { 'x-request-id': 'admin-inactive-request' },
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'UNAUTHENTICATED');
  assert.equal(response.json().error.requestId, 'admin-inactive-request');
  await app.close();
});

test('administration mutation passes the exact request id into the audited service', async () => {
  let receivedRequestId = '';
  const app = Fastify({ requestIdHeader: 'x-request-id', genReqId: () => crypto.randomUUID() });
  registerAdministrationRoutes(app, {
    identityProvider: {
      async resolve() {
        return { userId: actorId, provider: 'local-development' as const };
      },
    },
    sessionRepository: {
      async findCurrentSession() {
        return session;
      },
    },
    service: {
      async create(_actorId: string, requestId: string) {
        receivedRequestId = requestId;
        return {
          grant: {
            id: 'd4000000-0000-4000-8000-000000000001',
            userId: targetId,
            organizationId,
            role: 'district_operator' as const,
            scope: 'territory' as const,
            territoryId,
            effectiveFrom: '2026-06-01T00:00:00.000Z',
            effectiveUntil: null,
            cancelledAt: null,
          },
          auditEvent: {
            id: 'd5000000-0000-4000-8000-000000000001',
            organizationId,
            territoryId,
            actorUserId: actorId,
            actorOrganizationId: organizationId,
            action: 'user_role_grant.created' as const,
            resource: 'user_role_grant' as const,
            resourceId: 'd4000000-0000-4000-8000-000000000001',
            oldState: null,
            newState: {},
            reason: 'Synthetic test.',
            requestId,
            occurredAt: '2026-06-01T00:00:00.000Z',
            dataClassification: 'synthetic' as const,
            provenance: 'administration_api',
          },
        };
      },
    } as never,
  });
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/role-grants',
    headers: { 'x-request-id': 'admin-audit-request' },
    payload: {
      userId: targetId,
      role: 'district_operator',
      scope: 'territory',
      territoryId,
      effectiveFrom: '2026-06-01T00:00:00.000Z',
      reason: 'Synthetic test.',
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(receivedRequestId, 'admin-audit-request');
  assert.equal(response.json().auditEvent.requestId, 'admin-audit-request');
  await app.close();
});

test('administration route accepts explicit scheduled-grant cancellation without an end timestamp', async () => {
  let receivedOperation = '';
  const app = Fastify({ requestIdHeader: 'x-request-id', genReqId: () => crypto.randomUUID() });
  registerAdministrationRoutes(app, {
    identityProvider: {
      async resolve() {
        return { userId: actorId, provider: 'local-development' as const };
      },
    },
    sessionRepository: {
      async findCurrentSession() {
        return session;
      },
    },
    service: {
      async revoke(
        _actorId: string,
        requestId: string,
        _grantId: string,
        input: { operation: string },
      ) {
        receivedOperation = input.operation;
        return {
          grant: {
            id: 'd4000000-0000-4000-8000-000000000001',
            userId: targetId,
            organizationId,
            role: 'district_operator' as const,
            scope: 'territory' as const,
            territoryId,
            effectiveFrom: '2026-09-01T00:00:00.000Z',
            effectiveUntil: null,
            cancelledAt: '2026-06-01T00:00:00.000Z',
          },
          auditEvent: {
            id: 'd5000000-0000-4000-8000-000000000001',
            organizationId,
            territoryId,
            actorUserId: actorId,
            actorOrganizationId: organizationId,
            action: 'user_role_grant.cancelled' as const,
            resource: 'user_role_grant' as const,
            resourceId: 'd4000000-0000-4000-8000-000000000001',
            oldState: {},
            newState: {},
            reason: 'Synthetic cancellation.',
            requestId,
            occurredAt: '2026-06-01T00:00:00.000Z',
            dataClassification: 'synthetic' as const,
            provenance: 'administration_api',
          },
        };
      },
    } as never,
  });
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/role-grants/d4000000-0000-4000-8000-000000000001/revocations',
    payload: { operation: 'cancel', reason: 'Synthetic cancellation.' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(receivedOperation, 'cancel');
  assert.equal(response.json().auditEvent.action, 'user_role_grant.cancelled');
  await app.close();
});

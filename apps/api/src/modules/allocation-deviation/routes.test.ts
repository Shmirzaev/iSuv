import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../app.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import type { PostgresAllocationDeviationService } from './service.js';
const planId = 'd1000000-0000-4000-8000-000000000001';
const userId = 'd1000000-0000-4000-8000-000000000002';
const identityProvider = {
  resolve: async () => ({ userId, externalSubject: 'test' }),
} as unknown as IdentityProvider;
const sessions = {
  findCurrentSession: async () => ({ user: { id: userId } }),
} as unknown as IdentitySessionRepository;
const auth = {
  findEffectiveGrantsForTarget: async () => [],
} as unknown as TerritoryAuthorizationRepository;
const base = {
  interval: { start: '2026-01-01T00:00:00.000000Z', end: '2026-01-01T01:00:00.000000Z' },
  knownAt: '2026-01-02T00:00:00.000000Z',
  plannedEntry: null,
  binding: null,
  tolerance: null,
  actual: null,
  delta: null,
  absoluteDelta: null,
  percent: null,
  dataClassification: 'synthetic' as const,
  officialComplianceEligible: false as const,
  condition: 'unassessable' as const,
};
test('allocation deviation endpoint validates input and does not enumerate inaccessible plans', async () => {
  const service = {
    findPlanTerritory: async () => 'd2000000-0000-4000-8000-000000000001',
    deviation: async () => ({ ...base, outcome: 'no_approved_plan' as const }),
  } as unknown as PostgresAllocationDeviationService;
  const app = createApp(undefined, false, {
    identityProvider,
    identitySessionRepository: sessions,
    territoryAuthorizationRepository: auth,
    allocationDeviationService: service,
  });
  const invalid = await app.inject({
    method: 'GET',
    url: '/api/v1/allocation-plans/nope/deviation',
  });
  assert.equal(invalid.statusCode, 400);
  const denied = await app.inject({
    method: 'GET',
    url: `/api/v1/allocation-plans/${planId}/deviation?intervalStart=2026-01-01T00%3A00%3A00.000000Z&intervalEnd=2026-01-01T01%3A00%3A00.000000Z`,
  });
  assert.equal(denied.statusCode, 404);
  await app.close();
});

test('allocation authoring authenticates before lookup and never calls mutations when denied', async () => {
  const entryId = 'd1000000-0000-4000-8000-000000000020';
  const payload = {
    stationId: 'd1000000-0000-4000-8000-000000000021',
    sensorId: 'd1000000-0000-4000-8000-000000000022',
    deviceInstallationId: 'd1000000-0000-4000-8000-000000000023',
    method: 'direct_discharge',
    referencePlane: 'upstream',
    provenance: 'synthetic:denial-test',
    reason: 'exercise authoring denial',
  };
  let lookups = 0;
  let mutations = 0;
  const service = {
    findEntryTerritory: async () => {
      lookups += 1;
      return 'd2000000-0000-4000-8000-000000000001';
    },
    createBinding: async () => {
      mutations += 1;
      throw new Error('must not be called');
    },
  } as unknown as PostgresAllocationDeviationService;
  const anonymous = createApp(undefined, false, {
    identityProvider: { resolve: async () => null } as unknown as IdentityProvider,
    identitySessionRepository: sessions,
    territoryAuthorizationRepository: auth,
    allocationDeviationService: service,
  });
  const unauthenticated = await anonymous.inject({
    method: 'POST',
    url: `/api/v1/allocation-plan-entries/${entryId}/measurement-binding`,
    payload,
  });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(lookups, 0);
  await anonymous.close();

  const deniedApp = createApp(undefined, false, {
    identityProvider,
    identitySessionRepository: sessions,
    territoryAuthorizationRepository: auth,
    allocationDeviationService: service,
  });
  const denied = await deniedApp.inject({
    method: 'POST',
    url: `/api/v1/allocation-plan-entries/${entryId}/measurement-binding`,
    payload,
  });
  assert.equal(denied.statusCode, 404);
  assert.equal(lookups, 1);
  assert.equal(mutations, 0);
  await deniedApp.close();
});

test('governed allocation-deviation authoring uses the caller identity and territory authority', async () => {
  let activeUserId = userId;
  const approverId = 'd1000000-0000-4000-8000-000000000003';
  const territoryId = 'd2000000-0000-4000-8000-000000000001';
  const policyId = 'd1000000-0000-4000-8000-000000000004';
  const entryId = 'd1000000-0000-4000-8000-000000000005';
  const stationId = 'd1000000-0000-4000-8000-000000000006';
  const sensorId = 'd1000000-0000-4000-8000-000000000007';
  const installationId = 'd1000000-0000-4000-8000-000000000008';
  const sectionId = 'd1000000-0000-4000-8000-000000000009';
  const provider = {
    resolve: async () => ({ userId: activeUserId, externalSubject: 'test' }),
  } as unknown as IdentityProvider;
  const activeSessions = {
    findCurrentSession: async () => ({ user: { id: activeUserId } }),
  } as unknown as IdentitySessionRepository;
  const allowed = {
    findEffectiveGrantsForTarget: async (actor: string) => [
      {
        id: 'd1000000-0000-4000-8000-000000000010',
        role: actor === approverId ? 'national_admin' : 'national_admin',
        scope: 'national',
        territoryId: null,
        coversTargetTerritory: true,
      },
    ],
  } as unknown as TerritoryAuthorizationRepository;
  const timestamps = {
    createdAt: '2026-01-01T00:00:00.000000Z',
    requestedAt: '2026-01-01T00:00:00.000000Z',
    approvedAt: '2026-01-01T00:00:01.000000Z',
  };
  const service = {
    findPlanTerritory: async () => territoryId,
    findEntryTerritory: async () => territoryId,
    findSectionTerritory: async () => territoryId,
    findTolerancePolicyTerritory: async () => territoryId,
    createBinding: async (
      _entry: string,
      input: {
        stationId: string;
        sensorId: string;
        deviceInstallationId: string;
        method: string;
        referencePlane: string;
        provenance: string;
        reason: string;
      },
      actor: string,
      requestId: string,
    ) => ({
      id: 'd1000000-0000-4000-8000-000000000011',
      entryId,
      stationId: input.stationId,
      sensorId: input.sensorId,
      deviceInstallationId: input.deviceInstallationId,
      method: input.method,
      referencePlane: input.referencePlane,
      purpose: 'section_delivery',
      provenance: input.provenance,
      createdByUserId: actor,
      creationReason: input.reason,
      createdRequestId: requestId,
      createdAt: timestamps.createdAt,
      dataClassification: 'synthetic',
      officialComplianceEligible: false,
    }),
    createTolerancePolicy: async (
      input: { waterSectionId: string; provenance: string; reason: string },
      actor: string,
      requestId: string,
    ) => ({
      id: policyId,
      organizationId: 'd1000000-0000-4000-8000-000000000012',
      territoryId,
      waterSectionId: input.waterSectionId,
      provenance: input.provenance,
      createdByUserId: actor,
      creationReason: input.reason,
      createdRequestId: requestId,
      createdAt: timestamps.createdAt,
      dataClassification: 'synthetic',
      officialComplianceEligible: false,
    }),
    requestToleranceVersion: async (
      _policy: string,
      input: Record<string, unknown>,
      actor: string,
    ) => ({
      id: 'd1000000-0000-4000-8000-000000000013',
      policyId,
      version: 1,
      status: 'requested',
      effectiveFrom: input.effectiveFrom,
      effectiveUntil: input.effectiveUntil ?? null,
      underAbsoluteM3: input.underAbsoluteM3 ?? null,
      overAbsoluteM3: input.overAbsoluteM3 ?? null,
      underPercent: input.underPercent ?? null,
      overPercent: input.overPercent ?? null,
      combination: input.combination,
      appliesToZeroPlan: input.appliesToZeroPlan,
      requestedByUserId: actor,
      requestedAt: timestamps.requestedAt,
      requestReason: input.reason,
      approvedByUserId: null,
      approvedAt: null,
      approvalReason: null,
      dataClassification: 'synthetic',
      officialComplianceEligible: false,
    }),
    approveToleranceVersion: async (
      _policy: string,
      version: number,
      reason: string,
      actor: string,
    ) => ({
      id: 'd1000000-0000-4000-8000-000000000013',
      policyId,
      version,
      status: 'approved',
      effectiveFrom: '2030-01-01T00:00:00.000000Z',
      effectiveUntil: '2030-01-02T00:00:00.000000Z',
      underAbsoluteM3: '1',
      overAbsoluteM3: '1',
      underPercent: null,
      overPercent: null,
      combination: 'all',
      appliesToZeroPlan: true,
      requestedByUserId: userId,
      requestedAt: timestamps.requestedAt,
      requestReason: 'request tolerance',
      approvedByUserId: actor,
      approvedAt: timestamps.approvedAt,
      approvalReason: reason,
      dataClassification: 'synthetic',
      officialComplianceEligible: false,
    }),
  } as unknown as PostgresAllocationDeviationService;
  const app = createApp(undefined, false, {
    identityProvider: provider,
    identitySessionRepository: activeSessions,
    territoryAuthorizationRepository: allowed,
    allocationDeviationService: service,
  });
  const binding = await app.inject({
    method: 'POST',
    url: `/api/v1/allocation-plan-entries/${entryId}/measurement-binding`,
    payload: {
      stationId,
      sensorId,
      deviceInstallationId: installationId,
      method: 'direct_discharge',
      referencePlane: 'upstream',
      provenance: 'synthetic:route-test',
      reason: 'bind test entry',
    },
  });
  assert.equal(binding.statusCode, 200);
  const policy = await app.inject({
    method: 'POST',
    url: '/api/v1/section-tolerance-policies',
    payload: {
      waterSectionId: sectionId,
      provenance: 'synthetic:route-test',
      reason: 'create test policy',
    },
  });
  assert.equal(policy.statusCode, 200);
  const requested = await app.inject({
    method: 'POST',
    url: `/api/v1/section-tolerance-policies/${policyId}/versions/request`,
    payload: {
      effectiveFrom: '2030-01-01T00:00:00.000000Z',
      effectiveUntil: '2030-01-02T00:00:00.000000Z',
      underAbsoluteM3: '1',
      overAbsoluteM3: '1',
      combination: 'all',
      appliesToZeroPlan: true,
      reason: 'request tolerance',
    },
  });
  assert.equal(requested.statusCode, 200);
  activeUserId = approverId;
  const approved = await app.inject({
    method: 'POST',
    url: `/api/v1/section-tolerance-policies/${policyId}/versions/1/approve`,
    payload: { reason: 'approve tolerance' },
  });
  assert.equal(approved.statusCode, 200);
  const invalid = await app.inject({
    method: 'POST',
    url: `/api/v1/allocation-plan-entries/${entryId}/measurement-binding`,
    payload: { stationId },
  });
  assert.equal(invalid.statusCode, 400);
  await app.close();
});

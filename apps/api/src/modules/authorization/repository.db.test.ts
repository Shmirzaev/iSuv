import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { authorizeTerritoryAction, PostgresTerritoryAuthorizationRepository } from './service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests');

const pool = new Pool({ connectionString: databaseUrl, max: 6 });
const repository = new PostgresTerritoryAuthorizationRepository(databaseUrl);

const organizationA = 'b1000000-0000-4000-8000-000000000001';
const organizationB = 'b1000000-0000-4000-8000-000000000002';
const rootA = 'b2000000-0000-4000-8000-000000000001';
const districtA = 'b2000000-0000-4000-8000-000000000002';
const districtB = 'b2000000-0000-4000-8000-000000000003';
const cycleA = 'b2000000-0000-4000-8000-000000000004';
const cycleB = 'b2000000-0000-4000-8000-000000000005';
const rootB = 'b2000000-0000-4000-8000-000000000006';
const userDistrict = 'b3000000-0000-4000-8000-000000000001';
const userDirector = 'b3000000-0000-4000-8000-000000000002';
const userAuditor = 'b3000000-0000-4000-8000-000000000003';
const userNational = 'b3000000-0000-4000-8000-000000000004';
const userSystem = 'b3000000-0000-4000-8000-000000000005';
const userInactive = 'b3000000-0000-4000-8000-000000000006';
const userTimed = 'b3000000-0000-4000-8000-000000000007';

interface GrantInput {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  scope: string;
  territoryId: string | null;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  cancelledAt?: string | null;
  createdAt?: string;
}

async function clearFixtures(): Promise<void> {
  await pool.query('DELETE FROM user_role_grants WHERE organization_id = ANY($1::uuid[])', [
    [organizationA, organizationB],
  ]);
  await pool.query('DELETE FROM identity_users WHERE organization_id = ANY($1::uuid[])', [
    [organizationA, organizationB],
  ]);
  await pool.query('DELETE FROM territories WHERE organization_id = ANY($1::uuid[])', [
    [organizationA, organizationB],
  ]);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [
    [organizationA, organizationB],
  ]);
}

async function insertGrant(input: GrantInput): Promise<void> {
  await pool.query(
    `INSERT INTO user_role_grants
       (id, user_id, organization_id, role, scope, territory_id, effective_from, effective_until, cancelled_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.id,
      input.userId,
      input.organizationId,
      input.role,
      input.scope,
      input.territoryId,
      input.effectiveFrom,
      input.effectiveUntil ?? null,
      input.cancelledAt ?? null,
      input.createdAt ?? new Date().toISOString(),
    ],
  );
}

before(async () => {
  await clearFixtures();
  await pool.query(
    `INSERT INTO organizations (id, code, name, data_classification)
     VALUES
       ($1, 'AUTH-TEST-A', 'Authorization test organization A', 'synthetic'),
       ($2, 'AUTH-TEST-B', 'Authorization test organization B', 'synthetic')`,
    [organizationA, organizationB],
  );
  await pool.query(
    `INSERT INTO territories (id, organization_id, parent_territory_id, code, name, kind, data_classification)
     VALUES
       ($1, $2, NULL, 'AUTH-ROOT-A', 'Authorization root A', 'region', 'synthetic'),
       ($3, $2, $1, 'AUTH-DISTRICT-A', 'Authorization district A', 'district', 'synthetic'),
       ($4, $2, $1, 'AUTH-DISTRICT-B', 'Authorization district B', 'district', 'synthetic'),
       ($5, $2, NULL, 'AUTH-CYCLE-A', 'Authorization cycle A', 'district', 'synthetic'),
       ($6, $2, NULL, 'AUTH-CYCLE-B', 'Authorization cycle B', 'district', 'synthetic'),
       ($7, $8, NULL, 'AUTH-ROOT-B', 'Authorization root B', 'region', 'synthetic')`,
    [rootA, organizationA, districtA, districtB, cycleA, cycleB, rootB, organizationB],
  );
  await pool.query(
    `INSERT INTO identity_users (id, organization_id, external_subject, display_name, is_active, data_classification)
     VALUES
       ($1, $8, 'synthetic:auth-district', 'Authorization district operator', true, 'synthetic'),
       ($2, $8, 'synthetic:auth-director', 'Authorization regional director', true, 'synthetic'),
       ($3, $8, 'synthetic:auth-auditor', 'Authorization auditor', true, 'synthetic'),
       ($4, $8, 'synthetic:auth-national', 'Authorization national admin', true, 'synthetic'),
       ($5, $8, 'synthetic:auth-system', 'Authorization system admin', true, 'synthetic'),
       ($6, $8, 'synthetic:auth-inactive', 'Authorization inactive operator', false, 'synthetic'),
       ($7, $8, 'synthetic:auth-timed', 'Authorization timed operator', true, 'synthetic')`,
    [
      userDistrict,
      userDirector,
      userAuditor,
      userNational,
      userSystem,
      userInactive,
      userTimed,
      organizationA,
    ],
  );
  await Promise.all([
    insertGrant({
      id: 'b4000000-0000-4000-8000-000000000001',
      userId: userDistrict,
      organizationId: organizationA,
      role: 'district_operator',
      scope: 'territory',
      territoryId: districtA,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    }),
    insertGrant({
      id: 'b4000000-0000-4000-8000-000000000002',
      userId: userDirector,
      organizationId: organizationA,
      role: 'regional_director',
      scope: 'territory',
      territoryId: rootA,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    }),
    insertGrant({
      id: 'b4000000-0000-4000-8000-000000000003',
      userId: userAuditor,
      organizationId: organizationA,
      role: 'auditor',
      scope: 'territory',
      territoryId: rootA,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    }),
    insertGrant({
      id: 'b4000000-0000-4000-8000-000000000004',
      userId: userNational,
      organizationId: organizationA,
      role: 'national_admin',
      scope: 'national',
      territoryId: null,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    }),
    insertGrant({
      id: 'b4000000-0000-4000-8000-000000000005',
      userId: userSystem,
      organizationId: organizationA,
      role: 'system_admin',
      scope: 'system',
      territoryId: null,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    }),
    insertGrant({
      id: 'b4000000-0000-4000-8000-000000000006',
      userId: userInactive,
      organizationId: organizationA,
      role: 'district_operator',
      scope: 'territory',
      territoryId: districtA,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    }),
    insertGrant({
      id: 'b4000000-0000-4000-8000-000000000007',
      userId: userTimed,
      organizationId: organizationA,
      role: 'district_operator',
      scope: 'territory',
      territoryId: districtA,
      effectiveFrom: '2026-03-01T00:00:00.000Z',
      effectiveUntil: '2026-03-02T00:00:00.000Z',
    }),
    insertGrant({
      id: 'b4000000-0000-4000-8000-000000000011',
      userId: userTimed,
      organizationId: organizationA,
      role: 'hydrologist',
      scope: 'territory',
      territoryId: districtA,
      effectiveFrom: '2027-01-01T00:00:00.000Z',
      cancelledAt: '2026-01-02T00:00:00.000Z',
      createdAt: '2025-01-01T00:00:00.000Z',
    }),
  ]);
});

after(async () => {
  await clearFixtures();
  await pool.end();
});

test(
  'migration-backed authorization enforces scope, organization, activity, target existence, and UTC boundaries',
  { concurrency: false },
  async () => {
    const at = new Date('2026-01-15T00:00:00.000Z');
    assert.equal(
      (await authorizeTerritoryAction(repository, userDistrict, 'telemetry:write', districtA, at))
        .allowed,
      true,
    );
    assert.deepEqual(
      await authorizeTerritoryAction(repository, userDistrict, 'telemetry:write', districtB, at),
      { allowed: false, reason: 'OUTSIDE_TERRITORY_SCOPE' },
    );
    assert.equal(
      (await authorizeTerritoryAction(repository, userDirector, 'incident:write', districtB, at))
        .allowed,
      true,
    );
    assert.deepEqual(
      await authorizeTerritoryAction(repository, userAuditor, 'incident:write', districtA, at),
      { allowed: false, reason: 'ROLE_READ_ONLY' },
    );
    assert.equal(
      (await authorizeTerritoryAction(repository, userAuditor, 'incident:read', districtA, at))
        .allowed,
      true,
    );
    assert.equal(
      (
        await authorizeTerritoryAction(
          repository,
          userNational,
          'allocation_plan:write',
          districtA,
          at,
        )
      ).allowed,
      true,
    );
    assert.equal(
      (await authorizeTerritoryAction(repository, userNational, 'allocation_plan:write', rootB, at))
        .allowed,
      false,
    );
    assert.equal(
      (await authorizeTerritoryAction(repository, userTimed, 'water_balance:write', districtA, at))
        .allowed,
      false,
    );
    assert.equal(
      (await authorizeTerritoryAction(repository, userSystem, 'allocation_plan:write', rootB, at))
        .allowed,
      true,
    );
    assert.equal(
      (await authorizeTerritoryAction(repository, userInactive, 'telemetry:write', districtA, at))
        .allowed,
      false,
    );
    assert.equal(
      (
        await authorizeTerritoryAction(
          repository,
          userDistrict,
          'telemetry:write',
          'b2000000-0000-4000-8000-000000000099',
          at,
        )
      ).allowed,
      false,
    );
    assert.equal(
      (
        await authorizeTerritoryAction(
          repository,
          userTimed,
          'telemetry:write',
          districtA,
          new Date('2026-03-01T00:00:00.000Z'),
        )
      ).allowed,
      true,
    );
    assert.equal(
      (
        await authorizeTerritoryAction(
          repository,
          userTimed,
          'telemetry:write',
          districtA,
          new Date('2026-03-02T00:00:00.000Z'),
        )
      ).allowed,
      false,
    );
  },
);

test(
  'grant exclusion permits historical and future re-grants but rejects overlapping validity',
  { concurrency: false },
  async () => {
    await insertGrant({
      id: 'b4000000-0000-4000-8000-000000000008',
      userId: userTimed,
      organizationId: organizationA,
      role: 'district_operator',
      scope: 'territory',
      territoryId: districtA,
      effectiveFrom: '2026-02-01T00:00:00.000Z',
      effectiveUntil: '2026-02-02T00:00:00.000Z',
    });
    await insertGrant({
      id: 'b4000000-0000-4000-8000-000000000009',
      userId: userTimed,
      organizationId: organizationA,
      role: 'district_operator',
      scope: 'territory',
      territoryId: districtA,
      effectiveFrom: '2026-03-02T00:00:00.000Z',
      effectiveUntil: '2026-03-03T00:00:00.000Z',
    });
    await assert.rejects(
      insertGrant({
        id: 'b4000000-0000-4000-8000-000000000010',
        userId: userTimed,
        organizationId: organizationA,
        role: 'district_operator',
        scope: 'territory',
        territoryId: districtA,
        effectiveFrom: '2026-03-01T12:00:00.000Z',
        effectiveUntil: '2026-03-02T12:00:00.000Z',
      }),
      (error: unknown) => (error as { code?: string }).code === '23P01',
    );
  },
);

test(
  'organization advisory locking prevents concurrent reciprocal territory parents',
  { concurrency: false },
  async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      await first.query('UPDATE territories SET parent_territory_id = $1 WHERE id = $2', [
        cycleB,
        cycleA,
      ]);
      const reciprocal = second.query(
        'UPDATE territories SET parent_territory_id = $1 WHERE id = $2',
        [cycleA, cycleB],
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      await first.query('COMMIT');
      await assert.rejects(
        reciprocal,
        (error: unknown) => (error as { code?: string }).code === '23514',
      );
      await second.query('ROLLBACK');
    } finally {
      first.release();
      second.release();
    }
  },
);

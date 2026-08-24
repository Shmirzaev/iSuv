import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { auditStateMaximumBytes } from '@isuv/contracts';
import { Pool, type PoolClient } from 'pg';
import { PostgresRoleGrantAdministrationService } from '../administration/service.js';
import { PostgresAuditEventRepository } from './repository.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests');

const pool = new Pool({ connectionString: databaseUrl });
let database: PoolClient;
let service: PostgresRoleGrantAdministrationService;
let repository: PostgresAuditEventRepository;
const organizationA = randomUUID();
const organizationB = randomUUID();
const territoryA = randomUUID();
const territoryB = randomUUID();
const territoryChildA = randomUUID();
const territorySiblingA = randomUUID();
const systemActor = randomUUID();
const nationalActor = randomUUID();
const auditor = randomUUID();
const targetA = randomUUID();
const targetB = randomUUID();
let firstGrantId = '';
let firstAuditId = '';

async function expectConstraintFailure(
  action: () => Promise<unknown>,
  code = '23514',
): Promise<void> {
  await database.query('SAVEPOINT expected_constraint_failure');
  let failure: unknown;
  try {
    await action();
  } catch (error) {
    failure = error;
  } finally {
    await database.query('ROLLBACK TO SAVEPOINT expected_constraint_failure');
    await database.query('RELEASE SAVEPOINT expected_constraint_failure');
  }
  assert.equal((failure as { code?: string } | undefined)?.code, code);
}

async function databaseNow(): Promise<Date> {
  const result = await database.query<{ database_now: Date }>('SELECT now() AS database_now');
  return result.rows[0]!.database_now;
}

before(async () => {
  database = await pool.connect();
  await database.query('BEGIN');
  service = new PostgresRoleGrantAdministrationService(databaseUrl, database);
  repository = new PostgresAuditEventRepository(databaseUrl, database);
  await database.query(
    `INSERT INTO organizations (id, code, name, data_classification)
     VALUES ($1, $3, 'Audit A', 'synthetic'), ($2, $4, 'Audit B', 'synthetic')`,
    [organizationA, organizationB, `AUDIT-A-${organizationA}`, `AUDIT-B-${organizationB}`],
  );
  await database.query(
    `INSERT INTO territories (id, organization_id, code, name, kind, data_classification)
     VALUES ($1, $3, 'AUDIT-A', 'Audit territory A', 'region', 'synthetic'),
            ($2, $4, 'AUDIT-B', 'Audit territory B', 'region', 'synthetic')`,
    [territoryA, territoryB, organizationA, organizationB],
  );
  await database.query(
    `INSERT INTO territories (id, organization_id, parent_territory_id, code, name, kind, data_classification)
     VALUES ($1, $3, $4, 'AUDIT-CHILD', 'Audit territory child', 'district', 'synthetic'),
            ($2, $3, NULL, 'AUDIT-SIBLING', 'Audit territory sibling', 'region', 'synthetic')`,
    [territoryChildA, territorySiblingA, organizationA, territoryA],
  );
  await database.query(
    `INSERT INTO identity_users (id, organization_id, external_subject, display_name, is_active, data_classification)
     VALUES
       ($1, $6, $7, 'System actor', true, 'synthetic'),
       ($2, $6, $8, 'National actor', true, 'synthetic'),
       ($3, $6, $9, 'Auditor', true, 'synthetic'),
       ($4, $6, $10, 'Target A', true, 'synthetic'),
       ($5, $11, $12, 'Target B', true, 'synthetic')`,
    [
      systemActor,
      nationalActor,
      auditor,
      targetA,
      targetB,
      organizationA,
      `synthetic:audit-system:${systemActor}`,
      `synthetic:audit-national:${nationalActor}`,
      `synthetic:audit-auditor:${auditor}`,
      `synthetic:audit-target-a:${targetA}`,
      organizationB,
      `synthetic:audit-target-b:${targetB}`,
    ],
  );
  await database.query(
    `INSERT INTO user_role_grants (user_id, organization_id, role, scope, territory_id, effective_from)
     VALUES
       ($1, $4, 'system_admin', 'system', NULL, '2026-01-01T00:00:00.000Z'),
       ($2, $4, 'national_admin', 'national', NULL, '2026-01-01T00:00:00.000Z'),
       ($3, $4, 'auditor', 'territory', $5, '2026-01-01T00:00:00.000Z')`,
    [systemActor, nationalActor, auditor, organizationA, territoryA],
  );
});

after(async () => {
  await database.query('ROLLBACK');
  database.release();
  await pool.end();
});

test(
  'audited cross-organization creation and revocation are atomic and preserve UTC/request metadata',
  { concurrency: false },
  async () => {
    const at = new Date('2026-05-01T00:00:00.000Z');
    const created = await service.create(
      systemActor,
      'audit-request-cross-org',
      {
        userId: targetB,
        role: 'regional_director',
        scope: 'territory',
        territoryId: territoryB,
        effectiveFrom: '2026-04-01T00:00:00.000Z',
        effectiveUntil: null,
        reason: 'Synthetic cross-organization delegated director coverage.',
      },
      at,
    );
    firstGrantId = created.grant.id;
    firstAuditId = created.auditEvent.id;
    assert.equal(created.auditEvent.organizationId, organizationB);
    assert.equal(created.auditEvent.actorOrganizationId, organizationA);
    assert.equal(created.auditEvent.actorUserId, systemActor);
    assert.equal(created.auditEvent.requestId, 'audit-request-cross-org');
    assert.equal(created.auditEvent.newState?.['effectiveFrom'], '2026-04-01T00:00:00.000Z');
    assert.equal(created.auditEvent.oldState, null);
    assert.match(created.auditEvent.occurredAt, /Z$/);

    const revoked = await service.revoke(
      systemActor,
      'audit-request-revoke',
      created.grant.id,
      {
        operation: 'revoke',
        effectiveUntil: '2026-06-15T00:00:00.000Z',
        reason: 'Synthetic authority window closed.',
      },
      at,
    );
    assert.equal(revoked.auditEvent.action, 'user_role_grant.revoked');
    assert.equal(revoked.auditEvent.oldState?.['effectiveUntil'], null);
    assert.equal(revoked.auditEvent.newState?.['effectiveUntil'], '2026-06-15T00:00:00.000Z');
    await assert.rejects(
      service.revoke(
        systemActor,
        'audit-request-double-revoke',
        created.grant.id,
        {
          operation: 'revoke',
          effectiveUntil: '2026-06-14T00:00:00.000Z',
          reason: 'A grant must not be revoked twice.',
        },
        at,
      ),
      (error: unknown) => (error as { kind?: string }).kind === 'NOT_FOUND',
    );

    const before = await database.query('SELECT count(*)::int AS count FROM audit_events');
    const grantsBefore = await database.query(
      `SELECT count(*)::int AS count FROM user_role_grants
     WHERE user_id = $1 AND role = 'regional_director' AND territory_id = $2`,
      [targetB, territoryB],
    );
    await assert.rejects(
      service.create(
        systemActor,
        'audit-overlap',
        {
          userId: targetB,
          role: 'regional_director',
          scope: 'territory',
          territoryId: territoryB,
          effectiveFrom: '2026-06-10T00:00:00.000Z',
          effectiveUntil: null,
          reason: 'This overlaps and must roll back.',
        },
        at,
      ),
      (error: unknown) => (error as { kind?: string }).kind === 'CONFLICT',
    );
    const afterRollback = await database.query('SELECT count(*)::int AS count FROM audit_events');
    const grantsAfter = await database.query(
      `SELECT count(*)::int AS count FROM user_role_grants
     WHERE user_id = $1 AND role = 'regional_director' AND territory_id = $2`,
      [targetB, territoryB],
    );
    assert.equal(afterRollback.rows[0]?.count, before.rows[0]?.count);
    assert.equal(grantsAfter.rows[0]?.count, grantsBefore.rows[0]?.count);
    const revocation = {
      operation: 'revoke' as const,
      effectiveUntil: '2026-06-10T00:00:00.000Z',
      reason: 'Scope discovery must not be possible.',
    };
    await assert.rejects(
      service.revoke(auditor, 'audit-hidden-existing', firstGrantId, revocation, at),
      (error: unknown) => (error as { kind?: string }).kind === 'NOT_FOUND',
    );
    await assert.rejects(
      service.revoke(auditor, 'audit-hidden-unknown', randomUUID(), revocation, at),
      (error: unknown) => (error as { kind?: string }).kind === 'NOT_FOUND',
    );
  },
);

test(
  'a scheduled grant is explicitly cancelled without altering its original validity window',
  { concurrency: false },
  async () => {
    const at = await databaseNow();
    const effectiveFrom = new Date(at.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const scheduled = await service.create(
      systemActor,
      'audit-request-scheduled',
      {
        userId: targetB,
        role: 'maintenance_engineer',
        scope: 'territory',
        territoryId: territoryB,
        effectiveFrom,
        effectiveUntil: null,
        reason: 'Synthetic scheduled maintenance assignment.',
      },
      at,
    );
    const cancelled = await service.revoke(
      systemActor,
      'audit-request-cancel',
      scheduled.grant.id,
      { operation: 'cancel', reason: 'The scheduled assignment is no longer required.' },
      at,
    );
    assert.equal(cancelled.auditEvent.action, 'user_role_grant.cancelled');
    assert.equal(cancelled.grant.effectiveFrom, effectiveFrom);
    assert.equal(cancelled.grant.effectiveUntil, null);
    assert.equal(cancelled.grant.cancelledAt, at.toISOString());
    assert.equal(cancelled.auditEvent.oldState?.['cancelledAt'], null);
    assert.equal(cancelled.auditEvent.newState?.['cancelledAt'], cancelled.grant.cancelledAt);
    // Cancellation removes the range from the partial exclusion constraint,
    // allowing a corrected schedule for the same role/scope to be recorded.
    const replacement = await service.create(
      systemActor,
      'audit-request-replacement',
      {
        userId: targetB,
        role: 'maintenance_engineer',
        scope: 'territory',
        territoryId: territoryB,
        effectiveFrom,
        effectiveUntil: null,
        reason: 'Corrected synthetic scheduled maintenance assignment.',
      },
      at,
    );
    assert.equal(replacement.grant.cancelledAt, null);
    await assert.rejects(
      service.revoke(
        systemActor,
        'audit-request-double-cancel',
        scheduled.grant.id,
        { operation: 'cancel', reason: 'Cancelled grants cannot be cancelled twice.' },
        at,
      ),
      (error: unknown) => (error as { kind?: string }).kind === 'NOT_FOUND',
    );
    const alreadyEffectiveFrom = new Date(at.getTime() - 60 * 1000);
    const alreadyEffective = await service.create(
      systemActor,
      'audit-request-already-effective',
      {
        userId: targetB,
        role: 'hydrologist',
        scope: 'territory',
        territoryId: territoryB,
        effectiveFrom: alreadyEffectiveFrom.toISOString(),
        effectiveUntil: null,
        reason: 'Synthetic active grant for database-time boundary testing.',
      },
      at,
    );
    const auditCountBeforeRejectedCancel = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM audit_events',
    );
    await assert.rejects(
      service.revoke(
        systemActor,
        'audit-request-clock-divergence',
        alreadyEffective.grant.id,
        { operation: 'cancel', reason: 'Application clock must not override database time.' },
        new Date(alreadyEffectiveFrom.getTime() - 60 * 1000),
      ),
      (error: unknown) => (error as { kind?: string }).kind === 'VALIDATION_ERROR',
    );
    const auditCountAfterRejectedCancel = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM audit_events',
    );
    assert.equal(
      auditCountAfterRejectedCancel.rows[0]!.count,
      auditCountBeforeRejectedCancel.rows[0]!.count,
    );
  },
);

test(
  'same-organization national authority works while auditors and self-escalation are denied',
  { concurrency: false },
  async () => {
    const at = new Date('2026-05-01T00:00:00.000Z');
    const created = await service.create(
      nationalActor,
      'audit-request-national',
      {
        userId: targetA,
        role: 'district_operator',
        scope: 'territory',
        territoryId: territoryA,
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        reason: 'Synthetic district support assignment.',
      },
      at,
    );
    assert.equal(created.auditEvent.organizationId, organizationA);
    await assert.rejects(
      service.create(
        auditor,
        'audit-request-denied',
        {
          userId: targetA,
          role: 'district_operator',
          scope: 'territory',
          territoryId: territoryA,
          effectiveFrom: '2026-07-01T00:00:00.000Z',
          reason: 'Auditor must remain read-only.',
        },
        at,
      ),
      (error: unknown) => (error as { kind?: string }).kind === 'FORBIDDEN',
    );
    await assert.rejects(
      service.create(
        nationalActor,
        'audit-cross-org-denied',
        {
          userId: targetB,
          role: 'district_operator',
          scope: 'territory',
          territoryId: territoryB,
          effectiveFrom: '2026-07-01T00:00:00.000Z',
          reason: 'National authority must remain organization-scoped.',
        },
        at,
      ),
      (error: unknown) => (error as { kind?: string }).kind === 'NOT_FOUND',
    );
    await assert.rejects(
      service.create(
        nationalActor,
        'audit-higher-role-denied',
        {
          userId: targetA,
          role: 'system_admin',
          scope: 'system',
          territoryId: null,
          effectiveFrom: '2026-07-01T00:00:00.000Z',
          reason: 'A national administrator cannot grant a higher role.',
        },
        at,
      ),
      (error: unknown) => (error as { kind?: string }).kind === 'FORBIDDEN',
    );
    await assert.rejects(
      service.create(
        nationalActor,
        'audit-unknown-target',
        {
          userId: randomUUID(),
          role: 'district_operator',
          scope: 'territory',
          territoryId: territoryA,
          effectiveFrom: '2026-07-01T00:00:00.000Z',
          reason: 'Unknown users must fail closed.',
        },
        at,
      ),
      (error: unknown) => (error as { kind?: string }).kind === 'NOT_FOUND',
    );
    await assert.rejects(
      service.create(
        randomUUID(),
        'audit-unknown-actor',
        {
          userId: targetA,
          role: 'district_operator',
          scope: 'territory',
          territoryId: territoryA,
          effectiveFrom: '2026-07-01T00:00:00.000Z',
          reason: 'Unknown actors must fail closed.',
        },
        at,
      ),
      (error: unknown) => (error as { kind?: string }).kind === 'FORBIDDEN',
    );
    await assert.rejects(
      service.create(
        systemActor,
        'audit-request-self',
        {
          userId: systemActor,
          role: 'national_admin',
          scope: 'national',
          territoryId: null,
          effectiveFrom: '2026-07-01T00:00:00.000Z',
          reason: 'Self escalation must be denied.',
        },
        at,
      ),
      (error: unknown) => (error as { kind?: string }).kind === 'FORBIDDEN',
    );
  },
);

test(
  'audit events are append-only and cursor pagination does not lose equal-timestamp records',
  { concurrency: false },
  async () => {
    const fixedTime = '2026-08-01T00:00:00.000Z';
    const manualResourceIds = [randomUUID(), randomUUID()];
    const manualEventIds: string[] = [];
    for (const resourceId of manualResourceIds) {
      const inserted = await database.query<{ id: string }>(
        `INSERT INTO audit_events
        (organization_id, territory_id, actor_user_id, actor_organization_id, action, resource, resource_id,
         new_state, reason, request_id, occurred_at, data_classification, provenance)
       VALUES ($1, $2, $3, $1, 'user_role_grant.created', 'user_role_grant', $4,
               '{}'::jsonb, 'Synthetic pagination fixture.', $5, $6, 'synthetic', 'test')
       RETURNING id`,
        [organizationA, territoryA, systemActor, resourceId, `pagination-${resourceId}`, fixedTime],
      );
      manualEventIds.push(inserted.rows[0]!.id);
    }
    await expectConstraintFailure(() =>
      database.query('UPDATE audit_events SET reason = $2 WHERE id = $1', [
        firstAuditId,
        'not permitted',
      ]),
    );
    await expectConstraintFailure(() =>
      database.query(
        `INSERT INTO user_role_grants
         (user_id, organization_id, role, scope, territory_id, effective_from, created_at, cancelled_at)
         VALUES ($1, $2, 'hydrologist', 'territory', $3,
                 '2027-01-01T00:00:00Z', '2025-01-01T00:00:00Z', '2027-01-01T00:00:00Z')`,
        [targetA, organizationA, territoryA],
      ),
    );
    await expectConstraintFailure(() =>
      database.query(
        `INSERT INTO user_role_grants
         (user_id, organization_id, role, scope, territory_id, effective_from, created_at, cancelled_at)
         VALUES ($1, $2, 'maintenance_engineer', 'territory', $3,
                 '2028-01-01T00:00:00Z', '2027-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        [targetA, organizationA, territoryA],
      ),
    );
    await expectConstraintFailure(() =>
      database.query('DELETE FROM audit_events WHERE id = $1', [firstAuditId]),
    );
    await expectConstraintFailure(() =>
      database.query(
        `INSERT INTO audit_events
        (organization_id, territory_id, actor_user_id, actor_organization_id, action, resource, resource_id,
         reason, request_id, data_classification, provenance)
       VALUES ($1, $2, $3, $1, 'user_role_grant.created', 'user_role_grant', $4,
               'invalid empty state', 'empty-state', 'synthetic', 'test')`,
        [organizationA, territoryA, systemActor, randomUUID()],
      ),
    );
    await expectConstraintFailure(() =>
      database.query(
        `INSERT INTO audit_events
        (organization_id, territory_id, actor_user_id, actor_organization_id, action, resource, resource_id,
         new_state, reason, request_id, data_classification, provenance)
       VALUES ($1, $2, $3, $1, 'report.generated', 'report', $4,
               $5::jsonb, 'oversized state must be rejected', 'oversized-state', 'synthetic', 'test')`,
        [
          organizationA,
          territoryA,
          systemActor,
          randomUUID(),
          JSON.stringify({ payload: 'x'.repeat(auditStateMaximumBytes) }),
        ],
      ),
    );
    const first = await repository.list({
      territoryId: territoryA,
      actorUserId: systemActor,
      limit: 1,
    });
    assert.equal(first.events.length, 1);
    assert.ok(first.nextCursor);
    const second = await repository.list({
      territoryId: territoryA,
      actorUserId: systemActor,
      limit: 100,
      cursor: first.nextCursor!,
    });
    assert.ok(second.events.every((event) => event.id !== first.events[0]?.id));
    const seen = new Set([...first.events, ...second.events].map((event) => event.id));
    assert.ok(manualEventIds.every((id) => seen.has(id)));
    const filtered = await repository.list({
      territoryId: territoryA,
      actorUserId: systemActor,
      action: 'user_role_grant.created',
      resource: 'user_role_grant',
      occurredFrom: fixedTime,
      occurredUntil: '2026-08-02T00:00:00.000Z',
      limit: 100,
    });
    assert.deepEqual(new Set(filtered.events.map((event) => event.id)), new Set(manualEventIds));
  },
);

test(
  'audit explorer includes selected descendants, excludes siblings, and applies exact compact filters',
  { concurrency: false },
  async () => {
    const occurredAt = '2026-09-01T00:00:00.000Z';
    const childResource = randomUUID();
    const siblingResource = randomUUID();
    const requestId = `audit-explorer-${childResource}`;
    const insert = async (territoryId: string, resourceId: string, id: string) =>
      database.query(
        `INSERT INTO audit_events
        (id, organization_id, territory_id, actor_user_id, actor_organization_id, action, resource, resource_id,
         old_state, new_state, reason, request_id, occurred_at, data_classification, provenance)
         VALUES ($1, $2, $3, $4, $2, 'user_role_grant.created', 'user_role_grant', $5,
                 '{"before":"state"}'::jsonb, '{"after":"state"}'::jsonb, 'Explorer fixture.', $6, $7, 'synthetic', 'test')`,
        [id, organizationA, territoryId, systemActor, resourceId, requestId, occurredAt],
      );
    const childEventId = randomUUID();
    const siblingEventId = randomUUID();
    await insert(territoryChildA, childResource, childEventId);
    await insert(territorySiblingA, siblingResource, siblingEventId);
    const filtered = await repository.list({
      territoryId: territoryA,
      actorUserId: systemActor,
      action: 'user_role_grant.created',
      resource: 'user_role_grant',
      resourceId: childResource,
      requestId,
      occurredFrom: occurredAt,
      occurredUntil: '2026-09-02T00:00:00.000Z',
      limit: 25,
    });
    assert.deepEqual(
      filtered.events.map((event) => event.id),
      [childEventId],
    );
    assert.equal('oldState' in filtered.events[0]!, false);
    assert.equal('newState' in filtered.events[0]!, false);
    const detail = await repository.findById(childEventId, territoryA);
    assert.deepEqual(detail?.oldState, { before: 'state' });
    assert.deepEqual(detail?.newState, { after: 'state' });
    assert.equal(await repository.findById(siblingEventId, territoryA), null);
  },
);

test('audit explorer default scope prefers an effective territory grant, then a deterministic organization root', async () => {
  const evaluatedAt = new Date('2026-06-01T00:00:00.000Z');
  assert.equal(
    await repository.resolveDefaultTerritory(auditor, organizationA, evaluatedAt),
    territoryA,
  );
  assert.equal(
    await repository.resolveDefaultTerritory(nationalActor, organizationA, evaluatedAt),
    territoryA,
  );
  assert.equal(
    await repository.resolveDefaultTerritory(systemActor, organizationA, evaluatedAt),
    territoryA,
  );
});

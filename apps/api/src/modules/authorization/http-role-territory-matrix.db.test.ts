import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { createApp } from '../../app.js';
import { seedSystemMetadata } from '../../db/seed.js';
import { PostgresAllocationPlanService } from '../allocation-plans/service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests');

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const organizationId = 'a1000000-0000-4000-8000-000000000001';
const territoryA = 'a2000000-0000-4000-8000-000000000004';
const territoryB = 'a2000000-0000-4000-8000-000000000005';
const hydrologist = 'a3000000-0000-4000-8000-000000000006';
const maintenanceEngineer = 'a3000000-0000-4000-8000-000000000007';
const auditor = 'a3000000-0000-4000-8000-000000000008';
const seededRoleUsers = [
  ['a3000000-0000-4000-8000-000000000001', 'system_admin'],
  ['a3000000-0000-4000-8000-000000000002', 'national_admin'],
  ['a3000000-0000-4000-8000-000000000003', 'regional_director'],
  ['a3000000-0000-4000-8000-000000000004', 'basin_dispatcher'],
  ['a3000000-0000-4000-8000-000000000005', 'district_operator'],
  [hydrologist, 'hydrologist'],
  [maintenanceEngineer, 'maintenance_engineer'],
  [auditor, 'auditor'],
] as const;

function headers(userId: string, requestId: string) {
  return { 'x-isuv-user-id': userId, 'x-request-id': requestId };
}

async function oneId(sql: string, values: unknown[]): Promise<string> {
  const result = await pool.query<{ id: string }>(sql, values);
  assert.ok(result.rows[0]?.id, `expected a seeded fixture for: ${sql}`);
  return result.rows[0]!.id;
}

async function count(sql: string, values: unknown[]): Promise<number> {
  const result = await pool.query<{ count: string }>(sql, values);
  return Number(result.rows[0]!.count);
}

after(async () => {
  await pool.end();
});

test(
  'real HTTP authorization enforces role plus territory scope without enumerating or mutating denied targets',
  { concurrency: false },
  async () => {
    // The durable synthetic seed is the public, reproducible fixture used by the application.
    // Re-running it is deliberately idempotent and avoids an ad-hoc parallel authority model.
    await seedSystemMetadata(databaseUrl);

    const [sectionA, sectionB, incidentA, incidentB, deviceA, deviceB, governedPlan] =
      await Promise.all([
        oneId(
          "SELECT id FROM water_sections WHERE organization_id=$1 AND territory_id=$2 AND lifecycle='active' ORDER BY code LIMIT 1",
          [organizationId, territoryA],
        ),
        oneId(
          "SELECT id FROM water_sections WHERE organization_id=$1 AND territory_id=$2 AND lifecycle='active' ORDER BY code LIMIT 1",
          [organizationId, territoryB],
        ),
        oneId(
          'SELECT id FROM incidents WHERE organization_id=$1 AND territory_id=$2 ORDER BY created_at LIMIT 1',
          [organizationId, territoryA],
        ),
        oneId(
          'SELECT id FROM incidents WHERE organization_id=$1 AND territory_id=$2 ORDER BY created_at LIMIT 1',
          [organizationId, territoryB],
        ),
        oneId(
          'SELECT current.device_id AS id FROM device_health_current current WHERE current.organization_id=$1 AND current.territory_id=$2 ORDER BY current.device_id LIMIT 1',
          [organizationId, territoryA],
        ),
        oneId(
          `SELECT installation.device_id AS id
         FROM telemetry_device_installations installation
         WHERE installation.organization_id=$1 AND installation.territory_id=$2
           AND installation.effective_until IS NULL
         ORDER BY installation.device_id LIMIT 1`,
          [organizationId, territoryB],
        ),
        oneId(
          'SELECT id FROM allocation_plans WHERE organization_id=$1 ORDER BY created_at LIMIT 1',
          [organizationId],
        ),
      ]);

    const originalIdentityFlag = process.env.ISUV_ENABLE_LOCAL_IDENTITY;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.ISUV_ENABLE_LOCAL_IDENTITY = 'true';
    process.env.NODE_ENV = 'test';
    const allocationTransaction = await pool.connect();
    await allocationTransaction.query('BEGIN');
    const app = createApp(async () => undefined, false, {
      // The one allowed mutation remains visible for HTTP/audit assertions through this client
      // and is rolled back below.  Denial checks continue to use the real production service
      // boundary, authorization repository, identity repository, and HTTP routes.
      allocationPlanService: new PostgresAllocationPlanService(databaseUrl, allocationTransaction),
    });
    const requestIds = {
      allowedPlan: `p7-auth-allowed-plan-${randomUUID()}`,
      deniedPlan: `p7-auth-denied-plan-${randomUUID()}`,
      unknownPlan: `p7-auth-unknown-plan-${randomUUID()}`,
      deniedIncident: `p7-auth-denied-incident-${randomUUID()}`,
      deniedDevice: `p7-auth-denied-device-${randomUUID()}`,
      deniedHydrologist: `p7-auth-denied-hydrologist-${randomUUID()}`,
      deniedAuditor: `p7-auth-denied-auditor-${randomUUID()}`,
    };
    const territoryWriter = randomUUID();
    const territoryWriterGrant = randomUUID();
    try {
      for (const [userId, expectedRole] of seededRoleUsers) {
        const session = await app.inject({
          method: 'GET',
          url: '/api/v1/session',
          headers: headers(userId, `p7-auth-role-${expectedRole}-${randomUUID()}`),
        });
        assert.equal(session.statusCode, 200, `${expectedRole}: ${session.body}`);
        assert.ok(
          session
            .json()
            .session.currentGrants.some((grant: { role: string }) => grant.role === expectedRole),
          `${expectedRole} must be represented by an effective server-resolved grant`,
        );
      }

      // The durable seed intentionally has no district-scoped all-permissions role.  This
      // ephemeral, cleaned-up grant isolates the scope check from role denial: a director can
      // write only district A, never its sibling district B.
      await pool.query(
        `INSERT INTO identity_users
           (id, organization_id, external_subject, display_name, is_active, data_classification)
         VALUES ($1,$2,$3,$4,true,'synthetic')`,
        [
          territoryWriter,
          organizationId,
          `synthetic:p7-authorization-matrix:${territoryWriter}`,
          'P7 authorization matrix territory writer',
        ],
      );
      await pool.query(
        `INSERT INTO user_role_grants
           (id,user_id,organization_id,role,scope,territory_id,effective_from)
         VALUES ($1,$2,$3,'regional_director','territory',$4,'2026-01-01T00:00:00.000Z')`,
        [territoryWriterGrant, territoryWriter, organizationId, territoryA],
      );
      const allocationPayload = (waterSectionId: string, reason: string) => ({
        waterSectionId,
        effectiveFrom: '2035-01-01T00:00:00.000000Z',
        effectiveUntil: '2035-01-01T01:00:00.000000Z',
        entries: [
          {
            intervalStart: '2035-01-01T00:00:00.000000Z',
            intervalEnd: '2035-01-01T01:00:00.000000Z',
            plannedVolume: '3600',
            unit: 'm3',
            targetSemantics: 'whole_interval_target_no_proration',
          },
        ],
        reason,
      });

      // The territory-scoped director is permitted in district A.  This is a governed write:
      // allocation lifecycle database auditing must share its request ID.
      const allowed = await app.inject({
        method: 'POST',
        url: '/api/v1/allocation-plans',
        headers: headers(territoryWriter, requestIds.allowedPlan),
        payload: allocationPayload(sectionA, 'P7 authorization matrix allowed synthetic plan'),
      });
      assert.equal(allowed.statusCode, 200);
      const allowedPlanId = allowed.json().planVersion.planId as string;
      assert.ok(allowedPlanId);
      const allowedAudits = await allocationTransaction.query<{
        action: string;
        request_id: string;
      }>(
        'SELECT action::text, request_id FROM audit_events WHERE request_id=$1 ORDER BY occurred_at,id',
        [requestIds.allowedPlan],
      );
      assert.deepEqual(
        allowedAudits.rows.map((row) => row.action),
        [
          'allocation_plan.created',
          'allocation_plan_version.created',
          'allocation_plan_entry.created',
        ],
      );
      assert.ok(allowedAudits.rows.every((row) => row.request_id === requestIds.allowedPlan));

      // The same territory-scoped director is outside district B.  An existing B section and a
      // nonexistent section deliberately produce the same externally visible denial.
      const deniedPlan = await app.inject({
        method: 'POST',
        url: '/api/v1/allocation-plans',
        headers: headers(territoryWriter, requestIds.deniedPlan),
        payload: allocationPayload(sectionB, 'P7 authorization matrix denied cross-territory plan'),
      });
      const unknownPlan = await app.inject({
        method: 'POST',
        url: '/api/v1/allocation-plans',
        headers: headers(territoryWriter, requestIds.unknownPlan),
        payload: allocationPayload('f9000000-0000-4000-8000-000000000001', 'P7 unknown section'),
      });
      assert.equal(deniedPlan.statusCode, 404);
      assert.equal(unknownPlan.statusCode, 404);
      assert.deepEqual(
        { code: deniedPlan.json().error.code, message: deniedPlan.json().error.message },
        { code: unknownPlan.json().error.code, message: unknownPlan.json().error.message },
      );
      assert.equal(
        await count(
          'SELECT count(*)::text AS count FROM allocation_plans WHERE created_request_id=$1',
          [requestIds.deniedPlan],
        ),
        0,
      );
      assert.equal(
        await count('SELECT count(*)::text AS count FROM audit_events WHERE request_id=$1', [
          requestIds.deniedPlan,
        ]),
        0,
      );

      // Existing cross-territory incidents and devices are also nonenumerating and must not
      // append either timeline history or device-health/live-event provenance.
      const deniedIncident = await app.inject({
        method: 'POST',
        url: `/api/v1/incidents/${incidentB}/comments`,
        headers: headers(territoryWriter, requestIds.deniedIncident),
        payload: { body: 'P7 cross-territory attempt', reason: 'authorization matrix' },
      });
      assert.equal(deniedIncident.statusCode, 404);
      assert.equal(
        await count(
          'SELECT count(*)::text AS count FROM incident_timeline WHERE incident_id=$1 AND request_id=$2',
          [incidentB, requestIds.deniedIncident],
        ),
        0,
      );
      assert.equal(
        await count('SELECT count(*)::text AS count FROM audit_events WHERE request_id=$1', [
          requestIds.deniedIncident,
        ]),
        0,
      );

      const deniedDeviceSourceEventId = `p7-auth-denied-device-${randomUUID()}`;
      const deviceCurrentBefore = await pool.query<{
        latest_event_id: string;
        last_seen_received_at: string;
      }>(
        `SELECT latest_event_id::text, last_seen_received_at::text
         FROM device_health_current WHERE device_id=$1`,
        [deviceB],
      );
      const deniedDevice = await app.inject({
        method: 'POST',
        url: '/api/v1/device-health/events',
        headers: headers(territoryWriter, requestIds.deniedDevice),
        payload: {
          deviceId: deviceB,
          sourceSystem: 'p7-authorization-matrix',
          sourceEventId: deniedDeviceSourceEventId,
          occurredAt: '2035-01-01T00:00:00.000000Z',
          connectionStatus: 'offline',
          deviceFault: 'none',
          faultCode: null,
          dataCondition: 'unconfigured',
          power: { state: 'unknown' },
          signal: { state: 'unknown' },
          provenance: 'synthetic:p7-authorization-matrix',
          dataClassification: 'synthetic',
        },
      });
      assert.equal(deniedDevice.statusCode, 404);
      assert.equal(
        await count(
          'SELECT count(*)::text AS count FROM device_health_events WHERE source_system=$1 AND source_event_id=$2',
          ['p7-authorization-matrix', deniedDeviceSourceEventId],
        ),
        0,
      );
      const deviceCurrentAfter = await pool.query<{
        latest_event_id: string;
        last_seen_received_at: string;
      }>(
        `SELECT latest_event_id::text, last_seen_received_at::text
         FROM device_health_current WHERE device_id=$1`,
        [deviceB],
      );
      assert.deepEqual(deviceCurrentAfter.rows, deviceCurrentBefore.rows);
      assert.equal(
        await count('SELECT count(*)::text AS count FROM audit_events WHERE request_id=$1', [
          requestIds.deniedDevice,
        ]),
        0,
      );
      assert.equal(
        await count(
          `SELECT count(*)::text AS count FROM device_live_event_journal journal
           JOIN device_health_events event ON event.id=journal.health_event_id
           WHERE event.source_system=$1 AND event.source_event_id=$2`,
          ['p7-authorization-matrix', deniedDeviceSourceEventId],
        ),
        0,
      );

      // Representative least-privilege behavior: hydrologists are allowed plan reads but not
      // incident writes; maintenance may read devices in its district; auditors may read audit
      // history but cannot create allocation plans.
      const hydrologistRead = await app.inject({
        method: 'GET',
        url: `/api/v1/allocation-plans/${governedPlan}/history`,
        headers: headers(hydrologist, `p7-auth-hydrologist-read-${randomUUID()}`),
      });
      assert.equal(hydrologistRead.statusCode, 200, hydrologistRead.body);
      const deniedHydrologist = await app.inject({
        method: 'POST',
        url: `/api/v1/incidents/${incidentA}/comments`,
        headers: headers(hydrologist, requestIds.deniedHydrologist),
        payload: { body: 'P7 hydrologist role denial', reason: 'authorization matrix' },
      });
      assert.equal(deniedHydrologist.statusCode, 404);
      assert.equal(
        await count(
          'SELECT count(*)::text AS count FROM incident_timeline WHERE incident_id=$1 AND request_id=$2',
          [incidentA, requestIds.deniedHydrologist],
        ),
        0,
      );
      assert.equal(
        (
          await app.inject({
            method: 'GET',
            url: `/api/v1/device-health/${deviceA}`,
            headers: headers(maintenanceEngineer, `p7-auth-maintenance-read-${randomUUID()}`),
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await app.inject({
            method: 'GET',
            url: `/api/v1/audit/events?territoryId=${territoryA}`,
            headers: headers(auditor, `p7-auth-auditor-read-${randomUUID()}`),
          })
        ).statusCode,
        200,
      );
      const deniedAuditor = await app.inject({
        method: 'POST',
        url: '/api/v1/allocation-plans',
        headers: headers(auditor, requestIds.deniedAuditor),
        payload: allocationPayload(sectionA, 'P7 auditor role denial'),
      });
      assert.equal(deniedAuditor.statusCode, 404);
      assert.equal(
        await count(
          'SELECT count(*)::text AS count FROM allocation_plans WHERE created_request_id=$1',
          [requestIds.deniedAuditor],
        ),
        0,
      );
    } finally {
      // The only successful mutation is transaction-bound.  Its audit records were asserted
      // above, then this rollback keeps the shared seeded database exactly reusable.
      await allocationTransaction.query('ROLLBACK');
      allocationTransaction.release();
      await pool.query('DELETE FROM user_role_grants WHERE id=$1', [territoryWriterGrant]);
      await pool.query('DELETE FROM identity_users WHERE id=$1', [territoryWriter]);
      await app.close();
      if (originalIdentityFlag === undefined) delete process.env.ISUV_ENABLE_LOCAL_IDENTITY;
      else process.env.ISUV_ENABLE_LOCAL_IDENTITY = originalIdentityFlag;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  },
);

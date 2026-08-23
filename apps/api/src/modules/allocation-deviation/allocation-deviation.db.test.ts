import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { allocationDeviationResultSchema } from '@isuv/contracts';
import { Pool } from 'pg';
import { PostgresAllocationPlanService } from '../allocation-plans/service.js';
import { PostgresObservationService } from '../observations/service.js';
import { PostgresAllocationDeviationService } from './service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests');
const pool = new Pool({ connectionString: databaseUrl });
after(async () => pool.end());

test(
  'governed bindings and tolerances produce one exact synthetic deviation without bypasses',
  { concurrency: false },
  async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const fixture = (
        await client.query<{
          section_id: string;
          station_id: string;
          sensor_id: string;
          device_id: string;
          installation_id: string;
        }>(`SELECT section_row.id section_id,station.id station_id,sensor.id sensor_id,sensor.device_id,installation.id installation_id
           FROM water_sections section_row
           JOIN monitoring_stations station ON station.junction_id=section_row.upstream_junction_id AND station.organization_id=section_row.organization_id AND station.territory_id=section_row.territory_id
           JOIN telemetry_device_installations installation ON installation.station_id=station.id AND installation.effective_until IS NULL
           JOIN telemetry_sensors sensor ON sensor.device_id=installation.device_id AND sensor.measurement_kind='discharge' AND sensor.unit='m3/s'
           WHERE section_row.lifecycle='active' ORDER BY section_row.code LIMIT 1`)
      ).rows[0]!;
      const creator = 'a3000000-0000-4000-8000-000000000001';
      const approver = 'a3000000-0000-4000-8000-000000000002';
      const intervalStart = '2030-01-01T00:00:00.000001Z';
      const intervalEnd = '2030-01-01T00:00:01.000002Z';
      const plans = new PostgresAllocationPlanService(databaseUrl, client);
      const draft = await plans.create(
        {
          waterSectionId: fixture.section_id,
          effectiveFrom: intervalStart,
          effectiveUntil: intervalEnd,
          entries: [
            {
              intervalStart,
              intervalEnd,
              plannedVolume: '1',
              unit: 'm3',
              targetSemantics: 'whole_interval_target_no_proration',
            },
          ],
          reason: 'synthetic allocation deviation DB fixture',
        },
        creator,
        'p3003-plan-create',
      );
      const entryId = (
        await client.query<{ id: string }>(
          'SELECT id FROM allocation_plan_entries WHERE plan_version_id=$1',
          [draft.id],
        )
      ).rows[0]!.id;
      await assert.rejects(
        plans.request(
          draft.planId,
          draft.version,
          'request without binding',
          creator,
          'p3003-no-binding',
        ),
        /binding/i,
      );
      await client.query('SAVEPOINT wrong_reference');
      await assert.rejects(
        client.query(
          `INSERT INTO allocation_plan_entry_measurement_bindings(entry_id,station_id,sensor_id,device_installation_id,method,reference_plane,purpose,data_classification,provenance,created_by_user_id,creation_reason,created_request_id)
           VALUES($1,$2,$3,$4,'direct_discharge','downstream','section_delivery','synthetic','synthetic:wrong reference plane',$5,'negative binding test','p3003-wrong-reference')`,
          [entryId, fixture.station_id, fixture.sensor_id, fixture.installation_id, creator],
        ),
        /measurement scope|binding/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT wrong_reference');
      const binding = (
        await client.query<{ id: string }>(
          `INSERT INTO allocation_plan_entry_measurement_bindings(entry_id,station_id,sensor_id,device_installation_id,method,reference_plane,purpose,data_classification,provenance,created_by_user_id,creation_reason,created_request_id)
           VALUES($1,$2,$3,$4,'direct_discharge','upstream','section_delivery','synthetic','synthetic:explicit plan-entry delivery measurement',$5,'bind synthetic plan entry','p3003-binding') RETURNING id`,
          [entryId, fixture.station_id, fixture.sensor_id, fixture.installation_id, creator],
        )
      ).rows[0]!;
      await client.query('SAVEPOINT immutable_binding');
      await assert.rejects(
        client.query(
          'UPDATE allocation_plan_entry_measurement_bindings SET provenance=provenance WHERE id=$1',
          [binding.id],
        ),
        /immutable/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT immutable_binding');
      await plans.request(
        draft.planId,
        draft.version,
        'request governed plan',
        creator,
        'p3003-plan-request',
      );
      await plans.approve(
        draft.planId,
        draft.version,
        { reason: 'approve synthetic plan', legalReference: 'SYNTHETIC-NON-AUTHORITATIVE' },
        approver,
        'p3003-plan-approve',
      );

      const authoring = new PostgresAllocationDeviationService(databaseUrl, client);
      const tolerancePolicy = await authoring.createTolerancePolicy(
        {
          waterSectionId: fixture.section_id,
          provenance: 'synthetic:asymmetric deviation limits for testing',
          reason: 'create synthetic tolerance',
        },
        creator,
        'p3003-tolerance',
      );
      await client.query('SAVEPOINT unbounded_tolerance');
      await assert.rejects(
        client.query(
          `INSERT INTO section_tolerance_policy_versions(policy_id,version,status,effective_from,effective_until,under_absolute_m3,over_absolute_m3,combination,applies_to_zero_plan,requested_by_user_id,request_reason,requested_request_id)
           VALUES($1,1,'requested',$2,NULL,'1','1','all',true,$3,'unbounded direct SQL','p3003-unbounded')`,
          [tolerancePolicy.id, intervalStart, creator],
        ),
        /null|effective_until/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT unbounded_tolerance');
      const toleranceRequest = {
        effectiveFrom: intervalStart,
        effectiveUntil: intervalEnd,
        underAbsoluteM3: '0.5',
        overAbsoluteM3: '0.5',
        combination: 'all' as const,
        appliesToZeroPlan: true,
        reason: 'request synthetic tolerance',
      };
      const toleranceVersion = await authoring.requestToleranceVersion(
        tolerancePolicy.id,
        toleranceRequest,
        creator,
        'p3003-tolerance-request',
      );
      await client.query('SAVEPOINT self_approval');
      await assert.rejects(
        authoring.approveToleranceVersion(
          tolerancePolicy.id,
          toleranceVersion.version,
          'self approval must be rejected',
          creator,
          'p3003-tolerance-self-approve',
        ),
        /invalid/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT self_approval');
      const approvedToleranceVersion = await authoring.approveToleranceVersion(
        tolerancePolicy.id,
        toleranceVersion.version,
        'approve synthetic tolerance',
        approver,
        'p3003-tolerance-approve',
      );
      const overlapVersion = await authoring.requestToleranceVersion(
        tolerancePolicy.id,
        { ...toleranceRequest, reason: 'overlap request' },
        creator,
        'p3003-overlap-request',
      );
      await client.query('SAVEPOINT overlap');
      await assert.rejects(
        authoring.approveToleranceVersion(
          tolerancePolicy.id,
          overlapVersion.version,
          'overlap approve',
          approver,
          'p3003-overlap-approve',
        ),
        /conflict/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT overlap');
      await client.query('SAVEPOINT immutable_tolerance');
      await assert.rejects(
        client.query(
          'UPDATE section_tolerance_policy_versions SET combination=combination WHERE id=$1',
          [approvedToleranceVersion.id],
        ),
        /immutable/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT immutable_tolerance');

      const observations = new PostgresObservationService(databaseUrl, client);
      const ingestValid = async (observedAt: string, value: string) => {
        const sourceEventId = randomUUID();
        const raw = await observations.ingest({
          sensorId: fixture.sensor_id,
          deviceId: fixture.device_id,
          measurementKind: 'discharge',
          sourceSystem: 'allocation-deviation-db-test',
          sourceEventId,
          observedAt,
          unit: 'm3/s',
          value,
          uncertainty: null,
          qualityState: 'unknown',
          qualityReason: 'awaiting synthetic validation',
          totalizerTransition: null,
          provenance: 'synthetic:allocation-deviation-db-test',
          measurementMethod: 'synthetic_direct_discharge_fixture',
        });
        return observations.correct(
          raw.observation.lineageId,
          {
            workflowState: 'corrected',
            value,
            uncertainty: null,
            qualityState: 'valid',
            qualityReason: null,
            totalizerTransition: null,
            provenance: 'synthetic:governed-allocation-deviation-db-test',
            correctionReason: 'validated synthetic allocation comparison fixture',
            measurementMethod: 'synthetic_direct_discharge_fixture',
          },
          creator,
          `p3003-observation-${sourceEventId}`,
        );
      };
      await ingestValid(intervalStart, '1');
      const last = await ingestValid(intervalEnd, '3');
      const service = new PostgresAllocationDeviationService(databaseUrl, client);
      const beforeTolerance = (
        await client.query<{ cutoff: string }>(
          `SELECT to_char(($1::timestamptz-interval '1 microsecond') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cutoff`,
          [approvedToleranceVersion.approvedAt],
        )
      ).rows[0]!.cutoff;
      assert.equal(
        (
          await service.deviation(draft.planId, {
            intervalStart,
            intervalEnd,
            knownAt: beforeTolerance,
          })
        ).outcome,
        'no_approved_tolerance',
      );
      const partial = await service.deviation(draft.planId, {
        intervalStart,
        intervalEnd: '2030-01-01T00:00:01.000001Z',
        knownAt: last.ingestedAt,
      });
      assert.equal(partial.outcome, 'plan_interval_not_exact');
      const result = allocationDeviationResultSchema.parse(
        await service.deviation(draft.planId, {
          intervalStart,
          intervalEnd,
          knownAt: last.ingestedAt,
        }),
      );
      assert.equal(result.outcome, 'computed');
      if (result.outcome === 'computed') {
        assert.equal(result.condition, 'over');
        assert.deepEqual(result.delta, {
          numerator: '500001',
          denominator: '500000',
          unit: 'm3',
        });
        assert.equal(result.planVersionId, draft.id);
        assert.equal(result.planEntryId, entryId);
        assert.equal(
          result.binding.provenance,
          'synthetic:explicit plan-entry delivery measurement',
        );
        assert.equal(result.actual.sourceRefs.length, 2);
        assert.equal(result.officialComplianceEligible, false);
      }
      const equivalentOffset = await service.deviation(draft.planId, {
        intervalStart: '2030-01-01T05:00:00.000001+05:00',
        intervalEnd: '2030-01-01T05:00:01.000002+05:00',
        knownAt: last.ingestedAt,
      });
      assert.equal(equivalentOffset.outcome, 'computed');
      const audits = await client.query<{ action: string }>(
        `SELECT action::text FROM audit_events WHERE resource_id=ANY($1::uuid[]) ORDER BY action`,
        [[binding.id, tolerancePolicy.id, approvedToleranceVersion.id]],
      );
      assert.deepEqual(
        audits.rows.map((row) => row.action),
        [
          'allocation_plan_entry_measurement_binding.created',
          'section_tolerance_policy.created',
          'section_tolerance_policy_version.approved',
          'section_tolerance_policy_version.requested',
        ],
      );
      const approvalAudit = await client.query<{
        old_status: string | null;
        new_status: string;
      }>(
        `SELECT old_state->>'status' old_status,new_state->>'status' new_status
         FROM audit_events WHERE resource_id=$1 AND action='section_tolerance_policy_version.approved'`,
        [approvedToleranceVersion.id],
      );
      assert.deepEqual(approvalAudit.rows, [{ old_status: 'requested', new_status: 'approved' }]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  },
);

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { auditActionSchema, auditResourceSchema } from '@isuv/contracts';
import { Pool, type PoolClient } from 'pg';
import { PostgresObservationService } from '../observations/service.js';
import { PostgresValidationService } from './service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests');
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
after(async () => pool.end());

async function expectDbReject(client: PoolClient, action: () => Promise<unknown>): Promise<void> {
  await client.query('SAVEPOINT expected_validation_failure');
  try {
    await assert.rejects(action());
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_validation_failure');
    await client.query('RELEASE SAVEPOINT expected_validation_failure');
  }
}

async function removeConcurrentFixture(input: {
  lineageIds: string[];
  profileId: string;
  approverId: string;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query(
      `DELETE FROM audit_events WHERE resource_id = $1
       OR resource_id IN (SELECT id FROM validation_profile_versions WHERE profile_id=$1)
       OR resource_id = ANY($2::uuid[])`,
      [input.profileId, input.lineageIds],
    );
    await client.query(
      'DELETE FROM observation_validation_executions WHERE lineage_id = ANY($1::uuid[])',
      [input.lineageIds],
    );
    await client.query('DELETE FROM observation_revisions WHERE lineage_id = ANY($1::uuid[])', [
      input.lineageIds,
    ]);
    await client.query('DELETE FROM observation_lineages WHERE id = ANY($1::uuid[])', [
      input.lineageIds,
    ]);
    await client.query('DELETE FROM validation_profile_versions WHERE profile_id=$1', [
      input.profileId,
    ]);
    await client.query('DELETE FROM validation_profiles WHERE id=$1', [input.profileId]);
    await client.query('DELETE FROM identity_users WHERE id=$1', [input.approverId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

test(
  'approved effective profile appends one audited validation revision; no policy defers without inventing validity',
  { concurrency: false },
  async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const fixture = await client.query<{
        organization_id: string;
        territory_id: string;
        sensor_id: string;
        device_id: string;
        actor_id: string;
      }>(
        `SELECT sensor.organization_id, installation.territory_id, sensor.id sensor_id, sensor.device_id,
       (SELECT id FROM identity_users user_row WHERE user_row.organization_id=sensor.organization_id AND user_row.is_active ORDER BY id LIMIT 1) actor_id
       FROM telemetry_sensors sensor JOIN telemetry_device_installations installation ON installation.device_id=sensor.device_id AND installation.effective_until IS NULL
       WHERE sensor.measurement_kind='stage' LIMIT 1`,
      );
      const row = fixture.rows[0]!;
      const approver = randomUUID();
      await client.query(
        `INSERT INTO identity_users (id,organization_id,external_subject,display_name,data_classification) VALUES ($1,$2,$3,'Validation approver','synthetic')`,
        [approver, row.organization_id, `synthetic:validation-approver:${approver}`],
      );
      const observationService = new PostgresObservationService(databaseUrl, client);
      const validationService = new PostgresValidationService(databaseUrl, client);
      const precursor = await observationService.ingest(
        {
          sensorId: row.sensor_id,
          deviceId: row.device_id,
          measurementKind: 'stage',
          sourceSystem: 'validation-db-test',
          sourceEventId: randomUUID(),
          observedAt: '2026-08-23T00:00:00.000000Z',
          unit: 'm',
          value: '2.400000000001',
          uncertainty: null,
          qualityState: 'unknown',
          qualityReason: 'prior raw sequence evidence only',
          totalizerTransition: null,
          provenance: 'synthetic-db-test',
          measurementMethod: 'unconfigured',
        },
        row.territory_id,
      );
      const raw = await observationService.ingest(
        {
          sensorId: row.sensor_id,
          deviceId: row.device_id,
          measurementKind: 'stage',
          sourceSystem: 'validation-db-test',
          sourceEventId: randomUUID(),
          observedAt: '2026-08-23T00:00:00.123456Z',
          unit: 'm',
          value: '2.500000000001',
          uncertainty: null,
          qualityState: 'unknown',
          qualityReason: 'raw pending configured validation',
          totalizerTransition: null,
          provenance: 'synthetic-db-test',
          measurementMethod: 'unconfigured',
        },
        row.territory_id,
      );
      const deferred = await validationService.validate(
        raw.observation.lineageId,
        row.territory_id,
        row.actor_id,
        'validation-no-profile',
        '2026-08-23T00:00:01.123457Z',
      );
      assert.deepEqual(
        {
          outcome: deferred.outcome,
          deferReason: deferred.deferReason,
          quality: deferred.qualityState,
          coverage: deferred.coverageState,
        },
        {
          outcome: 'deferred',
          deferReason: 'no_approved_profile',
          quality: 'unknown',
          coverage: 'unconfigured',
        },
      );
      const draft = await validationService.createProfile(
        {
          organizationId: row.organization_id,
          territoryId: row.territory_id,
          sensorId: row.sensor_id,
          measurementKind: 'stage',
          dataClassification: 'synthetic',
          name: `exact-db-${randomUUID()}`,
          effectiveFrom: '2026-08-23T00:00:00.000000Z',
          rules: {
            staleAfterSeconds: 3600,
            maximumRatePerSecond: '100000',
            minimumValue: '0',
            maximumValue: '10',
            allowBootstrapWithoutPrior: true,
          },
          reason: 'synthetic validation test profile',
        },
        row.actor_id,
        'validation-profile-create',
      );
      await assert.rejects(
        validationService.approveVersion(
          draft.profileId,
          1,
          row.territory_id,
          'self approval forbidden',
          row.actor_id,
          'validation-self-approval',
        ),
        /author/,
      );
      const approved = await validationService.approveVersion(
        draft.profileId,
        1,
        row.territory_id,
        'independent synthetic approval',
        approver,
        'validation-approval',
      );
      assert.equal(approved.status, 'approved');
      assert.equal(approved.syntheticNonAuthoritative, true);
      const bootstrap = await validationService.validate(
        precursor.observation.lineageId,
        row.territory_id,
        row.actor_id,
        'validation-bootstrap',
        '2026-08-23T00:00:01.000000Z',
      );
      assert.deepEqual(
        {
          outcome: bootstrap.outcome,
          deferReason: bootstrap.deferReason,
          revision: bootstrap.observation?.revision,
        },
        { outcome: 'applied', deferReason: null, revision: 2 },
      );
      const applied = await validationService.validate(
        raw.observation.lineageId,
        row.territory_id,
        row.actor_id,
        'validation-apply',
        '2026-08-23T00:00:01.123457Z',
      );
      assert.equal(applied.outcome, 'applied');
      assert.equal(applied.observation?.workflowState, 'automatically_validated');
      assert.equal(applied.observation?.qualityState, 'valid');
      assert.equal(applied.observation?.observedAt, '2026-08-23T00:00:00.123456Z');
      const replay = await validationService.validate(
        raw.observation.lineageId,
        row.territory_id,
        row.actor_id,
        'validation-replay',
        '2026-08-23T00:00:01.123457Z',
      );
      assert.equal(replay.outcome, 'applied');
      assert.equal(replay.observation?.id, applied.observation?.id);
      const audit = await client.query<{ old_state: unknown; new_state: unknown }>(
        `SELECT old_state,new_state FROM audit_events WHERE resource_id=$1 AND action='observation.automatically_validated'`,
        [applied.observation?.id],
      );
      assert.equal(audit.rowCount, 1);
      assert.equal(JSON.stringify(audit.rows[0]).includes('rawPayloadHash'), false);
      assert.equal(JSON.stringify(audit.rows[0]).includes('rate_exceeds'), false);
      assert.equal(
        auditActionSchema.parse('observation.automatically_validated'),
        'observation.automatically_validated',
      );
      assert.equal(auditResourceSchema.parse('validation_profile'), 'validation_profile');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  },
);

test(
  'profile lifecycle rejects direct approval and execution references must belong to their lineage',
  { concurrency: false },
  async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const fixture = await client.query<{
        organization_id: string;
        territory_id: string;
        sensor_id: string;
        actor_id: string;
      }>(
        `SELECT sensor.organization_id,installation.territory_id,sensor.id sensor_id,(SELECT id FROM identity_users user_row WHERE user_row.organization_id=sensor.organization_id AND user_row.is_active ORDER BY id LIMIT 1) actor_id FROM telemetry_sensors sensor JOIN telemetry_device_installations installation ON installation.device_id=sensor.device_id AND installation.effective_until IS NULL WHERE sensor.measurement_kind='stage' LIMIT 1`,
      );
      const row = fixture.rows[0]!;
      const validationService = new PostgresValidationService(databaseUrl, client);
      const distinctApprover = randomUUID();
      await client.query(
        `INSERT INTO identity_users (id,organization_id,external_subject,display_name,data_classification)
       VALUES ($1,$2,$3,'Distinct direct approver','synthetic')`,
        [
          distinctApprover,
          row.organization_id,
          `synthetic:validation-direct-approver:${distinctApprover}`,
        ],
      );
      const draft = await validationService.createProfile(
        {
          organizationId: row.organization_id,
          territoryId: row.territory_id,
          sensorId: row.sensor_id,
          measurementKind: 'stage',
          dataClassification: 'synthetic',
          name: `lifecycle-${randomUUID()}`,
          effectiveFrom: '2026-08-24T00:00:00.000000Z',
          rules: { frozenAfterCount: 2 },
          reason: 'lifecycle test',
        },
        row.actor_id,
        'lifecycle-create',
      );
      await expectDbReject(client, () =>
        client.query(
          `UPDATE validation_profile_versions SET status='approved',approved_by_user_id=$2,approved_at=clock_timestamp(),approval_reason='direct' WHERE id=$1`,
          [draft.id, row.actor_id],
        ),
      );
      await expectDbReject(client, () =>
        client.query(
          `INSERT INTO validation_profile_versions (profile_id,version,status,effective_from,rules,drafted_by_user_id,approved_by_user_id,approved_at,approval_reason) VALUES ($1,2,'approved','2026-08-25T00:00:00Z','{"staleAfterSeconds":1}'::jsonb,$2,$3,clock_timestamp(),'direct')`,
          [draft.profileId, row.actor_id, distinctApprover],
        ),
      );
      await expectDbReject(client, () =>
        client.query(
          `INSERT INTO validation_profiles (organization_id,territory_id,sensor_id,measurement_kind,data_classification,name)
           VALUES ($1,$2,$3,'stage','synthetic','same scope, different name')`,
          [row.organization_id, row.territory_id, row.sensor_id],
        ),
      );
      const malformed = await client.query<{ id: string }>(
        `INSERT INTO validation_profile_versions (profile_id,version,effective_from,rules,drafted_by_user_id)
         VALUES ($1,2,'2026-08-26T00:00:00Z','{"unknownRule":1}'::jsonb,$2) RETURNING id`,
        [draft.profileId, row.actor_id],
      );
      await expectDbReject(client, () =>
        client.query(
          `UPDATE validation_profile_versions SET status='approved',approved_by_user_id=$2,approved_at=clock_timestamp(),approval_reason='malformed direct approval' WHERE id=$1`,
          [malformed.rows[0]?.id, distinctApprover],
        ),
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  },
);

test(
  'effective system administrators may govern a foreign organization; national and ordinary actors may not',
  { concurrency: false },
  async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const targets = await client.query<{
        organization_id: string;
        territory_id: string;
        sensor_id: string;
      }>(
        `SELECT sensor.organization_id, installation.territory_id, sensor.id sensor_id
       FROM telemetry_sensors sensor JOIN telemetry_device_installations installation ON installation.device_id=sensor.device_id AND installation.effective_until IS NULL
       WHERE sensor.measurement_kind='stage' ORDER BY sensor.id LIMIT 3`,
      );
      const [allowedTarget, nationalTarget, ordinaryTarget] = targets.rows;
      assert.ok(allowedTarget && nationalTarget && ordinaryTarget);
      const actorOrganizationId = randomUUID();
      const authorId = randomUUID();
      const approverId = randomUUID();
      const nationalId = randomUUID();
      const ordinaryId = randomUUID();
      await client.query(
        `INSERT INTO organizations (id,code,name,data_classification) VALUES ($1,$2,'Cross-organization validation actors','synthetic')`,
        [actorOrganizationId, `VAL-XORG-${randomUUID()}`],
      );
      for (const [id, subject, name] of [
        [authorId, 'system-author', 'System author'],
        [approverId, 'system-approver', 'System approver'],
        [nationalId, 'national-actor', 'National actor'],
        [ordinaryId, 'ordinary-actor', 'Ordinary actor'],
      ] as const)
        await client.query(
          `INSERT INTO identity_users (id,organization_id,external_subject,display_name,data_classification)
         VALUES ($1,$2,$3,$4,'synthetic')`,
          [id, actorOrganizationId, `synthetic:${subject}:${id}`, name],
        );
      for (const userId of [authorId, approverId])
        await client.query(
          `INSERT INTO user_role_grants (user_id,organization_id,role,scope,effective_from)
         VALUES ($1,$2,'system_admin','system',clock_timestamp() - interval '1 minute')`,
          [userId, actorOrganizationId],
        );
      await client.query(
        `INSERT INTO user_role_grants (user_id,organization_id,role,scope,effective_from)
       VALUES ($1,$2,'national_admin','national',clock_timestamp() - interval '1 minute')`,
        [nationalId, actorOrganizationId],
      );
      const service = new PostgresValidationService(databaseUrl, client);
      const crossDraft = await service.createProfile(
        {
          organizationId: allowedTarget.organization_id,
          territoryId: allowedTarget.territory_id,
          sensorId: allowedTarget.sensor_id,
          measurementKind: 'stage',
          dataClassification: 'synthetic',
          name: `cross-org-system-${randomUUID()}`,
          effectiveFrom: '2027-02-01T00:00:00.000000Z',
          rules: { minimumValue: '0', maximumValue: '10' },
          reason: 'authorized cross-organization system profile',
        },
        authorId,
        'cross-org-system-create',
      );
      const approved = await service.approveVersion(
        crossDraft.profileId,
        1,
        allowedTarget.territory_id,
        'independent cross-organization system approval',
        approverId,
        'cross-org-system-approve',
      );
      assert.equal(approved.status, 'approved');
      const audit = await client.query<{ actor_organization_id: string }>(
        `SELECT actor_organization_id FROM audit_events WHERE resource_id=$1 AND action='validation_profile_version.approved'`,
        [approved.id],
      );
      assert.equal(audit.rows[0]?.actor_organization_id, actorOrganizationId);
      const invalidTarget = (
        target: (typeof targets.rows)[number],
        actorId: string,
        label: string,
      ) =>
        service.createProfile(
          {
            organizationId: target.organization_id,
            territoryId: target.territory_id,
            sensorId: target.sensor_id,
            measurementKind: 'stage',
            dataClassification: 'synthetic',
            name: `${label}-${randomUUID()}`,
            effectiveFrom: '2027-02-01T00:00:00.000000Z',
            rules: { minimumValue: '0', maximumValue: '10' },
            reason: `${label} must remain organization local`,
          },
          actorId,
          `cross-org-${label}`,
        );
      await assert.rejects(invalidTarget(nationalTarget, nationalId, 'national'), /invalid/);
      await assert.rejects(invalidTarget(ordinaryTarget, ordinaryId, 'ordinary'), /invalid/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  },
);

test(
  'validator retries and concurrent correction remain linear under the shared lineage lock',
  { concurrency: false },
  async () => {
    const fixture = await pool.query<{
      organization_id: string;
      territory_id: string;
      sensor_id: string;
      device_id: string;
      actor_id: string;
    }>(`SELECT sensor.organization_id, installation.territory_id, sensor.id sensor_id, sensor.device_id,
      (SELECT id FROM identity_users user_row WHERE user_row.organization_id=sensor.organization_id AND user_row.is_active ORDER BY id LIMIT 1) actor_id
      FROM telemetry_sensors sensor JOIN telemetry_device_installations installation ON installation.device_id=sensor.device_id AND installation.effective_until IS NULL
      WHERE sensor.measurement_kind='stage' LIMIT 1`);
    const row = fixture.rows[0]!;
    const approverId = randomUUID();
    let profileId: string | undefined;
    const lineageIds: string[] = [];
    try {
      await pool.query(
        `INSERT INTO identity_users (id,organization_id,external_subject,display_name,data_classification)
       VALUES ($1,$2,$3,'Concurrent validation approver','synthetic')`,
        [approverId, row.organization_id, `synthetic:validation-concurrent-approver:${approverId}`],
      );
      const validation = new PostgresValidationService(databaseUrl);
      const observations = new PostgresObservationService(databaseUrl);
      const profile = await validation.createProfile(
        {
          organizationId: row.organization_id,
          territoryId: row.territory_id,
          sensorId: row.sensor_id,
          measurementKind: 'stage',
          dataClassification: 'synthetic',
          name: `concurrency-${randomUUID()}`,
          effectiveFrom: '2027-01-01T00:00:00.000000Z',
          rules: { minimumValue: '0', maximumValue: '10', allowBootstrapWithoutPrior: true },
          reason: 'concurrency test profile',
        },
        row.actor_id,
        'concurrency-profile-create',
      );
      profileId = profile.profileId;
      await validation.approveVersion(
        profile.profileId,
        1,
        row.territory_id,
        'independent concurrency approval',
        approverId,
        'concurrency-profile-approve',
      );
      const first = await observations.ingest(
        {
          sensorId: row.sensor_id,
          deviceId: row.device_id,
          measurementKind: 'stage',
          sourceSystem: 'validation-concurrency',
          sourceEventId: randomUUID(),
          observedAt: '2027-01-01T00:00:00.000001Z',
          unit: 'm',
          value: '2.0',
          uncertainty: null,
          qualityState: 'unknown',
          qualityReason: 'raw concurrent validator input',
          totalizerTransition: null,
          provenance: 'synthetic-db-test',
          measurementMethod: 'unconfigured',
        },
        row.territory_id,
      );
      lineageIds.push(first.observation.lineageId);
      const retries = await Promise.all([
        new PostgresValidationService(databaseUrl).validate(
          first.observation.lineageId,
          row.territory_id,
          row.actor_id,
          'concurrency-validate-a',
          '2027-01-01T00:00:01.000001Z',
        ),
        new PostgresValidationService(databaseUrl).validate(
          first.observation.lineageId,
          row.territory_id,
          row.actor_id,
          'concurrency-validate-b',
          '2027-01-01T00:00:01.000001Z',
        ),
      ]);
      assert.equal(
        retries.every((result) => result.outcome === 'applied'),
        true,
      );
      const oneExecution = await pool.query<{
        executions: string;
        revisions: string;
        audits: string;
      }>(
        `SELECT (SELECT count(*)::text FROM observation_validation_executions WHERE lineage_id=$1) executions,
       (SELECT count(*)::text FROM observation_revisions WHERE lineage_id=$1) revisions,
       (SELECT count(*)::text FROM audit_events WHERE action='observation.automatically_validated' AND resource_id=(SELECT id FROM observation_revisions WHERE lineage_id=$1 AND revision=2)) audits`,
        [first.observation.lineageId],
      );
      assert.deepEqual(oneExecution.rows[0], { executions: '1', revisions: '2', audits: '1' });

      const second = await observations.ingest(
        {
          sensorId: row.sensor_id,
          deviceId: row.device_id,
          measurementKind: 'stage',
          sourceSystem: 'validation-concurrency',
          sourceEventId: randomUUID(),
          observedAt: '2027-01-01T00:01:00.000001Z',
          unit: 'm',
          value: '2.1',
          uncertainty: null,
          qualityState: 'unknown',
          qualityReason: 'raw validator correction race',
          totalizerTransition: null,
          provenance: 'synthetic-db-test',
          measurementMethod: 'unconfigured',
        },
        row.territory_id,
      );
      lineageIds.push(second.observation.lineageId);
      await Promise.all([
        new PostgresValidationService(databaseUrl).validate(
          second.observation.lineageId,
          row.territory_id,
          row.actor_id,
          'concurrency-race-validation',
          '2027-01-01T00:01:01.000001Z',
        ),
        new PostgresObservationService(databaseUrl).correct(
          second.observation.lineageId,
          {
            workflowState: 'corrected',
            value: '2.1000',
            uncertainty: null,
            qualityState: 'valid',
            qualityReason: null,
            totalizerTransition: null,
            provenance: 'synthetic-human-correction',
            correctionReason: 'concurrent review',
          },
          row.actor_id,
          'concurrency-race-correction',
        ),
      ]);
      const linear = await pool.query<{ revision: number; state: string }>(
        'SELECT revision,state::text FROM observation_revisions WHERE lineage_id=$1 ORDER BY revision',
        [second.observation.lineageId],
      );
      assert.deepEqual(
        linear.rows.map((item) => item.revision),
        linear.rows.map((_, index) => index + 1),
      );
      assert.equal(linear.rows.filter((item) => item.state === 'corrected').length, 1);
      assert.ok(linear.rows.length === 2 || linear.rows.length === 3);
      const afterCorrection = await new PostgresValidationService(databaseUrl).validate(
        second.observation.lineageId,
        row.territory_id,
        row.actor_id,
        'concurrency-after-correction',
        '2027-01-01T00:01:02.000001Z',
      );
      assert.deepEqual(
        { outcome: afterCorrection.outcome, deferReason: afterCorrection.deferReason },
        { outcome: 'deferred', deferReason: 'current_revision_not_raw' },
      );
      for (const workflowState of ['estimated', 'rejected'] as const) {
        const raw = await observations.ingest(
          {
            sensorId: row.sensor_id,
            deviceId: row.device_id,
            measurementKind: 'stage',
            sourceSystem: 'validation-concurrency',
            sourceEventId: randomUUID(),
            observedAt:
              workflowState === 'estimated'
                ? '2027-01-01T00:02:00.000001Z'
                : '2027-01-01T00:03:00.000001Z',
            unit: 'm',
            value: '2.2',
            uncertainty: null,
            qualityState: 'unknown',
            qualityReason: `raw pending ${workflowState} review`,
            totalizerTransition: null,
            provenance: 'synthetic-db-test',
            measurementMethod: 'unconfigured',
          },
          row.territory_id,
        );
        lineageIds.push(raw.observation.lineageId);
        await observations.correct(
          raw.observation.lineageId,
          workflowState === 'estimated'
            ? {
                workflowState,
                value: '2.2',
                uncertainty: '0.1',
                uncertaintyMethod: 'synthetic uncertainty',
                qualityState: 'estimated',
                qualityReason: 'approved synthetic estimate',
                totalizerTransition: null,
                provenance: 'synthetic-human-estimate',
                correctionReason: 'concurrent terminal state',
                measurementMethod: 'synthetic estimate',
              }
            : {
                workflowState,
                value: '2.2',
                uncertainty: null,
                qualityState: 'invalid',
                qualityReason: 'approved synthetic rejection',
                totalizerTransition: null,
                provenance: 'synthetic-human-rejection',
                correctionReason: 'concurrent terminal state',
              },
          row.actor_id,
          `concurrency-${workflowState}`,
        );
        const deferred = await new PostgresValidationService(databaseUrl).validate(
          raw.observation.lineageId,
          row.territory_id,
          row.actor_id,
          `concurrency-after-${workflowState}`,
          '2027-01-01T00:04:00.000001Z',
        );
        assert.deepEqual(
          { outcome: deferred.outcome, deferReason: deferred.deferReason },
          { outcome: 'deferred', deferReason: 'current_revision_not_raw' },
        );
      }
    } finally {
      if (profileId) await removeConcurrentFixture({ lineageIds, profileId, approverId });
    }
  },
);

import type {
  AutomaticValidationResponse,
  CreateValidationProfileRequest,
  CreateValidationProfileVersionRequest,
  Observation,
  ValidationProfileVersion,
} from '@isuv/contracts';
import { validationRulesSchema } from '@isuv/contracts';
import { coverageState, evaluateObservationValidation, type ValidationRules } from '@isuv/domain';
import type { PoolClient } from 'pg';
import { withDatabase } from '../../db/client.js';
import { observationSelect, toObservation, type ObservationRow } from '../observations/service.js';
import { PostgresDeviceHealthService } from '../device-health/service.js';

function auditObservation(observation: Observation): Record<string, unknown> {
  return {
    id: observation.id,
    lineageId: observation.lineageId,
    revision: observation.revision,
    organizationId: observation.organizationId,
    territoryId: observation.territoryId,
    sensorId: observation.sensorId,
    measurementKind: observation.measurementKind,
    unit: observation.unit,
    observedAt: observation.observedAt,
    workflowState: observation.workflowState,
    qualityState: observation.qualityState,
    value: observation.value,
    dataClassification: observation.dataClassification,
    sourceSystem: observation.sourceSystem,
    sourceEventId: observation.sourceEventId,
  };
}
function auditProfileVersion(version: ValidationProfileVersion): Record<string, unknown> {
  return {
    id: version.id,
    profileId: version.profileId,
    version: version.version,
    organizationId: version.organizationId,
    territoryId: version.territoryId,
    sensorId: version.sensorId,
    measurementKind: version.measurementKind,
    dataClassification: version.dataClassification,
    status: version.status,
    effectiveFrom: version.effectiveFrom,
    effectiveUntil: version.effectiveUntil,
    syntheticNonAuthoritative: version.syntheticNonAuthoritative,
  };
}

interface ProfileVersionRow {
  id: string;
  profile_id: string;
  version: number;
  organization_id: string;
  territory_id: string;
  sensor_id: string;
  measurement_kind: ValidationProfileVersion['measurementKind'];
  data_classification: ValidationProfileVersion['dataClassification'];
  name: string;
  status: ValidationProfileVersion['status'];
  effective_from: string;
  effective_until: string | null;
  rules: unknown;
  drafted_by_user_id: string;
  drafted_at: string;
  approved_by_user_id: string | null;
  approved_at: string | null;
  approval_reason: string | null;
}
function profileVersion(row: ProfileVersionRow): ValidationProfileVersion {
  return {
    id: row.id,
    profileId: row.profile_id,
    version: row.version,
    organizationId: row.organization_id,
    territoryId: row.territory_id,
    sensorId: row.sensor_id,
    measurementKind: row.measurement_kind,
    dataClassification: row.data_classification,
    name: row.name,
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    rules: validationRulesSchema.parse(row.rules),
    draftedByUserId: row.drafted_by_user_id,
    draftedAt: row.drafted_at,
    approvedByUserId: row.approved_by_user_id,
    approvedAt: row.approved_at,
    approvalReason: row.approval_reason,
    syntheticNonAuthoritative: row.data_classification === 'synthetic',
  };
}
const profileVersionSelect = `SELECT version.id, version.profile_id, version.version, profile.organization_id, profile.territory_id,
  profile.sensor_id, profile.measurement_kind, profile.data_classification, profile.name, version.status,
  to_char(version.effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') effective_from,
  CASE WHEN version.effective_until IS NULL THEN NULL ELSE to_char(version.effective_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END effective_until,
  version.rules, version.drafted_by_user_id, to_char(version.drafted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') drafted_at,
  version.approved_by_user_id, CASE WHEN version.approved_at IS NULL THEN NULL ELSE to_char(version.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END approved_at,
  version.approval_reason FROM validation_profile_versions version JOIN validation_profiles profile ON profile.id=version.profile_id`;

export class ValidationError extends Error {
  public constructor(
    public readonly kind: 'NOT_FOUND' | 'VALIDATION_ERROR' | 'CONFLICT',
    message: string,
  ) {
    super(message);
  }
}
export class PostgresValidationService {
  public constructor(
    private readonly databaseUrl: string | undefined,
    private readonly transactionClient?: PoolClient,
  ) {}
  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    if (this.transactionClient) {
      await this.transactionClient.query('SAVEPOINT validation_operation');
      try {
        const result = await action(this.transactionClient);
        await this.transactionClient.query('RELEASE SAVEPOINT validation_operation');
        return result;
      } catch (error) {
        await this.transactionClient.query('ROLLBACK TO SAVEPOINT validation_operation');
        await this.transactionClient.query('RELEASE SAVEPOINT validation_operation');
        throw error;
      }
    }
    return withDatabase(this.databaseUrl, async (pool) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await action(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }
  private async audit(
    client: PoolClient,
    input: {
      organizationId: string;
      territoryId: string;
      actorUserId: string;
      action: string;
      resource: string;
      resourceId: string;
      oldState: unknown;
      newState: unknown;
      reason: string;
      requestId: string;
      classification: 'synthetic' | 'official';
      provenance: string;
    },
  ): Promise<void> {
    const result = await client.query(
      `INSERT INTO audit_events (organization_id,territory_id,actor_user_id,actor_organization_id,action,resource,resource_id,old_state,new_state,reason,request_id,data_classification,provenance)
      SELECT $1,$2,actor.id,actor.organization_id,$3::audit_event_action,$4::audit_event_resource,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11
      FROM identity_users actor WHERE actor.id=$12 AND actor.is_active=true`,
      [
        input.organizationId,
        input.territoryId,
        input.action,
        input.resource,
        input.resourceId,
        JSON.stringify(input.oldState),
        JSON.stringify(input.newState),
        input.reason,
        input.requestId,
        input.classification,
        input.provenance,
        input.actorUserId,
      ],
    );
    if (result.rowCount !== 1)
      throw new ValidationError('NOT_FOUND', 'The validation resource was not found.');
  }
  public async createProfile(
    input: CreateValidationProfileRequest,
    actorUserId: string,
    requestId: string,
  ): Promise<ValidationProfileVersion> {
    return this.transaction(async (client) => {
      const profile = await client.query<{ id: string }>(
        `INSERT INTO validation_profiles (organization_id,territory_id,sensor_id,measurement_kind,data_classification,name)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          input.organizationId,
          input.territoryId,
          input.sensorId,
          input.measurementKind,
          input.dataClassification,
          input.name,
        ],
      );
      if (!profile.rows[0])
        throw new ValidationError('VALIDATION_ERROR', 'The validation profile is invalid.');
      const inserted = await client.query<{ id: string }>(
        `WITH inserted AS (
        INSERT INTO validation_profile_versions (profile_id,version,effective_from,effective_until,rules,drafted_by_user_id)
        VALUES ($1,1,$2,$3,$4::jsonb,$5) RETURNING id)
        SELECT id FROM inserted`,
        [
          profile.rows[0].id,
          input.effectiveFrom,
          input.effectiveUntil ?? null,
          JSON.stringify(input.rules),
          actorUserId,
        ],
      );
      const version = await client.query<ProfileVersionRow>(
        `${profileVersionSelect} WHERE version.id=$1`,
        [inserted.rows[0]!.id],
      );
      const output = profileVersion(version.rows[0]!);
      await this.audit(client, {
        organizationId: input.organizationId,
        territoryId: input.territoryId,
        actorUserId,
        action: 'validation_profile.created',
        resource: 'validation_profile',
        resourceId: output.profileId,
        oldState: null,
        newState: auditProfileVersion(output),
        reason: input.reason,
        requestId,
        classification: input.dataClassification,
        provenance: 'validation_profile_api',
      });
      await this.audit(client, {
        organizationId: input.organizationId,
        territoryId: input.territoryId,
        actorUserId,
        action: 'validation_profile_version.created',
        resource: 'validation_profile',
        resourceId: output.id,
        oldState: null,
        newState: auditProfileVersion(output),
        reason: input.reason,
        requestId,
        classification: input.dataClassification,
        provenance: 'validation_profile_api',
      });
      return output;
    }).catch((error) => {
      if ((error as { code?: string }).code === '23514')
        throw new ValidationError('VALIDATION_ERROR', 'The validation profile is invalid.');
      if ((error as { code?: string }).code === '23505')
        throw new ValidationError('CONFLICT', 'A validation profile already governs that scope.');
      throw error;
    });
  }
  public async createVersion(
    profileId: string,
    territoryId: string,
    input: CreateValidationProfileVersionRequest,
    actorUserId: string,
    requestId: string,
  ): Promise<ValidationProfileVersion> {
    return this.transaction(async (client) => {
      const profile = await client.query<{
        organization_id: string;
        territory_id: string;
        data_classification: 'synthetic' | 'official';
      }>(
        'SELECT organization_id,territory_id,data_classification FROM validation_profiles WHERE id=$1 AND territory_id=$2 FOR UPDATE',
        [profileId, territoryId],
      );
      const scope = profile.rows[0];
      if (!scope) throw new ValidationError('NOT_FOUND', 'The validation profile was not found.');
      const inserted = await client.query<{ id: string }>(
        `WITH inserted AS (
        INSERT INTO validation_profile_versions (profile_id,version,effective_from,effective_until,rules,drafted_by_user_id)
        SELECT $1,COALESCE(MAX(version),0)+1,$2,$3,$4::jsonb,$5 FROM validation_profile_versions WHERE profile_id=$1 RETURNING id)
        SELECT id FROM inserted`,
        [
          profileId,
          input.effectiveFrom,
          input.effectiveUntil ?? null,
          JSON.stringify(input.rules),
          actorUserId,
        ],
      );
      const version = await client.query<ProfileVersionRow>(
        `${profileVersionSelect} WHERE version.id=$1`,
        [inserted.rows[0]!.id],
      );
      const output = profileVersion(version.rows[0]!);
      await this.audit(client, {
        organizationId: scope.organization_id,
        territoryId,
        actorUserId,
        action: 'validation_profile_version.created',
        resource: 'validation_profile',
        resourceId: output.id,
        oldState: null,
        newState: auditProfileVersion(output),
        reason: input.reason,
        requestId,
        classification: scope.data_classification,
        provenance: 'validation_profile_api',
      });
      return output;
    });
  }
  public async approveVersion(
    profileId: string,
    versionNumber: number,
    territoryId: string,
    reason: string,
    actorUserId: string,
    requestId: string,
  ): Promise<ValidationProfileVersion> {
    return this.transaction(async (client) => {
      const current = await client.query<ProfileVersionRow>(
        `${profileVersionSelect} WHERE version.profile_id=$1 AND version.version=$2 AND profile.territory_id=$3 FOR UPDATE`,
        [profileId, versionNumber, territoryId],
      );
      if (!current.rows[0])
        throw new ValidationError('NOT_FOUND', 'The validation profile was not found.');
      const prior = profileVersion(current.rows[0]);
      if (prior.status !== 'draft')
        throw new ValidationError(
          'CONFLICT',
          'The validation profile version is no longer a draft.',
        );
      if (prior.draftedByUserId === actorUserId)
        throw new ValidationError(
          'VALIDATION_ERROR',
          'A profile author cannot approve their own version.',
        );
      const changedId = await client.query<{ id: string }>(
        `WITH changed AS (
        UPDATE validation_profile_versions SET status='approved',approved_by_user_id=$2,approved_at=clock_timestamp(),approval_reason=$3 WHERE id=$1 RETURNING id)
        SELECT id FROM changed`,
        [prior.id, actorUserId, reason],
      );
      const changed = await client.query<ProfileVersionRow>(
        `${profileVersionSelect} WHERE version.id=$1`,
        [changedId.rows[0]!.id],
      );
      const output = profileVersion(changed.rows[0]!);
      await this.audit(client, {
        organizationId: output.organizationId,
        territoryId: output.territoryId,
        actorUserId,
        action: 'validation_profile_version.approved',
        resource: 'validation_profile',
        resourceId: output.id,
        oldState: auditProfileVersion(prior),
        newState: auditProfileVersion(output),
        reason,
        requestId,
        classification: output.dataClassification,
        provenance: 'validation_profile_api',
      });
      return output;
    });
  }
  public async validate(
    lineageId: string,
    expectedTerritoryId: string,
    actorUserId: string,
    requestId: string,
    evaluationAt: Date | string = new Date(),
    algorithmVersion = 'v1',
  ): Promise<AutomaticValidationResponse> {
    return this.transaction(async (client) => {
      // The revision trigger has this lock too, but taking it before the read
      // prevents a stale current-revision decision under concurrent correction.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 2))', [
        lineageId,
      ]);
      const current = await client.query<ObservationRow>(
        `${observationSelect} WHERE lineage.id=$1 AND lineage.territory_id=$2 ORDER BY revision.revision DESC LIMIT 1 FOR UPDATE`,
        [lineageId, expectedTerritoryId],
      );
      const observationRow = current.rows[0];
      if (!observationRow) throw new ValidationError('NOT_FOUND', 'The observation was not found.');
      const currentObservation = toObservation(observationRow);
      // Cadence/window expectations are configured by a later coverage-policy slice.
      // A stored fact is not evidence that a complete interval was expected or observed.
      const coverage = coverageState({ configured: false, expectedCount: 0, observedCount: 0 });
      if (currentObservation.workflowState !== 'raw') {
        if (currentObservation.workflowState !== 'automatically_validated')
          return {
            outcome: 'deferred',
            deferReason: 'current_revision_not_raw',
            profileVersionId: null,
            profileVersion: null,
            evidence: [],
            observation: currentObservation,
            coverageState: coverage,
            qualityState: currentObservation.qualityState,
          } as AutomaticValidationResponse;
        const priorExecution = await client.query<{
          profile_version_id: string;
          version: number;
          evidence: string[];
        }>(
          `SELECT execution.profile_version_id, version.version, execution.evidence FROM observation_validation_executions execution JOIN validation_profile_versions version ON version.id=execution.profile_version_id WHERE execution.lineage_id=$1 AND execution.source_revision_id=(SELECT id FROM observation_revisions WHERE lineage_id=$1 AND revision=1) AND execution.algorithm_version=$2`,
          [lineageId, algorithmVersion],
        );
        if (priorExecution.rows[0])
          return {
            outcome: 'applied',
            deferReason: null,
            profileVersionId: priorExecution.rows[0].profile_version_id,
            profileVersion: priorExecution.rows[0].version,
            evidence: priorExecution.rows[0].evidence,
            observation: currentObservation,
            coverageState: coverage,
            qualityState: currentObservation.qualityState,
          } as AutomaticValidationResponse;
        return {
          outcome: 'deferred',
          deferReason: 'current_revision_not_raw',
          profileVersionId: null,
          profileVersion: null,
          evidence: [],
          observation: currentObservation,
          coverageState: coverage,
          qualityState: currentObservation.qualityState,
        } as AutomaticValidationResponse;
      }
      const profile = await client.query<ProfileVersionRow>(
        `${profileVersionSelect} WHERE profile.organization_id=$1 AND profile.territory_id=$2 AND profile.sensor_id=$3 AND profile.measurement_kind=$4 AND profile.data_classification=$5 AND version.status='approved' AND version.effective_from <= $6 AND (version.effective_until IS NULL OR version.effective_until > $6) ORDER BY version.effective_from DESC, version.version DESC, version.id DESC LIMIT 1 FOR SHARE`,
        [
          observationRow.organization_id,
          observationRow.territory_id,
          observationRow.sensor_id,
          observationRow.measurement_kind,
          observationRow.data_classification,
          observationRow.observed_at,
        ],
      );
      if (!profile.rows[0])
        return {
          outcome: 'deferred',
          deferReason: 'no_approved_profile',
          profileVersionId: null,
          profileVersion: null,
          evidence: [],
          observation: currentObservation,
          coverageState: coverage,
          qualityState: currentObservation.qualityState,
        } as AutomaticValidationResponse;
      const selected = profileVersion(profile.rows[0]);
      const rules = selected.rules as ValidationRules;
      const prior = await client.query<{ value: string; observed_at: string }>(
        // Only one latest governed-valid revision per lineage is usable sequence
        // context. Raw/suspect/estimated/rejected revisions cannot turn a later
        // candidate valid or invalid. Organization+sensor scope retains history
        // through a lawful territory relocation without returning prior values.
        `WITH latest_per_lineage AS (
           SELECT DISTINCT ON (lineage.id) lineage.id, lineage.observed_at, revision.value, revision.state, revision.quality_state
           FROM observation_lineages lineage JOIN observation_revisions revision ON revision.lineage_id=lineage.id
           WHERE lineage.organization_id=$1 AND lineage.sensor_id=$2 AND lineage.measurement_kind=$3 AND lineage.observed_at < $4
           ORDER BY lineage.id, revision.revision DESC, revision.id DESC
         )
         SELECT value::text value, to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at
         FROM latest_per_lineage
         WHERE quality_state='valid' AND state IN ('automatically_validated','expert_validated','corrected')
         ORDER BY observed_at DESC, id DESC LIMIT 100`,
        [
          observationRow.organization_id,
          observationRow.sensor_id,
          observationRow.measurement_kind,
          observationRow.observed_at,
        ],
      );
      const disorder = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM observation_lineages lineage JOIN observation_revisions revision ON revision.lineage_id=lineage.id WHERE lineage.organization_id=$1 AND lineage.sensor_id=$2 AND lineage.observed_at > $3 AND revision.revision=1 AND revision.ingested_at < $4) exists`,
        [
          observationRow.organization_id,
          observationRow.sensor_id,
          observationRow.observed_at,
          observationRow.ingested_at,
        ],
      );
      const evaluatedAt =
        typeof evaluationAt === 'string' ? evaluationAt : evaluationAt.toISOString();
      const evaluated = evaluateObservationValidation(rules, {
        candidate: {
          measurementKind: observationRow.measurement_kind,
          value: observationRow.value,
          observedAt: observationRow.observed_at,
          ingestedAt: observationRow.ingested_cursor,
          rawQualityState: observationRow.quality_state as 'unknown' | 'suspect' | 'invalid',
          totalizerTransition: observationRow.totalizer_transition,
        },
        preceding: prior.rows.map((item) => ({ value: item.value, observedAt: item.observed_at })),
        arrivedOutOfOrder: disorder.rows[0]?.exists ?? false,
        evaluationAt: evaluatedAt,
      });
      if (evaluated.deferred)
        return {
          outcome: 'deferred',
          deferReason: 'insufficient_evidence',
          profileVersionId: selected.id,
          profileVersion: selected.version,
          evidence: [...evaluated.evidence],
          observation: currentObservation,
          coverageState: coverage,
          qualityState: currentObservation.qualityState,
        } as AutomaticValidationResponse;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO observation_revisions (lineage_id,revision,state,quality_state,quality_reason,value,unit,uncertainty,uncertainty_method,uncertainty_confidence,provenance,data_classification,totalizer_transition,measurement_method,raw_payload_ref,raw_payload_hash,calibration_ref,rating_curve_ref)
        VALUES ($1,$2,'automatically_validated',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [
          lineageId,
          observationRow.revision + 1,
          evaluated.qualityState,
          evaluated.qualityReason,
          observationRow.value,
          observationRow.unit,
          observationRow.uncertainty,
          observationRow.uncertainty_method,
          observationRow.uncertainty_confidence,
          observationRow.provenance,
          observationRow.data_classification,
          observationRow.totalizer_transition,
          observationRow.measurement_method,
          observationRow.raw_payload_ref,
          observationRow.raw_payload_hash,
          observationRow.calibration_ref,
          observationRow.rating_curve_ref,
        ],
      );
      const revised = await client.query<ObservationRow>(
        `${observationSelect} WHERE revision.id=$1`,
        [inserted.rows[0]!.id],
      );
      const observation = toObservation(revised.rows[0]!);
      const execution = await client.query<{ id: string }>(
        `INSERT INTO observation_validation_executions (lineage_id,source_revision_id,profile_version_id,algorithm_version,resulting_revision_id,evidence,evaluated_at,actor_user_id) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id`,
        [
          lineageId,
          currentObservation.id,
          selected.id,
          algorithmVersion,
          observation.id,
          JSON.stringify(evaluated.evidence),
          evaluatedAt,
          actorUserId,
        ],
      );
      await this.audit(client, {
        organizationId: observation.organizationId,
        territoryId: observation.territoryId,
        actorUserId,
        action: 'observation.automatically_validated',
        resource: 'observation',
        resourceId: observation.id,
        oldState: auditObservation(currentObservation),
        newState: {
          observation: auditObservation(observation),
          profileVersionId: selected.id,
          profileVersion: selected.version,
          evidenceCount: evaluated.evidence.length,
          executionId: execution.rows[0]!.id,
        },
        reason: 'automatic validation completed',
        requestId,
        classification: observation.dataClassification,
        provenance: 'observation_validation_v1',
      });
      await new PostgresDeviceHealthService(this.databaseUrl, client).ingestAcceptedObservation(
        observation,
      );
      return {
        outcome: 'applied',
        deferReason: null,
        profileVersionId: selected.id,
        profileVersion: selected.version,
        evidence: [...evaluated.evidence],
        observation,
        coverageState: coverage,
        qualityState: observation.qualityState,
      } as AutomaticValidationResponse;
    }).catch((error) => {
      if ((error as { code?: string }).code === '23514')
        throw new ValidationError('VALIDATION_ERROR', 'The validation operation is invalid.');
      throw error;
    });
  }
}

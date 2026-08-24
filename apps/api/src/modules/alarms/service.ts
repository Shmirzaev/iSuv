import {
  alarmCatalogVersionSchema,
  alarmConditionSchema,
  alarmEpisodeSchema,
  alarmMaterializationResultSchema,
  type AlarmCatalogVersion,
  type AlarmEpisode,
  type AlarmMaterializationResult,
  type CreateAlarmCatalogRequest,
  type RequestAlarmCatalogVersionRequest,
} from '@isuv/contracts';
import {
  compatibleAlarmCatalogBinding,
  decideAlarmMaterialization,
  type AlarmCondition as DomainCondition,
} from '@isuv/domain';
import type { PoolClient } from 'pg';
import { withDatabase } from '../../db/client.js';
import { PostgresAlarmRuleService } from '../alarm-rules/service.js';

export class AlarmError extends Error {
  public constructor(
    public readonly kind: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR',
    message: string,
  ) {
    super(message);
  }
}

const timestampSelect = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function domainCondition(
  condition: ReturnType<typeof alarmConditionSchema.parse>,
): DomainCondition {
  return {
    ...condition,
    enterPersistenceMicroseconds: BigInt(condition.enterPersistenceMicroseconds),
    clearPersistenceMicroseconds: BigInt(condition.clearPersistenceMicroseconds),
    maxGapMicroseconds: BigInt(condition.maxGapMicroseconds),
  };
}

interface Scope {
  territoryId: string;
  subjectKind?: 'observation_sensor' | 'allocation_plan';
}

interface MaterializationRow {
  catalog_id: string;
  catalog_version_id: string;
  organization_id: string;
  territory_id: string;
  event_type: AlarmCatalogVersion['eventType'];
  rule_id: string;
  rule_version_id: string;
  activation_support: AlarmCatalogVersion['activationSupport'];
  water_condition: AlarmCatalogVersion['waterCondition'];
  system_condition: AlarmCatalogVersion['systemDeviceCondition'];
  severity: AlarmCatalogVersion['severity'];
  condition: unknown;
  provenance: string;
}

interface RunRow {
  id: string;
  rule_version_id: string | null;
  state: 'inactive' | 'pending_activation' | 'active' | 'pending_clear' | 'deferred';
  effective_at: string;
  known_at: string;
  result: Record<string, unknown>;
  evidence: Array<Record<string, unknown>>;
}

export class PostgresAlarmService {
  public constructor(
    private readonly databaseUrl?: string,
    private readonly transactionClient?: PoolClient,
  ) {}

  private async read<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    if (this.transactionClient) return action(this.transactionClient);
    return withDatabase(this.databaseUrl, async (pool) => {
      const client = await pool.connect();
      try {
        return await action(client);
      } finally {
        client.release();
      }
    });
  }

  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    if (this.transactionClient) {
      await this.transactionClient.query('SAVEPOINT alarm_operation');
      try {
        const result = await action(this.transactionClient);
        await this.transactionClient.query('RELEASE SAVEPOINT alarm_operation');
        return result;
      } catch (error) {
        await this.transactionClient.query('ROLLBACK TO SAVEPOINT alarm_operation');
        await this.transactionClient.query('RELEASE SAVEPOINT alarm_operation');
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

  private failure(error: unknown): never {
    if (error instanceof AlarmError) throw error;
    const code = (error as { code?: string })?.code;
    if (code === '23505' || code === '23P01')
      throw new AlarmError('CONFLICT', 'The alarm catalog conflicts with governed history.');
    if (code === '23514' || code === '23503' || code === '22P02' || code === 'P0002')
      throw new AlarmError('VALIDATION_ERROR', 'The alarm catalog input is invalid.');
    throw error;
  }

  public async findTerritory(territoryId: string): Promise<string | null> {
    return this.read(
      async (client) =>
        (
          await client.query<{ id: string }>('SELECT id FROM territories WHERE id=$1', [
            territoryId,
          ])
        ).rows[0]?.id ?? null,
    );
  }

  public async findCatalogScope(catalogId: string): Promise<Scope | null> {
    return this.read(async (client) => {
      const row = (
        await client.query<{ territory_id: string }>(
          'SELECT territory_id FROM alarm_catalogs WHERE id=$1',
          [catalogId],
        )
      ).rows[0];
      return row ? { territoryId: row.territory_id } : null;
    });
  }

  public async findRuleScope(ruleId: string): Promise<Scope | null> {
    return this.read(async (client) => {
      const row = (
        await client.query<{
          territory_id: string;
          subject_kind: 'observation_sensor' | 'allocation_plan';
        }>('SELECT territory_id,subject_kind FROM alarm_rules WHERE id=$1', [ruleId])
      ).rows[0];
      return row ? { territoryId: row.territory_id, subjectKind: row.subject_kind } : null;
    });
  }

  public async create(
    input: CreateAlarmCatalogRequest,
    actorId: string,
    requestId: string,
  ): Promise<{ id: string; territoryId: string }> {
    try {
      return await this.transaction(async (client) => {
        const row = (
          await client.query<{ id: string; territory_id: string }>(
            `INSERT INTO alarm_catalogs(
              organization_id,territory_id,event_type,title,provenance,
              created_by_user_id,creation_reason,created_request_id
            ) SELECT territory.organization_id,territory.id,$2,$3,$4,$5,$6,$7
              FROM territories territory WHERE territory.id=$1
            RETURNING id,territory_id`,
            [
              input.territoryId,
              input.eventType,
              input.title,
              input.provenance,
              actorId,
              input.reason,
              requestId,
            ],
          )
        ).rows[0];
        if (!row) throw new AlarmError('NOT_FOUND', 'The alarm catalog scope was not found.');
        return { id: row.id, territoryId: row.territory_id };
      });
    } catch (error) {
      return this.failure(error);
    }
  }

  public async requestVersion(
    catalogId: string,
    input: RequestAlarmCatalogVersionRequest,
    actorId: string,
    requestId: string,
  ): Promise<{ id: string; version: number; status: string }> {
    try {
      return await this.transaction(async (client) => {
        const row = (
          await client.query<{ id: string; version: number; status: string }>(
            `INSERT INTO alarm_catalog_versions(
              catalog_id,version,status,effective_from,effective_until,rule_id,
              activation_support,water_condition,system_condition,severity,provenance,
              requested_by_user_id,request_reason,requested_request_id
            ) VALUES($1,1,'requested',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            RETURNING id,version,status`,
            [
              catalogId,
              input.effectiveFrom,
              input.effectiveUntil,
              input.ruleId,
              input.activationSupport,
              input.waterCondition,
              input.systemDeviceCondition,
              input.severity,
              input.provenance,
              actorId,
              input.reason,
              requestId,
            ],
          )
        ).rows[0];
        if (!row) throw new AlarmError('NOT_FOUND', 'The alarm catalog was not found.');
        return row;
      });
    } catch (error) {
      return this.failure(error);
    }
  }

  public async approveVersion(
    catalogId: string,
    version: number,
    reason: string,
    actorId: string,
    requestId: string,
  ): Promise<{ id: string; version: number; status: string }> {
    try {
      return await this.transaction(async (client) => {
        const row = (
          await client.query<{ id: string; version: number; status: string }>(
            `UPDATE alarm_catalog_versions SET status='approved',approved_by_user_id=$3,
              approval_reason=$4,approved_request_id=$5
            WHERE catalog_id=$1 AND version=$2 AND status='requested'
            RETURNING id,version,status`,
            [catalogId, version, actorId, reason, requestId],
          )
        ).rows[0];
        if (!row)
          throw new AlarmError('CONFLICT', 'Only a requested catalog version can be approved.');
        return row;
      });
    } catch (error) {
      return this.failure(error);
    }
  }

  public async catalogVersion(
    catalogId: string,
    effectiveAt: string,
    knownAt: string,
  ): Promise<AlarmCatalogVersion | null> {
    return this.read(async (client) => {
      const row = (
        await client.query<Record<string, unknown>>(
          `SELECT version_row.id,version_row.catalog_id,"version",catalog.organization_id,
            catalog.territory_id,catalog.event_type,catalog.title,version_row.rule_id,
            version_row.activation_support,version_row.water_condition,version_row.system_condition,
            version_row.severity,version_row.status,${timestampSelect('version_row.effective_from')} effective_from,
            ${timestampSelect('version_row.effective_until')} effective_until,
            ${timestampSelect('version_row.approved_at')} known_at,version_row.provenance,
            catalog.created_by_user_id,${timestampSelect('catalog.created_at')} created_at,
            version_row.requested_by_user_id,${timestampSelect('version_row.requested_at')} requested_at,
            version_row.request_reason,version_row.approved_by_user_id,
            ${timestampSelect('version_row.approved_at')} approved_at,version_row.approval_reason
          FROM alarm_catalog_versions version_row JOIN alarm_catalogs catalog ON catalog.id=version_row.catalog_id
          WHERE catalog.id=$1 AND version_row.status='approved' AND version_row.effective_from<=$2
            AND version_row.effective_until>$2 AND version_row.approved_at<=$3
          ORDER BY version_row.version DESC LIMIT 1`,
          [catalogId, effectiveAt, knownAt],
        )
      ).rows[0];
      if (!row) return null;
      return alarmCatalogVersionSchema.parse({
        id: row.id,
        catalogId: row.catalog_id,
        version: row.version,
        organizationId: row.organization_id,
        territoryId: row.territory_id,
        eventType: row.event_type,
        title: row.title,
        ruleId: row.rule_id,
        activationSupport: row.activation_support,
        waterCondition: row.water_condition,
        systemDeviceCondition: row.system_condition,
        severity: row.severity,
        status: row.status,
        effectiveFrom: row.effective_from,
        effectiveUntil: row.effective_until,
        knownAt,
        provenance: row.provenance,
        dataClassification: 'synthetic',
        officialComplianceEligible: false,
        authoredByUserId: row.created_by_user_id,
        authoredAt: row.created_at,
        requestedByUserId: row.requested_by_user_id,
        requestedAt: row.requested_at,
        requestReason: row.request_reason,
        approvedByUserId: row.approved_by_user_id,
        approvedAt: row.approved_at,
        approvalReason: row.approval_reason,
      });
    });
  }

  private async episode(client: PoolClient, alarmId: string): Promise<AlarmEpisode> {
    const row = (
      await client.query<Record<string, unknown>>(
        `SELECT alarm.*,${timestampSelect('alarm.detected_at')} detected,
          ${timestampSelect('alarm.activated_effective_at')} effective,
          ${timestampSelect('alarm.activated_known_at')} known,
          ${timestampSelect('alarm.cleared_at')} cleared,
          latest.signal_run_id latest_run_id,activation.evidence activation_evidence
        FROM alarms alarm
        JOIN alarm_rule_evaluation_runs activation ON activation.id=alarm.activation_signal_run_id
        JOIN LATERAL(SELECT evidence.signal_run_id FROM alarm_evidence evidence
          WHERE evidence.alarm_id=alarm.id ORDER BY evidence.effective_at DESC,evidence.known_at DESC,evidence.created_at DESC LIMIT 1) latest ON true
        WHERE alarm.id=$1`,
        [alarmId],
      )
    ).rows[0]!;
    const activationEvidence = (row.activation_evidence as Array<{ revisionIds?: string[] }>)
      .flatMap((item) => item.revisionIds ?? [])
      .filter((id, index, all) => all.indexOf(id) === index);
    return alarmEpisodeSchema.parse({
      id: row.id,
      organizationId: row.organization_id,
      territoryId: row.territory_id,
      eventType: row.event_type,
      waterCondition: row.water_condition,
      systemDeviceCondition: row.system_condition,
      severity: row.severity,
      automaticState: row.automatic_state,
      catalogId: row.catalog_id,
      catalogVersionId: row.catalog_version_id,
      ruleId: row.rule_id,
      ruleVersionId: row.rule_version_id,
      activationSignalRunId: row.activation_signal_run_id,
      latestSignalRunId: row.latest_run_id,
      activationEvidence: activationEvidence.length
        ? activationEvidence
        : [row.activation_signal_run_id],
      provenance: row.provenance,
      detectedAt: row.detected,
      effectiveAt: row.effective,
      knownAt: row.known,
      clearedAt: row.cleared,
      clearSignalRunId: row.cleared_signal_run_id,
      dataClassification: 'synthetic',
      officialComplianceEligible: false,
    });
  }

  public async materialize(
    ruleId: string,
    effectiveAt: string,
    knownAt: string,
    actorId: string,
    requestId: string,
  ): Promise<AlarmMaterializationResult> {
    try {
      return await this.transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ruleId]);
        await new PostgresAlarmRuleService(this.databaseUrl, client).evaluate(ruleId, {
          effectiveAt,
          knownAt,
        });
        const run = (
          await client.query<RunRow>(
            `SELECT id,rule_version_id,state,${timestampSelect('effective_at')} effective_at,
              ${timestampSelect('known_at')} known_at,result,evidence
            FROM alarm_rule_evaluation_runs WHERE rule_id=$1 AND effective_at=$2 AND known_at=$3
            ORDER BY created_at DESC,id DESC LIMIT 1`,
            [ruleId, effectiveAt, knownAt],
          )
        ).rows[0]!;
        const configured = (
          await client.query<MaterializationRow>(
            `SELECT catalog.id catalog_id,version_row.id catalog_version_id,catalog.organization_id,
              catalog.territory_id,catalog.event_type,version_row.rule_id,run.rule_version_id,
              version_row.activation_support,version_row.water_condition,version_row.system_condition,
              version_row.severity,rule_version.condition,version_row.provenance
            FROM alarm_catalog_versions version_row
            JOIN alarm_catalogs catalog ON catalog.id=version_row.catalog_id
            JOIN alarm_rule_evaluation_runs run ON run.id=$4
            JOIN alarm_rule_versions rule_version ON rule_version.id=run.rule_version_id
            WHERE version_row.rule_id=$1 AND version_row.status='approved'
              AND version_row.effective_from<=$2 AND version_row.effective_until>$2
              AND version_row.approved_at<=$3
            ORDER BY version_row.approved_at DESC,version_row.version DESC LIMIT 1`,
            [ruleId, effectiveAt, knownAt, run.id],
          )
        ).rows[0];
        const existing = (
          await client.query<{ id: string }>(
            `SELECT id FROM alarms WHERE rule_id=$1 AND automatic_state='active'
             ORDER BY detected_at DESC LIMIT 1 FOR UPDATE`,
            [ruleId],
          )
        ).rows[0];
        const compatibility = compatibleAlarmCatalogBinding(
          configured
            ? {
                eventType: configured.event_type,
                ruleId: configured.rule_id,
                activationSupport: configured.activation_support,
              }
            : null,
          {
            sourceKind: 'p4_001_rule_signal',
            ruleId,
            condition: configured
              ? domainCondition(alarmConditionSchema.parse(configured.condition))
              : ({ kind: 'allocation_deviation' } as never),
            state: run.state,
          },
        );
        const decision = decideAlarmMaterialization(
          compatibility,
          run.state,
          existing ? { id: existing.id, automaticState: 'active' } : null,
        );
        if (decision.outcome === 'not_materialized')
          return alarmMaterializationResultSchema.parse({
            outcome: 'not_materialized',
            action: null,
            alarm: null,
            reason: decision.reason,
          });
        if (!configured && !existing)
          throw new AlarmError('VALIDATION_ERROR', 'The alarm catalog is not configured.');
        let alarmId = existing?.id;
        if (decision.outcome === 'created') {
          const qualifyingStart = run.result.qualifyingStart;
          if (typeof qualifyingStart !== 'string')
            throw new AlarmError('VALIDATION_ERROR', 'The active signal has no qualifying start.');
          alarmId = (
            await client.query<{ id: string }>(
              `INSERT INTO alarms(organization_id,territory_id,catalog_id,catalog_version_id,
                rule_id,rule_version_id,event_type,water_condition,system_condition,severity,
                activation_signal_run_id,activation_episode_start,activated_effective_at,
                activated_known_at,materialized_by_user_id,materialized_request_id,provenance)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
              ON CONFLICT(catalog_version_id,rule_version_id,activation_episode_start)
              DO NOTHING RETURNING id`,
              [
                configured!.organization_id,
                configured!.territory_id,
                configured!.catalog_id,
                configured!.catalog_version_id,
                ruleId,
                configured!.rule_version_id,
                configured!.event_type,
                configured!.water_condition,
                configured!.system_condition,
                configured!.severity,
                run.id,
                qualifyingStart,
                run.effective_at,
                run.known_at,
                actorId,
                requestId,
                configured!.provenance,
              ],
            )
          ).rows[0]?.id;
          if (!alarmId)
            alarmId = (
              await client.query<{ id: string }>(
                `SELECT id FROM alarms WHERE catalog_version_id=$1 AND rule_version_id=$2
                  AND activation_episode_start=$3`,
                [configured!.catalog_version_id, configured!.rule_version_id, qualifyingStart],
              )
            ).rows[0]!.id;
        }
        await client.query(
          `INSERT INTO alarm_evidence(alarm_id,signal_run_id,effective_at,known_at,
            evidence_status,result,evidence,provenance)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(alarm_id,signal_run_id) DO NOTHING`,
          [
            alarmId,
            run.id,
            run.effective_at,
            run.known_at,
            run.state === 'deferred' ? 'unassessable' : 'assessable',
            JSON.stringify(run.result),
            JSON.stringify(run.evidence),
            configured?.provenance ?? 'synthetic:preserved alarm evidence',
          ],
        );
        if (decision.action === 'automatically_cleared')
          await client.query(
            `UPDATE alarms SET automatic_state='cleared',cleared_signal_run_id=$2,
              cleared_effective_at=$3,cleared_known_at=$4,cleared_by_user_id=$5,
              cleared_request_id=$6 WHERE id=$1 AND automatic_state='active'`,
            [alarmId, run.id, run.effective_at, run.known_at, actorId, requestId],
          );
        const alarm = await this.episode(client, alarmId!);
        return alarmMaterializationResultSchema.parse({
          outcome: decision.outcome,
          action: decision.action,
          alarm,
          reason: null,
        });
      });
    } catch (error) {
      return this.failure(error);
    }
  }
}

import { createHash } from 'node:crypto';
import {
  alarmConditionFactSchema,
  alarmConditionSchema,
  alarmRuleEvaluationSchema,
  type AlarmCondition as ContractCondition,
  type AlarmConditionFact,
  type AlarmRuleEvaluation,
  type CreateAlarmRuleRequest,
  type RequestAlarmRuleVersionRequest,
} from '@isuv/contracts';
import {
  div,
  evaluateAlarmCondition,
  parseExactDecimal,
  rational,
  sub,
  utcMicros,
  type AlarmCondition as DomainCondition,
  type ConditionEvaluation,
  type ConditionFact,
  type ConditionState,
  type Rational,
} from '@isuv/domain';
import type { PoolClient } from 'pg';
import { withDatabase } from '../../db/client.js';
import { PostgresAllocationDeviationService } from '../allocation-deviation/service.js';

export class AlarmRuleError extends Error {
  public constructor(
    public readonly kind: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR',
    message: string,
  ) {
    super(message);
  }
}

interface RuleScope {
  territoryId: string;
  subjectKind: 'observation_sensor' | 'allocation_plan';
  subjectId: string;
}

interface VersionRow extends RuleScope {
  ruleId: string;
  versionId: string;
  effectiveFrom: string;
  condition: unknown;
  provenance: string;
}

interface ObservationRow {
  lineage_id: string;
  revision_id: string;
  profile_version_id: string | null;
  observed_at: string;
  ingested_at: string;
  measurement_kind: 'stage' | 'discharge' | 'accumulated_volume';
  unit: string;
  state: string;
  quality_state: string;
  value: string;
  uncertainty: string | null;
  provenance: string;
  data_classification: 'synthetic';
}

const timestampSelect = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function exact(value: Rational) {
  return { numerator: value.numerator.toString(), denominator: value.denominator.toString() };
}

function domainCondition(condition: ContractCondition): DomainCondition {
  const durations = {
    enterPersistenceMicroseconds: BigInt(condition.enterPersistenceMicroseconds),
    clearPersistenceMicroseconds: BigInt(condition.clearPersistenceMicroseconds),
    maxGapMicroseconds: BigInt(condition.maxGapMicroseconds),
  };
  return condition.kind === 'observation_threshold'
    ? { ...condition, ...durations }
    : { ...condition, ...durations };
}

function domainFact(fact: AlarmConditionFact): ConditionFact {
  const common = {
    eventStart: fact.eventStart,
    eventEnd: fact.eventEnd,
    observedAt: fact.observedAt,
    knownAt: fact.knownAt,
    sourceIds: fact.sourceIds,
    revisionIds: fact.revisionIds,
    policyIds: fact.policyIds,
    trusted: fact.trusted,
    complete: fact.complete,
    estimated: fact.estimated,
    provenance: fact.provenance,
    dataClassification: fact.dataClassification,
    officialComplianceEligible: fact.officialComplianceEligible,
  } as const;
  if (fact.kind === 'observation')
    return {
      ...common,
      kind: 'observation',
      sensorId: fact.sensorId,
      quantity: fact.quantity,
      unit: fact.unit,
      value: fact.value
        ? rational(BigInt(fact.value.numerator), BigInt(fact.value.denominator))
        : null,
      uncertainty: fact.uncertainty
        ? rational(BigInt(fact.uncertainty.numerator), BigInt(fact.uncertainty.denominator))
        : null,
      ratePerSecond: fact.ratePerSecond
        ? rational(BigInt(fact.ratePerSecond.numerator), BigInt(fact.ratePerSecond.denominator))
        : null,
    };
  return {
    ...common,
    kind: 'allocation',
    planId: fact.planId,
    outcome: fact.outcome,
    condition: fact.condition,
    value: fact.value
      ? rational(BigInt(fact.value.numerator), BigInt(fact.value.denominator))
      : null,
    uncertainty: fact.uncertainty
      ? rational(BigInt(fact.uncertainty.numerator), BigInt(fact.uncertainty.denominator))
      : null,
  };
}

function stableState(result: ConditionEvaluation, prior: ConditionState): ConditionState {
  if (result.state === 'active' || result.state === 'inactive') return result.state;
  if (result.state === 'pending_activation') return 'inactive';
  if (result.state === 'pending_clear') return 'active';
  return prior === 'active' || prior === 'pending_clear' ? 'active' : 'inactive';
}

/** Invalid facts split continuity but do not silently clear a previously active condition. */
function evaluateSegments(
  condition: DomainCondition,
  facts: AlarmConditionFact[],
  effectiveAt: string,
) {
  // The domain evaluator owns the exact terminal-horizon rule. Check it once
  // across the complete source sequence before splitting invalid evidence into
  // historical segments; individual segments must not mistake the horizon for
  // a source fact.
  const horizon = evaluateAlarmCondition(condition, facts.map(domainFact), 'inactive', effectiveAt);
  if (horizon.state === 'deferred' && horizon.reason === 'gap_exceeded') return horizon;
  let prior: ConditionState = 'inactive';
  let group: AlarmConditionFact[] = [];
  let deferredResult: ConditionEvaluation | null = null;
  let last = evaluateAlarmCondition(condition, [], prior);
  const flush = () => {
    if (!group.length) return;
    last = evaluateAlarmCondition(condition, group.map(domainFact), prior);
    prior = stableState(last, prior);
    group = [];
  };
  for (const fact of facts) {
    const single = evaluateAlarmCondition(condition, [domainFact(fact)], prior);
    if (single.state === 'deferred') {
      flush();
      last = single;
      deferredResult ??= single;
      group = [];
    } else group.push(fact);
  }
  flush();
  return deferredResult ?? last;
}

export class PostgresAlarmRuleService {
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
      await this.transactionClient.query('SAVEPOINT alarm_rule_operation');
      try {
        const value = await action(this.transactionClient);
        await this.transactionClient.query('RELEASE SAVEPOINT alarm_rule_operation');
        return value;
      } catch (issue) {
        await this.transactionClient.query('ROLLBACK TO SAVEPOINT alarm_rule_operation');
        await this.transactionClient.query('RELEASE SAVEPOINT alarm_rule_operation');
        throw issue;
      }
    }
    return withDatabase(this.databaseUrl, async (pool) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await action(client);
        await client.query('COMMIT');
        return value;
      } catch (issue) {
        await client.query('ROLLBACK');
        throw issue;
      } finally {
        client.release();
      }
    });
  }

  private failure(issue: unknown): never {
    if (issue instanceof AlarmRuleError) throw issue;
    const code = (issue as { code?: string })?.code;
    if (code === '23505' || code === '23P01')
      throw new AlarmRuleError('CONFLICT', 'The alarm rule conflicts with governed history.');
    if (code === '23514' || code === '23503' || code === '22P02')
      throw new AlarmRuleError('VALIDATION_ERROR', 'The alarm rule input is invalid.');
    throw issue;
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

  public async findRuleScope(ruleId: string): Promise<RuleScope | null> {
    return this.read(async (client) => {
      const row = (
        await client.query<{
          territory_id: string;
          subject_kind: RuleScope['subjectKind'];
          subject_id: string;
        }>(`SELECT territory_id,subject_kind,subject_id FROM alarm_rules WHERE id=$1`, [ruleId])
      ).rows[0];
      return row
        ? {
            territoryId: row.territory_id,
            subjectKind: row.subject_kind,
            subjectId: row.subject_id,
          }
        : null;
    });
  }

  public async create(input: CreateAlarmRuleRequest, actor: string, requestId: string) {
    try {
      return await this.transaction(async (client) => {
        const row = (
          await client.query(
            `INSERT INTO alarm_rules(
              organization_id,territory_id,subject_kind,subject_id,provenance,
              created_by_user_id,creation_reason,created_request_id
            )
            SELECT organization_id,id,$2,$3,$4,$5,$6,$7 FROM territories WHERE id=$1
            RETURNING id,territory_id,subject_kind,subject_id,provenance`,
            [
              input.territoryId,
              input.subjectKind,
              input.subjectId,
              input.provenance,
              actor,
              input.reason,
              requestId,
            ],
          )
        ).rows[0];
        if (!row) throw new AlarmRuleError('NOT_FOUND', 'Alarm rule subject was not found.');
        return row;
      });
    } catch (issue) {
      return this.failure(issue);
    }
  }

  public async request(
    ruleId: string,
    input: RequestAlarmRuleVersionRequest,
    actor: string,
    requestId: string,
  ) {
    try {
      return await this.transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ruleId]);
        const exists = await client.query('SELECT id FROM alarm_rules WHERE id=$1', [ruleId]);
        if (!exists.rows[0]) throw new AlarmRuleError('NOT_FOUND', 'Alarm rule was not found.');
        return (
          await client.query(
            `INSERT INTO alarm_rule_versions(
              rule_id,version,status,effective_from,effective_until,condition,provenance,
              requested_by_user_id,request_reason,requested_request_id
            ) SELECT $1,COALESCE(max(version),0)+1,'requested',$2,$3,$4,$5,$6,$7,$8
              FROM alarm_rule_versions WHERE rule_id=$1
            RETURNING id,version,status`,
            [
              ruleId,
              input.effectiveFrom,
              input.effectiveUntil,
              input.condition,
              input.provenance,
              actor,
              input.reason,
              requestId,
            ],
          )
        ).rows[0];
      });
    } catch (issue) {
      return this.failure(issue);
    }
  }

  public async approve(
    ruleId: string,
    version: number,
    reason: string,
    actor: string,
    requestId: string,
  ) {
    try {
      return await this.transaction(async (client) => {
        const row = (
          await client.query(
            `UPDATE alarm_rule_versions SET
              status='approved',approved_by_user_id=$3,approval_reason=$4,approved_request_id=$5
            WHERE rule_id=$1 AND version=$2 AND status='requested'
            RETURNING id,version,status`,
            [ruleId, version, actor, reason, requestId],
          )
        ).rows[0];
        if (!row)
          throw new AlarmRuleError('CONFLICT', 'Only a requested rule version can be approved.');
        return row;
      });
    } catch (issue) {
      return this.failure(issue);
    }
  }

  private async selectedVersion(
    client: PoolClient,
    ruleId: string,
    effectiveAt: string,
    knownAt: string,
  ): Promise<VersionRow | null> {
    const row = (
      await client.query<{
        rule_id: string;
        version_id: string;
        territory_id: string;
        subject_kind: RuleScope['subjectKind'];
        subject_id: string;
        effective_from: string;
        condition: unknown;
        provenance: string;
      }>(
        `SELECT rule_row.id rule_id,version_row.id version_id,rule_row.territory_id,
          rule_row.subject_kind,rule_row.subject_id,
          ${timestampSelect('version_row.effective_from')} effective_from,
          version_row.condition,version_row.provenance
        FROM alarm_rules rule_row
        JOIN alarm_rule_versions version_row ON version_row.rule_id=rule_row.id
        WHERE rule_row.id=$1 AND version_row.status='approved'
          AND version_row.effective_from<=$2 AND version_row.effective_until>$2
          AND version_row.approved_at<=$3
        ORDER BY version_row.effective_from DESC,version_row.version DESC LIMIT 1`,
        [ruleId, effectiveAt, knownAt],
      )
    ).rows[0];
    return row
      ? {
          ruleId: row.rule_id,
          versionId: row.version_id,
          territoryId: row.territory_id,
          subjectKind: row.subject_kind,
          subjectId: row.subject_id,
          effectiveFrom: row.effective_from,
          condition: row.condition,
          provenance: row.provenance,
        }
      : null;
  }

  private async observationFacts(
    client: PoolClient,
    version: VersionRow,
    condition: Extract<ContractCondition, { kind: 'observation_threshold' }>,
    effectiveAt: string,
    knownAt: string,
  ): Promise<AlarmConditionFact[]> {
    const rows = await client.query<ObservationRow>(
      `WITH current_revision AS (
        SELECT DISTINCT ON (lineage.id)
          lineage.id lineage_id,revision.id revision_id,execution.profile_version_id,
          ${timestampSelect('lineage.observed_at')} observed_at,
          ${timestampSelect('revision.ingested_at')} ingested_at,
          lineage.measurement_kind,lineage.unit,revision.state,revision.quality_state,
          revision.value::text,revision.uncertainty::text,revision.provenance,
          revision.data_classification
        FROM observation_lineages lineage
        JOIN observation_revisions revision ON revision.lineage_id=lineage.id
        LEFT JOIN LATERAL (
          SELECT validation.profile_version_id
          FROM observation_validation_executions validation
          WHERE validation.resulting_revision_id=revision.id
          ORDER BY validation.evaluated_at DESC,validation.id DESC LIMIT 1
        ) execution ON true
        WHERE lineage.sensor_id=$1 AND lineage.observed_at>=$2 AND lineage.observed_at<=$3
          AND revision.ingested_at<=$4
        ORDER BY lineage.id,revision.ingested_at DESC,revision.revision DESC,revision.id DESC
      ) SELECT * FROM current_revision ORDER BY observed_at,lineage_id LIMIT 4097`,
      [version.subjectId, version.effectiveFrom, effectiveAt, knownAt],
    );
    if (rows.rows.length > 4096) return [];
    let previous: { at: string; value: Rational } | null = null;
    return rows.rows.map((row) => {
      const trusted =
        row.quality_state === 'valid' &&
        ['automatically_validated', 'expert_validated', 'corrected'].includes(row.state);
      const currentValue = parseExactDecimal(row.value);
      let rate: Rational | null = null;
      if (trusted && previous) {
        const elapsed = utcMicros(row.observed_at) - utcMicros(previous.at);
        if (elapsed > 0n)
          rate = div(sub(currentValue, previous.value), rational(elapsed, 1_000_000n));
      }
      if (trusted) previous = { at: row.observed_at, value: currentValue };
      else previous = null;
      return alarmConditionFactSchema.parse({
        kind: 'observation',
        eventStart: row.observed_at,
        eventEnd: row.observed_at,
        observedAt: row.observed_at,
        knownAt,
        sourceIds: [row.lineage_id],
        revisionIds: [row.revision_id],
        policyIds: [row.profile_version_id ?? row.revision_id],
        trusted,
        complete: true,
        estimated: row.state === 'estimated' || row.quality_state === 'estimated',
        provenance: row.provenance,
        dataClassification: 'synthetic',
        officialComplianceEligible: false,
        sensorId: version.subjectId,
        quantity: condition.quantity,
        unit: condition.unit,
        value: exact(currentValue),
        uncertainty: row.uncertainty ? exact(parseExactDecimal(row.uncertainty)) : null,
        ratePerSecond: rate ? exact(rate) : null,
      });
    });
  }

  private async allocationFacts(
    client: PoolClient,
    version: VersionRow,
    effectiveAt: string,
    knownAt: string,
  ): Promise<AlarmConditionFact[]> {
    const intervals = await client.query<{
      interval_start: string;
      interval_end: string;
    }>(
      `SELECT DISTINCT
        ${timestampSelect('entry.interval_start')} interval_start,
        ${timestampSelect('entry.interval_end')} interval_end
      FROM allocation_plan_versions plan_version
      JOIN allocation_plan_entries entry ON entry.plan_version_id=plan_version.id
      WHERE plan_version.plan_id=$1 AND plan_version.status IN ('approved','superseded')
        AND plan_version.approved_at<=$4 AND entry.interval_start>=$2 AND entry.interval_end<=$3
      ORDER BY interval_start,interval_end LIMIT 4097`,
      [version.subjectId, version.effectiveFrom, effectiveAt, knownAt],
    );
    if (intervals.rows.length > 4096) return [];
    const deviationService = new PostgresAllocationDeviationService(this.databaseUrl, client);
    const facts: AlarmConditionFact[] = [];
    let previousEnd: string | null = null;
    for (const interval of intervals.rows) {
      const deviation = await deviationService.deviation(version.subjectId, {
        intervalStart: interval.interval_start,
        intervalEnd: interval.interval_end,
        knownAt,
      });
      const computed = deviation.outcome === 'computed';
      const policyId = computed
        ? deviation.tolerance.versionId
        : (deviation.tolerance?.versionId ?? version.versionId);
      const revisionIds = computed
        ? deviation.actual.sourceRefs.map((source) => source.revisionId)
        : [version.versionId];
      facts.push(
        alarmConditionFactSchema.parse({
          kind: 'allocation',
          eventStart: interval.interval_start,
          eventEnd: interval.interval_end,
          observedAt: interval.interval_end,
          knownAt,
          sourceIds: computed ? [deviation.planEntryId, deviation.binding.id] : [version.subjectId],
          revisionIds: revisionIds.length ? revisionIds : [version.versionId],
          policyIds: [policyId],
          trusted: computed,
          complete:
            computed &&
            (previousEnd === null || utcMicros(previousEnd) === utcMicros(interval.interval_start)),
          estimated: deviation.outcome === 'estimated_not_eligible',
          provenance: computed
            ? `${deviation.binding.provenance};${deviation.tolerance.provenance}`
            : `synthetic:${deviation.outcome}`,
          dataClassification: 'synthetic',
          officialComplianceEligible: false,
          planId: version.subjectId,
          outcome: computed ? 'computed' : 'unassessable',
          condition: computed ? deviation.condition : 'unassessable',
          value: computed
            ? {
                numerator: deviation.delta.numerator,
                denominator: deviation.delta.denominator,
              }
            : null,
          uncertainty: null,
        }),
      );
      previousEnd = interval.interval_end;
    }
    return facts;
  }

  public async evaluate(
    ruleId: string,
    input: { effectiveAt: string; knownAt?: string | undefined },
  ): Promise<AlarmRuleEvaluation> {
    try {
      return await this.transaction(async (client) => {
        const knownAt = input.knownAt ?? new Date().toISOString();
        const selected = await this.selectedVersion(client, ruleId, input.effectiveAt, knownAt);
        if (!selected) {
          const evaluation = alarmRuleEvaluationSchema.parse({
            ruleId,
            versionId: null,
            effectiveAt: input.effectiveAt,
            knownAt,
            state: 'deferred',
            reason: 'unconfigured_rule',
            qualifyingStart: null,
            qualifyingEnd: null,
            qualifyingDurationMicroseconds: '0',
            qualifyingFactCount: 0,
            evidence: [],
            dataClassification: 'synthetic',
            officialComplianceEligible: false,
            alarmEligible: false,
          });
          const fingerprint = `sha256:${createHash('sha256')
            .update(JSON.stringify({ condition: null, facts: [] }))
            .digest('hex')}`;
          let run = (
            await client.query<{ id: string }>(
              `INSERT INTO alarm_rule_evaluation_runs(
                rule_id,rule_version_id,effective_at,known_at,input_fingerprint,
                algorithm_version,state,reason,result,evidence,evidence_count
              ) VALUES($1,NULL,$2,$3,$4,'alarm-condition-v1',$5,$6,$7,'[]'::jsonb,0)
              ON CONFLICT DO NOTHING RETURNING id`,
              [
                ruleId,
                input.effectiveAt,
                knownAt,
                fingerprint,
                evaluation.state,
                evaluation.reason,
                JSON.stringify(evaluation),
              ],
            )
          ).rows[0];
          if (!run)
            run = (
              await client.query<{ id: string }>(
                `SELECT id FROM alarm_rule_evaluation_runs
                 WHERE rule_id=$1 AND rule_version_id IS NULL AND effective_at=$2
                   AND known_at=$3 AND input_fingerprint=$4`,
                [ruleId, input.effectiveAt, knownAt, fingerprint],
              )
            ).rows[0]!;
          await client.query(
            `INSERT INTO alarm_rule_current_signals(
              rule_id,evaluation_run_id,effective_at,known_at,state,updated_at
            ) VALUES($1,$2,$3,$4,$5,clock_timestamp())
            ON CONFLICT(rule_id) DO UPDATE SET
              evaluation_run_id=EXCLUDED.evaluation_run_id,effective_at=EXCLUDED.effective_at,
              known_at=EXCLUDED.known_at,state=EXCLUDED.state,updated_at=clock_timestamp()
            WHERE EXCLUDED.effective_at>alarm_rule_current_signals.effective_at
               OR (EXCLUDED.effective_at=alarm_rule_current_signals.effective_at
                   AND EXCLUDED.known_at>alarm_rule_current_signals.known_at)`,
            [ruleId, run.id, input.effectiveAt, knownAt, evaluation.state],
          );
          return evaluation;
        }
        const condition = alarmConditionSchema.parse(selected.condition);
        if (
          (condition.kind === 'observation_threshold' &&
            (selected.subjectKind !== 'observation_sensor' ||
              condition.sensorId !== selected.subjectId)) ||
          (condition.kind === 'allocation_deviation' &&
            (selected.subjectKind !== 'allocation_plan' || condition.planId !== selected.subjectId))
        )
          throw new AlarmRuleError(
            'VALIDATION_ERROR',
            'The governed rule subject is inconsistent.',
          );
        const facts =
          condition.kind === 'observation_threshold'
            ? await this.observationFacts(client, selected, condition, input.effectiveAt, knownAt)
            : await this.allocationFacts(client, selected, input.effectiveAt, knownAt);
        const result = evaluateSegments(domainCondition(condition), facts, input.effectiveAt);
        const evaluation = alarmRuleEvaluationSchema.parse({
          ruleId,
          versionId: selected.versionId,
          effectiveAt: input.effectiveAt,
          knownAt,
          state: result.state,
          reason: result.reason,
          qualifyingStart: result.evidence.qualifyingStart,
          qualifyingEnd: result.evidence.qualifyingEnd,
          qualifyingDurationMicroseconds: result.evidence.qualifyingDurationMicroseconds.toString(),
          qualifyingFactCount: result.evidence.qualifyingFactCount,
          evidence: facts,
          dataClassification: 'synthetic',
          officialComplianceEligible: false,
          alarmEligible: false,
        });
        const fingerprint = `sha256:${createHash('sha256')
          .update(JSON.stringify({ condition, facts }))
          .digest('hex')}`;
        let run = (
          await client.query<{ id: string }>(
            `INSERT INTO alarm_rule_evaluation_runs(
              rule_id,rule_version_id,effective_at,known_at,input_fingerprint,
              algorithm_version,state,reason,result,evidence,evidence_count
            ) VALUES($1,$2,$3,$4,$5,'alarm-condition-v1',$6,$7,$8,$9,$10)
            ON CONFLICT(rule_version_id,effective_at,known_at,input_fingerprint)
            DO NOTHING
            RETURNING id`,
            [
              ruleId,
              selected.versionId,
              input.effectiveAt,
              knownAt,
              fingerprint,
              evaluation.state,
              evaluation.reason,
              JSON.stringify(evaluation),
              JSON.stringify(facts),
              facts.length,
            ],
          )
        ).rows[0];
        if (!run)
          run = (
            await client.query<{ id: string }>(
              `SELECT id FROM alarm_rule_evaluation_runs
               WHERE rule_version_id=$1 AND effective_at=$2 AND known_at=$3
                 AND input_fingerprint=$4`,
              [selected.versionId, input.effectiveAt, knownAt, fingerprint],
            )
          ).rows[0]!;
        await client.query(
          `INSERT INTO alarm_rule_current_signals(
            rule_id,evaluation_run_id,effective_at,known_at,state,updated_at
          ) VALUES($1,$2,$3,$4,$5,clock_timestamp())
          ON CONFLICT(rule_id) DO UPDATE SET
            evaluation_run_id=EXCLUDED.evaluation_run_id,effective_at=EXCLUDED.effective_at,
            known_at=EXCLUDED.known_at,state=EXCLUDED.state,updated_at=clock_timestamp()
          WHERE EXCLUDED.effective_at>alarm_rule_current_signals.effective_at
             OR (EXCLUDED.effective_at=alarm_rule_current_signals.effective_at
                 AND EXCLUDED.known_at>alarm_rule_current_signals.known_at)`,
          [ruleId, run.id, input.effectiveAt, knownAt, evaluation.state],
        );
        return evaluation;
      });
    } catch (issue) {
      return this.failure(issue);
    }
  }
}

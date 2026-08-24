import type {
  AllocationDeviationResult,
  AllocationEntryMeasurementBinding,
  CreateAllocationEntryMeasurementBindingRequest,
  CreateSectionTolerancePolicyRequest,
  RequestSectionTolerancePolicyVersionRequest,
  SectionTolerancePolicyRecord,
  SectionTolerancePolicyVersion,
  SectionTolerancePolicy,
} from '@isuv/contracts';
import { evaluateAllocationDeviation, type Rational } from '@isuv/domain';
import type { PoolClient } from 'pg';
import { withDatabase } from '../../db/client.js';
import { PostgresQuantityDerivationService } from '../quantity-derivation/service.js';

interface PlanRow {
  version_id: string;
  entry_id: string;
  interval_start: string;
  interval_end: string;
  planned_volume_m3: string;
  unit: 'm3';
  water_section_id: string;
  territory_id: string;
}
interface BindingRow {
  id: string;
  entry_id: string;
  station_id: string;
  sensor_id: string;
  device_installation_id: string;
  method: 'direct_discharge' | 'stage_rating_curve' | 'accumulated_volume_delta';
  reference_plane: 'upstream' | 'downstream' | 'on_section';
  purpose: 'section_delivery';
  provenance: string;
  created_by_user_id: string;
  creation_reason: string;
  created_request_id: string;
  created_at: string;
}
interface ToleranceRow {
  id: string;
  policy_id: string;
  water_section_id: string;
  effective_from: string;
  effective_until: string | null;
  approved_at: string;
  under_absolute_m3: string | null;
  over_absolute_m3: string | null;
  under_percent: string | null;
  over_percent: string | null;
  combination: 'all' | 'any';
  applies_to_zero_plan: boolean;
  provenance: string;
}
interface PolicyRecordRow {
  id: string;
  organization_id: string;
  territory_id: string;
  water_section_id: string;
  provenance: string;
  created_by_user_id: string;
  creation_reason: string;
  created_request_id: string;
  created_at: string;
}
interface PolicyVersionRow {
  id: string;
  policy_id: string;
  version: number;
  status: 'requested' | 'approved';
  effective_from: string;
  effective_until: string | null;
  under_absolute_m3: string | null;
  over_absolute_m3: string | null;
  under_percent: string | null;
  over_percent: string | null;
  combination: 'all' | 'any';
  applies_to_zero_plan: boolean;
  requested_by_user_id: string;
  requested_at: string;
  request_reason: string;
  approved_by_user_id: string | null;
  approved_at: string | null;
  approval_reason: string | null;
}
export class AllocationDeviationError extends Error {
  public constructor(
    public readonly kind: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR',
    message: string,
  ) {
    super(message);
  }
}
function interval(start: string, end: string) {
  return { start, end };
}
function timestampMicros(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i.exec(
    value,
  );
  if (!match) throw new Error('A validated UTC timestamp was expected.');
  return (
    BigInt(Date.parse(`${match[1]}${match[3]}`)) * 1000n + BigInt((match[2] ?? '').padEnd(6, '0'))
  );
}
function sameInstant(left: string | undefined, right: string): boolean {
  return left !== undefined && timestampMicros(left) === timestampMicros(right);
}
function rational(value: { numerator: string; denominator: string }): Rational {
  return { numerator: BigInt(value.numerator), denominator: BigInt(value.denominator) };
}
function exactM3(value: Rational) {
  return {
    numerator: value.numerator.toString(),
    denominator: value.denominator.toString(),
    unit: 'm3' as const,
  };
}
function exactPercent(value: Rational) {
  return {
    numerator: value.numerator.toString(),
    denominator: value.denominator.toString(),
    unit: 'percent' as const,
  };
}
function binding(row: BindingRow): AllocationEntryMeasurementBinding {
  return {
    id: row.id,
    entryId: row.entry_id,
    stationId: row.station_id,
    sensorId: row.sensor_id,
    deviceInstallationId: row.device_installation_id,
    method: row.method,
    referencePlane: row.reference_plane,
    purpose: row.purpose,
    provenance: row.provenance,
    createdByUserId: row.created_by_user_id,
    creationReason: row.creation_reason,
    createdRequestId: row.created_request_id,
    createdAt: row.created_at,
    dataClassification: 'synthetic',
    officialComplianceEligible: false,
  };
}
function tolerance(row: ToleranceRow): SectionTolerancePolicy {
  return {
    id: row.policy_id,
    versionId: row.id,
    waterSectionId: row.water_section_id,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    knownAt: row.approved_at,
    underAbsoluteM3: row.under_absolute_m3,
    overAbsoluteM3: row.over_absolute_m3,
    underPercent: row.under_percent,
    overPercent: row.over_percent,
    combination: row.combination,
    appliesToZeroPlan: row.applies_to_zero_plan,
    provenance: row.provenance,
    dataClassification: 'synthetic',
    officialComplianceEligible: false,
  };
}
function policyRecord(row: PolicyRecordRow): SectionTolerancePolicyRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    territoryId: row.territory_id,
    waterSectionId: row.water_section_id,
    provenance: row.provenance,
    createdByUserId: row.created_by_user_id,
    creationReason: row.creation_reason,
    createdRequestId: row.created_request_id,
    createdAt: row.created_at,
    dataClassification: 'synthetic',
    officialComplianceEligible: false,
  };
}
function policyVersion(row: PolicyVersionRow): SectionTolerancePolicyVersion {
  return {
    id: row.id,
    policyId: row.policy_id,
    version: row.version,
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    underAbsoluteM3: row.under_absolute_m3,
    overAbsoluteM3: row.over_absolute_m3,
    underPercent: row.under_percent,
    overPercent: row.over_percent,
    combination: row.combination,
    appliesToZeroPlan: row.applies_to_zero_plan,
    requestedByUserId: row.requested_by_user_id,
    requestedAt: row.requested_at,
    requestReason: row.request_reason,
    approvedByUserId: row.approved_by_user_id,
    approvedAt: row.approved_at,
    approvalReason: row.approval_reason,
    dataClassification: 'synthetic',
    officialComplianceEligible: false,
  };
}

export class PostgresAllocationDeviationService {
  public constructor(
    private readonly databaseUrl: string | undefined,
    private readonly transactionClient?: PoolClient,
  ) {}
  private async read<T>(action: (client: PoolClient) => Promise<T>) {
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
  private async transaction<T>(action: (client: PoolClient) => Promise<T>) {
    if (this.transactionClient) return action(this.transactionClient);
    return withDatabase(this.databaseUrl, async (pool) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await action(client);
        await client.query('COMMIT');
        return result;
      } catch (issue) {
        await client.query('ROLLBACK');
        throw issue;
      } finally {
        client.release();
      }
    });
  }
  private failure(issue: unknown): never {
    if (issue instanceof AllocationDeviationError) throw issue;
    const code = (issue as { code?: string } | undefined)?.code;
    if (code === '23P01' || code === '23505')
      throw new AllocationDeviationError('CONFLICT', 'The governed allocation record conflicts.');
    if (code === '23514' || code === '23503')
      throw new AllocationDeviationError(
        'VALIDATION_ERROR',
        'The governed allocation input is invalid.',
      );
    throw issue;
  }
  public async findPlanTerritory(planId: string): Promise<string | null> {
    return this.read(
      async (c) =>
        (
          await c.query<{ territory_id: string }>(
            'SELECT territory_id FROM allocation_plans WHERE id=$1',
            [planId],
          )
        ).rows[0]?.territory_id ?? null,
    );
  }
  public async findEntryTerritory(entryId: string): Promise<string | null> {
    return this.read(async (client) => {
      const result = await client.query<{ territory_id: string }>(
        `SELECT plan.territory_id FROM allocation_plan_entries entry_row
         JOIN allocation_plan_versions version_row ON version_row.id=entry_row.plan_version_id
         JOIN allocation_plans plan ON plan.id=version_row.plan_id WHERE entry_row.id=$1`,
        [entryId],
      );
      return result.rows[0]?.territory_id ?? null;
    });
  }
  public async findSectionTerritory(sectionId: string): Promise<string | null> {
    return this.read(async (client) => {
      const result = await client.query<{ territory_id: string }>(
        "SELECT territory_id FROM water_sections WHERE id=$1 AND lifecycle='active'",
        [sectionId],
      );
      return result.rows[0]?.territory_id ?? null;
    });
  }
  public async findTolerancePolicyTerritory(policyId: string): Promise<string | null> {
    return this.read(async (client) => {
      const result = await client.query<{ territory_id: string }>(
        'SELECT territory_id FROM section_tolerance_policies WHERE id=$1',
        [policyId],
      );
      return result.rows[0]?.territory_id ?? null;
    });
  }
  public async createBinding(
    entryId: string,
    input: CreateAllocationEntryMeasurementBindingRequest,
    actorUserId: string,
    requestId: string,
  ): Promise<AllocationEntryMeasurementBinding> {
    try {
      return await this.transaction(async (client) => {
        const result = await client.query<BindingRow>(
          `INSERT INTO allocation_plan_entry_measurement_bindings(entry_id,station_id,sensor_id,device_installation_id,method,reference_plane,purpose,data_classification,provenance,created_by_user_id,creation_reason,created_request_id)
           VALUES($1,$2,$3,$4,$5,$6,'section_delivery','synthetic',$7,$8,$9,$10)
           RETURNING id,entry_id,station_id,sensor_id,device_installation_id,method,reference_plane,purpose,provenance,created_by_user_id,creation_reason,created_request_id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at`,
          [
            entryId,
            input.stationId,
            input.sensorId,
            input.deviceInstallationId,
            input.method,
            input.referencePlane,
            input.provenance,
            actorUserId,
            input.reason,
            requestId,
          ],
        );
        return binding(result.rows[0]!);
      });
    } catch (issue) {
      return this.failure(issue);
    }
  }
  public async createTolerancePolicy(
    input: CreateSectionTolerancePolicyRequest,
    actorUserId: string,
    requestId: string,
  ): Promise<SectionTolerancePolicyRecord> {
    try {
      return await this.transaction(async (client) => {
        const result = await client.query<PolicyRecordRow>(
          `INSERT INTO section_tolerance_policies(organization_id,territory_id,water_section_id,data_classification,provenance,created_by_user_id,creation_reason,created_request_id)
           SELECT organization_id,territory_id,id,'synthetic',$2,$3,$4,$5 FROM water_sections WHERE id=$1 AND lifecycle='active'
           RETURNING id,organization_id,territory_id,water_section_id,provenance,created_by_user_id,creation_reason,created_request_id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at`,
          [input.waterSectionId, input.provenance, actorUserId, input.reason, requestId],
        );
        if (!result.rows[0])
          throw new AllocationDeviationError('NOT_FOUND', 'The water section was not found.');
        return policyRecord(result.rows[0]);
      });
    } catch (issue) {
      return this.failure(issue);
    }
  }
  public async requestToleranceVersion(
    policyId: string,
    input: RequestSectionTolerancePolicyVersionRequest,
    actorUserId: string,
    requestId: string,
  ): Promise<SectionTolerancePolicyVersion> {
    try {
      return await this.transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [policyId]);
        const policy = await client.query<{ id: string }>(
          'SELECT id FROM section_tolerance_policies WHERE id=$1 FOR UPDATE',
          [policyId],
        );
        if (!policy.rows[0])
          throw new AllocationDeviationError('NOT_FOUND', 'The tolerance policy was not found.');
        const result = await client.query<PolicyVersionRow>(
          `INSERT INTO section_tolerance_policy_versions(policy_id,version,status,effective_from,effective_until,under_absolute_m3,over_absolute_m3,under_percent,over_percent,combination,applies_to_zero_plan,requested_by_user_id,request_reason,requested_request_id)
           SELECT $1,COALESCE(max(version),0)+1,'requested',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 FROM section_tolerance_policy_versions WHERE policy_id=$1
           RETURNING id,policy_id,version,status,to_char(effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') effective_from,CASE WHEN effective_until IS NULL THEN NULL ELSE to_char(effective_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END effective_until,under_absolute_m3::text,over_absolute_m3::text,under_percent::text,over_percent::text,combination,applies_to_zero_plan,requested_by_user_id,to_char(requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') requested_at,request_reason,approved_by_user_id,CASE WHEN approved_at IS NULL THEN NULL ELSE to_char(approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END approved_at,approval_reason`,
          [
            policyId,
            input.effectiveFrom,
            input.effectiveUntil,
            input.underAbsoluteM3 ?? null,
            input.overAbsoluteM3 ?? null,
            input.underPercent ?? null,
            input.overPercent ?? null,
            input.combination,
            input.appliesToZeroPlan,
            actorUserId,
            input.reason,
            requestId,
          ],
        );
        return policyVersion(result.rows[0]!);
      });
    } catch (issue) {
      return this.failure(issue);
    }
  }
  public async approveToleranceVersion(
    policyId: string,
    version: number,
    reason: string,
    actorUserId: string,
    requestId: string,
    options: { allowSyntheticHistoricalEffectiveTime?: boolean } = {},
  ): Promise<SectionTolerancePolicyVersion> {
    try {
      return await this.transaction(async (client) => {
        if (options.allowSyntheticHistoricalEffectiveTime)
          await client.query("SET LOCAL isuv.seed_allow_synthetic_historical_tolerance='on'");
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [policyId]);
        const result = await client.query<PolicyVersionRow>(
          `UPDATE section_tolerance_policy_versions SET status='approved',approved_by_user_id=$3,approval_reason=$4,approved_request_id=$5
           WHERE policy_id=$1 AND version=$2 AND status='requested'
           RETURNING id,policy_id,version,status,to_char(effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') effective_from,CASE WHEN effective_until IS NULL THEN NULL ELSE to_char(effective_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END effective_until,under_absolute_m3::text,over_absolute_m3::text,under_percent::text,over_percent::text,combination,applies_to_zero_plan,requested_by_user_id,to_char(requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') requested_at,request_reason,approved_by_user_id,CASE WHEN approved_at IS NULL THEN NULL ELSE to_char(approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END approved_at,approval_reason`,
          [policyId, version, actorUserId, reason, requestId],
        );
        if (!result.rows[0])
          throw new AllocationDeviationError(
            'CONFLICT',
            'Only a requested tolerance version can be approved.',
          );
        return policyVersion(result.rows[0]);
      });
    } catch (issue) {
      return this.failure(issue);
    }
  }
  public async deviation(
    planId: string,
    input: { intervalStart: string; intervalEnd: string; knownAt?: string },
  ): Promise<AllocationDeviationResult> {
    return this.read(async (client) => {
      const knownAt = input.knownAt ?? new Date().toISOString();
      const requested = interval(input.intervalStart, input.intervalEnd);
      const plan = await client.query<PlanRow>(
        `SELECT version_row.id version_id,entry_row.id entry_id,to_char(entry_row.interval_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') interval_start,to_char(entry_row.interval_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') interval_end,entry_row.planned_volume_m3::text,entry_row.unit,plan_row.water_section_id,plan_row.territory_id
        FROM allocation_plans plan_row JOIN allocation_plan_versions version_row ON version_row.plan_id=plan_row.id JOIN allocation_plan_entries entry_row ON entry_row.plan_version_id=version_row.id
        WHERE plan_row.id=$1 AND version_row.status IN ('approved','superseded') AND version_row.approved_at<=$4 AND version_row.effective_from<=$2 AND (CASE WHEN version_row.status='superseded' AND version_row.superseded_at<=$4 THEN COALESCE(version_row.superseded_effective_at,version_row.effective_until) ELSE version_row.effective_until END IS NULL OR CASE WHEN version_row.status='superseded' AND version_row.superseded_at<=$4 THEN COALESCE(version_row.superseded_effective_at,version_row.effective_until) ELSE version_row.effective_until END>$2) AND entry_row.interval_start=$2 AND entry_row.interval_end=$3 ORDER BY version_row.effective_from DESC,version_row.version DESC LIMIT 1`,
        [planId, input.intervalStart, input.intervalEnd, knownAt],
      );
      if (!plan.rows[0]) {
        const active = await client.query<{ id: string }>(
          `SELECT id FROM allocation_plan_versions WHERE plan_id=$1 AND status IN ('approved','superseded') AND approved_at<=$3 AND effective_from<=$2 AND (CASE WHEN status='superseded' AND superseded_at<=$3 THEN COALESCE(superseded_effective_at,effective_until) ELSE effective_until END IS NULL OR CASE WHEN status='superseded' AND superseded_at<=$3 THEN COALESCE(superseded_effective_at,effective_until) ELSE effective_until END>$2) ORDER BY effective_from DESC,version DESC LIMIT 1`,
          [planId, input.intervalStart, knownAt],
        );
        const containing = active.rows[0]
          ? await client.query<{ id: string }>(
              'SELECT id FROM allocation_plan_entries WHERE plan_version_id=$1 AND interval_start<=$2 AND interval_end>$2 ORDER BY interval_start DESC LIMIT 1',
              [active.rows[0].id, input.intervalStart],
            )
          : null;
        const outcome = !active.rows[0]
          ? 'no_approved_plan'
          : containing?.rows[0]
            ? 'plan_interval_not_exact'
            : 'schedule_gap';
        return {
          outcome,
          condition: 'unassessable',
          planVersionId: active.rows[0]?.id ?? null,
          planEntryId: containing?.rows[0]?.id ?? null,
          interval: requested,
          knownAt,
          plannedEntry: null,
          binding: null,
          tolerance: null,
          actual: null,
          delta: null,
          absoluteDelta: null,
          percent: null,
          percentageReason: null,
          dataClassification: 'synthetic',
          officialComplianceEligible: false,
        };
      }
      const row = plan.rows[0];
      const entry = {
        intervalStart: row.interval_start,
        intervalEnd: row.interval_end,
        plannedVolume: row.planned_volume_m3,
        unit: 'm3' as const,
        targetSemantics: 'whole_interval_target_no_proration' as const,
      };
      const bindingRows = await client.query<BindingRow>(
        `SELECT id,entry_id,station_id,sensor_id,device_installation_id,method,reference_plane,purpose,provenance,created_by_user_id,creation_reason,created_request_id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at FROM allocation_plan_entry_measurement_bindings WHERE entry_id=$1 AND created_at<=$2`,
        [row.entry_id, knownAt],
      );
      if (!bindingRows.rows[0])
        return {
          outcome: 'missing_measurement_binding',
          condition: 'unassessable',
          planVersionId: row.version_id,
          planEntryId: row.entry_id,
          interval: requested,
          knownAt,
          plannedEntry: entry,
          binding: null,
          tolerance: null,
          actual: null,
          delta: null,
          absoluteDelta: null,
          percent: null,
          percentageReason: null,
          dataClassification: 'synthetic',
          officialComplianceEligible: false,
        };
      const measure = binding(bindingRows.rows[0]);
      const policies = await client.query<ToleranceRow>(
        `SELECT version_row.id,version_row.policy_id,policy.water_section_id,to_char(version_row.effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') effective_from,CASE WHEN version_row.effective_until IS NULL THEN NULL ELSE to_char(version_row.effective_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END effective_until,to_char(version_row.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') approved_at,version_row.under_absolute_m3::text,version_row.over_absolute_m3::text,version_row.under_percent::text,version_row.over_percent::text,version_row.combination,version_row.applies_to_zero_plan,policy.provenance FROM section_tolerance_policies policy JOIN section_tolerance_policy_versions version_row ON version_row.policy_id=policy.id WHERE policy.water_section_id=$1 AND version_row.effective_from<=$2 AND (version_row.effective_until IS NULL OR version_row.effective_until>=$3) AND version_row.approved_at<=$4 ORDER BY version_row.effective_from DESC,version_row.version DESC LIMIT 1`,
        [row.water_section_id, input.intervalStart, input.intervalEnd, knownAt],
      );
      if (!policies.rows[0])
        return {
          outcome: 'no_approved_tolerance',
          condition: 'unassessable',
          planVersionId: row.version_id,
          planEntryId: row.entry_id,
          interval: requested,
          knownAt,
          plannedEntry: entry,
          binding: measure,
          tolerance: null,
          actual: null,
          delta: null,
          absoluteDelta: null,
          percent: null,
          percentageReason: null,
          dataClassification: 'synthetic',
          officialComplianceEligible: false,
        };
      const policy = tolerance(policies.rows[0]);
      const actual = await new PostgresQuantityDerivationService(this.databaseUrl, client).derive(
        measure.stationId,
        {
          sensorId: measure.sensorId,
          method: measure.method,
          intervalStart: input.intervalStart,
          intervalEnd: input.intervalEnd,
          knownAt,
        },
      );
      if (actual.outcome !== 'computed')
        return {
          outcome: 'actual_not_eligible',
          condition: 'unassessable',
          planVersionId: row.version_id,
          planEntryId: row.entry_id,
          interval: requested,
          knownAt,
          plannedEntry: entry,
          binding: measure,
          tolerance: policy,
          actual,
          delta: null,
          absoluteDelta: null,
          percent: null,
          percentageReason: null,
          dataClassification: 'synthetic',
          officialComplianceEligible: false,
        };
      if (measure.method === 'stage_rating_curve' || actual.qualityState === 'estimated')
        return {
          outcome: 'estimated_not_eligible',
          condition: 'unassessable',
          planVersionId: row.version_id,
          planEntryId: row.entry_id,
          interval: requested,
          knownAt,
          plannedEntry: entry,
          binding: measure,
          tolerance: policy,
          actual,
          delta: null,
          absoluteDelta: null,
          percent: null,
          percentageReason: null,
          dataClassification: 'synthetic',
          officialComplianceEligible: false,
        };
      if (
        actual.coverage !== 'complete' ||
        actual.qualityState !== 'valid' ||
        actual.method !== measure.method ||
        !sameInstant(actual.requestedInterval.start, input.intervalStart) ||
        !sameInstant(actual.requestedInterval.end, input.intervalEnd) ||
        !sameInstant(actual.coveredInterval?.start, input.intervalStart) ||
        !sameInstant(actual.coveredInterval?.end, input.intervalEnd) ||
        !['direct_discharge', 'accumulated_volume_delta'].includes(measure.method)
      )
        return {
          outcome: 'actual_not_eligible',
          condition: 'unassessable',
          planVersionId: row.version_id,
          planEntryId: row.entry_id,
          interval: requested,
          knownAt,
          plannedEntry: entry,
          binding: measure,
          tolerance: policy,
          actual,
          delta: null,
          absoluteDelta: null,
          percent: null,
          percentageReason: null,
          dataClassification: 'synthetic',
          officialComplianceEligible: false,
        };
      const result = evaluateAllocationDeviation(
        entry.plannedVolume,
        rational(actual.volume),
        policy,
      );
      return {
        outcome: 'computed',
        condition: result.condition,
        planVersionId: row.version_id,
        planEntryId: row.entry_id,
        interval: requested,
        knownAt,
        plannedEntry: entry,
        binding: measure,
        tolerance: policy,
        actual,
        delta: exactM3(result.delta),
        absoluteDelta: exactM3(result.absoluteDelta),
        percent: result.percent ? exactPercent(result.percent) : null,
        percentageReason: result.percent ? null : 'planned_volume_zero',
        dataClassification: 'synthetic',
        officialComplianceEligible: false,
      };
    });
  }
}

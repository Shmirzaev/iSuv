import type {
  AllocationPlanHistoryQuery,
  AllocationPlanVersion,
  AppendAllocationPlanVersionRequest,
  ApproveAllocationPlanVersionRequest,
  CreateAllocationPlanRequest,
  PlannedDeliveryEntry,
} from '@isuv/contracts';
import { allocationPlanVersionSchema } from '@isuv/contracts';
import { withDatabase } from '../../db/client.js';
import type { PoolClient } from 'pg';

export class AllocationPlanError extends Error {
  public constructor(
    public readonly kind: 'NOT_FOUND' | 'VALIDATION_ERROR' | 'CONFLICT',
    message: string,
  ) {
    super(message);
  }
}
interface VersionRow {
  id: string;
  plan_id: string;
  version: number;
  organization_id: string;
  territory_id: string;
  water_section_id: string;
  data_classification: 'synthetic';
  status: AllocationPlanVersion['status'];
  effective_from: string;
  effective_until: string | null;
  drafted_by_user_id: string;
  drafted_at: string;
  requested_by_user_id: string | null;
  requested_at: string | null;
  request_reason: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  approval_reason: string | null;
  legal_reference: string | null;
  superseded_effective_at: string | null;
  superseded_at: string | null;
  superseded_by_version_id: string | null;
  supersession_known?: boolean;
}
const selectVersion = `SELECT v.id, v.plan_id, v.version, p.organization_id, p.territory_id, p.water_section_id, p.data_classification, v.status,
 to_char(v.effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') effective_from,
 CASE WHEN v.effective_until IS NULL THEN NULL ELSE to_char(v.effective_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END effective_until,
 v.drafted_by_user_id, to_char(v.drafted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') drafted_at,
 v.requested_by_user_id, CASE WHEN v.requested_at IS NULL THEN NULL ELSE to_char(v.requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END requested_at, v.request_reason,
 v.approved_by_user_id, CASE WHEN v.approved_at IS NULL THEN NULL ELSE to_char(v.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END approved_at,
 v.approval_reason, v.legal_reference,
 CASE WHEN v.superseded_effective_at IS NULL THEN NULL ELSE to_char(v.superseded_effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END superseded_effective_at,
 CASE WHEN v.superseded_at IS NULL THEN NULL ELSE to_char(v.superseded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END superseded_at
 ,v.superseded_by_version_id
 FROM allocation_plan_versions v JOIN allocation_plans p ON p.id = v.plan_id`;
function entry(row: {
  interval_start: string;
  interval_end: string;
  planned_volume_m3: string;
  unit: string;
}): PlannedDeliveryEntry {
  return {
    intervalStart: row.interval_start,
    intervalEnd: row.interval_end,
    plannedVolume: row.planned_volume_m3.includes('.')
      ? row.planned_volume_m3.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
      : row.planned_volume_m3,
    unit: 'm3',
    targetSemantics: 'whole_interval_target_no_proration',
  };
}
type Queryable = Pick<PoolClient, 'query'>;
async function materialize(client: Queryable, row: VersionRow): Promise<AllocationPlanVersion> {
  const entries = await client.query<{
    interval_start: string;
    interval_end: string;
    planned_volume_m3: string;
    unit: string;
  }>(
    `SELECT to_char(interval_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') interval_start,
            to_char(interval_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') interval_end, planned_volume_m3::text, unit
     FROM allocation_plan_entries WHERE plan_version_id = $1 ORDER BY interval_start, id`,
    [row.id],
  );
  return allocationPlanVersionSchema.parse({
    id: row.id,
    planId: row.plan_id,
    version: row.version,
    organizationId: row.organization_id,
    territoryId: row.territory_id,
    waterSectionId: row.water_section_id,
    dataClassification: row.data_classification,
    status: row.status,
    effectiveFrom: row.effective_from,
    declaredEffectiveUntil: row.effective_until,
    governedEffectiveUntil: row.superseded_effective_at ?? row.effective_until,
    entries: entries.rows.map(entry),
    draftedByUserId: row.drafted_by_user_id,
    draftedAt: row.drafted_at,
    requestedByUserId: row.requested_by_user_id,
    requestedAt: row.requested_at,
    requestReason: row.request_reason,
    approvedByUserId: row.approved_by_user_id,
    approvedAt: row.approved_at,
    approvalReason: row.approval_reason,
    legalReference: row.legal_reference,
    supersededEffectiveAt: row.superseded_effective_at,
    supersededAt: row.superseded_at,
    supersededByVersionId: row.superseded_by_version_id,
    officialComplianceEligible: false,
  });
}
export class PostgresAllocationPlanService {
  public constructor(
    private readonly databaseUrl: string | undefined,
    private readonly transactionClient?: PoolClient,
  ) {}
  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    if (this.transactionClient) {
      await this.transactionClient.query('SAVEPOINT allocation_plan_operation');
      try {
        const result = await action(this.transactionClient);
        await this.transactionClient.query('RELEASE SAVEPOINT allocation_plan_operation');
        return result;
      } catch (error) {
        await this.transactionClient.query('ROLLBACK TO SAVEPOINT allocation_plan_operation');
        await this.transactionClient.query('RELEASE SAVEPOINT allocation_plan_operation');
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
  public async findSectionTerritory(sectionId: string): Promise<string | null> {
    return withDatabase(
      this.databaseUrl,
      async (pool) =>
        (
          await pool.query<{ territory_id: string }>(
            "SELECT territory_id FROM water_sections WHERE id=$1 AND lifecycle='active'",
            [sectionId],
          )
        ).rows[0]?.territory_id ?? null,
    );
  }
  public async findPlanTerritory(planId: string): Promise<string | null> {
    return withDatabase(
      this.databaseUrl,
      async (pool) =>
        (
          await pool.query<{ territory_id: string }>(
            'SELECT territory_id FROM allocation_plans WHERE id=$1',
            [planId],
          )
        ).rows[0]?.territory_id ?? null,
    );
  }
  private async insertVersion(
    client: PoolClient,
    planId: string,
    actorUserId: string,
    content: AppendAllocationPlanVersionRequest,
    requestId: string,
  ): Promise<AllocationPlanVersion> {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [planId]);
    const plan = await client.query<{
      organization_id: string;
      territory_id: string;
      data_classification: 'synthetic';
    }>(
      'SELECT organization_id, territory_id, data_classification FROM allocation_plans WHERE id=$1 FOR UPDATE',
      [planId],
    );
    if (!plan.rows[0])
      throw new AllocationPlanError('NOT_FOUND', 'The allocation plan was not found.');
    const version = await client.query<{ id: string }>(
      `INSERT INTO allocation_plan_versions(plan_id,version,effective_from,effective_until,drafted_by_user_id,draft_reason,draft_request_id)
      SELECT $1, COALESCE(MAX(version),0)+1, $2, $3, $4, $5, $6 FROM allocation_plan_versions WHERE plan_id=$1 RETURNING id`,
      [
        planId,
        content.effectiveFrom,
        content.effectiveUntil ?? null,
        actorUserId,
        content.reason,
        requestId,
      ],
    );
    for (const item of content.entries)
      await client.query(
        "INSERT INTO allocation_plan_entries(plan_version_id,interval_start,interval_end,planned_volume_m3,unit,created_by_user_id,creation_reason,created_request_id) VALUES($1,$2,$3,$4,'m3',$5,$6,$7)",
        [
          version.rows[0]!.id,
          item.intervalStart,
          item.intervalEnd,
          item.plannedVolume,
          actorUserId,
          content.reason,
          requestId,
        ],
      );
    const row = await client.query<VersionRow>(`${selectVersion} WHERE v.id=$1`, [
      version.rows[0]!.id,
    ]);
    return materialize(client, row.rows[0]!);
  }
  public async create(
    input: CreateAllocationPlanRequest,
    actorUserId: string,
    requestId: string,
  ): Promise<AllocationPlanVersion> {
    return this.transaction(async (client) => {
      const section = await client.query<{
        organization_id: string;
        territory_id: string;
      }>(
        "SELECT organization_id,territory_id FROM water_sections WHERE id=$1 AND lifecycle='active' FOR UPDATE",
        [input.waterSectionId],
      );
      if (!section.rows[0])
        throw new AllocationPlanError('NOT_FOUND', 'The water section was not found.');
      const plan = await client.query<{ id: string }>(
        'INSERT INTO allocation_plans(organization_id,territory_id,water_section_id,data_classification,created_by_user_id,creation_reason,created_request_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [
          section.rows[0].organization_id,
          section.rows[0].territory_id,
          input.waterSectionId,
          'synthetic',
          actorUserId,
          input.reason,
          requestId,
        ],
      );
      return this.insertVersion(client, plan.rows[0]!.id, actorUserId, input, requestId);
    });
  }
  public async append(
    planId: string,
    input: AppendAllocationPlanVersionRequest,
    actorUserId: string,
    requestId: string,
  ): Promise<AllocationPlanVersion> {
    return this.transaction((client) =>
      this.insertVersion(client, planId, actorUserId, input, requestId),
    );
  }
  public async request(
    planId: string,
    version: number,
    reason: string,
    actorUserId: string,
    requestId: string,
  ): Promise<AllocationPlanVersion> {
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [planId]);
      const old = await client.query<VersionRow>(
        `${selectVersion} WHERE v.plan_id=$1 AND v.version=$2 FOR UPDATE`,
        [planId, version],
      );
      if (!old.rows[0])
        throw new AllocationPlanError('NOT_FOUND', 'The allocation plan version was not found.');
      const updated = await client.query<{ id: string }>(
        `UPDATE allocation_plan_versions SET status='requested',requested_by_user_id=$2,requested_at=clock_timestamp(),request_reason=$3,requested_request_id=$4 WHERE id=$1 AND status='draft' RETURNING id`,
        [old.rows[0].id, actorUserId, reason, requestId],
      );
      if (!updated.rows[0])
        throw new AllocationPlanError(
          'CONFLICT',
          'Only a draft allocation plan version can be requested.',
        );
      const changed = await client.query<VersionRow>(`${selectVersion} WHERE v.id=$1`, [
        updated.rows[0].id,
      ]);
      const after = await materialize(client, changed.rows[0]!);
      return after;
    });
  }
  public async approve(
    planId: string,
    version: number,
    input: ApproveAllocationPlanVersionRequest,
    actorUserId: string,
    requestId: string,
    options: { allowSyntheticHistoricalEffectiveTime?: boolean } = {},
  ): Promise<AllocationPlanVersion> {
    return this.transaction(async (client) => {
      if (options.allowSyntheticHistoricalEffectiveTime)
        await client.query("SET LOCAL isuv.seed_allow_synthetic_historical_plan='on'");
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [planId]);
      const old = await client.query<VersionRow>(
        `${selectVersion} WHERE v.plan_id=$1 AND v.version=$2 FOR UPDATE`,
        [planId, version],
      );
      if (!old.rows[0])
        throw new AllocationPlanError('NOT_FOUND', 'The allocation plan version was not found.');
      const backdated = await client.query<{
        backdated: boolean;
        data_classification: 'synthetic' | 'official';
      }>(
        'SELECT version_row.effective_from < clock_timestamp() AS backdated,plan.data_classification FROM allocation_plan_versions version_row JOIN allocation_plans plan ON plan.id=version_row.plan_id WHERE version_row.id=$1',
        [old.rows[0].id],
      );
      if (
        backdated.rows[0]?.backdated &&
        !(
          options.allowSyntheticHistoricalEffectiveTime &&
          backdated.rows[0].data_classification === 'synthetic'
        )
      )
        throw new AllocationPlanError(
          'VALIDATION_ERROR',
          'An allocation plan cannot be approved with an effective time before approval.',
        );
      const cut = await client.query<{ id: string }>(
        `SELECT v.id FROM allocation_plan_versions v JOIN allocation_plan_entries e ON e.plan_version_id=v.id WHERE v.plan_id=$1 AND v.status='approved' AND e.interval_start < $2 AND e.interval_end > $2 LIMIT 1`,
        [planId, old.rows[0].effective_from],
      );
      if (cut.rows[0])
        throw new AllocationPlanError(
          'CONFLICT',
          'The candidate effective boundary cuts an approved plan entry.',
        );
      const conflicting = await client.query<VersionRow>(
        `${selectVersion} WHERE v.plan_id=$1 AND v.status='approved' AND v.effective_from < $2 AND (v.effective_until IS NULL OR v.effective_until > $2) FOR UPDATE`,
        [planId, old.rows[0].effective_from],
      );
      const laterOverlap = await client.query<{ id: string }>(
        `SELECT id FROM allocation_plan_versions WHERE plan_id=$1 AND status='approved' AND effective_from >= $2 AND ($3::timestamptz IS NULL OR effective_from < $3::timestamptz) LIMIT 1 FOR UPDATE`,
        [planId, old.rows[0].effective_from, old.rows[0].effective_until],
      );
      if (laterOverlap.rows[0])
        throw new AllocationPlanError(
          'CONFLICT',
          'The candidate allocation plan overlaps an approved version.',
        );
      // The successor becomes approved first. The deferred governed-range
      // exclusion permits this transient overlap only while this transaction
      // then records the exact predecessor supersession(s).
      const approved = await client.query<{ id: string }>(
        `UPDATE allocation_plan_versions SET status='approved',approved_by_user_id=$2,approved_at=clock_timestamp(),approval_reason=$3,legal_reference=$4,approved_request_id=$5 WHERE id=$1 AND status='requested' AND requested_by_user_id<>$2 RETURNING id`,
        [old.rows[0].id, actorUserId, input.reason, input.legalReference, requestId],
      );
      if (!approved.rows[0])
        throw new AllocationPlanError(
          'CONFLICT',
          'A distinct approver must approve a requested allocation plan version.',
        );
      const changed = await client.query<VersionRow>(`${selectVersion} WHERE v.id=$1`, [
        approved.rows[0].id,
      ]);
      const after = await materialize(client, changed.rows[0]!);
      for (const prior of conflicting.rows) {
        const changedPrior = await client.query<{ id: string }>(
          `UPDATE allocation_plan_versions SET status='superseded',superseded_effective_at=$2,superseded_at=(SELECT approved_at FROM allocation_plan_versions WHERE id=$3),superseded_by_version_id=$3,superseded_by_user_id=$4,supersession_reason=$5,superseded_request_id=$6 WHERE id=$1 RETURNING id`,
          [
            prior.id,
            old.rows[0].effective_from,
            old.rows[0].id,
            actorUserId,
            input.reason,
            requestId,
          ],
        );
        if (!changedPrior.rows[0])
          throw new AllocationPlanError(
            'CONFLICT',
            'The predecessor allocation plan could not be superseded.',
          );
      }
      return after;
    });
  }
  public async current(
    planId: string,
    effectiveAt: string,
    knownAt: string,
  ): Promise<{
    resolution: 'planned' | 'no_plan';
    noPlanReason: 'no_approved_plan' | 'schedule_gap' | null;
    effectiveAt: string;
    knownAt: string;
    planVersion: AllocationPlanVersion | null;
    entry: PlannedDeliveryEntry | null;
  }> {
    const execute = async (
      pool: Queryable,
    ): Promise<{
      resolution: 'planned' | 'no_plan';
      noPlanReason: 'no_approved_plan' | 'schedule_gap' | null;
      effectiveAt: string;
      knownAt: string;
      planVersion: AllocationPlanVersion | null;
      entry: PlannedDeliveryEntry | null;
    }> => {
      const row = await pool.query<VersionRow>(
        `${selectVersion.replace(' FROM allocation_plan_versions v', ', (v.superseded_at IS NOT NULL AND v.superseded_at <= $3::timestamptz) supersession_known FROM allocation_plan_versions v')} WHERE v.plan_id=$1 AND v.status IN ('approved','superseded') AND v.approved_at <= $3 AND v.effective_from <= $2
          AND (CASE WHEN v.status='superseded' AND v.superseded_at <= $3 THEN COALESCE(v.superseded_effective_at,v.effective_until) ELSE v.effective_until END IS NULL
               OR CASE WHEN v.status='superseded' AND v.superseded_at <= $3 THEN COALESCE(v.superseded_effective_at,v.effective_until) ELSE v.effective_until END > $2)
          ORDER BY v.effective_from DESC LIMIT 1`,
        [planId, effectiveAt, knownAt],
      );
      if (!row.rows[0])
        return {
          resolution: 'no_plan',
          noPlanReason: 'no_approved_plan',
          effectiveAt,
          knownAt,
          planVersion: null,
          entry: null,
        };
      const entries = await pool.query<{
        interval_start: string;
        interval_end: string;
        planned_volume_m3: string;
        unit: string;
      }>(
        `SELECT to_char(interval_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') interval_start,to_char(interval_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') interval_end,planned_volume_m3::text,unit FROM allocation_plan_entries WHERE plan_version_id=$1 AND interval_start <= $2 AND interval_end > $2 ORDER BY interval_start DESC LIMIT 1`,
        [row.rows[0].id, effectiveAt],
      );
      const materialized = await materialize(pool, row.rows[0]);
      const supersessionKnown = row.rows[0].supersession_known === true;
      const version = allocationPlanVersionSchema.parse({
        ...materialized,
        status: supersessionKnown ? 'superseded' : 'approved',
        governedEffectiveUntil: supersessionKnown
          ? row.rows[0].superseded_effective_at
          : materialized.declaredEffectiveUntil,
        supersededEffectiveAt: supersessionKnown ? materialized.supersededEffectiveAt : null,
        supersededAt: supersessionKnown ? materialized.supersededAt : null,
        supersededByVersionId: supersessionKnown ? materialized.supersededByVersionId : null,
      });
      return entries.rows[0]
        ? {
            resolution: 'planned',
            noPlanReason: null,
            effectiveAt,
            knownAt,
            planVersion: version,
            entry: entry(entries.rows[0]),
          }
        : {
            resolution: 'no_plan',
            noPlanReason: 'schedule_gap',
            effectiveAt,
            knownAt,
            planVersion: version,
            entry: null,
          };
    };
    if (this.transactionClient) return execute(this.transactionClient);
    return withDatabase(this.databaseUrl, execute);
  }
  public async history(
    planId: string,
    query: AllocationPlanHistoryQuery,
  ): Promise<{ versions: AllocationPlanVersion[]; nextCursor: string | null }> {
    const execute = async (pool: Queryable) => {
      let cursor: [number, string] | null = null;
      if (query.cursor) {
        try {
          const parsed: unknown = JSON.parse(
            Buffer.from(query.cursor, 'base64url').toString('utf8'),
          );
          if (
            !Array.isArray(parsed) ||
            parsed.length !== 2 ||
            !Number.isInteger(parsed[0]) ||
            parsed[0] < 1 ||
            parsed[0] > 2_147_483_647 ||
            typeof parsed[1] !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              parsed[1],
            )
          )
            throw new Error();
          cursor = [parsed[0], parsed[1]];
        } catch {
          throw new AllocationPlanError(
            'VALIDATION_ERROR',
            'The allocation plan history cursor is invalid.',
          );
        }
      }
      const values: unknown[] = [planId];
      let where = 'v.plan_id=$1';
      if (cursor) {
        values.push(cursor[0], cursor[1]);
        where += ' AND (v.version,v.id) < ($2::int,$3::uuid)';
      }
      values.push(query.limit + 1);
      const rows = await pool.query<VersionRow>(
        `${selectVersion} WHERE ${where} ORDER BY v.version DESC,v.id DESC LIMIT $${values.length}`,
        values,
      );
      const selected = rows.rows.slice(0, query.limit);
      const versions = await Promise.all(selected.map((row) => materialize(pool, row)));
      const last = selected.at(-1);
      return {
        versions,
        nextCursor:
          rows.rows.length > query.limit && last
            ? Buffer.from(JSON.stringify([last.version, last.id])).toString('base64url')
            : null,
      };
    };
    if (this.transactionClient) return execute(this.transactionClient);
    return withDatabase(this.databaseUrl, execute);
  }
}

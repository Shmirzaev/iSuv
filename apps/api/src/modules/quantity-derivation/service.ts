import type {
  DerivedVolumeResult,
  QuantityDerivationMethod,
  RatingCurveVersion,
} from '@isuv/contracts';
import {
  deriveCounterInterval,
  integrateSeries,
  interpolateStage,
  parseExactDecimal,
  type ExactObservation,
  type RatingKnot,
} from '@isuv/domain';
import type { PoolClient } from 'pg';
import { withDatabase } from '../../db/client.js';

export class QuantityDerivationError extends Error {
  public constructor(
    public readonly kind: 'NOT_FOUND' | 'VALIDATION_ERROR',
    message: string,
  ) {
    super(message);
  }
}
interface CurveRow {
  id: string;
  curve_id: string;
  version: number;
  organization_id: string;
  territory_id: string;
  station_id: string;
  stage_sensor_id: string;
  device_installation_id: string;
  effective_from: string;
  effective_until: string | null;
  approved_at: string;
  knots: RatingKnot[];
  provenance: string;
}
interface PolicyRow {
  id: string;
  policy_id: string;
  version: number;
  organization_id: string;
  territory_id: string;
  station_id: string;
  sensor_id: string;
  device_installation_id: string;
  method: QuantityDerivationMethod;
  effective_from: string;
  effective_until: string | null;
  approved_at: string;
  max_gap_microseconds: string;
  provenance: string;
}
type ObservationRow = ExactObservation;
const curveSelect = `SELECT version.id,version.curve_id,version.version,curve.organization_id,curve.territory_id,curve.station_id,curve.stage_sensor_id,curve.device_installation_id,
 to_char(version.effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') effective_from,
 CASE WHEN version.effective_until IS NULL THEN NULL ELSE to_char(version.effective_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END effective_until,
 to_char(version.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') approved_at,version.knots,curve.provenance
 FROM rating_curve_versions version JOIN rating_curves curve ON curve.id=version.curve_id`;
const policySelect = `SELECT version.id,version.policy_id,version.version,policy.organization_id,policy.territory_id,policy.station_id,policy.sensor_id,policy.device_installation_id,policy.method,
 to_char(version.effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') effective_from,
 CASE WHEN version.effective_until IS NULL THEN NULL ELSE to_char(version.effective_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END effective_until,
 to_char(version.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') approved_at,version.max_gap_microseconds::text,policy.provenance
 FROM integration_coverage_policy_versions version JOIN integration_coverage_policies policy ON policy.id=version.policy_id`;
function curve(row: CurveRow): RatingCurveVersion {
  return {
    id: row.id,
    curveId: row.curve_id,
    version: row.version,
    organizationId: row.organization_id,
    territoryId: row.territory_id,
    stationId: row.station_id,
    stageSensorId: row.stage_sensor_id,
    deviceInstallationId: row.device_installation_id,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    knownAt: row.approved_at,
    knots: row.knots,
    algorithm: 'synthetic_piecewise_linear_v1',
    hydraulicAssumptions: 'stationary_single_valued_no_hysteresis',
    provenance: row.provenance,
    dataClassification: 'synthetic',
    officialComplianceEligible: false,
  };
}
function sourceRefs(observations: readonly ExactObservation[]) {
  return observations.map((row) => ({
    lineageId: row.lineageId,
    revisionId: row.revisionId,
    observedAt: row.observedAt,
    sensorId: row.sensorId,
    deviceInstallationId: row.deviceInstallationId,
    measurementMethod: row.measurementMethod,
    totalizerTransition: row.totalizerTransition as
      'normal' | 'reset_reported' | 'rollover_reported' | 'unknown' | null,
    workflowState: row.workflowState as
      | 'raw'
      | 'automatically_validated'
      | 'expert_validated'
      | 'corrected'
      | 'estimated'
      | 'rejected',
    qualityState: row.qualityState as 'unknown' | 'valid' | 'suspect' | 'invalid' | 'estimated',
  }));
}
export class PostgresQuantityDerivationService {
  public constructor(
    private readonly databaseUrl: string | undefined,
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
  public async findStationTerritory(stationId: string): Promise<string | null> {
    return this.read(
      async (client) =>
        (
          await client.query<{ territory_id: string }>(
            'SELECT territory_id FROM monitoring_stations WHERE id=$1',
            [stationId],
          )
        ).rows[0]?.territory_id ?? null,
    );
  }
  public async findRatingCurve(
    curveId: string,
    effectiveAt: string,
    knownAt: string,
  ): Promise<RatingCurveVersion | null> {
    return this.read(async (client) => {
      const result = await client.query<CurveRow>(
        `${curveSelect} WHERE version.curve_id=$1 AND version.effective_from <= $2 AND (version.effective_until IS NULL OR version.effective_until>$2) AND version.approved_at <= $3 ORDER BY version.effective_from DESC,version.version DESC LIMIT 1`,
        [curveId, effectiveAt, knownAt],
      );
      return result.rows[0] ? curve(result.rows[0]) : null;
    });
  }
  public async derive(
    stationId: string,
    input: {
      sensorId: string;
      method: QuantityDerivationMethod;
      intervalStart: string;
      intervalEnd: string;
      knownAt?: string | undefined;
    },
  ): Promise<DerivedVolumeResult> {
    return this.read(async (client) => {
      const knownAt = input.knownAt ?? new Date().toISOString();
      const interval = { start: input.intervalStart, end: input.intervalEnd };
      const policies = await client.query<PolicyRow>(
        `${policySelect} WHERE policy.station_id=$1 AND policy.sensor_id=$2 AND policy.method=$3 AND version.effective_from <= $4 AND (version.effective_until IS NULL OR version.effective_until >= $5) AND version.approved_at <= $6 ORDER BY version.effective_from DESC,version.version DESC`,
        [stationId, input.sensorId, input.method, input.intervalStart, input.intervalEnd, knownAt],
      );
      const selected = policies.rows[0];
      const common = (
        policyVersionId: string | null,
        curveVersionId: string | null,
        refs: readonly ExactObservation[],
        coveredInterval: { start: string; end: string } | null,
        coverage: 'unconfigured' | 'no_data' | 'incomplete' | 'complete',
        qualityState: 'valid' | 'estimated' | 'unreliable' | 'no_data',
        provenance: string,
      ) => ({
        measurementKind: 'interval_volume' as const,
        unit: 'm3' as const,
        requestedInterval: interval,
        coveredInterval,
        coverage,
        knownAt,
        method: input.method,
        policyVersionId,
        curveVersionId,
        sourceRefs: sourceRefs(refs),
        provenance,
        dataClassification: 'synthetic' as const,
        officialComplianceEligible: false as const,
        qualityState,
        uncertainty: null,
      });
      if (!selected)
        return {
          outcome: 'deferred',
          deferReason: 'no_approved_coverage_policy',
          volume: null,
          ...common(
            null,
            null,
            [],
            null,
            'unconfigured',
            'no_data',
            'synthetic: no approved coverage policy',
          ),
        };
      let selectedCurve: CurveRow | undefined;
      if (input.method === 'stage_rating_curve') {
        const curves = await client.query<CurveRow>(
          `${curveSelect} WHERE curve.station_id=$1 AND curve.stage_sensor_id=$2 AND curve.device_installation_id=$3 AND version.effective_from <= $4 AND (version.effective_until IS NULL OR version.effective_until >= $5) AND version.approved_at <= $6 ORDER BY version.effective_from DESC,version.version DESC`,
          [
            stationId,
            selected.sensor_id,
            selected.device_installation_id,
            input.intervalStart,
            input.intervalEnd,
            knownAt,
          ],
        );
        selectedCurve = curves.rows[0];
        if (!selectedCurve)
          return {
            outcome: 'deferred',
            deferReason: 'no_approved_rating_curve',
            volume: null,
            ...common(selected.id, null, [], null, 'unconfigured', 'no_data', selected.provenance),
          };
      }
      const observations = await client.query<ObservationRow>(
        `WITH current AS (
      SELECT DISTINCT ON (lineage.id) lineage.id lineage_id,revision.id revision_id,lineage.observed_at,lineage.sensor_id,lineage.device_installation_id,revision.measurement_method,revision.totalizer_transition,revision.state,revision.quality_state,revision.value
      FROM observation_lineages lineage JOIN observation_revisions revision ON revision.lineage_id=lineage.id
      WHERE lineage.station_id=$1 AND lineage.sensor_id=$2 AND lineage.device_installation_id=$3 AND lineage.observed_at >= $4 AND lineage.observed_at <= $5 AND revision.ingested_at <= $6
      ORDER BY lineage.id,revision.revision DESC,revision.id DESC)
      SELECT lineage_id AS "lineageId",revision_id AS "revisionId",to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "observedAt",sensor_id AS "sensorId",device_installation_id AS "deviceInstallationId",measurement_method AS "measurementMethod",totalizer_transition AS "totalizerTransition",state AS "workflowState",quality_state AS "qualityState",value::text value
      FROM current ORDER BY observed_at,lineage_id`,
        [
          stationId,
          selected.sensor_id,
          selected.device_installation_id,
          input.intervalStart,
          input.intervalEnd,
          knownAt,
        ],
      );
      const result =
        input.method === 'accumulated_volume_delta'
          ? deriveCounterInterval(
              input.intervalStart,
              input.intervalEnd,
              observations.rows,
              BigInt(selected.max_gap_microseconds),
              true,
            )
          : integrateSeries(
              input.intervalStart,
              input.intervalEnd,
              observations.rows,
              BigInt(selected.max_gap_microseconds),
              selectedCurve
                ? (value) => interpolateStage(selectedCurve!.knots, parseExactDecimal(value))
                : parseExactDecimal,
            );
      const covered =
        result.coveredStart && result.coveredEnd
          ? { start: result.coveredStart, end: result.coveredEnd }
          : null;
      if (result.outcome === 'deferred')
        return {
          outcome: 'deferred',
          deferReason: result.reason,
          volume: null,
          ...common(
            selected.id,
            selectedCurve?.id ?? null,
            observations.rows,
            covered,
            observations.rows.length === 0 ? 'no_data' : 'incomplete',
            [
              'unusable_observation',
              'mixed_sensor_installation_or_method',
              'stage_outside_rating_curve',
              'negative_discharge_not_configured',
              'counter_reset_or_rollover',
              'counter_decrease',
            ].includes(result.reason)
              ? 'unreliable'
              : 'no_data',
            selectedCurve?.provenance ?? selected.provenance,
          ),
        };
      return {
        outcome: 'computed',
        deferReason: null,
        volume: {
          numerator: result.value.numerator.toString(),
          denominator: result.value.denominator.toString(),
          unit: 'm3',
        },
        ...common(
          selected.id,
          selectedCurve?.id ?? null,
          observations.rows,
          covered,
          'complete',
          input.method === 'stage_rating_curve' ? 'estimated' : 'valid',
          selectedCurve?.provenance ?? selected.provenance,
        ),
      };
    });
  }
}

import type {
  CreateWaterBalanceModelRequest,
  DerivedVolumeResult,
  RequestWaterBalanceVersionRequest,
  WaterBalanceResult,
} from '@isuv/contracts';
import {
  calculateWaterBalance,
  parseExactDecimal,
  rational,
  shiftedBalanceInterval,
  utcMicros,
  type Rational,
} from '@isuv/domain';
import type { PoolClient } from 'pg';
import { withDatabase } from '../../db/client.js';
import { PostgresQuantityDerivationService } from '../quantity-derivation/service.js';

export class WaterBalanceError extends Error {
  constructor(
    public readonly kind: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR',
    message: string,
  ) {
    super(message);
  }
}
function leap(year: bigint) {
  return year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n);
}
/** Exact inverse of utcMicros; intentionally never routes microseconds through Date. */
function isoMicros(value: bigint) {
  let days = value / 86_400_000_000n,
    remainder = value % 86_400_000_000n;
  if (remainder < 0n) {
    days -= 1n;
    remainder += 86_400_000_000n;
  }
  let year = 1970n;
  while (days < 0n) {
    year--;
    days += leap(year) ? 366n : 365n;
  }
  while (days >= (leap(year) ? 366n : 365n)) {
    days -= leap(year) ? 366n : 365n;
    year++;
  }
  const months = [31n, 28n, 31n, 30n, 31n, 30n, 31n, 31n, 30n, 31n, 30n, 31n];
  let month = 1;
  for (const base of months) {
    const d = base + (month === 2 && leap(year) ? 1n : 0n);
    if (days < d) break;
    days -= d;
    month++;
  }
  const hour = remainder / 3_600_000_000n;
  remainder %= 3_600_000_000n;
  const minute = remainder / 60_000_000n;
  remainder %= 60_000_000n;
  const second = remainder / 1_000_000n;
  const fraction = remainder % 1_000_000n;
  return `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${(days + 1n).toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}.${fraction.toString().padStart(6, '0')}Z`;
}
function exact(value: Rational) {
  return {
    numerator: value.numerator.toString(),
    denominator: value.denominator.toString(),
    unit: 'm3' as const,
  };
}
function sameInstant(left: string | undefined, right: string) {
  return left !== undefined && utcMicros(left) === utcMicros(right);
}
export class PostgresWaterBalanceService {
  constructor(
    private readonly databaseUrl?: string,
    private readonly transactionClient?: PoolClient,
  ) {}
  private async read<T>(fn: (c: PoolClient) => Promise<T>) {
    if (this.transactionClient) return fn(this.transactionClient);
    return withDatabase(this.databaseUrl, async (pool) => {
      const c = await pool.connect();
      try {
        return await fn(c);
      } finally {
        c.release();
      }
    });
  }
  private async transaction<T>(fn: (c: PoolClient) => Promise<T>) {
    if (this.transactionClient) return fn(this.transactionClient);
    return withDatabase(this.databaseUrl, async (pool) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn(c);
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    });
  }
  private failure(issue: unknown): never {
    const code = (issue as { code?: string })?.code;
    if (code === '23505' || code === '23P01')
      throw new WaterBalanceError('CONFLICT', 'The water balance record conflicts.');
    if (code === '23514' || code === '23503')
      throw new WaterBalanceError('VALIDATION_ERROR', 'The water balance input is invalid.');
    throw issue;
  }
  async findJunctionTerritories(junctionId: string) {
    return this.read(async (c) =>
      (
        await c.query<{ territory_id: string }>(
          `SELECT DISTINCT territory_id FROM water_sections WHERE lifecycle='active' AND (upstream_junction_id=$1 OR downstream_junction_id=$1) UNION SELECT territory_id FROM network_junctions WHERE id=$1`,
          [junctionId],
        )
      ).rows.map((x) => x.territory_id),
    );
  }
  async findModelTerritories(modelId: string) {
    return this.read(async (c) =>
      (
        await c.query<{ territory_id: string }>(
          `SELECT territory_id FROM water_balance_models WHERE id=$1
           UNION SELECT DISTINCT section_row.territory_id FROM water_balance_versions version_row
           JOIN water_balance_version_components component ON component.version_id=version_row.id
           JOIN water_sections section_row ON section_row.id=component.water_section_id
           WHERE version_row.model_id=$1`,
          [modelId],
        )
      ).rows.map((x) => x.territory_id),
    );
  }
  async findCalculationTerritories(
    junctionId: string,
    input: { intervalStart: string; intervalEnd: string; knownAt: string },
  ) {
    return this.read(async (c) =>
      (
        await c.query<{ territory_id: string }>(
          `WITH selected AS (
             SELECT version_row.id FROM water_balance_models model
             JOIN water_balance_versions version_row ON version_row.model_id=model.id
             WHERE model.junction_id=$1 AND version_row.status='approved'
               AND version_row.effective_from<=$2 AND version_row.effective_until>=$3
               AND version_row.approved_at<=$4
             ORDER BY version_row.effective_from DESC,version_row.version DESC LIMIT 1
           )
           SELECT territory_id FROM network_junctions WHERE id=$1
           UNION SELECT DISTINCT section_row.territory_id FROM selected
           JOIN water_balance_version_components component ON component.version_id=selected.id
           JOIN water_sections section_row ON section_row.id=component.water_section_id`,
          [junctionId, input.intervalStart, input.intervalEnd, input.knownAt],
        )
      ).rows.map((x) => x.territory_id),
    );
  }
  async create(input: CreateWaterBalanceModelRequest, actor: string, requestId: string) {
    try {
      return await this.transaction(async (c) => {
        const r = await c.query(
          `INSERT INTO water_balance_models(organization_id,junction_id,territory_id,provenance,created_by_user_id,creation_reason,created_request_id) SELECT organization_id,id,territory_id,$2,$3,$4,$5 FROM network_junctions WHERE id=$1 RETURNING id,junction_id,provenance`,
          [input.junctionId, input.provenance, actor, input.reason, requestId],
        );
        if (!r.rows[0]) throw new WaterBalanceError('NOT_FOUND', 'Junction not found.');
        return r.rows[0];
      });
    } catch (e) {
      return this.failure(e);
    }
  }
  async request(
    modelId: string,
    input: RequestWaterBalanceVersionRequest,
    actor: string,
    requestId: string,
  ) {
    try {
      return await this.transaction(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [modelId]);
        const v = await c.query<{ id: string; version: number }>(
          `INSERT INTO water_balance_versions(model_id,version,status,effective_from,effective_until,provenance,requested_by_user_id,request_reason,requested_request_id) SELECT $1,COALESCE(max(version),0)+1,'requested',$2,$3,$4,$5,$6,$7 FROM water_balance_versions WHERE model_id=$1 RETURNING id,version`,
          [
            modelId,
            input.effectiveFrom,
            input.effectiveUntil,
            input.provenance,
            actor,
            input.reason,
            requestId,
          ],
        );
        if (!v.rows[0]) throw new WaterBalanceError('NOT_FOUND', 'Water balance model not found.');
        for (const x of input.components)
          await c.query(
            `INSERT INTO water_balance_version_components(version_id,water_section_id,station_id,sensor_id,device_installation_id,method,role,reference_plane,travel_time_microseconds,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              v.rows[0].id,
              x.waterSectionId,
              x.stationId,
              x.sensorId,
              x.deviceInstallationId,
              x.method,
              x.role,
              x.referencePlane,
              x.travelTimeMicroseconds,
              x.provenance,
            ],
          );
        for (const a of input.assumptions)
          await c.query(
            `INSERT INTO water_balance_version_assumptions(version_id,interval_start,interval_end,storage_change_m3,known_addition_m3,known_removal_m3,provenance) VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [
              v.rows[0].id,
              a.intervalStart,
              a.intervalEnd,
              a.storageChangeM3,
              a.knownAdditionM3,
              a.knownRemovalM3,
              a.provenance,
            ],
          );
        return v.rows[0];
      });
    } catch (e) {
      return this.failure(e);
    }
  }
  async approve(
    modelId: string,
    version: number,
    reason: string,
    actor: string,
    requestId: string,
  ) {
    try {
      return await this.transaction(async (c) => {
        const r = await c.query(
          `UPDATE water_balance_versions SET status='approved',approved_by_user_id=$3,approval_reason=$4,approved_request_id=$5 WHERE model_id=$1 AND version=$2 AND status='requested' RETURNING id,version,status`,
          [modelId, version, actor, reason, requestId],
        );
        if (!r.rows[0])
          throw new WaterBalanceError(
            'CONFLICT',
            'Only a requested water balance version can be approved.',
          );
        return r.rows[0];
      });
    } catch (e) {
      return this.failure(e);
    }
  }
  async calculate(
    junctionId: string,
    input: { intervalStart: string; intervalEnd: string; knownAt?: string | undefined },
  ): Promise<WaterBalanceResult> {
    return this.read(async (c) => {
      const knownAt = input.knownAt ?? new Date().toISOString();
      const blank = (
        outcome: 'deferred' | 'computed',
        deferReason: WaterBalanceResult['deferReason'],
        modelId: string | null,
        versionId: string | null,
        components: WaterBalanceResult['components'] = [],
      ) => ({
        outcome,
        deferReason,
        junctionId,
        modelId,
        versionId,
        interval: { start: input.intervalStart, end: input.intervalEnd },
        knownAt,
        components,
        incomingM3: null,
        outgoingM3: null,
        knownAdditionM3: null,
        knownRemovalM3: null,
        storageChangeM3: null,
        assumptionId: null,
        assumptionProvenance: null,
        residualM3: null,
        provenance: 'synthetic: water balance',
        dataClassification: 'synthetic' as const,
        officialComplianceEligible: false as const,
        alarmEligible: false as const,
      });
      const ver = await c.query<{ model_id: string; version_id: string; provenance: string }>(
        `SELECT m.id model_id,v.id version_id,v.provenance FROM water_balance_models m JOIN water_balance_versions v ON v.model_id=m.id WHERE m.junction_id=$1 AND v.status='approved' AND v.effective_from<=$2 AND v.effective_until>=$3 AND v.approved_at<=$4 ORDER BY v.effective_from DESC,v.version DESC LIMIT 1`,
        [junctionId, input.intervalStart, input.intervalEnd, knownAt],
      );
      if (!ver.rows[0]) return blank('deferred', 'no_approved_water_balance_model', null, null);
      const row = ver.rows[0];
      const comp = await c.query<{
        water_section_id: string;
        station_id: string;
        sensor_id: string;
        device_installation_id: string;
        method: 'direct_discharge' | 'stage_rating_curve' | 'accumulated_volume_delta';
        role: 'incoming' | 'outgoing';
        reference_plane: 'upstream' | 'downstream';
        travel_time_microseconds: string;
        provenance: string;
      }>(
        `SELECT water_section_id,station_id,sensor_id,device_installation_id,method,role,reference_plane,travel_time_microseconds::text,provenance FROM water_balance_version_components WHERE version_id=$1 ORDER BY role,water_section_id`,
        [row.version_id],
      );
      const a = await c.query<{
        id: string;
        storage_change_m3: string;
        known_addition_m3: string;
        known_removal_m3: string;
        provenance: string;
      }>(
        `SELECT id,storage_change_m3::text,known_addition_m3::text,known_removal_m3::text,provenance FROM water_balance_version_assumptions WHERE version_id=$1 AND interval_start=$2 AND interval_end=$3`,
        [row.version_id, input.intervalStart, input.intervalEnd],
      );
      if (!a.rows[0])
        return blank('deferred', 'missing_exact_assumption', row.model_id, row.version_id);
      const q = new PostgresQuantityDerivationService(this.databaseUrl, c);
      const enriched = [] as {
        waterSectionId: string;
        role: 'incoming' | 'outgoing';
        referencePlane: 'upstream' | 'downstream';
        travelTimeMicroseconds: bigint;
        volume: Rational | null;
        derivation: DerivedVolumeResult;
        sourceInterval: { start: string; end: string };
        stationId: string;
        sensorId: string;
        deviceInstallationId: string;
        method: 'direct_discharge' | 'stage_rating_curve' | 'accumulated_volume_delta';
        bindingProvenance: string;
      }[];
      for (const x of comp.rows) {
        const shifted = shiftedBalanceInterval(
          input.intervalStart,
          input.intervalEnd,
          x.role,
          x.reference_plane,
          BigInt(x.travel_time_microseconds),
        );
        const sourceInterval = {
          start: isoMicros(shifted.startMicros),
          end: isoMicros(shifted.endMicros),
        };
        const derivation = await q.derive(x.station_id, {
          sensorId: x.sensor_id,
          method: x.method,
          intervalStart: sourceInterval.start,
          intervalEnd: sourceInterval.end,
          knownAt,
        });
        enriched.push({
          waterSectionId: x.water_section_id,
          role: x.role,
          referencePlane: x.reference_plane,
          travelTimeMicroseconds: BigInt(x.travel_time_microseconds),
          volume:
            derivation.outcome === 'computed' &&
            derivation.coverage === 'complete' &&
            derivation.qualityState === 'valid' &&
            derivation.method === x.method &&
            derivation.sourceRefs.length > 0 &&
            derivation.sourceRefs.every(
              (source) =>
                source.sensorId === x.sensor_id &&
                source.deviceInstallationId === x.device_installation_id,
            ) &&
            sameInstant(derivation.requestedInterval.start, sourceInterval.start) &&
            sameInstant(derivation.requestedInterval.end, sourceInterval.end) &&
            sameInstant(derivation.coveredInterval?.start, sourceInterval.start) &&
            sameInstant(derivation.coveredInterval?.end, sourceInterval.end) &&
            ['direct_discharge', 'accumulated_volume_delta'].includes(x.method)
              ? rational(BigInt(derivation.volume.numerator), BigInt(derivation.volume.denominator))
              : null,
          derivation,
          sourceInterval,
          stationId: x.station_id,
          sensorId: x.sensor_id,
          deviceInstallationId: x.device_installation_id,
          method: x.method,
          bindingProvenance: x.provenance,
        });
      }
      const ass = {
        intervalStart: input.intervalStart,
        intervalEnd: input.intervalEnd,
        storageChangeM3: parseExactDecimal(a.rows[0].storage_change_m3),
        knownAdditionM3: parseExactDecimal(a.rows[0].known_addition_m3),
        knownRemovalM3: parseExactDecimal(a.rows[0].known_removal_m3),
      };
      const calc = calculateWaterBalance(enriched, ass);
      const rendered = enriched.map((x) => ({
        waterSectionId: x.waterSectionId,
        role: x.role,
        referencePlane: x.referencePlane,
        travelTimeMicroseconds: x.travelTimeMicroseconds.toString(),
        sourceInterval: x.sourceInterval,
        stationId: x.stationId,
        sensorId: x.sensorId,
        deviceInstallationId: x.deviceInstallationId,
        method: x.method,
        bindingProvenance: x.bindingProvenance,
        derivation: x.derivation,
      }));
      if (calc.outcome === 'deferred')
        return {
          ...blank('deferred', 'component_not_eligible', row.model_id, row.version_id, rendered),
          provenance: row.provenance,
        };
      return {
        ...blank('computed', null, row.model_id, row.version_id, rendered),
        incomingM3: exact(calc.incomingM3),
        outgoingM3: exact(calc.outgoingM3),
        knownAdditionM3: exact(ass.knownAdditionM3),
        knownRemovalM3: exact(ass.knownRemovalM3),
        storageChangeM3: exact(ass.storageChangeM3),
        assumptionId: a.rows[0].id,
        assumptionProvenance: a.rows[0].provenance,
        residualM3: exact(calc.residualM3),
        provenance: row.provenance,
      };
    });
  }
}

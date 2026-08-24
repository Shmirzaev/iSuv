import type { DashboardPeriod, DashboardResponse } from '@isuv/contracts';
import {
  dashboardWindows,
  exactDashboardDeviation,
  parseExactDecimal,
  rational,
} from '@isuv/domain';
import { withDatabase } from '../../db/client.js';

const ts = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const scenarioId = 'd5000000-0000-4000-8000-000000000001';
function exact(value: ReturnType<typeof rational>) {
  return {
    numerator: value.numerator.toString(),
    denominator: value.denominator.toString(),
    unit: 'm3' as const,
  };
}
function nullableMetric(value: string | null, members: number, reason: string) {
  return value === null
    ? {
        state: members ? ('unassessable' as const) : ('unconfigured' as const),
        value: null,
        unit: 'm3' as const,
        source: members ? ('synthetic_scenario' as const) : ('unconfigured' as const),
        reason: members ? reason : 'No synthetic delivery comparison member is in scope.',
      }
    : {
        state: 'scenario_classified' as const,
        value: exact(parseExactDecimal(value)),
        unit: 'm3' as const,
        source: 'synthetic_scenario' as const,
        reason: null,
      };
}

interface DashboardRow {
  reference_at: string;
  known_at: string;
  provenance: string;
  version: number;
  station_denominator: string;
  device_denominator: string;
  reported: string;
  no_data: string;
  unreliable: string;
  unconfigured: string;
  inflow_m3s: string | null;
  planned_m3: string | null;
  actual_m3: string | null;
  prior_actual_m3: string | null;
  assessed: string;
  within_count: string;
  over_count: string;
  under_count: string;
  ingress_members: string;
  delivery_members: string;
  critical_alarms: string;
}

export class PostgresDashboardService {
  public constructor(private readonly databaseUrl?: string) {}
  private async read<T>(
    fn: (client: {
      query: <R>(text: string, values?: unknown[]) => Promise<{ rows: R[] }>;
    }) => Promise<T>,
  ) {
    return withDatabase(this.databaseUrl, async (pool) => {
      const client = await pool.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    });
  }
  async findDefaultTerritory(userId: string, organizationId: string, evaluatedAt: Date) {
    return this.read(async (client) => {
      const row = (
        await client.query<{ territory_id: string }>(
          `SELECT COALESCE(
             (SELECT territory_id FROM user_role_grants
              WHERE user_id=$1 AND organization_id=$2 AND territory_id IS NOT NULL
                AND cancelled_at IS NULL AND effective_from <= $3
                AND (effective_until IS NULL OR effective_until > $3)
              ORDER BY effective_from, id LIMIT 1),
             (SELECT territory_id FROM dashboard_synthetic_scenarios
              WHERE id='d5000000-0000-4000-8000-000000000001' AND organization_id=$2)
           ) territory_id`,
          [userId, organizationId, evaluatedAt],
        )
      ).rows[0];
      return row?.territory_id ?? null;
    });
  }
  async dashboard(territoryId: string, period: DashboardPeriod): Promise<DashboardResponse | null> {
    return this.read(async (client) => {
      const row = (
        await client.query<DashboardRow>(
          `WITH RECURSIVE descendants AS (
             SELECT id FROM territories WHERE id=$1
             UNION ALL
             SELECT child.id FROM territories child JOIN descendants parent ON child.parent_territory_id=parent.id
           ), scenario AS (
             SELECT * FROM dashboard_synthetic_scenarios WHERE id='d5000000-0000-4000-8000-000000000001'
           ), rows AS (
             SELECT row.* FROM dashboard_synthetic_reporting_rows row JOIN descendants d ON d.id=row.territory_id
             WHERE row.scenario_id='d5000000-0000-4000-8000-000000000001' AND row.period=$2
           )
           SELECT ${ts('scenario.reference_at')} reference_at, ${ts('scenario.known_at')} known_at, scenario.provenance, scenario.version,
             count(rows.station_id)::text station_denominator, count(rows.device_id)::text device_denominator,
             count(*) FILTER(WHERE rows.data_state='reported')::text reported,
             count(*) FILTER(WHERE rows.data_state='no_data')::text no_data,
             count(*) FILTER(WHERE rows.data_state='unreliable')::text unreliable,
             count(*) FILTER(WHERE rows.data_state='unconfigured')::text unconfigured,
             sum(rows.inflow_m3s) FILTER(WHERE rows.metric_role='regional_ingress_member')::text inflow_m3s,
             sum(rows.planned_m3) FILTER(WHERE rows.metric_role='delivery_member')::text planned_m3, sum(rows.actual_m3) FILTER(WHERE rows.metric_role='delivery_member')::text actual_m3, sum(rows.prior_actual_m3) FILTER(WHERE rows.metric_role='delivery_member')::text prior_actual_m3,
             count(*) FILTER(WHERE rows.metric_role='delivery_member' AND rows.planned_m3 IS NOT NULL AND rows.actual_m3 IS NOT NULL)::text assessed,
             count(*) FILTER(WHERE rows.metric_role='delivery_member' AND rows.planned_m3 IS NOT NULL AND rows.actual_m3 = rows.planned_m3)::text within_count,
             count(*) FILTER(WHERE rows.metric_role='delivery_member' AND rows.planned_m3 IS NOT NULL AND rows.actual_m3 > rows.planned_m3)::text over_count,
             count(*) FILTER(WHERE rows.metric_role='delivery_member' AND rows.planned_m3 IS NOT NULL AND rows.actual_m3 < rows.planned_m3)::text under_count,
             count(*) FILTER(WHERE rows.metric_role='regional_ingress_member')::text ingress_members,
             count(*) FILTER(WHERE rows.metric_role='delivery_member')::text delivery_members
             ,count(*) FILTER(WHERE rows.active_critical_alarm)::text critical_alarms
           FROM scenario LEFT JOIN rows ON true
           GROUP BY scenario.reference_at,scenario.known_at,scenario.provenance,scenario.version`,
          [territoryId, period],
        )
      ).rows[0];
      if (!row || Number(row.station_denominator) === 0) return null;
      const descendantTerritoryIds = (
        await client.query<{ id: string }>(
          `WITH RECURSIVE descendants AS (SELECT id FROM territories WHERE id=$1 UNION ALL SELECT child.id FROM territories child JOIN descendants parent ON child.parent_territory_id=parent.id) SELECT id FROM descendants ORDER BY id`,
          [territoryId],
        )
      ).rows.map((value) => value.id);
      const deviations = (
        await client.query<{
          station_id: string;
          device_id: string;
          hotspot_code: string;
          territory_id: string;
          territory_name: string;
          data_state: 'reported';
          quality: 'valid';
          planned_m3: string;
          actual_m3: string;
        }>(
          `WITH RECURSIVE descendants AS (SELECT id FROM territories WHERE id=$1 UNION ALL SELECT child.id FROM territories child JOIN descendants parent ON child.parent_territory_id=parent.id)
           SELECT row.station_id,row.device_id,row.hotspot_code,row.territory_id,territory.name territory_name,row.data_state,row.quality,row.planned_m3::text,row.actual_m3::text
           FROM dashboard_synthetic_reporting_rows row JOIN territories territory ON territory.id=row.territory_id
           WHERE row.scenario_id=$2 AND row.period=$3 AND row.territory_id IN(SELECT id FROM descendants)
             AND metric_role='delivery_member' AND planned_m3 IS NOT NULL AND actual_m3 IS NOT NULL
           ORDER BY abs(actual_m3-planned_m3) DESC, station_id LIMIT 10`,
          [territoryId, scenarioId, period],
        )
      ).rows;
      const windows = dashboardWindows(period, row.reference_at);
      const assessed = Number(row.assessed);
      const compliance = assessed
        ? {
            state: 'scenario_classified' as const,
            assessedDenominator: assessed,
            withinCount: Number(row.within_count),
            overCount: Number(row.over_count),
            underCount: Number(row.under_count),
            percentage: {
              numerator: (BigInt(row.within_count) * 100n).toString(),
              denominator: BigInt(assessed).toString(),
              unit: 'percent' as const,
            },
            source: 'synthetic_scenario' as const,
            reason: null,
          }
        : {
            state: 'unassessable' as const,
            assessedDenominator: 0,
            withinCount: 0,
            overCount: 0,
            underCount: 0,
            percentage: null,
            source: 'synthetic_scenario' as const,
            reason: 'No complete synthetic plan/actual fixture is in scope.',
          };
      return {
        referenceAt: row.reference_at,
        knownAt: row.known_at,
        presentationTimeZone: 'Asia/Tashkent',
        windows,
        scenario: {
          id: scenarioId,
          version: row.version,
          period,
          provenance: row.provenance,
          dataClassification: 'synthetic',
          officialComplianceEligible: false,
          synthetic: true,
          definitions: {
            regionalInflowCutSet: {
              state: Number(row.ingress_members) ? 'scenario_classified' : 'unconfigured',
              memberStationCount: Number(row.ingress_members),
              unit: 'm3/s',
              provenance:
                'synthetic v1 mutually exclusive regional ingress member marker; not an official ingress cut set',
            },
            deliveryComparisonSet: {
              state: Number(row.delivery_members) ? 'scenario_classified' : 'unconfigured',
              memberStationCount: Number(row.delivery_members),
              unit: 'm3',
              provenance:
                'synthetic v1 deterministic delivery comparison member marker; not official allocation compliance',
            },
          },
        },
        scope: {
          territoryId,
          descendantTerritoryIds,
          stationDenominator: Number(row.station_denominator),
          deviceDenominator: Number(row.device_denominator),
          reportedStationCount: Number(row.reported),
          dataStates: {
            reported: Number(row.reported),
            noData: Number(row.no_data),
            unreliable: Number(row.unreliable),
            unconfigured: Number(row.unconfigured),
          },
        },
        kpis: {
          regionalInflow:
            row.inflow_m3s === null
              ? {
                  state: Number(row.ingress_members) ? 'unassessable' : 'unconfigured',
                  value: null,
                  unit: 'm3/s',
                  source: Number(row.ingress_members) ? 'synthetic_scenario' : 'unconfigured',
                  reason: Number(row.ingress_members)
                    ? 'No reported synthetic boundary inflow is in scope.'
                    : 'No synthetic ingress cut-set member is in scope.',
                }
              : {
                  state: 'scenario_classified',
                  value: row.inflow_m3s,
                  unit: 'm3/s',
                  source: 'synthetic_scenario',
                  reason: null,
                },
          deliveredVolume: nullableMetric(
            row.actual_m3,
            Number(row.delivery_members),
            'No complete synthetic delivery fixture is in scope.',
          ),
          plannedVolume: nullableMetric(
            row.planned_m3,
            Number(row.delivery_members),
            'No complete synthetic plan fixture is in scope.',
          ),
          unexplainedBalance: {
            state: 'unconfigured',
            value: null,
            unit: 'm3',
            source: 'unconfigured',
            reason: 'Official balance cut-set and assumption policy are not configured.',
          },
          compliance,
          activeCriticalAlarms: {
            state: 'scenario_classified',
            count: Number(row.critical_alarms),
            source: 'synthetic_scenario',
            reason: null,
          },
          systemConfidence: {
            state: 'unconfigured',
            value: null,
            source: 'unconfigured',
            reason: 'Official availability cadence and confidence policy are not configured.',
          },
        },
        comparison:
          row.planned_m3 === null || row.actual_m3 === null || row.prior_actual_m3 === null
            ? {
                state: 'unassessable',
                plannedM3: null,
                actualM3: null,
                priorActualM3: null,
                source: 'synthetic_scenario',
                reason: 'No complete deterministic comparison fixture is in scope.',
              }
            : {
                state: 'scenario_classified',
                plannedM3: exact(parseExactDecimal(row.planned_m3)),
                actualM3: exact(parseExactDecimal(row.actual_m3)),
                priorActualM3: exact(parseExactDecimal(row.prior_actual_m3)),
                source: 'synthetic_scenario',
                reason: null,
              },
        deviations: deviations.map((item) => {
          const deviation = exactDashboardDeviation(item.planned_m3, item.actual_m3);
          return {
            stationId: item.station_id,
            deviceId: item.device_id,
            hotspotCode: item.hotspot_code,
            territoryId: item.territory_id,
            territoryName: item.territory_name,
            dataState: item.data_state,
            quality: item.quality,
            assessedInterval: windows.selected,
            signedM3: exact(deviation.signed),
            absoluteM3: exact(deviation.absolute),
            mapTarget: `#map?stationId=${item.station_id}`,
            liveTarget: `#operations?stationId=${item.station_id}`,
            source: 'synthetic_scenario' as const,
          };
        }),
      } satisfies DashboardResponse;
    });
  }
}

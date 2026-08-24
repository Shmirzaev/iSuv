import type { AnalyticsFacet, AnalyticsQuery, AnalyticsResponse } from '@isuv/contracts';
import {
  analyticsExact,
  reconcileAnalyticsMembers,
  dashboardWindows,
  parseExactDecimal,
  rational,
  type AnalyticsMember,
} from '@isuv/domain';
import type { PoolClient } from 'pg';
import { withDatabase } from '../../db/client.js';
import { PostgresAllocationDeviationService } from '../allocation-deviation/service.js';
import { PostgresWaterBalanceService } from '../water-balance/service.js';

const scenarioId = 'd7000000-0000-4000-8000-000000000001';
const ts = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const exact = (value: ReturnType<typeof rational>) => analyticsExact(value);
const zero = () => exact(rational(0n));
type Client = PoolClient;
type FacetRow = { id: string; kind: AnalyticsFacet; label: string };
type SectionRow = {
  id: string;
  name: string;
  territory_id: string;
  station_id: string | null;
  device_id: string | null;
  plan_id: string | null;
  population_count: string;
};

/** Read-only P3 composition. It never treats the dashboard reporting table as accounting evidence. */
export class PostgresAnalyticsService {
  public constructor(
    private readonly databaseUrl?: string,
    private readonly transactionClient?: PoolClient,
  ) {}
  private async read<T>(fn: (client: Client) => Promise<T>) {
    if (this.transactionClient) return fn(this.transactionClient);
    return withDatabase(this.databaseUrl, async (pool) => {
      const client = await pool.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    });
  }
  async findDefaultTerritory(userId: string, organizationId: string, at: Date) {
    return this.read(
      async (c) =>
        (
          await c.query<{ territory_id: string }>(
            `SELECT COALESCE((SELECT territory_id FROM user_role_grants WHERE user_id=$1 AND organization_id=$2 AND territory_id IS NOT NULL AND cancelled_at IS NULL AND effective_from <= $3 AND (effective_until IS NULL OR effective_until>$3) ORDER BY effective_from,id LIMIT 1),(SELECT territory_id FROM analytics_synthetic_scenarios WHERE id=$4 AND organization_id=$2)) territory_id`,
            [userId, organizationId, at, scenarioId],
          )
        ).rows[0]?.territory_id ?? null,
    );
  }
  private facetRows(c: Client, territoryId: string) {
    return c.query<FacetRow>(
      `WITH RECURSIVE descendants AS (SELECT id FROM territories WHERE id=$1 UNION ALL SELECT child.id FROM territories child JOIN descendants p ON child.parent_territory_id=p.id), assets AS (SELECT region.id,'region'::text kind,region.name label FROM water_regions region JOIN descendants d ON d.id=region.territory_id WHERE region.lifecycle='active' UNION SELECT basin.id,'basin',basin.name FROM water_basins basin JOIN descendants d ON d.id=basin.territory_id WHERE basin.lifecycle='active' UNION SELECT waterway.id,'waterway',waterway.name FROM waterways waterway JOIN descendants d ON d.id=waterway.territory_id WHERE waterway.lifecycle='active' UNION SELECT section.id,'section',section.name FROM water_sections section JOIN descendants d ON d.id=section.territory_id WHERE section.lifecycle='active') SELECT DISTINCT id,kind::text as kind,label FROM assets ORDER BY kind,label,id`,
      [territoryId],
    );
  }
  async analytics(territoryId: string, query: AnalyticsQuery): Promise<AnalyticsResponse | null> {
    return this.read(async (c) => {
      const scenario = (
        await c.query<{
          reference_at: string;
          known_at: string;
          version: number;
          provenance: string;
        }>(
          `SELECT ${ts('scenario.reference_at')} reference_at,${ts('scenario.known_at')} known_at,scenario.version,scenario.provenance
             FROM analytics_synthetic_scenarios scenario
            WHERE scenario.id=$1
              AND $2 IN (
                WITH RECURSIVE descendants AS (
                  SELECT territory.id FROM territories territory WHERE territory.id=scenario.territory_id
                  UNION ALL
                  SELECT child.id FROM territories child JOIN descendants parent ON child.parent_territory_id=parent.id
                ) SELECT id FROM descendants
              )`,
          [scenarioId, territoryId],
        )
      ).rows[0];
      if (!scenario) return null;
      const facets = (await this.facetRows(c, territoryId)).rows;
      if (query.facetId && !facets.some((x) => x.id === query.facetId && x.kind === query.facet))
        return null;
      const descendants = (
        await c.query<{ id: string }>(
          `WITH RECURSIVE d AS (SELECT id FROM territories WHERE id=$1 UNION ALL SELECT child.id FROM territories child JOIN d ON child.parent_territory_id=d.id) SELECT id FROM d ORDER BY id`,
          [territoryId],
        )
      ).rows.map((x) => x.id);
      const windows = dashboardWindows(query.period, scenario.reference_at);
      const facetJoin =
        query.facet === 'region'
          ? 'JOIN water_basins basin ON basin.id=waterway.basin_id JOIN water_regions region ON region.id=basin.region_id'
          : query.facet === 'basin'
            ? 'JOIN water_basins basin ON basin.id=waterway.basin_id'
            : '';
      const facetPredicate = (parameter: string) =>
        query.facet === 'region'
          ? `region.id=${parameter}`
          : query.facet === 'basin'
            ? `basin.id=${parameter}`
            : query.facet === 'waterway'
              ? `waterway.id=${parameter}`
              : query.facet === 'section'
                ? `section.id=${parameter}`
                : 'true';
      const sectionValues = query.facetId ? [territoryId, query.facetId] : [territoryId];
      const facetStations = (
        await c.query<{ station_id: string }>(
          `WITH RECURSIVE descendants AS (SELECT id FROM territories WHERE id=$1 UNION ALL SELECT child.id FROM territories child JOIN descendants p ON child.parent_territory_id=p.id) SELECT DISTINCT station.id station_id FROM water_sections section JOIN descendants d ON d.id=section.territory_id JOIN waterways waterway ON waterway.id=section.waterway_id ${facetJoin} JOIN monitoring_stations station ON station.section_id=section.id OR station.junction_id IN(section.upstream_junction_id,section.downstream_junction_id) WHERE station.lifecycle='active' AND section.lifecycle='active' AND ${facetPredicate('$2')}`,
          sectionValues,
        )
      ).rows.map((x) => x.station_id);
      const sections = (
        await c.query<SectionRow>(
          `WITH RECURSIVE descendants AS (SELECT id FROM territories WHERE id=$1 UNION ALL SELECT child.id FROM territories child JOIN descendants p ON child.parent_territory_id=p.id), candidate AS (SELECT section.id,section.name,section.territory_id,(SELECT station.id FROM monitoring_stations station WHERE station.lifecycle='active' AND (station.section_id=section.id OR station.junction_id IN(section.upstream_junction_id,section.downstream_junction_id)) ORDER BY station.code LIMIT 1) station_id,(SELECT installation.device_id FROM monitoring_stations station JOIN telemetry_device_installations installation ON installation.station_id=station.id AND installation.effective_until IS NULL WHERE station.lifecycle='active' AND (station.section_id=section.id OR station.junction_id IN(section.upstream_junction_id,section.downstream_junction_id)) ORDER BY station.code LIMIT 1) device_id,(SELECT plan.id FROM allocation_plans plan WHERE plan.water_section_id=section.id AND plan.territory_id IN(SELECT id FROM descendants) AND EXISTS(SELECT 1 FROM allocation_plan_versions version_row WHERE version_row.plan_id=plan.id AND version_row.status IN('approved','superseded') AND version_row.approved_at<=$2) ORDER BY plan.created_at LIMIT 1) plan_id FROM water_sections section JOIN descendants d ON d.id=section.territory_id JOIN waterways waterway ON waterway.id=section.waterway_id ${facetJoin} WHERE section.lifecycle='active' AND ${facetPredicate('$3')}) SELECT candidate.*,count(*) OVER()::text population_count FROM candidate WHERE plan_id IS NOT NULL ORDER BY name,id LIMIT 100`,
          query.facetId
            ? [territoryId, scenario.known_at, query.facetId]
            : [territoryId, scenario.known_at],
        )
      ).rows;
      const definedPopulation = Number(sections[0]?.population_count ?? 0);
      const omittedPopulation = Math.max(0, definedPopulation - sections.length);
      const deviations = new PostgresAllocationDeviationService(this.databaseUrl, c);
      const groups: AnalyticsResponse['delivery']['groups'] = [];
      const members: AnalyticsMember[] = [];
      for (const section of sections) {
        const result = section.plan_id
          ? await deviations.deviation(section.plan_id, {
              intervalStart: windows.selected.start,
              intervalEnd: windows.selected.end,
              knownAt: scenario.known_at,
            })
          : null;
        const computed =
          result?.outcome === 'computed' &&
          result.actual?.outcome === 'computed' &&
          result.actual.qualityState === 'valid' &&
          result.actual.coverage === 'complete' &&
          result.binding?.method !== 'stage_rating_curve' &&
          result.plannedEntry &&
          result.actual.volume &&
          result.delta &&
          result.absoluteDelta;
        if (computed) {
          const planned = parseExactDecimal(result!.plannedEntry!.plannedVolume),
            actual = rational(
              BigInt(result!.actual!.volume!.numerator),
              BigInt(result!.actual!.volume!.denominator),
            );
          members.push({ condition: result!.condition, planned, actual });
          groups.push({
            sectionId: section.id,
            sectionName: section.name,
            territoryId: section.territory_id,
            plannedM3: exact(planned),
            actualM3: exact(actual),
            signedVarianceM3: result!.delta!,
            absoluteVarianceM3: result!.absoluteDelta!,
            condition: result!.condition,
            state: 'assessed',
            reason: null,
            planVersionId: result!.planVersionId,
            toleranceVersionId: result!.tolerance?.versionId ?? null,
            method: result!.binding!.method,
            mapTarget: `#map?sectionId=${section.id}`,
            liveTarget: section.device_id ? `#operations?deviceId=${section.device_id}` : null,
            provenance: {
              dataClassification: 'synthetic',
              officialComplianceEligible: false,
              label: result!.actual!.provenance,
            },
          });
        } else {
          members.push({ condition: 'unassessable' });
          groups.push({
            sectionId: section.id,
            sectionName: section.name,
            territoryId: section.territory_id,
            plannedM3: null,
            actualM3: null,
            signedVarianceM3: null,
            absoluteVarianceM3: null,
            condition: 'unassessable',
            state: 'unassessable',
            reason: result ? result.outcome : 'no_governed_allocation_plan',
            planVersionId: result?.planVersionId ?? null,
            toleranceVersionId: result?.tolerance?.versionId ?? null,
            method: result?.binding?.method ?? null,
            mapTarget: `#map?sectionId=${section.id}`,
            liveTarget: section.device_id ? `#operations?deviceId=${section.device_id}` : null,
            provenance: {
              dataClassification: 'synthetic',
              officialComplianceEligible: false,
              label: result?.actual?.provenance ?? 'synthetic: no governed P3 delivery result',
            },
          });
        }
      }
      const totals = reconcileAnalyticsMembers(members);
      const memberCounts = {
        ...totals.counts,
        total: definedPopulation,
        unassessable: totals.counts.unassessable + omittedPopulation,
      };
      const bucket = (condition: 'over' | 'within' | 'under') => ({
        count: totals.counts[condition],
        plannedM3: zero(),
        actualM3: zero(),
        absoluteVarianceM3: zero(),
      });
      for (const group of groups)
        if (group.state === 'assessed' && group.condition !== 'unassessable') {
          const b = bucket(group.condition);
          void b;
        }
      // Use member totals only; no scenario reporting rows participate in compliance/balance arithmetic.
      const matrix = {
        over: bucket('over'),
        within: bucket('within'),
        under: bucket('under'),
        unassessable: { count: memberCounts.unassessable },
      };
      for (const key of ['over', 'within', 'under'] as const) {
        const selected = groups.filter((x) => x.condition === key && x.state === 'assessed');
        let p = rational(0n),
          a = rational(0n),
          v = rational(0n);
        for (const x of selected) {
          p = {
            numerator:
              p.numerator * BigInt(x.plannedM3!.denominator) +
              BigInt(x.plannedM3!.numerator) * p.denominator,
            denominator: p.denominator * BigInt(x.plannedM3!.denominator),
          };
          a = {
            numerator:
              a.numerator * BigInt(x.actualM3!.denominator) +
              BigInt(x.actualM3!.numerator) * a.denominator,
            denominator: a.denominator * BigInt(x.actualM3!.denominator),
          };
          v = {
            numerator:
              v.numerator * BigInt(x.absoluteVarianceM3!.denominator) +
              BigInt(x.absoluteVarianceM3!.numerator) * v.denominator,
            denominator: v.denominator * BigInt(x.absoluteVarianceM3!.denominator),
          };
        }
        matrix[key] = {
          count: selected.length,
          plannedM3: exact(p),
          actualM3: exact(a),
          absoluteVarianceM3: exact(v),
        };
      }
      const balanceFacetScope = query.facet
        ? `AND EXISTS(SELECT 1 FROM water_sections section JOIN waterways waterway ON waterway.id=section.waterway_id ${facetJoin} WHERE section.lifecycle='active' AND model.junction_id IN(section.upstream_junction_id,section.downstream_junction_id) AND ${facetPredicate('$5')})`
        : '';
      const junction = (
        await c.query<{ id: string }>(
          `SELECT model.junction_id id FROM water_balance_models model JOIN water_balance_versions version_row ON version_row.model_id=model.id JOIN network_junctions junction ON junction.id=model.junction_id WHERE model.territory_id=ANY($1::uuid[]) AND version_row.status='approved' AND version_row.effective_from<=$2 AND version_row.effective_until>=$3 AND version_row.approved_at<=$4 ${balanceFacetScope} ORDER BY version_row.effective_from DESC,version_row.version DESC LIMIT 1`,
          query.facetId
            ? [
                descendants,
                windows.selected.start,
                windows.selected.end,
                scenario.known_at,
                query.facetId,
              ]
            : [descendants, windows.selected.start, windows.selected.end, scenario.known_at],
        )
      ).rows[0];
      const balance = junction
        ? await new PostgresWaterBalanceService(this.databaseUrl, c).calculate(junction.id, {
            intervalStart: windows.selected.start,
            intervalEnd: windows.selected.end,
            knownAt: scenario.known_at,
          })
        : {
            outcome: 'deferred' as const,
            deferReason: 'no_approved_water_balance_model' as const,
            junctionId: '00000000-0000-4000-8000-000000000000',
            modelId: null,
            versionId: null,
            interval: windows.selected,
            knownAt: scenario.known_at,
            components: [],
            incomingM3: null,
            outgoingM3: null,
            knownAdditionM3: null,
            knownRemovalM3: null,
            storageChangeM3: null,
            assumptionId: null,
            assumptionProvenance: null,
            residualM3: null,
            provenance: 'synthetic: no scoped balance junction',
            dataClassification: 'synthetic' as const,
            officialComplianceEligible: false as const,
            alarmEligible: false as const,
          };
      const stateFilter = query.facet ? 'AND row.station_id=ANY($2::uuid[])' : '';
      const stateCounts = await c.query<{
        station_count: string;
        device_count: string;
        no_data: string;
        unreliable: string;
        reported: string;
        communicating: string;
        offline: string;
        unknown: string;
      }>(
        `WITH RECURSIVE d AS (SELECT id FROM territories WHERE id=$1 UNION ALL SELECT child.id FROM territories child JOIN d ON child.parent_territory_id=d.id), rows AS (SELECT row.* FROM live_operations_synthetic_rows row JOIN d ON d.id=row.territory_id WHERE row.scenario_id='d6000000-0000-4000-8000-000000000001' ${stateFilter}) SELECT count(*)::text station_count,count(*)::text device_count,count(*) FILTER(WHERE data_state='no_data')::text no_data,count(*) FILTER(WHERE data_state='unreliable')::text unreliable,count(*) FILTER(WHERE data_state='reported')::text reported,count(*) FILTER(WHERE connection_status='communicating')::text communicating,count(*) FILTER(WHERE connection_status='offline')::text offline,count(*) FILTER(WHERE connection_status='unknown')::text unknown FROM rows`,
        query.facet ? [territoryId, facetStations] : [territoryId],
      );
      const counts = stateCounts.rows[0] ?? {
        station_count: '0',
        device_count: '0',
        no_data: '0',
        unreliable: '0',
        reported: '0',
        communicating: '0',
        offline: '0',
        unknown: '0',
      };
      const n = Number(counts.station_count),
        reported = Number(counts.reported),
        unreliable = Number(counts.unreliable),
        noData = Number(counts.no_data);
      const allEligible =
        definedPopulation > 0 && omittedPopulation === 0 && totals.counts.unassessable === 0;
      return {
        referenceAt: scenario.reference_at,
        knownAt: scenario.known_at,
        presentationTimeZone: 'Asia/Tashkent',
        windows,
        scenario: {
          id: scenarioId,
          version: scenario.version,
          method: 'governed_p3_composition_v1',
          provenance: scenario.provenance,
          synthetic: true,
          officialComplianceEligible: false,
          forecast: false,
        },
        scope: {
          territoryId,
          descendantTerritoryIds: descendants,
          facet: query.facet ?? null,
          facetId: query.facetId ?? null,
          allowedFacets: facets,
          stationDenominator: n,
          deviceDenominator: Number(counts.device_count),
        },
        delivery: {
          state: allEligible ? 'assessed' : definedPopulation ? 'unassessable' : 'unconfigured',
          population: {
            defined: definedPopulation,
            returned: sections.length,
            complete: omittedPopulation === 0,
          },
          memberCounts,
          plannedM3: allEligible ? exact(totals.planned) : null,
          actualM3: allEligible ? exact(totals.actual) : null,
          signedVarianceM3: allEligible ? exact(totals.signedVariance) : null,
          absoluteVarianceM3: allEligible ? exact(totals.absoluteVariance) : null,
          exclusionNote:
            'Aggregate totals are null unless every defined delivery member is exact whole-window, complete, valid direct-discharge or accumulated-volume P3 evidence. Stage-derived, no-data, unreliable, incomplete, and unconfigured evidence is excluded.',
          groups,
        },
        deviationMatrix: matrix,
        balance,
        qualityCoverage: {
          denominator: n,
          completeValid: reported,
          estimatedExcluded: 0,
          unreliable,
          noData,
          unconfigured: 0,
          state: n ? 'assessed' : 'unconfigured',
          provenance: {
            dataClassification: 'synthetic',
            officialComplianceEligible: false,
            label:
              'Synthetic availability fixture; quality counts are coverage only, not condition or confidence.',
          },
        },
        availability: {
          denominator: Number(counts.device_count),
          communicating: Number(counts.communicating),
          offline: Number(counts.offline),
          unknown: Number(counts.unknown),
          cadenceState: 'unconfigured',
          reason: 'cadence_unconfigured',
          provenance: {
            dataClassification: 'synthetic',
            officialComplianceEligible: false,
            label: 'Synthetic device connection states; no online percentage is calculated.',
          },
        },
        provenance: {
          dataClassification: 'synthetic',
          officialComplianceEligible: false,
          label:
            'Synthetic P6 analytics composition; governed P3 results only, not official accounting or forecast.',
        },
      } satisfies AnalyticsResponse;
    });
  }
}

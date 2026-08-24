import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { allocationDeviationResultSchema, auditEventsResponseSchema } from '@isuv/contracts';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { PostgresAllocationDeviationService } from '../allocation-deviation/service.js';
import { PostgresAllocationPlanService } from '../allocation-plans/service.js';
import { PostgresAlarmRuleService } from '../alarm-rules/service.js';
import { PostgresAlarmService } from '../alarms/service.js';
import { PostgresAuditEventRepository } from '../audit/repository.js';
import { PostgresTerritoryAuthorizationRepository } from '../authorization/service.js';
import { PostgresDeviceHealthService } from '../device-health/service.js';
import { PostgresIdentitySessionRepository } from '../identity/repository.js';
import { PostgresIncidentService } from '../incidents/service.js';
import { PostgresObservationService } from '../observations/service.js';
import { PostgresReportService } from '../reports/service.js';
import { ingestSyntheticBatch } from '../telemetry/adapter.js';
import { PostgresValidationService } from '../validation/service.js';
import { PostgresWaterBalanceService } from '../water-balance/service.js';
import { registerAuditRoutes } from '../audit/routes.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for operational scenario tests');

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
after(async () => pool.end());

const actors = {
  systemAdministrator: 'a3000000-0000-4000-8000-000000000001',
  nationalAdministrator: 'a3000000-0000-4000-8000-000000000002',
  scenarioRequester: 'a3000000-0000-4000-8000-000000000004',
  scenarioApprover: 'a3000000-0000-4000-8000-000000000003',
} as const;

const p6Provenance =
  'synthetic: governed P6 composition cutoff; not official accounting or forecast';
const p7Provenance =
  'synthetic: P7 repeatable operational scenario; not official telemetry, allocation, policy, compliance, or incident evidence';
const p7AlarmFixtureProvenance =
  'synthetic: P7 isolated alarm fixture; not official telemetry, policy, compliance, or incident evidence';

const p7AlarmFixture = {
  parentTerritoryId: 'a2000000-0000-4000-8000-000000000004',
  territoryId: 'e7100000-0000-4000-8000-000000000001',
  stationId: 'e7100000-0000-4000-8000-000000000002',
  deviceId: 'e7100000-0000-4000-8000-000000000003',
  installationId: 'e7100000-0000-4000-8000-000000000004',
  sensorId: 'e7100000-0000-4000-8000-000000000005',
  territoryCode: 'P7-ALARM-ROLLBACK-TERRITORY',
  stationCode: 'P7-ALARM-ROLLBACK-STATION',
  deviceCode: 'P7-ALARM-ROLLBACK-DEVICE',
  sensorCode: 'P7-ALARM-ROLLBACK-STAGE',
} as const;

function requestId(part: string) {
  return `p7-operational-${part}-${randomUUID()}`;
}

test(
  'P7 governed operational scenario composes P6 evidence, alarm safety, snapshots, simulator status, and audit lookup',
  { concurrency: false },
  async (t) => {
    await t.test(
      'P6 direct-discharge whole-interval plan remains exact, synthetic, and nonofficial',
      async () => {
        const client = await pool.connect();
        await client.query('BEGIN');
        try {
          const fixture = (
            await client.query<{
              plan_id: string;
              territory_id: string;
              interval_start: string;
              interval_end: string;
              known_at: string;
            }>(
              `SELECT plan.id plan_id,plan.territory_id,
                    to_char(entry.interval_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') interval_start,
                    to_char(entry.interval_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') interval_end,
                    to_char(scenario.known_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') known_at
               FROM allocation_plans plan
               JOIN allocation_plan_versions version_row ON version_row.plan_id=plan.id
               JOIN allocation_plan_entries entry ON entry.plan_version_id=version_row.id
               JOIN analytics_synthetic_scenarios scenario ON scenario.provenance=$1
              WHERE plan.creation_reason='seed P6 governed analytics scenario'
                AND version_row.status='approved'
              ORDER BY entry.interval_end DESC LIMIT 1`,
              [p6Provenance],
            )
          ).rows[0];
          assert.ok(fixture, 'fresh seed provides the governed P6 plan');
          const result = allocationDeviationResultSchema.parse(
            await new PostgresAllocationDeviationService(databaseUrl, client).deviation(
              fixture.plan_id,
              {
                intervalStart: fixture.interval_start,
                intervalEnd: fixture.interval_end,
                knownAt: fixture.known_at,
              },
            ),
          );
          if (result.outcome !== 'computed')
            assert.fail(`P6 exact allocation comparison deferred: ${result.outcome}`);
          const actual = result.actual;
          assert.ok(actual?.volume, 'computed P6 comparison retains a derived volume');
          assert.equal(result.condition, 'within');
          assert.equal(Number(result.plannedEntry.plannedVolume), Number(actual.volume.numerator));
          assert.equal(actual.volume.denominator, '1');
          assert.equal(result.plannedEntry.unit, 'm3');
          assert.equal(actual.volume.unit, 'm3');
          assert.equal(result.binding.method, 'direct_discharge');
          assert.equal(result.binding.sensorId.startsWith('f10a'), true);
          assert.equal(result.officialComplianceEligible, false);
          assert.equal(result.dataClassification, 'synthetic');
          assert.match(result.binding.provenance, /synthetic/i);
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      },
    );

    await t.test(
      'two isolated approved direct-discharge plans prove exact over and under allocation boundaries',
      async () => {
        const client = await pool.connect();
        await client.query('BEGIN');
        try {
          const fixture = (
            await client.query<{
              section_id: string;
              station_id: string;
              sensor_id: string;
              device_id: string;
              installation_id: string;
            }>(
              `SELECT section_row.id section_id,policy.station_id,policy.sensor_id,sensor.device_id,
                      policy.device_installation_id installation_id
                 FROM integration_coverage_policies policy
                 JOIN telemetry_sensors sensor ON sensor.id=policy.sensor_id
                 JOIN water_sections section_row ON section_row.upstream_junction_id=(
                   SELECT station.junction_id FROM monitoring_stations station WHERE station.id=policy.station_id
                 )
                WHERE policy.id='b9000000-0000-4000-8000-000000000003'
                  AND policy.method='direct_discharge'
                  AND section_row.lifecycle='active'
                ORDER BY section_row.id LIMIT 1`,
            )
          ).rows[0];
          assert.ok(fixture, 'the seeded approved direct-discharge coverage stream is available');
          const plans = new PostgresAllocationPlanService(databaseUrl, client);
          const deviations = new PostgresAllocationDeviationService(databaseUrl, client);
          const observations = new PostgresObservationService(databaseUrl, client);
          const tolerance = await deviations.createTolerancePolicy(
            {
              waterSectionId: fixture.section_id,
              provenance: p7Provenance,
              reason: 'P7 exact allocation tolerance fixture',
            },
            actors.systemAdministrator,
            requestId('allocation-tolerance-create'),
          );
          const cases = [
            {
              name: 'over',
              intervalStart: '2032-01-01T00:00:00.000000Z',
              intervalEnd: '2032-01-01T01:00:00.000000Z',
              dischargeM3s: '2',
              condition: 'over',
              actual: '7200',
              delta: '3600',
              absoluteDelta: '3600',
              percent: '100',
            },
            {
              name: 'under',
              intervalStart: '2032-01-01T02:00:00.000000Z',
              intervalEnd: '2032-01-01T03:00:00.000000Z',
              dischargeM3s: '0.5',
              condition: 'under',
              actual: '1800',
              delta: '-1800',
              absoluteDelta: '1800',
              percent: '-50',
            },
          ] as const;
          let planId: string | null = null;
          for (const scenario of cases) {
            const input = {
              effectiveFrom: scenario.intervalStart,
              effectiveUntil: scenario.intervalEnd,
              entries: [
                {
                  intervalStart: scenario.intervalStart,
                  intervalEnd: scenario.intervalEnd,
                  plannedVolume: '3600',
                  unit: 'm3' as const,
                  targetSemantics: 'whole_interval_target_no_proration' as const,
                },
              ],
              reason: `P7 ${scenario.name} exact one-hour allocation fixture`,
            };
            let draft: { id: string; planId: string; version: number };
            if (planId)
              draft = await plans.append(
                planId,
                input,
                actors.systemAdministrator,
                requestId(`allocation-${scenario.name}-plan-append`),
              );
            else
              draft = await plans.create(
                { waterSectionId: fixture.section_id, ...input },
                actors.systemAdministrator,
                requestId(`allocation-${scenario.name}-plan-create`),
              );
            planId = draft.planId;
            const entry = (
              await client.query<{ id: string }>(
                'SELECT id FROM allocation_plan_entries WHERE plan_version_id=$1',
                [draft.id],
              )
            ).rows[0];
            assert.ok(entry);
            const binding = await deviations.createBinding(
              entry.id,
              {
                stationId: fixture.station_id,
                sensorId: fixture.sensor_id,
                deviceInstallationId: fixture.installation_id,
                method: 'direct_discharge',
                referencePlane: 'upstream',
                provenance: p7Provenance,
                reason: `P7 ${scenario.name} direct-discharge binding`,
              },
              actors.systemAdministrator,
              requestId(`allocation-${scenario.name}-binding`),
            );
            await plans.request(
              draft.planId,
              draft.version,
              `request P7 ${scenario.name} plan`,
              actors.systemAdministrator,
              requestId(`allocation-${scenario.name}-plan-request`),
            );
            await plans.approve(
              draft.planId,
              draft.version,
              {
                reason: `approve P7 ${scenario.name} plan`,
                legalReference: 'SYNTHETIC-NON-AUTHORITATIVE',
              },
              actors.nationalAdministrator,
              requestId(`allocation-${scenario.name}-plan-approve`),
            );
            const toleranceVersion = await deviations.requestToleranceVersion(
              tolerance.id,
              {
                effectiveFrom: scenario.intervalStart,
                effectiveUntil: scenario.intervalEnd,
                underAbsoluteM3: '0',
                overAbsoluteM3: '0',
                combination: 'any',
                appliesToZeroPlan: false,
                reason: `request P7 ${scenario.name} zero tolerance`,
              },
              actors.systemAdministrator,
              requestId(`allocation-${scenario.name}-tolerance-request`),
            );
            await deviations.approveToleranceVersion(
              tolerance.id,
              toleranceVersion.version,
              `approve P7 ${scenario.name} zero tolerance`,
              actors.nationalAdministrator,
              requestId(`allocation-${scenario.name}-tolerance-approve`),
            );
            const ingest = async (observedAt: string) => {
              const raw = await observations.ingest({
                sensorId: fixture.sensor_id,
                deviceId: fixture.device_id,
                measurementKind: 'discharge',
                sourceSystem: 'p7-operational-scenario',
                sourceEventId: randomUUID(),
                observedAt,
                unit: 'm3/s',
                value: scenario.dischargeM3s,
                uncertainty: '0',
                uncertaintyMethod: 'synthetic exact P7 allocation fixture',
                uncertaintyConfidence: '1',
                qualityState: 'unknown',
                qualityReason: 'awaiting governed P7 correction',
                totalizerTransition: null,
                provenance: p7Provenance,
                measurementMethod: 'synthetic_direct_discharge_fixture',
              });
              return observations.correct(
                raw.observation.lineageId,
                {
                  workflowState: 'corrected',
                  value: scenario.dischargeM3s,
                  uncertainty: '0',
                  qualityState: 'valid',
                  qualityReason: null,
                  totalizerTransition: null,
                  provenance: p7Provenance,
                  correctionReason: `P7 ${scenario.name} governed discharge evidence`,
                  measurementMethod: 'synthetic_direct_discharge_fixture',
                },
                actors.systemAdministrator,
                requestId(`allocation-${scenario.name}-observation-correct`),
              );
            };
            const hour = scenario.intervalStart.slice(0, 13);
            const samples = [
              scenario.intervalStart,
              `${hour}:15:00.000000Z`,
              `${hour}:30:00.000000Z`,
              `${hour}:45:00.000000Z`,
              scenario.intervalEnd,
            ];
            let last = await ingest(samples[0]!);
            for (const observedAt of samples.slice(1)) last = await ingest(observedAt);
            const result = allocationDeviationResultSchema.parse(
              await deviations.deviation(draft.planId, {
                intervalStart: scenario.intervalStart,
                intervalEnd: scenario.intervalEnd,
                knownAt: last.ingestedAt,
              }),
            );
            assert.equal(result.outcome, 'computed', JSON.stringify(result));
            if (result.outcome !== 'computed') continue;
            assert.equal(result.condition, scenario.condition);
            assert.deepEqual(result.actual.volume, {
              numerator: scenario.actual,
              denominator: '1',
              unit: 'm3',
            });
            assert.deepEqual(result.delta, {
              numerator: scenario.delta,
              denominator: '1',
              unit: 'm3',
            });
            assert.deepEqual(result.absoluteDelta, {
              numerator: scenario.absoluteDelta,
              denominator: '1',
              unit: 'm3',
            });
            assert.deepEqual(result.percent, {
              numerator: scenario.percent,
              denominator: '1',
              unit: 'percent',
            });
            assert.equal(Number(result.plannedEntry.plannedVolume), 3600);
            assert.equal(result.plannedEntry.unit, 'm3');
            assert.equal(result.binding.method, 'direct_discharge');
            assert.equal(result.actual.unit, 'm3');
            assert.equal(result.officialComplianceEligible, false);
            assert.equal(binding.provenance, p7Provenance);
          }
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      },
    );

    await t.test(
      'governed incoming and outgoing balance applies travel time and explicit terms without inferring loss',
      async () => {
        const client = await pool.connect();
        await client.query('BEGIN');
        try {
          const base = (
            await client.query<{ organization_id: string; territory_id: string }>(
              `SELECT organization_id,territory_id FROM network_junctions
                WHERE lifecycle='active' ORDER BY id LIMIT 1`,
            )
          ).rows[0];
          assert.ok(base, 'a synthetic organization and territory are seeded');
          const fixture = {
            junction: randomUUID(),
            upstreamJunction: randomUUID(),
            downstreamJunction: randomUUID(),
            incomingSection: randomUUID(),
            outgoingSection: randomUUID(),
            incomingStation: randomUUID(),
            outgoingStation: randomUUID(),
            incomingDevice: randomUUID(),
            outgoingDevice: randomUUID(),
            incomingInstallation: randomUUID(),
            outgoingInstallation: randomUUID(),
            incomingSensor: randomUUID(),
            outgoingSensor: randomUUID(),
            incomingCoverage: randomUUID(),
            outgoingCoverage: randomUUID(),
          };
          const tag = fixture.junction.slice(0, 8);
          for (const [id, code] of [
            [fixture.junction, 'P7-BAL-J'],
            [fixture.upstreamJunction, 'P7-BAL-U'],
            [fixture.downstreamJunction, 'P7-BAL-D'],
          ] as const)
            await client.query(
              `INSERT INTO network_junctions(id,organization_id,territory_id,code,name,lifecycle,status,data_classification)
               VALUES($1,$2,$3,$4,$4,'active','operational','synthetic')`,
              [id, base.organization_id, base.territory_id, `${code}-${tag}`],
            );
          for (const [id, upstream, downstream, code] of [
            [fixture.incomingSection, fixture.upstreamJunction, fixture.junction, 'P7-BAL-IN'],
            [fixture.outgoingSection, fixture.junction, fixture.downstreamJunction, 'P7-BAL-OUT'],
          ] as const)
            await client.query(
              `INSERT INTO water_sections(id,organization_id,territory_id,upstream_junction_id,downstream_junction_id,code,name,lifecycle,status,data_classification)
               VALUES($1,$2,$3,$4,$5,$6,$6,'active','operational','synthetic')`,
              [id, base.organization_id, base.territory_id, upstream, downstream, `${code}-${tag}`],
            );
          for (const [station, device, installation, sensor, code, stationJunction] of [
            [
              fixture.incomingStation,
              fixture.incomingDevice,
              fixture.incomingInstallation,
              fixture.incomingSensor,
              'P7-BAL-IN',
              fixture.upstreamJunction,
            ],
            [
              fixture.outgoingStation,
              fixture.outgoingDevice,
              fixture.outgoingInstallation,
              fixture.outgoingSensor,
              'P7-BAL-OUT',
              fixture.downstreamJunction,
            ],
          ] as const) {
            await client.query(
              `INSERT INTO monitoring_stations(id,organization_id,territory_id,junction_id,code,name,lifecycle,status,data_classification)
               VALUES($1,$2,$3,$4,$5,$5,'active','operational','synthetic')`,
              [
                station,
                base.organization_id,
                base.territory_id,
                stationJunction,
                `${code}-ST-${tag}`,
              ],
            );
            await client.query(
              `INSERT INTO telemetry_devices(id,organization_id,territory_id,code,name,protocol,lifecycle,status,data_classification)
               VALUES($1,$2,$3,$4,$4,'manual','active','operational','synthetic')`,
              [device, base.organization_id, base.territory_id, `${code}-DV-${tag}`],
            );
            await client.query(
              `INSERT INTO telemetry_device_installations(id,organization_id,territory_id,device_id,station_id,effective_from,provenance,data_classification)
               VALUES($1,$2,$3,$4,$5,'2032-12-01T00:00:00.000000Z',$6,'synthetic')`,
              [
                installation,
                base.organization_id,
                base.territory_id,
                device,
                station,
                p7Provenance,
              ],
            );
            await client.query(
              `INSERT INTO telemetry_sensors(id,organization_id,territory_id,device_id,code,name,measurement_kind,unit,lifecycle,status,data_classification)
               VALUES($1,$2,$3,$4,$5,$5,'discharge','m3/s','active','operational','synthetic')`,
              [sensor, base.organization_id, base.territory_id, device, `${code}-SN-${tag}`],
            );
          }
          const policyRequestIds: string[] = [];
          for (const [policy, station, sensor, installation, label] of [
            [
              fixture.incomingCoverage,
              fixture.incomingStation,
              fixture.incomingSensor,
              fixture.incomingInstallation,
              'incoming',
            ],
            [
              fixture.outgoingCoverage,
              fixture.outgoingStation,
              fixture.outgoingSensor,
              fixture.outgoingInstallation,
              'outgoing',
            ],
          ] as const) {
            const createRequestId = requestId(`balance-coverage-${label}-create`);
            const approveRequestId = requestId(`balance-coverage-${label}-approve`);
            policyRequestIds.push(createRequestId, approveRequestId);
            await client.query(
              `INSERT INTO integration_coverage_policies(
                 id,organization_id,territory_id,station_id,sensor_id,device_installation_id,method,
                 data_classification,provenance,created_by_user_id,creation_reason,created_request_id)
               VALUES($1,$2,$3,$4,$5,$6,'direct_discharge','synthetic',$7,$8,$9,$10)`,
              [
                policy,
                base.organization_id,
                base.territory_id,
                station,
                sensor,
                installation,
                p7Provenance,
                actors.systemAdministrator,
                `P7 governed coverage bootstrap for ${label} balance stream`,
                createRequestId,
              ],
            );
            await client.query(
              `INSERT INTO integration_coverage_policy_versions(
                 policy_id,version,effective_from,effective_until,max_gap_microseconds,
                 requested_by_user_id,request_reason,requested_request_id,
                 approved_by_user_id,approval_reason,approved_request_id)
               VALUES($1,1,'2032-12-01T00:00:00.000000Z','2033-12-01T00:00:00.000000Z',900000000,
                 $2,$3,$4,$5,$6,$7)`,
              [
                policy,
                actors.systemAdministrator,
                `P7 governed coverage request for ${label} balance stream`,
                requestId(`balance-coverage-${label}-request`),
                actors.nationalAdministrator,
                `P7 independent coverage approval for ${label} balance stream`,
                approveRequestId,
              ],
            );
          }
          const coverageAudit = await client.query<{ action: string; count: string }>(
            `SELECT action::text,count(*)::text count FROM audit_events
              WHERE request_id=ANY($1::text[]) GROUP BY action ORDER BY action`,
            [policyRequestIds],
          );
          assert.deepEqual(coverageAudit.rows, [
            { action: 'integration_coverage_policy.created', count: '2' },
            { action: 'integration_coverage_policy_version.approved', count: '2' },
          ]);
          const balance = new PostgresWaterBalanceService(databaseUrl, client);
          const intervalStart = '2033-01-01T00:00:00.000000Z';
          const intervalEnd = '2033-01-01T01:00:00.000000Z';
          const model = await balance.create(
            {
              junctionId: fixture.junction,
              provenance: p7Provenance,
              reason: 'P7 governed incoming/outgoing balance fixture',
            },
            actors.systemAdministrator,
            requestId('balance-model-create'),
          );
          const version = await balance.request(
            model.id,
            {
              effectiveFrom: intervalStart,
              effectiveUntil: intervalEnd,
              components: [
                {
                  waterSectionId: fixture.incomingSection,
                  stationId: fixture.incomingStation,
                  sensorId: fixture.incomingSensor,
                  deviceInstallationId: fixture.incomingInstallation,
                  method: 'direct_discharge',
                  role: 'incoming',
                  referencePlane: 'upstream',
                  travelTimeMicroseconds: '60000000',
                  provenance: p7Provenance,
                },
                {
                  waterSectionId: fixture.outgoingSection,
                  stationId: fixture.outgoingStation,
                  sensorId: fixture.outgoingSensor,
                  deviceInstallationId: fixture.outgoingInstallation,
                  method: 'direct_discharge',
                  role: 'outgoing',
                  referencePlane: 'downstream',
                  travelTimeMicroseconds: '0',
                  provenance: p7Provenance,
                },
              ],
              assumptions: [
                {
                  intervalStart,
                  intervalEnd,
                  storageChangeM3: '10',
                  knownAdditionM3: '20',
                  knownRemovalM3: '5',
                  provenance: p7Provenance,
                },
              ],
              provenance: p7Provenance,
              reason: 'P7 governed exact balance request',
            },
            actors.systemAdministrator,
            requestId('balance-model-request'),
          );
          await balance.approve(
            model.id,
            version.version,
            'P7 independent balance approval',
            actors.nationalAdministrator,
            requestId('balance-model-approve'),
          );
          const observations = new PostgresObservationService(databaseUrl, client);
          const ingestValid = async (
            sensorId: string,
            deviceId: string,
            observedAt: string,
            value: string,
          ) => {
            const raw = await observations.ingest({
              sensorId,
              deviceId,
              measurementKind: 'discharge',
              sourceSystem: 'p7-operational-balance',
              sourceEventId: randomUUID(),
              observedAt,
              unit: 'm3/s',
              value,
              uncertainty: '0',
              uncertaintyMethod: 'synthetic exact P7 balance fixture',
              uncertaintyConfidence: '1',
              qualityState: 'unknown',
              qualityReason: 'awaiting governed P7 correction',
              totalizerTransition: null,
              provenance: p7Provenance,
              measurementMethod: 'synthetic_direct_discharge_fixture',
            });
            return observations.correct(
              raw.observation.lineageId,
              {
                workflowState: 'corrected',
                value,
                uncertainty: '0',
                qualityState: 'valid',
                qualityReason: null,
                totalizerTransition: null,
                provenance: p7Provenance,
                correctionReason: 'P7 governed balance discharge evidence',
                measurementMethod: 'synthetic_direct_discharge_fixture',
              },
              actors.systemAdministrator,
              requestId('balance-observation-correct'),
            );
          };
          const incomingTimes = [
            '2032-12-31T23:59:00.000000Z',
            '2033-01-01T00:14:00.000000Z',
            '2033-01-01T00:29:00.000000Z',
            '2033-01-01T00:44:00.000000Z',
            '2033-01-01T00:59:00.000000Z',
          ];
          const outgoingTimes = [
            intervalStart,
            '2033-01-01T00:15:00.000000Z',
            '2033-01-01T00:30:00.000000Z',
            '2033-01-01T00:45:00.000000Z',
            intervalEnd,
          ];
          let knownAt = '';
          for (const observedAt of incomingTimes)
            knownAt = (
              await ingestValid(fixture.incomingSensor, fixture.incomingDevice, observedAt, '2')
            ).ingestedAt;
          for (const observedAt of outgoingTimes)
            knownAt = (
              await ingestValid(fixture.outgoingSensor, fixture.outgoingDevice, observedAt, '1')
            ).ingestedAt;
          const result = await balance.calculate(fixture.junction, {
            intervalStart,
            intervalEnd,
            knownAt,
          });
          assert.equal(result.outcome, 'computed');
          assert.deepEqual(result.incomingM3, { numerator: '7200', denominator: '1', unit: 'm3' });
          assert.deepEqual(result.outgoingM3, { numerator: '3600', denominator: '1', unit: 'm3' });
          assert.deepEqual(result.knownAdditionM3, {
            numerator: '20',
            denominator: '1',
            unit: 'm3',
          });
          assert.deepEqual(result.knownRemovalM3, { numerator: '5', denominator: '1', unit: 'm3' });
          assert.deepEqual(result.storageChangeM3, {
            numerator: '10',
            denominator: '1',
            unit: 'm3',
          });
          assert.deepEqual(result.residualM3, { numerator: '3605', denominator: '1', unit: 'm3' });
          assert.equal(result.components.length, 2);
          assert.equal(
            result.components.find((component) => component.role === 'incoming')
              ?.travelTimeMicroseconds,
            '60000000',
          );
          assert.deepEqual(
            result.components.find((component) => component.role === 'incoming')?.sourceInterval,
            {
              start: '2032-12-31T23:59:00.000000Z',
              end: '2033-01-01T00:59:00.000000Z',
            },
          );
          assert.equal(result.alarmEligible, false);
          assert.doesNotMatch(JSON.stringify(result), /loss|theft|leakage/i);
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      },
    );

    await t.test(
      'invalid evidence defers, a single valid breach remains pending, and no false critical alarm activates or clears',
      async () => {
        const client = await pool.connect();
        await client.query('BEGIN');
        try {
          const base = (
            await client.query<{
              organization_id: string;
              junction_id: string;
            }>(
              `SELECT actor.organization_id, junction.id junction_id
                 FROM identity_users actor
                 JOIN LATERAL (
                   SELECT id
                     FROM network_junctions
                    WHERE organization_id=actor.organization_id
                      AND lifecycle='active'
                    ORDER BY id
                    LIMIT 1
                 ) junction ON true
                WHERE actor.id=$1
                  AND EXISTS (
                    WITH RECURSIVE target_ancestors(id,parent_territory_id) AS (
                      SELECT territory.id,territory.parent_territory_id
                        FROM territories territory
                       WHERE territory.id=$2 AND territory.organization_id=actor.organization_id
                      UNION ALL
                      SELECT parent.id,parent.parent_territory_id
                        FROM territories parent
                        JOIN target_ancestors ancestor ON ancestor.parent_territory_id=parent.id
                    )
                    SELECT 1
                      FROM user_role_grants grant_row
                     WHERE grant_row.user_id=actor.id
                       AND grant_row.organization_id=actor.organization_id
                       AND grant_row.role='basin_dispatcher'
                       AND grant_row.scope='territory'
                       AND grant_row.territory_id IN (SELECT id FROM target_ancestors)
                       AND grant_row.cancelled_at IS NULL
                       AND grant_row.effective_from <= $3
                       AND (grant_row.effective_until IS NULL OR grant_row.effective_until > $3)
                  )
                LIMIT 1`,
              [
                actors.scenarioRequester,
                p7AlarmFixture.parentTerritoryId,
                '2034-01-01T00:00:00.000000Z',
              ],
            )
          ).rows[0];
          assert.ok(
            base,
            'P7 requester has an active territory grant and same-organization junction',
          );
          await client.query(
            `INSERT INTO territories(id,organization_id,parent_territory_id,code,name,kind,data_classification)
             VALUES($1,$2,$3,$4,'P7 isolated rollback-only alarm facility','facility','synthetic')`,
            [
              p7AlarmFixture.territoryId,
              base.organization_id,
              p7AlarmFixture.parentTerritoryId,
              p7AlarmFixture.territoryCode,
            ],
          );
          await client.query(
            `INSERT INTO monitoring_stations(id,organization_id,territory_id,junction_id,code,name,lifecycle,status,data_classification)
             VALUES($1,$2,$3,$4,$5,'P7 isolated rollback-only alarm station','active','operational','synthetic')`,
            [
              p7AlarmFixture.stationId,
              base.organization_id,
              p7AlarmFixture.territoryId,
              base.junction_id,
              p7AlarmFixture.stationCode,
            ],
          );
          await client.query(
            `INSERT INTO telemetry_devices(id,organization_id,territory_id,code,name,protocol,lifecycle,status,data_classification)
             VALUES($1,$2,$3,$4,'P7 isolated rollback-only alarm device','manual','active','operational','synthetic')`,
            [
              p7AlarmFixture.deviceId,
              base.organization_id,
              p7AlarmFixture.territoryId,
              p7AlarmFixture.deviceCode,
            ],
          );
          await client.query(
            `INSERT INTO telemetry_device_installations(id,organization_id,territory_id,device_id,station_id,effective_from,provenance,data_classification)
             VALUES($1,$2,$3,$4,$5,'2033-12-01T00:00:00.000000Z',$6,'synthetic')`,
            [
              p7AlarmFixture.installationId,
              base.organization_id,
              p7AlarmFixture.territoryId,
              p7AlarmFixture.deviceId,
              p7AlarmFixture.stationId,
              p7AlarmFixtureProvenance,
            ],
          );
          await client.query(
            `INSERT INTO telemetry_sensors(id,organization_id,territory_id,device_id,code,name,measurement_kind,unit,lifecycle,status,data_classification)
             VALUES($1,$2,$3,$4,$5,'P7 isolated rollback-only stage sensor','stage','m','active','operational','synthetic')`,
            [
              p7AlarmFixture.sensorId,
              base.organization_id,
              p7AlarmFixture.territoryId,
              p7AlarmFixture.deviceId,
              p7AlarmFixture.sensorCode,
            ],
          );
          const fixture = {
            organization_id: base.organization_id,
            territory_id: p7AlarmFixture.territoryId,
            sensor_id: p7AlarmFixture.sensorId,
            device_id: p7AlarmFixture.deviceId,
          };
          const authorization = (
            await client.query<{ requester_may_write: boolean; approver_may_approve: boolean }>(
              `SELECT alarm_rule_actor_may_act($1,$2,$3,'write',$4) requester_may_write,
                      alarm_rule_actor_may_act($5,$2,$3,'approve',$4) approver_may_approve`,
              [
                actors.scenarioRequester,
                fixture.organization_id,
                fixture.territory_id,
                '2034-01-01T00:00:00.000000Z',
                actors.scenarioApprover,
              ],
            )
          ).rows[0];
          assert.equal(authorization?.requester_may_write, true);
          assert.equal(authorization?.approver_may_approve, true);
          const rules = new PostgresAlarmRuleService(databaseUrl, client);
          const alarms = new PostgresAlarmService(databaseUrl, client);
          const observations = new PostgresObservationService(databaseUrl, client);
          const validation = new PostgresValidationService(databaseUrl, client);
          const start = '2034-01-01T00:00:00.000000Z';
          const end = '2034-01-01T00:01:00.000000Z';
          const profile = await validation.createProfile(
            {
              organizationId: fixture.organization_id,
              territoryId: fixture.territory_id,
              sensorId: fixture.sensor_id,
              measurementKind: 'stage',
              dataClassification: 'synthetic',
              name: 'P7 isolated rollback-only stage validation',
              effectiveFrom: start,
              effectiveUntil: end,
              rules: { minimumValue: '0', maximumValue: '10', allowBootstrapWithoutPrior: true },
              reason: 'P7 governed alarm safety fixture',
            },
            actors.scenarioRequester,
            requestId('alarm-profile-create'),
          );
          await validation.approveVersion(
            profile.profileId,
            profile.version,
            fixture.territory_id,
            'independent P7 validation approval',
            actors.scenarioApprover,
            requestId('alarm-profile-approve'),
          );
          const rule = await rules.create(
            {
              territoryId: fixture.territory_id,
              subjectKind: 'observation_sensor',
              subjectId: fixture.sensor_id,
              provenance: p7Provenance,
              reason: 'P7 governed pending/deferred alarm fixture',
            },
            actors.scenarioRequester,
            requestId('alarm-rule-create'),
          );
          const ruleVersion = await rules.request(
            rule.id,
            {
              effectiveFrom: start,
              effectiveUntil: end,
              condition: {
                kind: 'observation_threshold',
                sensorId: fixture.sensor_id,
                quantity: 'stage',
                unit: 'm',
                direction: 'low',
                enter: '2',
                clear: '3',
                enterPersistenceMicroseconds: '1000000',
                clearPersistenceMicroseconds: '1000000',
                maxGapMicroseconds: '3000000',
                uncertaintyBound: '0',
                rateGate: null,
              },
              provenance: p7Provenance,
              reason: 'P7 one-second persistence is deliberate',
            },
            actors.scenarioRequester,
            requestId('alarm-rule-request'),
          );
          await rules.approve(
            rule.id,
            ruleVersion.version,
            'independent P7 rule approval',
            actors.scenarioApprover,
            requestId('alarm-rule-approve'),
          );
          const catalog = await alarms.create(
            {
              territoryId: fixture.territory_id,
              eventType: 'dry_canal',
              title: 'P7 synthetic dry-canal safety check',
              provenance: p7Provenance,
              reason: 'P7 governed catalog fixture',
            },
            actors.scenarioRequester,
            requestId('alarm-catalog-create'),
          );
          const catalogVersion = await alarms.requestVersion(
            catalog.id,
            {
              effectiveFrom: start,
              effectiveUntil: end,
              ruleId: rule.id,
              activationSupport: 'p4_001_rule_signal',
              waterCondition: 'dry_canal',
              systemDeviceCondition: 'not_assessed',
              severity: 'warning',
              provenance: p7Provenance,
              reason: 'P7 governed catalog binding',
            },
            actors.scenarioRequester,
            requestId('alarm-catalog-request'),
          );
          await alarms.approveVersion(
            catalog.id,
            catalogVersion.version,
            'independent P7 catalog approval',
            actors.scenarioApprover,
            requestId('alarm-catalog-approve'),
          );
          const ingest = async (observedAt: string, value: string, valid: boolean) => {
            const raw = await observations.ingest({
              sensorId: fixture.sensor_id,
              deviceId: fixture.device_id,
              measurementKind: 'stage',
              sourceSystem: 'p7-operational-scenario',
              sourceEventId: randomUUID(),
              observedAt,
              unit: 'm',
              value,
              uncertainty: '0',
              uncertaintyMethod: 'synthetic exact P7 fixture',
              uncertaintyConfidence: '1',
              qualityState: valid ? 'unknown' : 'invalid',
              qualityReason: valid ? 'awaiting governed validation' : 'invalid P7 spike',
              totalizerTransition: null,
              provenance: p7Provenance,
              measurementMethod: 'synthetic_direct_stage_fixture',
            });
            if (!valid) return raw.observation;
            return observations.correct(
              raw.observation.lineageId,
              {
                workflowState: 'corrected',
                value,
                uncertainty: '0',
                qualityState: 'valid',
                qualityReason: null,
                totalizerTransition: null,
                provenance: p7Provenance,
                correctionReason: 'P7 governed valid stage evidence',
                measurementMethod: 'synthetic_direct_stage_fixture',
              },
              actors.scenarioRequester,
              requestId('alarm-observation-correct'),
            );
          };
          const valid = await ingest('2034-01-01T00:00:00.500000Z', '1', true);
          const pending = await rules.evaluate(rule.id, {
            effectiveAt: valid.observedAt,
            knownAt: valid.ingestedAt,
          });
          assert.equal(pending.state, 'pending_activation');
          const materialized = await alarms.materialize(
            rule.id,
            valid.observedAt,
            valid.ingestedAt,
            actors.scenarioRequester,
            requestId('alarm-pending-materialize'),
          );
          assert.equal(materialized.alarm, null);
          assert.notEqual(materialized.action, 'automatically_cleared');
          const invalid = await ingest('2034-01-01T00:00:00.600000Z', '99', false);
          const deferred = await rules.evaluate(rule.id, {
            effectiveAt: invalid.observedAt,
            knownAt: invalid.ingestedAt,
          });
          assert.equal(deferred.state, 'deferred');
          assert.equal(
            (
              await alarms.materialize(
                rule.id,
                invalid.observedAt,
                invalid.ingestedAt,
                actors.scenarioRequester,
                requestId('alarm-invalid-materialize'),
              )
            ).alarm,
            null,
          );
          const activeCount = await client.query<{ count: string }>(
            `SELECT count(*)::text count FROM alarms WHERE rule_id=$1 AND automatic_state='active'`,
            [rule.id],
          );
          assert.equal(activeCount.rows[0]?.count, '0');
          const repairedSpike = await observations.correct(
            invalid.lineageId,
            {
              workflowState: 'corrected',
              value: '1',
              uncertainty: '0',
              qualityState: 'valid',
              qualityReason: null,
              totalizerTransition: null,
              provenance: p7Provenance,
              correctionReason: 'P7 review repairs the invalid synthetic spike',
              measurementMethod: 'synthetic_direct_stage_fixture',
            },
            actors.scenarioRequester,
            requestId('alarm-spike-repaired'),
          );
          const activation = await ingest('2034-01-01T00:00:01.700000Z', '1', true);
          const active = await alarms.materialize(
            rule.id,
            activation.observedAt,
            activation.ingestedAt,
            actors.scenarioRequester,
            requestId('alarm-activate'),
          );
          assert.equal(active.alarm?.automaticState, 'active');
          assert.equal(active.alarm?.severity, 'warning');
          const incidents = new PostgresIncidentService(databaseUrl, client);
          const policy = await incidents.createPolicy(
            {
              territoryId: fixture.territory_id,
              eventType: 'dry_canal',
              severity: 'warning',
              title: `P7 dry-canal incident policy ${randomUUID()}`,
              provenance: p7Provenance,
              reason: 'P7 governed incident workflow policy',
            },
            actors.scenarioRequester,
            requestId('incident-policy-create'),
          );
          const policyVersion = await incidents.requestPolicyVersion(
            policy.policy.id,
            {
              effectiveFrom: start,
              effectiveUntil: end,
              tier: 1,
              procedure: 'Synthetic P7 workflow only; no physical control is issued.',
              acknowledgementTargetMicroseconds: '60000000',
              resolutionTargetMicroseconds: '120000000',
              reason: 'P7 request incident escalation policy',
            },
            actors.scenarioRequester,
            requestId('incident-policy-request'),
          );
          await incidents.approvePolicyVersion(
            policy.policy.id,
            policyVersion.policyVersion.version,
            'independent P7 policy approval',
            actors.scenarioApprover,
            requestId('incident-policy-approve'),
          );
          const opened = (await incidents.createIncident(
            active.alarm!.id,
            'open P7 synthetic alarm case',
            actors.scenarioRequester,
            requestId('incident-create'),
          )) as { incident: { id: string } };
          await assert.rejects(
            incidents.action(
              opened.incident.id,
              'resolved',
              'P7 premature resolve must be rejected',
              actors.scenarioRequester,
              requestId('incident-premature-resolve'),
            ),
            /invalid/i,
          );
          await incidents.action(
            opened.incident.id,
            'acknowledged',
            'P7 acknowledge',
            actors.scenarioRequester,
            requestId('incident-acknowledge'),
          );
          await incidents.action(
            opened.incident.id,
            'investigating',
            'P7 investigate',
            actors.scenarioRequester,
            requestId('incident-investigate'),
          );
          await incidents.assign(
            opened.incident.id,
            actors.scenarioRequester,
            'P7 assign investigation',
            actors.scenarioRequester,
            requestId('incident-assign'),
          );
          await incidents.note(
            opened.incident.id,
            'commented',
            'Synthetic field evidence reviewed; no physical command was issued.',
            'P7 record investigation comment',
            actors.scenarioRequester,
            requestId('incident-comment'),
          );
          await ingest('2034-01-01T00:00:02.000000Z', '4', true);
          const clear = await ingest('2034-01-01T00:00:03.100000Z', '4', true);
          const cleared = await alarms.materialize(
            rule.id,
            clear.observedAt,
            clear.ingestedAt,
            actors.scenarioRequester,
            requestId('alarm-automatic-clear'),
          );
          assert.equal(cleared.alarm?.automaticState, 'cleared');
          await incidents.action(
            opened.incident.id,
            'resolved',
            'P7 human resolution after governed automatic clear',
            actors.scenarioRequester,
            requestId('incident-resolve'),
          );
          const closed = (await incidents.action(
            opened.incident.id,
            'closed',
            'P7 close completed synthetic case',
            actors.scenarioRequester,
            requestId('incident-close'),
          )) as {
            incident: { status: string; timeline: Array<{ kind: string; requestId: string }> };
          };
          assert.equal(closed.incident.status, 'closed');
          assert.deepEqual(
            closed.incident.timeline.map((entry) => entry.kind),
            [
              'created',
              'acknowledged',
              'investigating',
              'assigned',
              'commented',
              'resolved',
              'closed',
            ],
          );
          assert.ok(
            closed.incident.timeline.every((entry) =>
              entry.requestId.startsWith('p7-operational-'),
            ),
          );
          const audited = await client.query<{ count: string }>(
            `SELECT count(*)::text count FROM audit_events
              WHERE resource='incident' AND resource_id=$1 AND request_id LIKE 'p7-operational-%'`,
            [opened.incident.id],
          );
          assert.equal(audited.rows[0]?.count, '7');
          assert.ok(repairedSpike.ingestedAt > invalid.ingestedAt);
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      },
    );

    await t.test(
      'six generated reports are frozen and export-stable after a later governed correction',
      async () => {
        const client = await pool.connect();
        await client.query('BEGIN');
        try {
          const fixture = (
            await client.query<{ section_id: string; territory_id: string; incident_id: string }>(
              `SELECT plan.water_section_id section_id,plan.territory_id,
                    (SELECT id FROM incidents ORDER BY created_at,id LIMIT 1) incident_id
               FROM allocation_plans plan
              WHERE plan.creation_reason='seed P6 governed analytics scenario' LIMIT 1`,
            )
          ).rows[0];
          assert.ok(fixture?.incident_id, 'seeded P5 incident supports the incident report kind');
          const reports = new PostgresReportService(databaseUrl, client);
          const generated = [] as Awaited<ReturnType<PostgresReportService['generate']>>[];
          for (const kind of [
            'daily_situation',
            'allocation_compliance',
            'water_balance',
            'device_availability',
            'executive_summary',
          ] as const)
            generated.push(
              await reports.generate(
                { kind, period: 'today', facet: 'section', facetId: fixture.section_id },
                fixture.territory_id,
                actors.systemAdministrator,
                requestId(`report-${kind}`),
              ),
            );
          const incidentScope = (
            await client.query<{ territory_id: string }>(
              'SELECT territory_id FROM incidents WHERE id=$1',
              [fixture.incident_id],
            )
          ).rows[0];
          assert.ok(incidentScope);
          generated.push(
            await reports.generate(
              { kind: 'incident', period: 'today', incidentId: fixture.incident_id },
              incidentScope.territory_id,
              actors.systemAdministrator,
              requestId('report-incident'),
            ),
          );
          assert.equal(new Set(generated.map((report) => report.kind)).size, 6);
          assert.ok(
            generated.every((report) => report.provenance.dataClassification === 'synthetic'),
          );
          assert.ok(
            generated.every((report) => report.provenance.officialComplianceEligible === false),
          );
          const snapshot = generated[0]!;
          const before = await reports.export(
            snapshot.id,
            'csv',
            actors.systemAdministrator,
            requestId('export-csv-before'),
          );
          const beforeHtml = await reports.export(
            snapshot.id,
            'html',
            actors.systemAdministrator,
            requestId('export-html-before'),
          );
          const source = (
            await client.query<{ lineage_id: string }>(
              `SELECT lineage.id lineage_id
               FROM observation_lineages lineage
              WHERE lineage.source_system='synthetic-p6-scenario'
              ORDER BY lineage.id LIMIT 1`,
            )
          ).rows[0];
          assert.ok(source, 'P6 frozen snapshot has an actual governed source lineage');
          const observations = new PostgresObservationService(databaseUrl, client);
          const current = await observations.find(source.lineage_id);
          assert.ok(current);
          const correction = await observations.correct(
            source.lineage_id,
            {
              workflowState: 'corrected',
              value: current.value,
              uncertainty: current.uncertainty,
              uncertaintyMethod: current.uncertaintyMethod ?? undefined,
              uncertaintyConfidence: current.uncertaintyConfidence ?? undefined,
              qualityState: 'valid',
              qualityReason: null,
              totalizerTransition: current.totalizerTransition,
              provenance: p7Provenance,
              correctionReason: 'P7 later correction must not rewrite a snapshot',
              measurementMethod: current.measurementMethod ?? undefined,
              calibrationRef: current.calibrationRef ?? undefined,
              ratingCurveRef: current.ratingCurveRef ?? undefined,
            },
            actors.systemAdministrator,
            requestId('later-correction'),
          );
          assert.ok(correction.ingestedAt > snapshot.knownAt);
          const reread = await reports.get(snapshot.id);
          const after = await reports.export(
            snapshot.id,
            'csv',
            actors.systemAdministrator,
            requestId('export-csv-after'),
          );
          const afterHtml = await reports.export(
            snapshot.id,
            'html',
            actors.systemAdministrator,
            requestId('export-html-after'),
          );
          assert.equal(reread?.fingerprint, snapshot.fingerprint);
          assert.deepEqual(reread?.payload, snapshot.payload);
          assert.equal(after.body, before.body);
          assert.equal(afterHtml.body, beforeHtml.body);
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      },
    );

    await t.test(
      'the synthetic adapter emits offline status facts without numeric observations and audit lookup finds P7 request ids',
      async () => {
        const client = await pool.connect();
        await client.query('BEGIN');
        try {
          const offlineSeed = 'p7-offline-rollback';
          const offlineAt = '2026-08-23T00:00:00.000000Z';
          const observations = new PostgresObservationService(databaseUrl, client);
          const deviceHealth = new PostgresDeviceHealthService(databaseUrl, client);
          const batch = await ingestSyntheticBatch(
            observations,
            offlineSeed,
            offlineAt,
            7,
            'offline',
          );
          assert.equal(batch.accepted, 0);
          assert.equal(batch.idempotent, 0);
          assert.equal(batch.gaps, 83);
          assert.equal(batch.statusEvents.length, 83);
          for (const status of batch.statusEvents) await deviceHealth.ingestSyntheticStatus(status);
          const statusFacts = await client.query<{ rows: string; devices: string }>(
            `SELECT count(*)::text rows,count(DISTINCT device_id)::text devices
               FROM device_health_events
              WHERE source_system='synthetic-simulator-v1'
                AND source_event_id LIKE $1
                AND connection_status='offline'
                AND provenance='synthetic:telemetry-simulator-v1;scenario=offline'`,
            [`synthetic:${offlineSeed}:%`],
          );
          assert.deepEqual(statusFacts.rows[0], { rows: '83', devices: '83' });
          const numeric = await client.query<{ lineages: string; revisions: string }>(
            `SELECT count(DISTINCT lineage.id)::text lineages,count(revision.id)::text revisions
               FROM observation_lineages lineage
               LEFT JOIN observation_revisions revision ON revision.lineage_id=lineage.id
              WHERE lineage.source_system='synthetic-simulator-v1' AND lineage.source_event_id LIKE $1`,
            [`synthetic:${offlineSeed}:%`],
          );
          assert.equal(
            numeric.rows[0]?.lineages,
            '0',
            'offline is a status/gap, never a zero reading',
          );
          assert.equal(numeric.rows[0]?.revisions, '0');

          const auditRequestId = 'p7-rollback-report-export-audit';
          const reports = new PostgresReportService(databaseUrl, client);
          const report = await reports.generate(
            { kind: 'daily_situation', period: 'today' },
            'a2000000-0000-4000-8000-000000000001',
            actors.systemAdministrator,
            'p7-rollback-report-generate',
          );
          const exported = await reports.export(
            report.id,
            'csv',
            actors.systemAdministrator,
            auditRequestId,
          );
          assert.match(
            exported.body,
            /Synthetic\/nonofficial decision support|Synthetic\/nonofficial/i,
          );
          const auditApp = Fastify({
            requestIdHeader: 'x-request-id',
            genReqId: () => 'p7-rollback-audit-route-request',
          });
          registerAuditRoutes(auditApp, {
            identityProvider: {
              async resolve(request) {
                const value = request.headers['x-isuv-user-id'];
                const userId = Array.isArray(value) ? value[0] : value;
                return userId === actors.systemAdministrator
                  ? { userId, provider: 'local-development' as const }
                  : null;
              },
            },
            sessionRepository: new PostgresIdentitySessionRepository(databaseUrl),
            authorizationRepository: new PostgresTerritoryAuthorizationRepository(databaseUrl),
            auditRepository: new PostgresAuditEventRepository(databaseUrl, client),
          });
          try {
            const response = await auditApp.inject({
              method: 'GET',
              url: `/api/v1/audit/events?requestId=${encodeURIComponent(auditRequestId)}&limit=25`,
              headers: {
                'x-isuv-user-id': actors.systemAdministrator,
                'x-request-id': 'p7-rollback-audit-route-request',
              },
            });
            assert.equal(response.statusCode, 200);
            const audit = auditEventsResponseSchema.parse(response.json());
            assert.ok(audit.events.some((event) => event.requestId === auditRequestId));
            assert.ok(audit.events.some((event) => event.action === 'report.exported'));
          } finally {
            await auditApp.close();
          }
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      },
    );
  },
);

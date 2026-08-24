import { withDatabase } from './client.js';
import { seedSyntheticNetwork } from './syntheticNetworkSeed.js';
import type { PoolClient } from 'pg';
import { PostgresAlarmRuleService } from '../modules/alarm-rules/service.js';
import { PostgresAlarmService } from '../modules/alarms/service.js';
import { PostgresIncidentService } from '../modules/incidents/service.js';
import { PostgresObservationService } from '../modules/observations/service.js';
import { PostgresValidationService } from '../modules/validation/service.js';
import { PostgresAllocationPlanService } from '../modules/allocation-plans/service.js';
import { PostgresAllocationDeviationService } from '../modules/allocation-deviation/service.js';
import { PostgresWaterBalanceService } from '../modules/water-balance/service.js';

const p5 = {
  organization: 'a1000000-0000-4000-8000-000000000001',
  territoryA: 'a2000000-0000-4000-8000-000000000004',
  territoryB: 'a2000000-0000-4000-8000-000000000005',
  requester: 'a3000000-0000-4000-8000-000000000004',
  approver: 'a3000000-0000-4000-8000-000000000003',
  assignee: 'a3000000-0000-4000-8000-000000000004',
  provenance:
    'synthetic: governed P5 alarm and incident scenario v1; not official telemetry, policy, or SLA',
} as const;

async function seedSyntheticAlarmIncidentScenario(client: PoolClient): Promise<void> {
  const base = new Date();
  const timestamp = (secondsFromBase: number) =>
    new Date(base.getTime() + secondsFromBase * 1_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, '.000000Z');
  const effectiveFrom = timestamp(-900);
  const effectiveUntil = timestamp(86_400);
  const activeOne = timestamp(-600);
  const activeTwo = timestamp(-599);
  const clear = timestamp(-598);
  const clearTwo = timestamp(-597);
  const reactivateOne = timestamp(-596);
  const reactivateTwo = timestamp(-595);
  const finalActiveOne = timestamp(-591);
  const finalActiveTwo = timestamp(-590);
  const knownAt = async () =>
    (
      await client.query<{ at: string }>(
        `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at`,
      )
    ).rows[0]!.at;
  const existing = await client.query<{ rules: string; catalogs: string; incidents: string }>(
    `SELECT count(*) FILTER (WHERE provenance=$1)::text rules,
      (SELECT count(*) FROM alarm_catalogs WHERE provenance=$1)::text catalogs,
      (SELECT count(*) FROM incidents WHERE creation_reason='seed P5 governed scenario')::text incidents
     FROM alarm_rules WHERE provenance=$1`,
    [p5.provenance],
  );
  const counts = existing.rows[0]!;
  if (counts.rules === '3') {
    if (counts.catalogs !== '3' || Number(counts.incidents) < 3)
      throw new Error('P5 governed synthetic scenario is partially present.');
    return;
  }
  if (counts.rules !== '0' || counts.catalogs !== '0' || counts.incidents !== '0')
    throw new Error('P5 governed synthetic scenario is partially present.');

  const sensors = await client.query<{
    territory_id: string;
    sensor_id: string;
    device_id: string;
    station_code: string;
  }>(
    `SELECT station.territory_id,sensor.id sensor_id,sensor.device_id,station.code station_code
       FROM monitoring_stations station JOIN telemetry_device_installations installation
         ON installation.station_id=station.id AND installation.effective_until IS NULL
       JOIN telemetry_sensors sensor ON sensor.device_id=installation.device_id
      WHERE station.territory_id=ANY($1::uuid[]) AND sensor.measurement_kind='stage' AND sensor.unit='m'
      ORDER BY station.territory_id,station.code`,
    [[p5.territoryA, p5.territoryB]],
  );
  // Reserve the low-ID stage sensors used by independent governed-service
  // tests; the scenario itself uses distinct real seeded synthetic sensors,
  // never a dashboard-only current-state fixture.
  const a = sensors.rows.filter((x) => x.territory_id === p5.territoryA);
  const b = sensors.rows.filter((x) => x.territory_id === p5.territoryB);
  if (a.length < 11 || b.length < 2)
    throw new Error('P5 scenario needs valid stage/m sensors in both territories.');
  const targets = [
    {
      key: 'a-high',
      territoryId: p5.territoryA,
      sensor: a[10]!,
      eventType: 'high_stage' as const,
      enter: '1.5',
      clear: '1.0',
      direction: 'high' as const,
      water: 'high_stage' as const,
    },
    {
      key: 'b-high',
      territoryId: p5.territoryB,
      sensor: b[0]!,
      eventType: 'high_stage' as const,
      enter: '1.5',
      clear: '1.0',
      direction: 'high' as const,
      water: 'high_stage' as const,
    },
    {
      key: 'b-dry',
      territoryId: p5.territoryB,
      sensor: b[1]!,
      eventType: 'dry_canal' as const,
      enter: '0.2',
      clear: '0.3',
      direction: 'low' as const,
      water: 'dry_canal' as const,
    },
  ];
  const observations = new PostgresObservationService(undefined, client);
  const validation = new PostgresValidationService(undefined, client);
  const rules = new PostgresAlarmRuleService(undefined, client);
  const alarms = new PostgresAlarmService(undefined, client);
  const incidents = new PostgresIncidentService(undefined, client);

  for (const target of targets) {
    const profile = await validation.createProfile(
      {
        organizationId: p5.organization,
        territoryId: target.territoryId,
        sensorId: target.sensor.sensor_id,
        measurementKind: 'stage',
        dataClassification: 'synthetic',
        name: `Synthetic P5 ${target.key} stage validation`,
        effectiveFrom,
        effectiveUntil: null,
        rules: { minimumValue: '0', maximumValue: '10', allowBootstrapWithoutPrior: true },
        reason: 'seed P5 governed scenario',
      },
      p5.requester,
      `seed-p5-profile-${target.key}`,
    );
    await validation.approveVersion(
      profile.profileId,
      profile.version,
      target.territoryId,
      'independent synthetic P5 approval',
      p5.approver,
      `seed-p5-profile-approve-${target.key}`,
    );
  }
  async function stage(
    target: (typeof targets)[number],
    at: string,
    value: string,
    suffix: string,
    valid = true,
  ) {
    const ingested = await observations.ingest(
      {
        sensorId: target.sensor.sensor_id,
        deviceId: target.sensor.device_id,
        measurementKind: 'stage',
        sourceSystem: 'synthetic-p5-scenario',
        sourceEventId: `${target.key}-${suffix}`,
        observedAt: at,
        unit: 'm',
        value,
        qualityState: valid ? 'unknown' : 'invalid',
        qualityReason: valid
          ? 'synthetic raw evidence awaiting governed validation'
          : 'synthetic invalid evidence retained for unassessable alarm',
        uncertainty: '0',
        uncertaintyMethod: 'synthetic exact scenario input',
        provenance: p5.provenance,
        measurementMethod: 'synthetic scenario generator',
        totalizerTransition: null,
      },
      target.territoryId,
    );
    if (valid)
      await validation.validate(
        ingested.observation.lineageId,
        target.territoryId,
        p5.requester,
        `seed-p5-validate-${target.key}-${suffix}`,
        at,
      );
  }
  for (const target of targets) {
    const values = target.key === 'b-dry' ? ['0.10', '0.10'] : ['2.00', '2.00'];
    await stage(target, activeOne, values[0]!, 'activate-1');
    await stage(target, activeTwo, values[1]!, 'activate-2');
  }
  const seeded = new Map<string, { ruleId: string; alarmId: string }>();
  for (const target of targets) {
    const rule = await rules.create(
      {
        territoryId: target.territoryId,
        subjectKind: 'observation_sensor',
        subjectId: target.sensor.sensor_id,
        provenance: p5.provenance,
        reason: 'seed P5 governed scenario',
      },
      p5.requester,
      `seed-p5-rule-${target.key}`,
    );
    const version = await rules.request(
      rule.id,
      {
        effectiveFrom,
        effectiveUntil,
        condition: {
          kind: 'observation_threshold',
          sensorId: target.sensor.sensor_id,
          quantity: 'stage',
          unit: 'm',
          direction: target.direction,
          enter: target.enter,
          clear: target.clear,
          enterPersistenceMicroseconds: '1000000',
          clearPersistenceMicroseconds: '1000000',
          maxGapMicroseconds: '60000000',
          uncertaintyBound: '0',
          rateGate: null,
        },
        provenance: p5.provenance,
        reason: 'seed P5 governed scenario',
      },
      p5.requester,
      `seed-p5-rule-request-${target.key}`,
    );
    await rules.approve(
      rule.id,
      version.version,
      'independent synthetic P5 approval',
      p5.approver,
      `seed-p5-rule-approve-${target.key}`,
    );
    const catalog = await alarms.create(
      {
        territoryId: target.territoryId,
        eventType: target.eventType,
        title: `Synthetic P5 ${target.key} alarm`,
        provenance: p5.provenance,
        reason: 'seed P5 governed scenario',
      },
      p5.requester,
      `seed-p5-catalog-${target.key}`,
    );
    const catalogVersion = await alarms.requestVersion(
      catalog.id,
      {
        effectiveFrom,
        effectiveUntil,
        ruleId: rule.id,
        activationSupport: 'p4_001_rule_signal',
        waterCondition: target.water,
        systemDeviceCondition: 'not_assessed',
        severity: 'warning',
        provenance: p5.provenance,
        reason: 'seed P5 governed scenario',
      },
      p5.requester,
      `seed-p5-catalog-request-${target.key}`,
    );
    await alarms.approveVersion(
      catalog.id,
      catalogVersion.version,
      'independent synthetic P5 approval',
      p5.approver,
      `seed-p5-catalog-approve-${target.key}`,
    );
    if (target.key !== 'a-high') {
      const policy = await incidents.createPolicy(
        {
          territoryId: target.territoryId,
          eventType: target.eventType,
          severity: 'warning',
          title: `Synthetic P5 ${target.key} escalation`,
          provenance: p5.provenance,
          reason: 'seed P5 governed scenario',
        },
        p5.requester,
        `seed-p5-policy-${target.key}`,
      );
      const policyVersion = await incidents.requestPolicyVersion(
        policy.policy.id,
        {
          effectiveFrom,
          effectiveUntil,
          tier: 1,
          procedure: 'Synthetic demonstration only; no notification execution.',
          acknowledgementTargetMicroseconds: '60000000',
          resolutionTargetMicroseconds: '120000000',
          reason: 'seed P5 governed scenario',
        },
        p5.requester,
        `seed-p5-policy-request-${target.key}`,
      );
      await incidents.approvePolicyVersion(
        policy.policy.id,
        policyVersion.policyVersion.version,
        'independent synthetic P5 approval',
        p5.approver,
        `seed-p5-policy-approve-${target.key}`,
      );
    }
    const evaluation = await rules.evaluate(rule.id, {
      effectiveAt: activeTwo,
      knownAt: await knownAt(),
    });
    const materialized = await alarms.materialize(
      rule.id,
      activeTwo,
      await knownAt(),
      p5.requester,
      `seed-p5-materialize-${target.key}`,
    );
    if (!materialized.alarm)
      throw new Error(
        `P5 ${target.key} alarm did not materialize: evaluation=${evaluation.state}/${evaluation.reason ?? 'none'}.`,
      );
    seeded.set(target.key, { ruleId: rule.id, alarmId: materialized.alarm.id });
  }
  // A remains automatic-active and unowned; deferred evidence is preserved rather than shown as clear/normal.
  await stage(targets[0]!, clear, '2.00', 'unassessable', false);
  await alarms.materialize(
    seeded.get('a-high')!.ruleId,
    clear,
    await knownAt(),
    p5.requester,
    'seed-p5-materialize-a-unassessable',
  );
  // This open case deliberately has no matching escalation policy, making the
  // unconfigured state a governed absence rather than a display fixture.
  await incidents.createIncident(
    seeded.get('a-high')!.alarmId,
    'seed P5 governed scenario',
    p5.requester,
    'seed-p5-incident-a-missing-policy',
  );
  // Record a subsequent invalid fact after the case exists. This preserves the
  // inability to assess as evidence and makes the latest known evidence safely
  // later than the incident creation timestamp.
  await stage(targets[0]!, clearTwo, '2.00', 'unassessable-after-incident', false);
  await alarms.materialize(
    seeded.get('a-high')!.ruleId,
    clearTwo,
    await knownAt(),
    p5.requester,
    'seed-p5-materialize-a-unassessable-after-incident',
  );
  // B high: automatically clear while its human case remains open, then a new active assigned investigation.
  const bHighIncident = (await incidents.createIncident(
    seeded.get('b-high')!.alarmId,
    'seed P5 governed scenario',
    p5.requester,
    'seed-p5-incident-b-high-open',
  )) as { incident: { id: string } };
  await incidents.action(
    bHighIncident.incident.id,
    'acknowledged',
    'seed P5 acknowledgement',
    p5.requester,
    'seed-p5-incident-b-high-ack',
  );
  await incidents.action(
    bHighIncident.incident.id,
    'investigating',
    'seed P5 investigation',
    p5.requester,
    'seed-p5-incident-b-high-investigate',
  );
  await incidents.assign(
    bHighIncident.incident.id,
    p5.assignee,
    'seed P5 assignment',
    p5.requester,
    'seed-p5-incident-b-high-assign',
  );
  await stage(targets[1]!, clear, '0.50', 'clear');
  await stage(targets[1]!, clearTwo, '0.50', 'clear-2');
  const bHighCleared = await alarms.materialize(
    seeded.get('b-high')!.ruleId,
    clearTwo,
    await knownAt(),
    p5.requester,
    'seed-p5-materialize-b-high-clear',
  );
  if (!bHighCleared.alarm || bHighCleared.alarm.automaticState !== 'cleared')
    throw new Error('P5 B high automatic episode did not clear before remaining human-open.');
  await stage(targets[1]!, reactivateOne, '2.00', 'reactivate-1');
  await stage(targets[1]!, reactivateTwo, '2.00', 'reactivate-2');
  const reactivated = await alarms.materialize(
    seeded.get('b-high')!.ruleId,
    reactivateTwo,
    await knownAt(),
    p5.requester,
    'seed-p5-materialize-b-high-reactivate',
  );
  if (!reactivated.alarm) throw new Error('P5 B high reactivation did not materialize.');
  const investigating = (await incidents.createIncident(
    reactivated.alarm.id,
    'seed P5 governed scenario',
    p5.requester,
    'seed-p5-incident-b-high-reactivated',
  )) as { incident: { id: string } };
  await incidents.action(
    investigating.incident.id,
    'acknowledged',
    'seed P5 acknowledgement',
    p5.requester,
    'seed-p5-incident-b-high-reactivated-ack',
  );
  await incidents.action(
    investigating.incident.id,
    'investigating',
    'seed P5 investigation',
    p5.requester,
    'seed-p5-incident-b-high-reactivated-investigate',
  );
  await incidents.assign(
    investigating.incident.id,
    p5.assignee,
    'seed P5 assignment',
    p5.requester,
    'seed-p5-incident-b-high-reactivated-assign',
  );
  // A continued high-stage observation gives the selected active case evidence
  // whose known time follows the case creation time without inventing a value.
  await stage(targets[1]!, finalActiveOne, '2.00', 'post-incident-evidence');
  await alarms.materialize(
    seeded.get('b-high')!.ruleId,
    finalActiveOne,
    await knownAt(),
    p5.requester,
    'seed-p5-materialize-b-high-post-incident',
  );
  // B dry: ordinary governed close history after its automatic signal clears.
  const dry = (await incidents.createIncident(
    seeded.get('b-dry')!.alarmId,
    'seed P5 governed scenario',
    p5.requester,
    'seed-p5-incident-b-dry-open',
  )) as { incident: { id: string } };
  await incidents.action(
    dry.incident.id,
    'acknowledged',
    'seed P5 acknowledgement',
    p5.requester,
    'seed-p5-incident-b-dry-ack',
  );
  await incidents.action(
    dry.incident.id,
    'investigating',
    'seed P5 investigation',
    p5.requester,
    'seed-p5-incident-b-dry-investigate',
  );
  await incidents.assign(
    dry.incident.id,
    p5.assignee,
    'seed P5 assignment',
    p5.requester,
    'seed-p5-incident-b-dry-assign',
  );
  await stage(targets[2]!, clear, '0.50', 'clear');
  await stage(targets[2]!, clearTwo, '0.50', 'clear-2');
  const dryCleared = await alarms.materialize(
    seeded.get('b-dry')!.ruleId,
    clearTwo,
    await knownAt(),
    p5.requester,
    'seed-p5-materialize-b-dry-clear',
  );
  if (!dryCleared.alarm || dryCleared.alarm.automaticState !== 'cleared')
    throw new Error('P5 B dry automatic episode did not clear before resolution.');
  await incidents.action(
    dry.incident.id,
    'resolved',
    'seed P5 resolution after automatic clear',
    p5.requester,
    'seed-p5-incident-b-dry-resolve',
  );
  await incidents.action(
    dry.incident.id,
    'closed',
    'seed P5 closure after resolution',
    p5.requester,
    'seed-p5-incident-b-dry-close',
  );
  await stage(targets[2]!, finalActiveOne, '0.10', 'final-active-1');
  await stage(targets[2]!, finalActiveTwo, '0.10', 'final-active-2');
  const finalActive = await alarms.materialize(
    seeded.get('b-dry')!.ruleId,
    finalActiveTwo,
    await knownAt(),
    p5.requester,
    'seed-p5-materialize-b-dry-final-active',
  );
  if (!finalActive.alarm || finalActive.alarm.automaticState !== 'active')
    throw new Error('P5 B dry final active/unowned alarm did not materialize.');
}

async function seedSyntheticQuantityDerivationModels(client: {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  // These are deliberately small, transparent fixtures, not calibration data.
  // They demonstrate both governed derivation paths without implying that any
  // of the 83 synthetic hotspot assets has an official curve or policy.
  await client.query(`
    WITH scope AS (
      SELECT station.id station_id, station.organization_id, station.territory_id,
        installation.id installation_id,
        (min(sensor.id::text) FILTER (WHERE sensor.measurement_kind='stage'))::uuid stage_sensor_id,
        (min(sensor.id::text) FILTER (WHERE sensor.measurement_kind='discharge'))::uuid discharge_sensor_id
      FROM monitoring_stations station
      JOIN telemetry_device_installations installation ON installation.station_id=station.id AND installation.effective_until IS NULL
      JOIN telemetry_sensors sensor ON sensor.device_id=installation.device_id
      WHERE station.code='SYN-HOTSPOT-001-STATION-01'
      GROUP BY station.id,station.organization_id,station.territory_id,installation.id
    )
    INSERT INTO rating_curves(id,organization_id,territory_id,station_id,stage_sensor_id,device_installation_id,data_classification,provenance,created_by_user_id,creation_reason,created_request_id)
    SELECT 'b9000000-0000-4000-8000-000000000001',organization_id,territory_id,station_id,stage_sensor_id,installation_id,'synthetic','synthetic: transparent demonstration rating curve; not official calibration','a3000000-0000-4000-8000-000000000001','seed synthetic quantity fixture','seed-quantity-curve-identity'
    FROM scope ON CONFLICT (id) DO NOTHING`);
  await client.query(`
    INSERT INTO rating_curve_versions(id,curve_id,version,effective_from,effective_until,knots,requested_by_user_id,request_reason,requested_request_id,approved_by_user_id,approval_reason,approved_request_id)
    VALUES ('b9000000-0000-4000-8000-000000000002','b9000000-0000-4000-8000-000000000001',1,'2026-01-01T00:00:00.000000Z',NULL,
      '[{"stageM":"0","dischargeM3s":"0"},{"stageM":"1","dischargeM3s":"2"},{"stageM":"2","dischargeM3s":"5"}]'::jsonb,
      'a3000000-0000-4000-8000-000000000001','seed synthetic quantity fixture','seed-quantity-curve-version-request','a3000000-0000-4000-8000-000000000002','seed synthetic fixture approval','seed-quantity-curve-version-approval') ON CONFLICT (id) DO NOTHING`);
  await client.query(`
    WITH scope AS (
      SELECT station.id station_id, station.organization_id, station.territory_id, installation.id installation_id,
        (min(sensor.id::text) FILTER (WHERE sensor.measurement_kind='stage'))::uuid stage_sensor_id,
        (min(sensor.id::text) FILTER (WHERE sensor.measurement_kind='discharge'))::uuid discharge_sensor_id
      FROM monitoring_stations station JOIN telemetry_device_installations installation ON installation.station_id=station.id AND installation.effective_until IS NULL
      JOIN telemetry_sensors sensor ON sensor.device_id=installation.device_id WHERE station.code='SYN-HOTSPOT-001-STATION-01'
      GROUP BY station.id,station.organization_id,station.territory_id,installation.id
    )
    INSERT INTO integration_coverage_policies(id,organization_id,territory_id,station_id,sensor_id,device_installation_id,method,data_classification,provenance,created_by_user_id,creation_reason,created_request_id)
    SELECT 'b9000000-0000-4000-8000-000000000003',organization_id,territory_id,station_id,discharge_sensor_id,installation_id,'direct_discharge','synthetic','synthetic: 15 minute direct-discharge coverage fixture; not official policy','a3000000-0000-4000-8000-000000000001','seed synthetic quantity fixture','seed-quantity-direct-policy' FROM scope
    ON CONFLICT (id) DO NOTHING`);
  await client.query(`
    WITH scope AS (
      SELECT station.id station_id, station.organization_id, station.territory_id, installation.id installation_id,
        (min(sensor.id::text) FILTER (WHERE sensor.measurement_kind='stage'))::uuid stage_sensor_id
      FROM monitoring_stations station JOIN telemetry_device_installations installation ON installation.station_id=station.id AND installation.effective_until IS NULL
      JOIN telemetry_sensors sensor ON sensor.device_id=installation.device_id WHERE station.code='SYN-HOTSPOT-001-STATION-01'
      GROUP BY station.id,station.organization_id,station.territory_id,installation.id
    )
    INSERT INTO integration_coverage_policies(id,organization_id,territory_id,station_id,sensor_id,device_installation_id,method,data_classification,provenance,created_by_user_id,creation_reason,created_request_id)
    SELECT 'b9000000-0000-4000-8000-000000000005',organization_id,territory_id,station_id,stage_sensor_id,installation_id,'stage_rating_curve','synthetic','synthetic: 15 minute stage-to-discharge coverage fixture; not official policy','a3000000-0000-4000-8000-000000000001','seed synthetic quantity fixture','seed-quantity-stage-policy' FROM scope
    ON CONFLICT (id) DO NOTHING`);
  await client.query(`
    WITH scope AS (
      SELECT station.id station_id, station.organization_id, station.territory_id, installation.id installation_id,
        (min(sensor.id::text) FILTER (WHERE sensor.measurement_kind='accumulated_volume'))::uuid counter_sensor_id
      FROM monitoring_stations station JOIN telemetry_device_installations installation ON installation.station_id=station.id AND installation.effective_until IS NULL
      JOIN telemetry_sensors sensor ON sensor.device_id=installation.device_id WHERE station.code='SYN-HOTSPOT-001-STATION-01'
      GROUP BY station.id,station.organization_id,station.territory_id,installation.id
    )
    INSERT INTO integration_coverage_policies(id,organization_id,territory_id,station_id,sensor_id,device_installation_id,method,data_classification,provenance,created_by_user_id,creation_reason,created_request_id)
    SELECT 'b9000000-0000-4000-8000-000000000007',organization_id,territory_id,station_id,counter_sensor_id,installation_id,'accumulated_volume_delta','synthetic','synthetic: monotonic exact-counter delta coverage fixture; resets and rollovers defer','a3000000-0000-4000-8000-000000000001','seed synthetic quantity fixture','seed-quantity-counter-policy' FROM scope
    ON CONFLICT (id) DO NOTHING`);
  await client.query(`
    INSERT INTO integration_coverage_policy_versions(id,policy_id,version,effective_from,effective_until,max_gap_microseconds,requested_by_user_id,request_reason,requested_request_id,approved_by_user_id,approval_reason,approved_request_id)
    VALUES
      ('b9000000-0000-4000-8000-000000000004','b9000000-0000-4000-8000-000000000003',1,'2026-01-01T00:00:00.000000Z',NULL,900000000,'a3000000-0000-4000-8000-000000000001','seed synthetic quantity fixture','seed-quantity-direct-policy-request','a3000000-0000-4000-8000-000000000002','seed synthetic fixture approval','seed-quantity-direct-policy-approval'),
      ('b9000000-0000-4000-8000-000000000006','b9000000-0000-4000-8000-000000000005',1,'2026-01-01T00:00:00.000000Z',NULL,900000000,'a3000000-0000-4000-8000-000000000001','seed synthetic quantity fixture','seed-quantity-stage-policy-request','a3000000-0000-4000-8000-000000000002','seed synthetic fixture approval','seed-quantity-stage-policy-approval'),
      ('b9000000-0000-4000-8000-000000000008','b9000000-0000-4000-8000-000000000007',1,'2026-01-01T00:00:00.000000Z',NULL,900000000,'a3000000-0000-4000-8000-000000000001','seed synthetic quantity fixture','seed-quantity-counter-policy-request','a3000000-0000-4000-8000-000000000002','seed synthetic fixture approval','seed-quantity-counter-policy-approval')
    ON CONFLICT (id) DO NOTHING`);
}

async function seedSyntheticDashboardScenario(client: {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  // A reporting read model only. It deliberately references the seeded 83
  // monitoring stations/devices but never inserts observations or represents
  // official allocation, balance, availability, or confidence policy.
  await client.query(`
    INSERT INTO dashboard_synthetic_scenarios(
      id,organization_id,territory_id,version,reference_at,known_at,
      presentation_time_zone,provenance,data_classification,official_compliance_eligible
    ) VALUES (
      'd5000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000001',1,
      '2026-08-24T07:34:56.123456Z','2026-08-24T07:34:56.123456Z',
      'Asia/Tashkent','synthetic: deterministic dashboard scenario v1; not official telemetry or compliance','synthetic',false
    ) ON CONFLICT (id) DO NOTHING`);
  await client.query(`
    WITH candidates AS (
      SELECT station.id station_id, installation.device_id, station.territory_id,
        regexp_replace(station.code, '-STATION-01$', '') hotspot_code,
        row_number() OVER (ORDER BY station.code) ordinal
      FROM monitoring_stations station
      JOIN telemetry_device_installations installation
        ON installation.station_id=station.id AND installation.effective_until IS NULL
      WHERE station.code ~ '^SYN-HOTSPOT-[0-9]{3}-STATION-01$'
    ), periods(period, multiplier) AS (
      -- The fixed reference instant is a Monday in Asia/Tashkent. Today
      -- and week therefore resolve to the same half-open window and must
      -- have identical m3 fixture totals. Longer calendar-to-cutoff windows
      -- use explicit deterministic demonstration multipliers.
      VALUES ('today', 1.000000), ('week', 1.000000), ('month', 24.000000),
        ('season', 146.000000), ('year', 236.000000)
    )
    INSERT INTO dashboard_synthetic_reporting_rows(
      scenario_id,period,hotspot_code,territory_id,station_id,device_id,metric_role,data_state,quality,
      inflow_m3s,planned_m3,actual_m3,prior_actual_m3,active_critical_alarm
    )
    SELECT
      'd5000000-0000-4000-8000-000000000001', periods.period, hotspot_code, territory_id, station_id, device_id,
      CASE WHEN ordinal IN(1,2) THEN 'regional_ingress_member' WHEN ordinal BETWEEN 3 AND 6 THEN 'delivery_member' ELSE 'none' END,
      CASE WHEN mod(ordinal,17)=0 THEN 'no_data' WHEN mod(ordinal,13)=0 THEN 'unreliable' ELSE 'reported' END,
      CASE WHEN mod(ordinal,17)=0 THEN 'no_data' WHEN mod(ordinal,13)=0 THEN 'unreliable' ELSE 'valid' END,
      -- Inflow is an instantaneous reference-cutoff rate in m3/s, so it is
      -- deliberately not multiplied by the elapsed reporting period.
      CASE WHEN mod(ordinal,17)=0 OR mod(ordinal,13)=0 THEN NULL ELSE 1.000000 + ordinal / 100.0 END,
      CASE WHEN ordinal BETWEEN 3 AND 6 THEN periods.multiplier * (100000.000000 + ordinal * 1000) ELSE NULL END,
      CASE WHEN ordinal BETWEEN 3 AND 6 THEN periods.multiplier * (100000.000000 + ordinal * 1000 + (CASE WHEN mod(ordinal,3)=0 THEN -9000 WHEN mod(ordinal,2)=0 THEN 7000 ELSE 1200 END)) ELSE NULL END,
      CASE WHEN ordinal BETWEEN 3 AND 6 THEN periods.multiplier * (98000.000000 + ordinal * 900) ELSE NULL END,
      ordinal IN(3,5)
    FROM candidates CROSS JOIN periods
    ON CONFLICT (scenario_id,period,station_id) DO NOTHING`);
}

async function seedSyntheticAnalyticsScenario(client: {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  // The event/reference cutoff is the exact governed plan-entry end, while
  // known_at is clocked only after every approval and observation revision.
  // This keeps the calendar window exact without backdating knowledge.
  await client.query(`INSERT INTO analytics_synthetic_scenarios(id,organization_id,territory_id,version,reference_at,known_at,provenance,data_classification,official_compliance_eligible)
    SELECT 'd7000000-0000-4000-8000-000000000001',plan.organization_id,'a2000000-0000-4000-8000-000000000001',1,entry.interval_end,clock_timestamp(),'synthetic: governed P6 composition cutoff; not official accounting or forecast','synthetic',false
    FROM allocation_plans plan JOIN allocation_plan_versions version_row ON version_row.plan_id=plan.id
    JOIN allocation_plan_entries entry ON entry.plan_version_id=version_row.id
    WHERE plan.creation_reason='seed P6 governed analytics scenario' AND version_row.status='approved'
    ORDER BY version_row.version DESC,entry.interval_end DESC LIMIT 1
    ON CONFLICT(id) DO NOTHING`);
}

async function seedSyntheticGovernedAnalyticsScenario(client: PoolClient): Promise<void> {
  const exists = await client.query<{ id: string }>(
    `SELECT id FROM allocation_plans WHERE creation_reason='seed P6 governed analytics scenario'`,
  );
  if (exists.rows[0]) return;
  const now = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const localMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 19, 0, 0, 0),
  );
  // Asia/Tashkent midnight on the current local day; choose previous UTC day when needed.
  if (localMidnight > now) localMidnight.setUTCDate(localMidnight.getUTCDate() - 1);
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '.000000Z');
  const start = iso(localMidnight),
    end = iso(now),
    effectiveUntil = iso(new Date(now.getTime() + 86400000));
  const actor = 'a3000000-0000-4000-8000-000000000001',
    approver = p5.approver;
  const scope = (
    await client.query<{
      station_id: string;
      section_id: string;
      sensor_id: string;
      device_id: string;
      installation_id: string;
      territory_id: string;
      junction_id: string;
    }>(
      `SELECT station.id station_id,section.id section_id,sensor.id sensor_id,sensor.device_id,installation.id installation_id,station.territory_id,station.junction_id junction_id FROM monitoring_stations station JOIN water_sections section ON section.upstream_junction_id=station.junction_id AND section.lifecycle='active' JOIN telemetry_device_installations installation ON installation.station_id=station.id AND installation.effective_until IS NULL JOIN telemetry_sensors sensor ON sensor.device_id=installation.device_id AND sensor.measurement_kind='discharge' ORDER BY station.code DESC,section.code DESC LIMIT 1`,
    )
  ).rows[0];
  if (!scope || end <= start) return;
  const observations = new PostgresObservationService(undefined, client),
    validation = new PostgresValidationService(undefined, client);
  const plan = new PostgresAllocationPlanService(undefined, client),
    deviation = new PostgresAllocationDeviationService(undefined, client),
    balance = new PostgresWaterBalanceService(undefined, client);
  await client.query(
    `INSERT INTO integration_coverage_policies(
       id,organization_id,territory_id,station_id,sensor_id,device_installation_id,method,
       data_classification,provenance,created_by_user_id,creation_reason,created_request_id)
     VALUES('d7100000-0000-4000-8000-000000000001',$1,$2,$3,$4,$5,'direct_discharge',
       'synthetic','synthetic: P6 15 minute direct-discharge coverage; not official policy',
       $6,'seed P6 governed analytics scenario','seed-p6-coverage-policy')
     ON CONFLICT(id) DO NOTHING`,
    [
      p5.organization,
      scope.territory_id,
      scope.station_id,
      scope.sensor_id,
      scope.installation_id,
      actor,
    ],
  );
  await client.query(
    `INSERT INTO integration_coverage_policy_versions(
       id,policy_id,version,effective_from,effective_until,max_gap_microseconds,
       requested_by_user_id,request_reason,requested_request_id,approved_by_user_id,
       approval_reason,approved_request_id)
     VALUES('d7100000-0000-4000-8000-000000000002','d7100000-0000-4000-8000-000000000001',
       1,$1,$2,900000000,$3,'seed P6 governed analytics scenario','seed-p6-coverage-request',
       $4,'seed P6 independent approval','seed-p6-coverage-approve')
     ON CONFLICT(id) DO NOTHING`,
    [start, effectiveUntil, actor, approver],
  );
  const profile = await validation.createProfile(
    {
      organizationId: p5.organization,
      territoryId: scope.territory_id,
      sensorId: scope.sensor_id,
      measurementKind: 'discharge',
      dataClassification: 'synthetic',
      name: 'Synthetic P6 discharge validation',
      effectiveFrom: start,
      effectiveUntil: null,
      rules: { minimumValue: '0', maximumValue: '100', allowBootstrapWithoutPrior: true },
      reason: 'seed P6 governed analytics scenario',
    },
    actor,
    'seed-p6-validation-profile',
  );
  await validation.approveVersion(
    profile.profileId,
    profile.version,
    scope.territory_id,
    'seed P6 independent approval',
    approver,
    'seed-p6-validation-approve',
  );
  const observationTimes: string[] = [];
  const startMs = localMidnight.getTime(),
    endMs = now.getTime(),
    cadenceMs = 15 * 60 * 1_000;
  for (let atMs = startMs; atMs < endMs; atMs += cadenceMs)
    observationTimes.push(iso(new Date(atMs)));
  if (observationTimes.at(-1) !== end) observationTimes.push(end);
  for (const [index, at] of observationTimes.entries()) {
    const suffix = index.toString().padStart(3, '0');
    const ingested = await observations.ingest(
      {
        sensorId: scope.sensor_id,
        deviceId: scope.device_id,
        measurementKind: 'discharge',
        sourceSystem: 'synthetic-p6-scenario',
        sourceEventId: `p6-${suffix}`,
        observedAt: at,
        unit: 'm3/s',
        value: '1',
        qualityState: 'unknown',
        qualityReason: 'synthetic governed P6 input',
        uncertainty: '0',
        uncertaintyMethod: 'synthetic exact scenario input',
        provenance: 'synthetic: governed P6 evidence',
        measurementMethod: 'synthetic',
        totalizerTransition: null,
      },
      scope.territory_id,
    );
    await validation.validate(
      ingested.observation.lineageId,
      scope.territory_id,
      actor,
      `seed-p6-validate-${suffix}`,
      at,
    );
  }
  const version = await plan.create(
    {
      waterSectionId: scope.section_id,
      effectiveFrom: start,
      effectiveUntil,
      entries: [
        {
          intervalStart: start,
          intervalEnd: end,
          plannedVolume: String((now.getTime() - localMidnight.getTime()) / 1000),
          unit: 'm3',
          targetSemantics: 'whole_interval_target_no_proration',
        },
      ],
      reason: 'seed P6 governed analytics scenario',
    },
    actor,
    'seed-p6-plan-create',
  );
  const entryId = (
    await client.query<{ id: string }>(
      'SELECT id FROM allocation_plan_entries WHERE plan_version_id=$1',
      [version.id],
    )
  ).rows[0]?.id;
  if (!entryId) throw new Error('P6 governed allocation entry was not created.');
  const binding = await deviation.createBinding(
    entryId,
    {
      stationId: scope.station_id,
      sensorId: scope.sensor_id,
      deviceInstallationId: scope.installation_id,
      method: 'direct_discharge',
      referencePlane: 'upstream',
      provenance: 'synthetic: P6 binding',
      reason: 'seed P6 governed analytics scenario',
    },
    actor,
    'seed-p6-binding',
  );
  void binding;
  await plan.request(
    version.planId,
    version.version,
    'seed P6 request',
    actor,
    'seed-p6-plan-request',
  );
  await plan.approve(
    version.planId,
    version.version,
    { reason: 'seed P6 independent approval', legalReference: 'synthetic seed fixture' },
    approver,
    'seed-p6-plan-approve',
    { allowSyntheticHistoricalEffectiveTime: true },
  );
  const policy = await deviation.createTolerancePolicy(
    {
      waterSectionId: scope.section_id,
      provenance: 'synthetic: P6 tolerance',
      reason: 'seed P6 governed analytics scenario',
    },
    actor,
    'seed-p6-tolerance',
  );
  const pv = await deviation.requestToleranceVersion(
    policy.id,
    {
      effectiveFrom: start,
      effectiveUntil,
      underAbsoluteM3: '1',
      overAbsoluteM3: '1',
      combination: 'any',
      appliesToZeroPlan: false,
      reason: 'seed P6 tolerance',
    },
    actor,
    'seed-p6-tolerance-request',
  );
  await deviation.approveToleranceVersion(
    policy.id,
    pv.version,
    'seed P6 independent approval',
    approver,
    'seed-p6-tolerance-approve',
    { allowSyntheticHistoricalEffectiveTime: true },
  );
  const model = await balance.create(
    {
      junctionId: scope.junction_id,
      provenance: 'synthetic: P6 balance model',
      reason: 'seed P6 governed analytics scenario',
    },
    actor,
    'seed-p6-balance-create',
  );
  const bv = await balance.request(
    model.id,
    {
      effectiveFrom: start,
      effectiveUntil,
      components: [
        {
          waterSectionId: scope.section_id,
          stationId: scope.station_id,
          sensorId: scope.sensor_id,
          deviceInstallationId: scope.installation_id,
          method: 'direct_discharge',
          role: 'outgoing',
          referencePlane: 'upstream',
          travelTimeMicroseconds: '0',
          provenance: 'synthetic: P6 balance component',
        },
      ],
      assumptions: [
        {
          intervalStart: start,
          intervalEnd: end,
          storageChangeM3: '0',
          knownAdditionM3: '0',
          knownRemovalM3: '0',
          provenance: 'synthetic: P6 balance assumptions',
        },
      ],
      provenance: 'synthetic: P6 balance model',
      reason: 'seed P6 governed analytics scenario',
    },
    actor,
    'seed-p6-balance-request',
  );
  await balance.approve(
    model.id,
    bv.version,
    'seed P6 independent approval',
    approver,
    'seed-p6-balance-approve',
  );
}

async function seedSyntheticLiveOperationsScenario(client: {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await client.query(`INSERT INTO live_operations_synthetic_scenarios(id,organization_id,territory_id,version,reference_at,known_at,presentation_time_zone,provenance,data_classification,official_telemetry)
    VALUES ('d6000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',1,'2026-08-24T07:34:56.123456Z','2026-08-24T07:34:56.123456Z','Asia/Tashkent','synthetic: deterministic live operations scenario v1; not official telemetry','synthetic',false) ON CONFLICT(id) DO NOTHING`);
  await client.query(`WITH candidates AS (
      SELECT station.id station_id, installation.device_id, installation.id installation_id, station.territory_id,
        row_number() over(order by station.code) ordinal
      FROM monitoring_stations station JOIN telemetry_device_installations installation ON installation.station_id=station.id AND installation.effective_until IS NULL
      WHERE station.code ~ '^SYN-HOTSPOT-[0-9]{3}-STATION-01$'
    ) INSERT INTO live_operations_synthetic_rows(scenario_id,station_id,device_id,installation_id,territory_id,data_state,stage_data_state,discharge_data_state,counter_data_state,connection_status,device_fault,fault_code,stage_m,discharge_m3s,counter_m3,observed_at,ingested_at,last_seen_received_at,power_voltage,signal_strength_dbm,provenance)
    SELECT 'd6000000-0000-4000-8000-000000000001',station_id,device_id,installation_id,territory_id,
      CASE WHEN mod(ordinal,17)=0 THEN 'no_data' WHEN mod(ordinal,13)=0 THEN 'unreliable' ELSE 'reported' END,CASE WHEN mod(ordinal,17)=0 THEN 'no_data' WHEN mod(ordinal,13)=0 THEN 'unreliable' ELSE 'reported' END,CASE WHEN mod(ordinal,17)=0 THEN 'no_data' WHEN mod(ordinal,13)=0 THEN 'unreliable' ELSE 'reported' END,CASE WHEN mod(ordinal,17)=0 THEN 'no_data' WHEN mod(ordinal,13)=0 THEN 'unreliable' ELSE 'reported' END,
      (CASE WHEN mod(ordinal,19)=0 THEN 'offline' WHEN mod(ordinal,11)=0 THEN 'unknown' ELSE 'communicating' END)::device_connection_status,
      CASE WHEN mod(ordinal,23)=0 THEN 'reported' WHEN mod(ordinal,11)=0 THEN 'unknown' ELSE 'none' END,
      CASE WHEN mod(ordinal,23)=0 THEN 'SYNTHETIC_FAULT' ELSE NULL END,
      CASE WHEN mod(ordinal,17)=0 THEN NULL ELSE 1.0+ordinal/100.0 END,
      CASE WHEN mod(ordinal,17)=0 THEN NULL ELSE 2.0+ordinal/10.0 END,
      CASE WHEN mod(ordinal,17)=0 THEN NULL ELSE 1000000.0+ordinal*1000 END,
      CASE WHEN mod(ordinal,17)=0 THEN NULL ELSE '2026-08-24T07:30:00.123456Z'::timestamptz END,
      CASE WHEN mod(ordinal,17)=0 THEN NULL ELSE '2026-08-24T07:30:02.123456Z'::timestamptz END,
      '2026-08-24T07:34:00.123456Z'::timestamptz,12.0+mod(ordinal,4)/10.0,-70-mod(ordinal,10),
      'synthetic: deterministic live operations row; not official telemetry' FROM candidates ON CONFLICT(scenario_id,station_id) DO NOTHING`);
  await client.query(
    `WITH stations AS (SELECT station_id,row_number() over(order by station_id) n FROM live_operations_synthetic_rows WHERE scenario_id='d6000000-0000-4000-8000-000000000001'), points AS (SELECT generate_series(0,23) h) INSERT INTO live_operations_synthetic_trend_points(scenario_id,station_id,sensor_kind,point_at,raw_value,validated_value,gap,provenance) SELECT 'd6000000-0000-4000-8000-000000000001',stations.station_id,'stage','2026-08-23T08:30:00.123456Z'::timestamptz+(points.h*interval '1 hour'),CASE WHEN points.h=12 THEN NULL ELSE 1+stations.n/100.0+points.h/1000.0 END,CASE WHEN points.h=12 THEN NULL WHEN mod(points.h,5)=0 THEN 1+stations.n/100.0+points.h/1000.0+0.002 ELSE 1+stations.n/100.0+points.h/1000.0 END,points.h=12,'synthetic: immutable 24-hour raw/validated stage trend; not official telemetry' FROM stations CROSS JOIN points ON CONFLICT(scenario_id,station_id,sensor_kind,point_at) DO NOTHING`,
  );
}

export async function seedSystemMetadata(databaseUrl: string | undefined): Promise<void> {
  await withDatabase(databaseUrl, async (pool) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "INSERT INTO system_metadata (key, value) VALUES ('seed_classification', 'synthetic') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      );
      await client.query(`
      INSERT INTO organizations (id, code, name, data_classification)
      VALUES ('a1000000-0000-4000-8000-000000000001', 'UZ-WATER-SYNTH', 'Synthetic Uzbekistan Water Authority', 'synthetic')
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        data_classification = EXCLUDED.data_classification,
        updated_at = now()
    `);
      await client.query(`
      INSERT INTO territories (id, organization_id, parent_territory_id, code, name, kind, data_classification)
      VALUES
        ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', NULL, 'UZ-SYNTH', 'Synthetic national scope', 'national', 'synthetic'),
        ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'SYR-SYNTH', 'Synthetic Syrdarya region', 'region', 'synthetic'),
        ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'SYR-BASIN-SYNTH', 'Synthetic Syrdarya basin', 'basin', 'synthetic'),
        ('a2000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003', 'SYR-DISTRICT-A-SYNTH', 'Synthetic Syrdarya district A', 'district', 'synthetic'),
        ('a2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003', 'SYR-DISTRICT-B-SYNTH', 'Synthetic Syrdarya district B', 'district', 'synthetic')
      ON CONFLICT (organization_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        parent_territory_id = EXCLUDED.parent_territory_id,
        kind = EXCLUDED.kind,
        data_classification = EXCLUDED.data_classification,
        updated_at = now()
    `);
      await client.query(`
      INSERT INTO identity_users (id, organization_id, external_subject, display_name, is_active, data_classification)
      VALUES
        ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'synthetic:system-admin', 'Synthetic system administrator', true, 'synthetic'),
        ('a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'synthetic:national-admin', 'Synthetic national administrator', true, 'synthetic'),
        ('a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'synthetic:regional-director', 'Synthetic regional director', true, 'synthetic'),
        ('a3000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'synthetic:basin-dispatcher', 'Synthetic basin dispatcher', true, 'synthetic'),
        ('a3000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'synthetic:district-operator', 'Synthetic district operator', true, 'synthetic'),
        ('a3000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'synthetic:hydrologist', 'Synthetic hydrologist', true, 'synthetic'),
        ('a3000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'synthetic:maintenance-engineer', 'Synthetic maintenance engineer', true, 'synthetic'),
        ('a3000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', 'synthetic:auditor', 'Synthetic auditor', true, 'synthetic')
      ON CONFLICT (external_subject) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        is_active = EXCLUDED.is_active,
        data_classification = EXCLUDED.data_classification,
        updated_at = now()
    `);
      await client.query(`
      INSERT INTO user_role_grants (id, user_id, organization_id, role, scope, territory_id, effective_from)
      VALUES
        ('a4000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'system_admin', 'system', NULL, '2026-01-01T00:00:00.000Z'),
        ('a4000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'national_admin', 'national', NULL, '2026-01-01T00:00:00.000Z'),
        ('a4000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'regional_director', 'territory', 'a2000000-0000-4000-8000-000000000002', '2026-01-01T00:00:00.000Z'),
        ('a4000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'basin_dispatcher', 'territory', 'a2000000-0000-4000-8000-000000000003', '2026-01-01T00:00:00.000Z'),
        ('a4000000-0000-4000-8000-000000000005', 'a3000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'district_operator', 'territory', 'a2000000-0000-4000-8000-000000000004', '2026-01-01T00:00:00.000Z'),
        ('a4000000-0000-4000-8000-000000000006', 'a3000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'hydrologist', 'territory', 'a2000000-0000-4000-8000-000000000003', '2026-01-01T00:00:00.000Z'),
        ('a4000000-0000-4000-8000-000000000007', 'a3000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'maintenance_engineer', 'territory', 'a2000000-0000-4000-8000-000000000004', '2026-01-01T00:00:00.000Z'),
        ('a4000000-0000-4000-8000-000000000008', 'a3000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', 'auditor', 'territory', 'a2000000-0000-4000-8000-000000000002', '2026-01-01T00:00:00.000Z')
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        organization_id = EXCLUDED.organization_id,
        role = EXCLUDED.role,
        scope = EXCLUDED.scope,
        territory_id = EXCLUDED.territory_id,
        effective_from = EXCLUDED.effective_from,
        effective_until = NULL,
        updated_at = now()
    `);
      const syntheticNetwork = await seedSyntheticNetwork(client);
      await seedSyntheticQuantityDerivationModels(client);
      await seedSyntheticDashboardScenario(client);
      await seedSyntheticGovernedAnalyticsScenario(client);
      await seedSyntheticAnalyticsScenario(client);
      await seedSyntheticLiveOperationsScenario(client);
      await seedSyntheticAlarmIncidentScenario(client);
      await client.query('COMMIT');
      console.info(
        JSON.stringify({
          level: 'info',
          event: 'seed_complete',
          classification: 'synthetic',
          seededIdentityUsers: 8,
          seededTerritories: 5,
          syntheticNetwork,
        }),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}

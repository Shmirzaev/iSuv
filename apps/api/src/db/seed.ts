import { withDatabase } from './client.js';
import { seedSyntheticNetwork } from './syntheticNetworkSeed.js';

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
      await seedSyntheticLiveOperationsScenario(client);
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

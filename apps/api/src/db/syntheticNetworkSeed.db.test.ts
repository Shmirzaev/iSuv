import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { seedSystemMetadata } from './seed.js';
import { syntheticHotspotCodePrefix, syntheticOrganizationId } from './syntheticNetworkSeed.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests');

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const hotspotPattern = `${syntheticHotspotCodePrefix}%`;
const syntheticWhere = "organization_id = $1 AND data_classification::text = 'synthetic'";

async function count(table: string, where: string, values: unknown[] = []): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table} WHERE ${where}`,
    values,
  );
  return Number(result.rows[0]!.count);
}

after(async () => {
  await pool.end();
});

test('synthetic 83-hotspot seed is repeatable, complete, connected, and explicitly non-official', async () => {
  await seedSystemMetadata(databaseUrl);
  const countsAfterFirstSeed = {
    regions: await count('water_regions', syntheticWhere, [syntheticOrganizationId]),
    basins: await count('water_basins', syntheticWhere, [syntheticOrganizationId]),
    waterways: await count('waterways', syntheticWhere, [syntheticOrganizationId]),
    junctions: await count('network_junctions', syntheticWhere, [syntheticOrganizationId]),
    sections: await count('water_sections', syntheticWhere, [syntheticOrganizationId]),
    controls: await count('control_structures', syntheticWhere, [syntheticOrganizationId]),
    stations: await count('monitoring_stations', syntheticWhere, [syntheticOrganizationId]),
    devices: await count('telemetry_devices', syntheticWhere, [syntheticOrganizationId]),
    sensors: await count('telemetry_sensors', syntheticWhere, [syntheticOrganizationId]),
    installations: await count(
      'telemetry_device_installations installation JOIN telemetry_devices device ON device.id = installation.device_id',
      "installation.organization_id = $1 AND installation.data_classification::text = 'synthetic'",
      [syntheticOrganizationId],
    ),
  };
  assert.deepEqual(countsAfterFirstSeed, {
    regions: 1,
    basins: 5,
    waterways: 88,
    junctions: 493,
    sections: 571,
    controls: 83,
    stations: 83,
    devices: 83,
    sensors: 249,
    installations: 83,
  });

  await seedSystemMetadata(databaseUrl);
  assert.deepEqual(
    {
      regions: await count('water_regions', syntheticWhere, [syntheticOrganizationId]),
      basins: await count('water_basins', syntheticWhere, [syntheticOrganizationId]),
      waterways: await count('waterways', syntheticWhere, [syntheticOrganizationId]),
      junctions: await count('network_junctions', syntheticWhere, [syntheticOrganizationId]),
      sections: await count('water_sections', syntheticWhere, [syntheticOrganizationId]),
      controls: await count('control_structures', syntheticWhere, [syntheticOrganizationId]),
      stations: await count('monitoring_stations', syntheticWhere, [syntheticOrganizationId]),
      devices: await count('telemetry_devices', syntheticWhere, [syntheticOrganizationId]),
      sensors: await count('telemetry_sensors', syntheticWhere, [syntheticOrganizationId]),
      installations: await count(
        'telemetry_device_installations installation JOIN telemetry_devices device ON device.id = installation.device_id',
        "installation.organization_id = $1 AND installation.data_classification::text = 'synthetic'",
        [syntheticOrganizationId],
      ),
    },
    countsAfterFirstSeed,
  );

  const roots = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM network_junctions entry
     WHERE entry.organization_id = $1
       AND entry.data_classification::text = 'synthetic'
       AND entry.code ~ '^SYN-HOTSPOT-[0-9]{3}-ENTRY$'
       AND NOT EXISTS (SELECT 1 FROM water_sections section WHERE section.downstream_junction_id = entry.id)`,
    [syntheticOrganizationId],
  );
  assert.equal(Number(roots.rows[0]!.count), 83);

  const graph = await pool.query<{
    basin_components: string;
    basin_outlets: string;
    roots_reaching_outlets: string;
    branches: string;
    merges: string;
    cycles: string;
    orphan_endpoints: string;
  }>(
    `WITH RECURSIVE synthetic_basins AS (
       SELECT id, code FROM water_basins
       WHERE organization_id = $1 AND data_classification::text = 'synthetic'
     ),
     edges AS (
       SELECT waterway.basin_id, section.upstream_junction_id, section.downstream_junction_id
       FROM water_sections section
       JOIN waterways waterway ON waterway.id = section.waterway_id
       JOIN synthetic_basins basin ON basin.id = waterway.basin_id
       WHERE section.organization_id = $1
         AND section.data_classification::text = 'synthetic'
         AND waterway.organization_id = $1
         AND waterway.data_classification::text = 'synthetic'
     ),
     roots AS (
       SELECT entry.id AS root_id, waterway.basin_id
       FROM network_junctions entry
       JOIN waterways waterway
         ON waterway.code = regexp_replace(entry.code, '-ENTRY$', '-WATERWAY')
        AND waterway.organization_id = entry.organization_id
       WHERE entry.organization_id = $1
         AND entry.data_classification::text = 'synthetic'
         AND waterway.data_classification::text = 'synthetic'
         AND entry.code ~ '^SYN-HOTSPOT-[0-9]{3}-ENTRY$'
     ),
     outlets AS (
       SELECT basin.id AS basin_id, outlet.id AS outlet_id
       FROM synthetic_basins basin
       JOIN network_junctions outlet
         ON outlet.code = basin.code || '-OUTLET'
        AND outlet.organization_id = $1
        AND outlet.data_classification::text = 'synthetic'
     ),
     hotspot_edges AS (
       SELECT section.waterway_id, section.upstream_junction_id, section.downstream_junction_id
       FROM water_sections section
       JOIN waterways waterway ON waterway.id = section.waterway_id
       WHERE waterway.organization_id = $1
         AND waterway.data_classification::text = 'synthetic'
         AND waterway.code LIKE $2
     ),
     paths(root_id, basin_id, node_id, path, cycle) AS (
       SELECT roots.root_id, roots.basin_id, roots.root_id, ARRAY[roots.root_id], false
       FROM roots
       UNION ALL
       SELECT paths.root_id, paths.basin_id, edge.downstream_junction_id,
              paths.path || edge.downstream_junction_id,
              edge.downstream_junction_id = ANY(paths.path)
       FROM paths
       JOIN edges edge ON edge.basin_id = paths.basin_id AND edge.upstream_junction_id = paths.node_id
       WHERE NOT paths.cycle
     )
     SELECT
       (SELECT count(*)::text FROM synthetic_basins) AS basin_components,
       (SELECT count(*)::text FROM outlets) AS basin_outlets,
       (SELECT count(DISTINCT paths.root_id)::text
        FROM paths JOIN outlets ON outlets.basin_id = paths.basin_id AND outlets.outlet_id = paths.node_id)
         AS roots_reaching_outlets,
       (SELECT count(DISTINCT waterway_id)::text
        FROM (SELECT waterway_id FROM hotspot_edges GROUP BY waterway_id, upstream_junction_id HAVING count(*) >= 2) branch)
         AS branches,
       (SELECT count(DISTINCT waterway_id)::text
        FROM (SELECT waterway_id FROM hotspot_edges GROUP BY waterway_id, downstream_junction_id HAVING count(*) >= 2) merge)
         AS merges,
       (SELECT count(*)::text FROM paths WHERE cycle) AS cycles,
       (SELECT count(*)::text
        FROM edges edge
        LEFT JOIN network_junctions upstream ON upstream.id = edge.upstream_junction_id
        LEFT JOIN network_junctions downstream ON downstream.id = edge.downstream_junction_id
        WHERE upstream.id IS NULL OR downstream.id IS NULL) AS orphan_endpoints`,
    [syntheticOrganizationId, hotspotPattern],
  );
  assert.deepEqual(graph.rows[0], {
    basin_components: '5',
    basin_outlets: '5',
    roots_reaching_outlets: '83',
    branches: '83',
    merges: '83',
    cycles: '0',
    orphan_endpoints: '0',
  });

  const fixtureQuality = await pool.query<{
    misaligned_sections: string;
    misaligned_stations: string;
    invalid_geometry: string;
    cross_territory_basins: string;
    cross_territory_edges: string;
    non_synthetic_records: string;
    valid_sensor_pairs: string;
    covered_basins: string;
    covered_hotspots: string;
    uncovered_basin_assets: string;
  }>(
    `WITH synthetic_sections AS (
       SELECT section.* FROM water_sections section WHERE section.organization_id = $1
     ),
     all_geometry AS (
       SELECT geometry FROM water_regions WHERE organization_id = $1
       UNION ALL SELECT geometry FROM water_basins WHERE organization_id = $1
       UNION ALL SELECT geometry FROM waterways WHERE organization_id = $1
       UNION ALL SELECT geometry FROM network_junctions WHERE organization_id = $1
       UNION ALL SELECT geometry FROM water_sections WHERE organization_id = $1
       UNION ALL SELECT geometry FROM control_structures WHERE organization_id = $1
       UNION ALL SELECT geometry FROM monitoring_stations WHERE organization_id = $1
     ),
     classified AS (
       SELECT data_classification::text AS classification FROM water_regions WHERE organization_id = $1
       UNION ALL SELECT data_classification::text FROM water_basins WHERE organization_id = $1
       UNION ALL SELECT data_classification::text FROM waterways WHERE organization_id = $1
       UNION ALL SELECT data_classification::text FROM network_junctions WHERE organization_id = $1
       UNION ALL SELECT data_classification::text FROM water_sections WHERE organization_id = $1
       UNION ALL SELECT data_classification::text FROM control_structures WHERE organization_id = $1
       UNION ALL SELECT data_classification::text FROM monitoring_stations WHERE organization_id = $1
       UNION ALL SELECT data_classification::text FROM telemetry_devices WHERE organization_id = $1
       UNION ALL SELECT data_classification::text FROM telemetry_sensors WHERE organization_id = $1
       UNION ALL
       SELECT installation.data_classification::text
       FROM telemetry_device_installations installation
       WHERE installation.organization_id = $1
     )
     SELECT
       (SELECT count(*)::text
        FROM synthetic_sections section
        JOIN network_junctions upstream ON upstream.id = section.upstream_junction_id
        JOIN network_junctions downstream ON downstream.id = section.downstream_junction_id
        WHERE NOT ST_Equals(ST_StartPoint(section.geometry), upstream.geometry)
           OR NOT ST_Equals(ST_EndPoint(section.geometry), downstream.geometry)) AS misaligned_sections,
       (SELECT count(*)::text
        FROM monitoring_stations station
        JOIN network_junctions junction ON junction.id = station.junction_id
        WHERE station.organization_id = $1 AND NOT ST_Equals(station.geometry, junction.geometry)) AS misaligned_stations,
       (SELECT count(*)::text FROM all_geometry
        WHERE NOT ST_IsValid(geometry) OR NOT network_wgs84_coordinates_in_bounds(geometry)) AS invalid_geometry,
       (SELECT count(DISTINCT waterway.basin_id)::text
        FROM synthetic_sections section
        JOIN waterways waterway ON waterway.id = section.waterway_id
        JOIN network_junctions upstream ON upstream.id = section.upstream_junction_id
        JOIN network_junctions downstream ON downstream.id = section.downstream_junction_id
       WHERE upstream.territory_id <> downstream.territory_id)
         AS cross_territory_basins,
       (SELECT count(*)::text
        FROM synthetic_sections section
        JOIN waterways waterway ON waterway.id = section.waterway_id
        JOIN network_junctions upstream ON upstream.id = section.upstream_junction_id
        JOIN network_junctions downstream ON downstream.id = section.downstream_junction_id
        WHERE upstream.territory_id <> downstream.territory_id)
         AS cross_territory_edges,
       (SELECT count(*)::text FROM classified WHERE classification <> 'synthetic') AS non_synthetic_records,
       (SELECT count(*)::text FROM telemetry_sensors sensor
        WHERE sensor.organization_id = $1
          AND ((sensor.measurement_kind = 'stage' AND sensor.unit = 'm')
            OR (sensor.measurement_kind = 'discharge' AND sensor.unit = 'm3/s')
            OR (sensor.measurement_kind = 'accumulated_volume' AND sensor.unit = 'm3'))) AS valid_sensor_pairs,
       (SELECT count(*)::text
        FROM water_basins basin
        JOIN water_regions region ON region.id = basin.region_id
        WHERE basin.organization_id = $1 AND ST_Covers(region.geometry, basin.geometry)) AS covered_basins,
       (SELECT count(DISTINCT waterway.id)::text
        FROM waterways waterway
        JOIN water_basins basin ON basin.id = waterway.basin_id
        JOIN water_regions region ON region.id = basin.region_id
        JOIN synthetic_sections section ON section.waterway_id = waterway.id
        JOIN network_junctions upstream ON upstream.id = section.upstream_junction_id
        JOIN network_junctions downstream ON downstream.id = section.downstream_junction_id
        WHERE waterway.code LIKE $2
          AND ST_Covers(basin.geometry, waterway.geometry)
          AND ST_Covers(basin.geometry, upstream.geometry)
          AND ST_Covers(basin.geometry, downstream.geometry)) AS covered_hotspots,
       (SELECT count(*)::text FROM (
          SELECT waterway.basin_id, waterway.geometry
          FROM waterways waterway WHERE waterway.organization_id = $1
          UNION ALL
          SELECT waterway.basin_id, section.geometry
          FROM synthetic_sections section JOIN waterways waterway ON waterway.id = section.waterway_id
          UNION ALL
          SELECT waterway.basin_id, junction.geometry
          FROM synthetic_sections section
          JOIN waterways waterway ON waterway.id = section.waterway_id
          JOIN network_junctions junction
            ON junction.id = section.upstream_junction_id OR junction.id = section.downstream_junction_id
        ) asset
        JOIN water_basins basin ON basin.id = asset.basin_id
        WHERE NOT ST_Covers(basin.geometry, asset.geometry)) AS uncovered_basin_assets`,
    [syntheticOrganizationId, hotspotPattern],
  );
  assert.deepEqual(fixtureQuality.rows[0], {
    misaligned_sections: '0',
    misaligned_stations: '0',
    invalid_geometry: '0',
    cross_territory_basins: '5',
    cross_territory_edges: '5',
    non_synthetic_records: '0',
    valid_sensor_pairs: '249',
    covered_basins: '5',
    covered_hotspots: '83',
    uncovered_basin_assets: '0',
  });

  const rootTelemetry = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM network_junctions entry
     JOIN monitoring_stations station ON station.junction_id = entry.id
     JOIN telemetry_device_installations installation
       ON installation.station_id = station.id
      AND installation.organization_id = entry.organization_id
      AND installation.data_classification::text = 'synthetic'
      AND installation.effective_from <= '2026-08-23T00:00:00.000Z'
      AND (installation.effective_until IS NULL OR installation.effective_until > '2026-08-23T00:00:00.000Z')
     JOIN telemetry_sensors sensor ON sensor.device_id = installation.device_id
     WHERE entry.organization_id = $1
       AND entry.data_classification::text = 'synthetic'
       AND station.organization_id = entry.organization_id
       AND station.data_classification::text = 'synthetic'
       AND sensor.organization_id = entry.organization_id
       AND sensor.data_classification::text = 'synthetic'
       AND entry.code ~ '^SYN-HOTSPOT-[0-9]{3}-ENTRY$'
     GROUP BY entry.id
     HAVING count(*) FILTER (WHERE sensor.measurement_kind = 'stage' AND sensor.unit = 'm') = 1
        AND count(*) FILTER (WHERE sensor.measurement_kind = 'discharge' AND sensor.unit = 'm3/s') = 1
        AND count(*) FILTER (WHERE sensor.measurement_kind = 'accumulated_volume' AND sensor.unit = 'm3') = 1
        AND count(*) = 3`,
    [syntheticOrganizationId],
  );
  assert.equal(rootTelemetry.rowCount, 83);

  const reconciledEntryCode = `${syntheticHotspotCodePrefix}001-ENTRY`;
  const originalTerritory = await pool.query<{ territory_id: string }>(
    `SELECT territory_id FROM network_junctions
     WHERE organization_id = $1 AND code = $2`,
    [syntheticOrganizationId, reconciledEntryCode],
  );
  const alternateTerritory = await pool.query<{ id: string }>(
    `SELECT id FROM territories
     WHERE organization_id = $1 AND id <> $2
     ORDER BY id LIMIT 1`,
    [syntheticOrganizationId, originalTerritory.rows[0]!.territory_id],
  );
  await pool.query(
    `UPDATE network_junctions SET territory_id = $1 WHERE organization_id = $2 AND code = $3`,
    [alternateTerritory.rows[0]!.id, syntheticOrganizationId, reconciledEntryCode],
  );
  await seedSystemMetadata(databaseUrl);
  const restoredEntry = await pool.query<{ territory_id: string }>(
    `SELECT territory_id FROM network_junctions
     WHERE organization_id = $1 AND code = $2`,
    [syntheticOrganizationId, reconciledEntryCode],
  );
  assert.equal(restoredEntry.rows[0]!.territory_id, originalTerritory.rows[0]!.territory_id);
  const reconciledBoundaryEdges = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM water_sections section
     JOIN waterways waterway ON waterway.id = section.waterway_id
     JOIN network_junctions upstream ON upstream.id = section.upstream_junction_id
     JOIN network_junctions downstream ON downstream.id = section.downstream_junction_id
     WHERE section.organization_id = $1
       AND section.data_classification::text = 'synthetic'
       AND upstream.territory_id <> downstream.territory_id`,
    [syntheticOrganizationId],
  );
  assert.equal(reconciledBoundaryEdges.rows[0]!.count, '5');

  const p5Scenario = await pool.query<{
    rules: string;
    active_unowned: string;
    cleared_human_open: string;
    active_investigating_assigned: string;
    closed: string;
    missing_policy_open: string;
    unassessable: string;
    incidents_with_post_creation_evidence: string;
    future_known_evidence: string;
  }>(
    `SELECT
      (SELECT count(*)::text FROM alarm_rules WHERE provenance LIKE 'synthetic: governed P5%') rules,
      (SELECT count(*)::text FROM alarms a WHERE a.provenance LIKE 'synthetic: governed P5%'
        AND a.automatic_state='active' AND NOT EXISTS(SELECT 1 FROM incident_alarm_links l WHERE l.alarm_id=a.id)) active_unowned,
      (SELECT count(*)::text FROM alarms a JOIN incident_alarm_links l ON l.alarm_id=a.id JOIN incidents i ON i.id=l.incident_id
        WHERE a.provenance LIKE 'synthetic: governed P5%' AND a.automatic_state='cleared' AND i.status IN('open','acknowledged','investigating')) cleared_human_open,
      (SELECT count(*)::text FROM alarms a JOIN incident_alarm_links l ON l.alarm_id=a.id JOIN incidents i ON i.id=l.incident_id
        WHERE a.provenance LIKE 'synthetic: governed P5%' AND a.automatic_state='active' AND i.status='investigating' AND i.assigned_user_id IS NOT NULL) active_investigating_assigned,
      (SELECT count(*)::text FROM incidents WHERE creation_reason='seed P5 governed scenario' AND status='closed') closed,
      (SELECT count(*)::text FROM incidents i WHERE i.creation_reason='seed P5 governed scenario' AND i.escalation_policy_id IS NULL AND i.status='open') missing_policy_open,
      (SELECT count(*)::text FROM alarm_evidence evidence JOIN alarms a ON a.id=evidence.alarm_id
        WHERE a.provenance LIKE 'synthetic: governed P5%' AND evidence.evidence_status='unassessable') unassessable,
      (SELECT count(*)::text FROM incidents i
        WHERE i.creation_reason='seed P5 governed scenario' AND EXISTS(
          SELECT 1 FROM incident_alarm_links link JOIN alarm_evidence evidence ON evidence.alarm_id=link.alarm_id
          WHERE link.incident_id=i.id AND evidence.known_at>=i.created_at AND evidence.known_at<=clock_timestamp())) incidents_with_post_creation_evidence,
      (SELECT count(*)::text FROM alarm_evidence evidence JOIN alarms a ON a.id=evidence.alarm_id
        WHERE a.provenance LIKE 'synthetic: governed P5%' AND evidence.known_at>clock_timestamp()) future_known_evidence`,
  );
  assert.deepEqual(p5Scenario.rows[0], {
    rules: '3',
    active_unowned: '1',
    cleared_human_open: '1',
    active_investigating_assigned: '1',
    closed: '1',
    missing_policy_open: '1',
    unassessable: '2',
    incidents_with_post_creation_evidence: '4',
    future_known_evidence: '0',
  });
});

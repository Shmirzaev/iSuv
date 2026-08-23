import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { createApp } from '../../app.js';
import { createLocalDevelopmentIdentityProvider } from '../identity/provider.js';
import { PostgresNetworkReadRepository } from './repository.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests');

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const repository = new PostgresNetworkReadRepository(databaseUrl);
const organizationA = 'd1000000-0000-4000-8000-000000000001';
const organizationB = 'd1000000-0000-4000-8000-000000000002';
const rootTerritory = 'd2000000-0000-4000-8000-000000000001';
const territoryA = 'd2000000-0000-4000-8000-000000000002';
const territoryB = 'd2000000-0000-4000-8000-000000000003';
const territoryOther = 'd2000000-0000-4000-8000-000000000004';
const districtUser = 'd3000000-0000-4000-8000-000000000001';
const directorUser = 'd3000000-0000-4000-8000-000000000002';
const inactiveUser = 'd3000000-0000-4000-8000-000000000003';
const junction1 = 'd4000000-0000-4000-8000-000000000001';
const junction2 = 'd4000000-0000-4000-8000-000000000002';
const junction3 = 'd4000000-0000-4000-8000-000000000003';
const junction4 = 'd4000000-0000-4000-8000-000000000004';
const junction5 = 'd4000000-0000-4000-8000-000000000005';
const junctionConcurrentA = 'd4000000-0000-4000-8000-000000000006';
const junctionConcurrentB = 'd4000000-0000-4000-8000-000000000007';
const junctionOther = 'd4000000-0000-4000-8000-000000000008';
const junctionTerritoryB = 'd4000000-0000-4000-8000-000000000009';
const waterway = 'd5000000-0000-4000-8000-000000000001';
const section12 = 'd6000000-0000-4000-8000-000000000001';
const section23 = 'd6000000-0000-4000-8000-000000000002';
const section24 = 'd6000000-0000-4000-8000-000000000003';
const section35 = 'd6000000-0000-4000-8000-000000000004';
const section45 = 'd6000000-0000-4000-8000-000000000005';
const section51 = 'd6000000-0000-4000-8000-000000000006';
const sectionConcurrentAB = 'd6000000-0000-4000-8000-000000000007';
const sectionConcurrentBA = 'd6000000-0000-4000-8000-000000000008';
const sectionCrossBoundary = 'd6000000-0000-4000-8000-000000000009';
const device = 'd7000000-0000-4000-8000-000000000001';
const relocatedDevice = 'd7000000-0000-4000-8000-000000000002';
const station = 'd8000000-0000-4000-8000-000000000001';
const station2 = 'd8000000-0000-4000-8000-000000000002';

async function clearFixtures(): Promise<void> {
  await pool.query('DELETE FROM telemetry_sensors WHERE organization_id = ANY($1::uuid[])', [
    [organizationA, organizationB],
  ]);
  await pool.query(
    'DELETE FROM telemetry_device_installations WHERE organization_id = ANY($1::uuid[])',
    [[organizationA, organizationB]],
  );
  await pool.query('DELETE FROM telemetry_devices WHERE organization_id = ANY($1::uuid[])', [
    [organizationA, organizationB],
  ]);
  await pool.query('DELETE FROM monitoring_stations WHERE organization_id = ANY($1::uuid[])', [
    [organizationA, organizationB],
  ]);
  await pool.query('DELETE FROM control_structures WHERE organization_id = ANY($1::uuid[])', [
    [organizationA, organizationB],
  ]);
  await pool.query('DELETE FROM water_sections WHERE organization_id = ANY($1::uuid[])', [
    [organizationA, organizationB],
  ]);
  await pool.query('DELETE FROM network_junctions WHERE organization_id = ANY($1::uuid[])', [
    [organizationA, organizationB],
  ]);
  await pool.query('DELETE FROM waterways WHERE organization_id = ANY($1::uuid[])', [
    [organizationA, organizationB],
  ]);
  await pool.query('DELETE FROM user_role_grants WHERE organization_id = ANY($1::uuid[])', [
    [organizationA, organizationB],
  ]);
  await pool.query('DELETE FROM identity_users WHERE organization_id = ANY($1::uuid[])', [
    [organizationA, organizationB],
  ]);
  await pool.query('DELETE FROM territories WHERE organization_id = ANY($1::uuid[])', [
    [organizationA, organizationB],
  ]);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [
    [organizationA, organizationB],
  ]);
}

async function insertSection(
  id: string,
  upstream: string,
  downstream: string,
  code: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO water_sections
       (id, organization_id, territory_id, waterway_id, upstream_junction_id, downstream_junction_id, code, name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [id, organizationA, territoryA, waterway, upstream, downstream, code],
  );
}

before(async () => {
  await clearFixtures();
  await pool.query(
    `INSERT INTO organizations (id, code, name, data_classification)
     VALUES ($1, 'NETWORK-TEST-A', 'Network test organization A', 'synthetic'),
            ($2, 'NETWORK-TEST-B', 'Network test organization B', 'synthetic')`,
    [organizationA, organizationB],
  );
  await pool.query(
    `INSERT INTO territories (id, organization_id, parent_territory_id, code, name, kind, data_classification)
     VALUES ($1, $2, NULL, 'NETWORK-ROOT', 'Network root', 'region', 'synthetic'),
            ($3, $2, $1, 'NETWORK-A', 'Network territory A', 'district', 'synthetic'),
            ($4, $2, $1, 'NETWORK-B', 'Network territory B', 'district', 'synthetic'),
            ($5, $6, NULL, 'NETWORK-OTHER', 'Network other territory', 'district', 'synthetic')`,
    [rootTerritory, organizationA, territoryA, territoryB, territoryOther, organizationB],
  );
  await pool.query(
    `INSERT INTO identity_users (id, organization_id, external_subject, display_name, is_active, data_classification)
     VALUES ($1, $4, 'synthetic:network-district', 'Network district reader', true, 'synthetic'),
            ($2, $4, 'synthetic:network-director', 'Network director reader', true, 'synthetic'),
            ($3, $4, 'synthetic:network-inactive', 'Network inactive reader', false, 'synthetic')`,
    [districtUser, directorUser, inactiveUser, organizationA],
  );
  await pool.query(
    `INSERT INTO user_role_grants
       (id, user_id, organization_id, role, scope, territory_id, effective_from)
     VALUES
       ('d9000000-0000-4000-8000-000000000001', $1, $4, 'district_operator', 'territory', $2, '2026-01-01T00:00:00Z'),
       ('d9000000-0000-4000-8000-000000000002', $3, $4, 'regional_director', 'territory', $5, '2026-01-01T00:00:00Z'),
       ('d9000000-0000-4000-8000-000000000003', $6, $4, 'district_operator', 'territory', $2, '2026-01-01T00:00:00Z')`,
    [districtUser, territoryA, directorUser, organizationA, rootTerritory, inactiveUser],
  );
  await pool.query(
    `INSERT INTO waterways (id, organization_id, territory_id, code, name, geometry)
     VALUES ($1, $2, $3, 'TEST-WATERWAY', 'Test waterway',
             ST_GeomFromText('LINESTRING(69.1 41.1,69.5 41.5)', 4326))`,
    [waterway, organizationA, territoryA],
  );
  const junctionIds = [
    junction1,
    junction2,
    junction3,
    junction4,
    junction5,
    junctionConcurrentA,
    junctionConcurrentB,
  ];
  for (const [index, id] of junctionIds.entries()) {
    await pool.query(
      `INSERT INTO network_junctions (id, organization_id, territory_id, code, name, geometry)
       VALUES ($1, $2, $3, $4, $4, ST_SetSRID(ST_MakePoint(69.1 + $5::double precision, 41.1), 4326))`,
      [id, organizationA, territoryA, `J-${index + 1}`, index / 100],
    );
  }
  await pool.query(
    `INSERT INTO network_junctions (id, organization_id, territory_id, code, name, geometry)
     VALUES ($1, $2, $3, 'J-OTHER', 'J-OTHER', ST_SetSRID(ST_MakePoint(70, 42), 4326))`,
    [junctionOther, organizationB, territoryOther],
  );
  await pool.query(
    `INSERT INTO network_junctions (id, organization_id, territory_id, code, name, geometry)
     VALUES ($1, $2, $3, 'J-TERRITORY-B', 'J-TERRITORY-B', ST_SetSRID(ST_MakePoint(69.7, 41.7), 4326))`,
    [junctionTerritoryB, organizationA, territoryB],
  );
  await insertSection(section12, junction1, junction2, 'S-12');
  await insertSection(section23, junction2, junction3, 'S-23');
  await insertSection(section24, junction2, junction4, 'S-24');
  await insertSection(section35, junction3, junction5, 'S-35');
  await insertSection(section45, junction4, junction5, 'S-45');
  await insertSection(sectionCrossBoundary, junction5, junctionTerritoryB, 'S-CROSS-BOUNDARY');
  await pool.query(
    `INSERT INTO monitoring_stations (id, organization_id, territory_id, junction_id, code, name, geometry)
     VALUES ($1, $2, $3, $4, 'STATION-1', 'Station 1', ST_SetSRID(ST_MakePoint(69.1, 41.1), 4326))`,
    [station, organizationA, territoryA, junction1],
  );
  await pool.query(
    `INSERT INTO monitoring_stations (id, organization_id, territory_id, junction_id, code, name, geometry)
     VALUES ($1, $2, $3, $4, 'STATION-2', 'Station 2', ST_SetSRID(ST_MakePoint(69.2, 41.1), 4326))`,
    [station2, organizationA, territoryA, junction2],
  );
  await pool.query(
    `INSERT INTO telemetry_devices (id, organization_id, territory_id, code, name, protocol)
     VALUES ($1, $2, $3, 'DEVICE-1', 'Device 1', 'mqtt')`,
    [device, organizationA, territoryA],
  );
  await pool.query(
    `INSERT INTO telemetry_devices (id, organization_id, territory_id, code, name, protocol)
     VALUES ($1, $2, $3, 'DEVICE-RELOCATED', 'Device relocated', 'modbus')`,
    [relocatedDevice, organizationA, territoryA],
  );
  await pool.query(
    `INSERT INTO telemetry_device_installations
       (id, organization_id, territory_id, device_id, station_id, effective_from, provenance)
     VALUES ('db000000-0000-4000-8000-000000000001', $1, $2, $3, $4,
             '2026-01-01T00:00:00Z', 'synthetic commissioning fixture')`,
    [organizationA, territoryA, device, station],
  );
  await pool.query(
    `INSERT INTO telemetry_device_installations
       (id, organization_id, territory_id, device_id, station_id, effective_from, effective_until, provenance)
     VALUES ('db000000-0000-4000-8000-000000000002', $1, $2, $3, $4,
             '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z', 'synthetic initial installation'),
            ('db000000-0000-4000-8000-000000000003', $1, $2, $3, $5,
             '2025-02-01T00:00:00Z', NULL, 'synthetic relocation handover')`,
    [organizationA, territoryA, relocatedDevice, station, station2],
  );
});

after(async () => {
  await clearFixtures();
  await pool.end();
});

test('PostGIS network model accepts directed branch and merge topology with stable entity reads', async () => {
  const topology = await repository.listTopology(territoryA);
  assert.equal(topology.length, 6);
  assert.equal(topology.filter((edge) => edge.upstreamJunctionId === junction2).length, 2);
  assert.equal(topology.filter((edge) => edge.downstreamJunctionId === junction5).length, 2);
  const boundary = topology.find((edge) => edge.sectionId === sectionCrossBoundary);
  assert.deepEqual(boundary && [boundary.downstreamJunctionId, boundary.downstreamBoundary], [
    null,
    true,
  ]);
  const sections = await repository.listEntities('section', territoryA);
  assert.equal(sections.length >= 5, true);
  const boundarySection = sections.find((entity) => entity.id === sectionCrossBoundary);
  assert.deepEqual(
    boundarySection &&
      boundarySection.type === 'section' && {
        downstreamJunctionId: boundarySection.downstreamJunctionId,
        downstreamBoundary: boundarySection.downstreamBoundary,
      },
    { downstreamJunctionId: null, downstreamBoundary: true },
  );
  const currentDevice = await repository.findEntity('device', device);
  assert.deepEqual(
    currentDevice && {
      type: currentDevice.type,
      stationId: currentDevice.type === 'device' ? currentDevice.stationId : null,
      installationProvenance:
        currentDevice.type === 'device' ? currentDevice.installationProvenance : null,
    },
    {
      type: 'device',
      stationId: station,
      installationProvenance: 'synthetic commissioning fixture',
    },
  );
});

test('network database constraints reject invalid topology, geometry, classifications, attachments, and code mutation', async () => {
  await pool.query(
    `INSERT INTO network_junctions (id, organization_id, territory_id, code, name, geometry)
     VALUES ('da000000-0000-4000-8000-000000000011', $1, $2, 'J-WGS84-EDGE', 'J-WGS84-EDGE',
             ST_GeomFromText('POINT(-180 90)', 4326))`,
    [organizationA, territoryA],
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO network_junctions (id, organization_id, territory_id, code, name, geometry)
       VALUES ('da000000-0000-4000-8000-000000000012', $1, $2, 'J-WGS84-INVALID', 'J-WGS84-INVALID',
               ST_GeomFromText('POINT(200 95)', 4326))`,
      [organizationA, territoryA],
    ),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO waterways (id, organization_id, territory_id, code, name, geometry)
       VALUES ('da100000-0000-4000-8000-000000000003', $1, $2, 'LINE-WGS84-INVALID', 'Line WGS84 invalid',
               ST_GeomFromText('LINESTRING(69 41,181 41)', 4326))`,
      [organizationA, territoryA],
    ),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO water_regions (id, organization_id, territory_id, code, name, geometry)
       VALUES ('da100000-0000-4000-8000-000000000004', $1, $2, 'POLYGON-WGS84-INVALID',
               'Polygon WGS84 invalid',
               ST_GeomFromText('MULTIPOLYGON(((69 41,70 41,70 91,69 41)))', 4326))`,
      [organizationA, territoryA],
    ),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );
  await assert.rejects(
    insertSection(section51, junction5, junction1, 'S-51'),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO monitoring_stations (id, organization_id, territory_id, code, name)
       VALUES ('da200000-0000-4000-8000-000000000002', $1, $2, 'BAD-STATION', 'Bad station')`,
      [organizationA, territoryA],
    ),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );
  await assert.rejects(
    insertSection('da000000-0000-4000-8000-000000000007', junction1, junction1, 'S-SELF'),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO telemetry_device_installations
         (id, organization_id, territory_id, device_id, station_id, effective_from, effective_until, provenance)
       VALUES ('db000000-0000-4000-8000-000000000004', $1, $2, $3, $4,
               '2025-01-15T00:00:00Z', '2025-01-20T00:00:00Z', 'overlap must fail')`,
      [organizationA, territoryA, relocatedDevice, station],
    ),
    (error: unknown) => (error as { code?: string }).code === '23P01',
  );
  const relocationHistory = await pool.query<{ provenance: string }>(
    `SELECT provenance FROM telemetry_device_installations
     WHERE device_id = $1 ORDER BY effective_from`,
    [relocatedDevice],
  );
  assert.deepEqual(
    relocationHistory.rows.map((row) => row.provenance),
    ['synthetic initial installation', 'synthetic relocation handover'],
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO water_sections
         (id, organization_id, territory_id, waterway_id, upstream_junction_id, downstream_junction_id, code, name)
       VALUES ('da000000-0000-4000-8000-000000000008', $1, $2, $3, $4, $5, 'S-CROSS-ORG', 'S-CROSS-ORG')`,
      [organizationA, territoryA, waterway, junctionOther, junction2],
    ),
    (error: unknown) => (error as { code?: string }).code === '23503',
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO waterways (id, organization_id, territory_id, code, name, geometry)
       VALUES ('da100000-0000-4000-8000-000000000001', $1, $2, 'BAD-GEOMETRY', 'Bad geometry',
               ST_GeomFromText('POINT(69 41)', 4326))`,
      [organizationA, territoryA],
    ),
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO waterways (id, organization_id, territory_id, code, name, geometry)
       VALUES ('da100000-0000-4000-8000-000000000002', $1, $2, 'EMPTY-GEOMETRY', 'Empty geometry',
               ST_GeomFromText('LINESTRING EMPTY', 4326))`,
      [organizationA, territoryA],
    ),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO control_structures (id, organization_id, territory_id, code, name, kind)
       VALUES ('da200000-0000-4000-8000-000000000001', $1, $2, 'BAD-CONTROL', 'Bad control', 'gate')`,
      [organizationA, territoryA],
    ),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO telemetry_sensors
         (id, organization_id, territory_id, device_id, code, name, measurement_kind, unit)
       VALUES ('da300000-0000-4000-8000-000000000001', $1, $2, $3,
               'BAD-SENSOR', 'Bad sensor', 'stage', 'm3')`,
      [organizationA, territoryA, device],
    ),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );
  await assert.rejects(
    pool.query("UPDATE network_junctions SET code = 'MUTATED' WHERE id = $1", [junction1]),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );
});

test(
  'organization advisory lock rejects concurrent reciprocal topology edges',
  { concurrency: false },
  async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      await first.query(
        `INSERT INTO water_sections
         (id, organization_id, territory_id, waterway_id, upstream_junction_id, downstream_junction_id, code, name)
       VALUES ($1, $2, $3, $4, $5, $6, 'S-C-AB', 'S-C-AB')`,
        [
          sectionConcurrentAB,
          organizationA,
          territoryA,
          waterway,
          junctionConcurrentA,
          junctionConcurrentB,
        ],
      );
      const reciprocal = second.query(
        `INSERT INTO water_sections
         (id, organization_id, territory_id, waterway_id, upstream_junction_id, downstream_junction_id, code, name)
       VALUES ($1, $2, $3, $4, $5, $6, 'S-C-BA', 'S-C-BA')`,
        [
          sectionConcurrentBA,
          organizationA,
          territoryA,
          waterway,
          junctionConcurrentB,
          junctionConcurrentA,
        ],
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      await first.query('COMMIT');
      await assert.rejects(
        reciprocal,
        (error: unknown) => (error as { code?: string }).code === '23514',
      );
      await second.query('ROLLBACK');
    } finally {
      first.release();
      second.release();
    }
  },
);

test('database-backed API reads enforce same, ancestor, cross-territory, inactive, and unknown identity boundaries', async () => {
  const app = createApp(async () => undefined, false, {
    identityProvider: createLocalDevelopmentIdentityProvider({ enabled: true }),
  });
  try {
    const same = await app.inject({
      method: 'GET',
      url: `/api/v1/network/entities/junction?territoryId=${territoryA}`,
      headers: { 'x-isuv-user-id': districtUser },
    });
    assert.equal(same.statusCode, 200);
    const ancestor = await app.inject({
      method: 'GET',
      url: `/api/v1/network/topology?territoryId=${territoryA}`,
      headers: { 'x-isuv-user-id': directorUser },
    });
    assert.equal(ancestor.statusCode, 200);
    const cross = await app.inject({
      method: 'GET',
      url: `/api/v1/network/entities/junction?territoryId=${territoryB}`,
      headers: { 'x-isuv-user-id': districtUser },
    });
    assert.equal(cross.statusCode, 403);
    const inactive = await app.inject({
      method: 'GET',
      url: `/api/v1/network/entities/junction?territoryId=${territoryA}`,
      headers: { 'x-isuv-user-id': inactiveUser },
    });
    assert.equal(inactive.statusCode, 401);
    const unknown = await app.inject({
      method: 'GET',
      url: `/api/v1/network/entities/junction?territoryId=${territoryA}`,
      headers: { 'x-isuv-user-id': 'd3000000-0000-4000-8000-000000000004' },
    });
    assert.equal(unknown.statusCode, 401);
  } finally {
    await app.close();
  }
});

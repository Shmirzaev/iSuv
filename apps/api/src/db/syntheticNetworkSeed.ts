import type { PoolClient } from 'pg';

export const syntheticHotspotCodePrefix = 'SYN-HOTSPOT-';
export const syntheticOrganizationId = 'a1000000-0000-4000-8000-000000000001';
export const syntheticDataClassification = 'synthetic' as const;
const territoryIds = [
  'a2000000-0000-4000-8000-000000000004',
  'a2000000-0000-4000-8000-000000000005',
] as const;

type AssetType =
  | 'region'
  | 'basin'
  | 'waterway'
  | 'junction'
  | 'section'
  | 'control'
  | 'station'
  | 'device'
  | 'installation'
  | 'sensor';

const assetTypeKeys: Record<AssetType, string> = {
  region: '01',
  basin: '02',
  waterway: '03',
  junction: '04',
  section: '05',
  control: '06',
  station: '07',
  device: '08',
  installation: '09',
  sensor: '0a',
};

function stableId(type: AssetType, hotspot: number, sequence = 0): string {
  const hotspotHex = hotspot.toString(16).padStart(4, '0');
  const sequenceHex = sequence.toString(16).padStart(12, '0');
  return `f1${assetTypeKeys[type]}${hotspotHex}-0000-4000-8000-${sequenceHex}`;
}

function fixed(value: number): string {
  return value.toFixed(4);
}

function pointWkt(longitude: number, latitude: number): string {
  return `POINT(${fixed(longitude)} ${fixed(latitude)})`;
}

function lineWkt(points: readonly (readonly [number, number])[]): string {
  return `LINESTRING(${points.map(([longitude, latitude]) => `${fixed(longitude)} ${fixed(latitude)}`).join(', ')})`;
}

function polygonWkt(longitude: number, latitude: number, radius: number): string {
  const points: readonly [number, number][] = [
    [longitude - radius, latitude - radius],
    [longitude + radius, latitude - radius],
    [longitude + radius, latitude + radius],
    [longitude - radius, latitude + radius],
    [longitude - radius, latitude - radius],
  ];
  return `MULTIPOLYGON(((${points
    .map(([pointLongitude, pointLatitude]) => `${fixed(pointLongitude)} ${fixed(pointLatitude)}`)
    .join(', ')})))`;
}

function rectangleWkt(
  minimumLongitude: number,
  minimumLatitude: number,
  maximumLongitude: number,
  maximumLatitude: number,
): string {
  return `MULTIPOLYGON(((${fixed(minimumLongitude)} ${fixed(minimumLatitude)}, ${fixed(maximumLongitude)} ${fixed(minimumLatitude)}, ${fixed(maximumLongitude)} ${fixed(maximumLatitude)}, ${fixed(minimumLongitude)} ${fixed(maximumLatitude)}, ${fixed(minimumLongitude)} ${fixed(minimumLatitude)})))`;
}

export interface SyntheticSpatialAsset {
  id: string;
  hotspotCode: string;
  organizationId: string;
  territoryId: string;
  code: string;
  name: string;
  geometry: string;
  dataClassification: typeof syntheticDataClassification;
}

export interface SyntheticBasin extends SyntheticSpatialAsset {
  regionId: string;
}

export interface SyntheticWaterway extends SyntheticSpatialAsset {
  basinId: string;
}

export interface SyntheticSection extends SyntheticSpatialAsset {
  waterwayId: string;
  upstreamJunctionId: string;
  downstreamJunctionId: string;
}

export interface SyntheticControlStructure extends SyntheticSpatialAsset {
  sectionId: string;
}

export interface SyntheticStation extends SyntheticSpatialAsset {
  junctionId: string;
}

export interface SyntheticDevice {
  id: string;
  hotspotCode: string;
  organizationId: string;
  territoryId: string;
  code: string;
  name: string;
  dataClassification: typeof syntheticDataClassification;
}

export interface SyntheticInstallation {
  id: string;
  organizationId: string;
  territoryId: string;
  deviceId: string;
  stationId: string;
  provenance: string;
  dataClassification: typeof syntheticDataClassification;
}

export interface SyntheticSensor {
  id: string;
  organizationId: string;
  territoryId: string;
  deviceId: string;
  code: string;
  name: string;
  measurementKind: 'stage' | 'discharge' | 'accumulated_volume';
  unit: 'm' | 'm3/s' | 'm3';
  dataClassification: typeof syntheticDataClassification;
}

export interface SyntheticNetworkSeed {
  hotspotCodes: string[];
  regions: SyntheticSpatialAsset[];
  basins: SyntheticBasin[];
  waterways: SyntheticWaterway[];
  junctions: SyntheticSpatialAsset[];
  sections: SyntheticSection[];
  controlStructures: SyntheticControlStructure[];
  stations: SyntheticStation[];
  devices: SyntheticDevice[];
  installations: SyntheticInstallation[];
  sensors: SyntheticSensor[];
}

function hotspotCode(hotspot: number): string {
  return `${syntheticHotspotCodePrefix}${hotspot.toString().padStart(3, '0')}`;
}

/**
 * Deterministic, deliberately fictional network fixtures. Coordinates only
 * place items in an Uzbekistan-like WGS84 envelope; they are not official GIS.
 */
export function buildSyntheticNetworkSeed(): SyntheticNetworkSeed {
  const seed: SyntheticNetworkSeed = {
    hotspotCodes: [],
    regions: [],
    basins: [],
    waterways: [],
    junctions: [],
    sections: [],
    controlStructures: [],
    stations: [],
    devices: [],
    installations: [],
    sensors: [],
  };
  const regionId = stableId('region', 0, 1);
  const basinDefinitions = [
    { center: [58.5, 40.5] as const, hotspotCount: 17 },
    { center: [61, 40.5] as const, hotspotCount: 17 },
    { center: [63.5, 40.5] as const, hotspotCount: 17 },
    { center: [66, 40.5] as const, hotspotCount: 16 },
    { center: [68.5, 40.5] as const, hotspotCount: 16 },
  ];
  const basinIds = basinDefinitions.map((_, index) => stableId('basin', 0, index + 1));
  const basinOutletSources = new Map<
    number,
    { id: string; territoryId: string; coordinates: readonly [number, number] }[]
  >();
  seed.regions.push({
    id: regionId,
    hotspotCode: 'SYNTH-DEMO-REGION-01',
    organizationId: syntheticOrganizationId,
    territoryId: territoryIds[0],
    code: 'SYNTH-DEMO-REGION-01',
    name: 'Synthetic demonstration water region (not official GIS)',
    geometry: rectangleWkt(57, 37, 70, 44),
    dataClassification: syntheticDataClassification,
  });
  for (let basinIndex = 1; basinIndex <= basinIds.length; basinIndex += 1) {
    const definition = basinDefinitions[basinIndex - 1]!;
    const [basinLongitude, basinLatitude] = definition.center;
    seed.basins.push({
      id: basinIds[basinIndex - 1]!,
      hotspotCode: `SYNTH-DEMO-BASIN-${basinIndex.toString().padStart(2, '0')}`,
      organizationId: syntheticOrganizationId,
      territoryId: territoryIds[(basinIndex - 1) % territoryIds.length]!,
      regionId,
      code: `SYNTH-DEMO-BASIN-${basinIndex.toString().padStart(2, '0')}`,
      name: `Synthetic demonstration basin ${basinIndex.toString().padStart(2, '0')} (not official GIS)`,
      geometry: polygonWkt(basinLongitude, basinLatitude, 1.1),
      dataClassification: syntheticDataClassification,
    });
  }

  let hotspot = 0;
  for (let basinIndex = 1; basinIndex <= basinDefinitions.length; basinIndex += 1) {
    const definition = basinDefinitions[basinIndex - 1]!;
    const [basinLongitude, basinLatitude] = definition.center;
    for (let localIndex = 0; localIndex < definition.hotspotCount; localIndex += 1) {
      hotspot += 1;
      const code = hotspotCode(hotspot);
      seed.hotspotCodes.push(code);
      const gridColumn = localIndex % 5;
      const gridRow = Math.floor(localIndex / 5);
      const longitude = basinLongitude + (gridColumn - 2) * 0.3;
      const latitude = basinLatitude + (gridRow - 1.5) * 0.28;
      const organizationId = syntheticOrganizationId;
      const basinId = basinIds[basinIndex - 1]!;
      // Each basin has one deliberately visible, one-way territory boundary.
      // Keeping all other roots in the owning territory makes the fixture
      // useful for authorization tests without suggesting a real boundary.
      const primaryTerritoryId = territoryIds[(basinIndex - 1) % territoryIds.length]!;
      const territoryId =
        localIndex === definition.hotspotCount - 1
          ? territoryIds.find((candidate) => candidate !== primaryTerritoryId)!
          : primaryTerritoryId;
      const waterwayId = stableId('waterway', hotspot);
      const junctionCoordinates: readonly [number, number][] = [
        [longitude - 0.23, latitude],
        [longitude - 0.1, latitude],
        [longitude + 0.08, latitude + 0.12],
        [longitude + 0.08, latitude - 0.12],
        [longitude + 0.28, latitude],
      ];
      const junctionIds = junctionCoordinates.map((_, sequence) =>
        stableId('junction', hotspot, sequence + 1),
      );

      seed.waterways.push({
        id: waterwayId,
        hotspotCode: code,
        organizationId,
        territoryId,
        basinId,
        code: `${code}-WATERWAY`,
        name: `Synthetic waterway for ${code} (demo only)`,
        geometry: lineWkt([
          junctionCoordinates[0]!,
          junctionCoordinates[1]!,
          junctionCoordinates[4]!,
        ]),
        dataClassification: syntheticDataClassification,
      });
      junctionCoordinates.forEach(([junctionLongitude, junctionLatitude], sequence) => {
        const isEntry = sequence === 0;
        seed.junctions.push({
          id: junctionIds[sequence]!,
          hotspotCode: code,
          organizationId,
          territoryId,
          code: isEntry
            ? `${code}-ENTRY`
            : `${code}-J-${(sequence + 1).toString().padStart(2, '0')}`,
          name: isEntry
            ? `Synthetic entry root for ${code} (demo only)`
            : `Synthetic junction ${(sequence + 1).toString().padStart(2, '0')} for ${code}`,
          geometry: pointWkt(junctionLongitude, junctionLatitude),
          dataClassification: syntheticDataClassification,
        });
      });

      const graphEdges: readonly [number, number][] = [
        [0, 1],
        [1, 2],
        [1, 3],
        [2, 4],
        [3, 4],
      ];
      graphEdges.forEach(([upstream, downstream], sequence) => {
        seed.sections.push({
          id: stableId('section', hotspot, sequence + 1),
          hotspotCode: code,
          organizationId,
          territoryId,
          waterwayId,
          upstreamJunctionId: junctionIds[upstream]!,
          downstreamJunctionId: junctionIds[downstream]!,
          code: `${code}-SECTION-${(sequence + 1).toString().padStart(2, '0')}`,
          name: `Synthetic section ${(sequence + 1).toString().padStart(2, '0')} for ${code}`,
          geometry: lineWkt([junctionCoordinates[upstream]!, junctionCoordinates[downstream]!]),
          dataClassification: syntheticDataClassification,
        });
      });
      const outletSources = basinOutletSources.get(basinIndex) ?? [];
      outletSources.push({
        id: junctionIds[4]!,
        territoryId,
        coordinates: junctionCoordinates[4]!,
      });
      basinOutletSources.set(basinIndex, outletSources);

      const controlId = stableId('control', hotspot);
      const stationId = stableId('station', hotspot);
      const deviceId = stableId('device', hotspot);
      seed.controlStructures.push({
        id: controlId,
        hotspotCode: code,
        organizationId,
        territoryId,
        sectionId: stableId('section', hotspot, 1),
        code: `${code}-CONTROL-01`,
        name: `Synthetic monitoring-only control structure for ${code}`,
        geometry: pointWkt(...junctionCoordinates[0]!),
        dataClassification: syntheticDataClassification,
      });
      seed.stations.push({
        id: stationId,
        hotspotCode: code,
        organizationId,
        territoryId,
        junctionId: junctionIds[0]!,
        code: `${code}-STATION-01`,
        name: `Synthetic monitoring station for ${code}`,
        geometry: pointWkt(...junctionCoordinates[0]!),
        dataClassification: syntheticDataClassification,
      });
      seed.devices.push({
        id: deviceId,
        hotspotCode: code,
        organizationId,
        territoryId,
        code: `${code}-DEVICE-01`,
        name: `Synthetic MQTT telemetry device for ${code}`,
        dataClassification: syntheticDataClassification,
      });
      seed.installations.push({
        id: stableId('installation', hotspot),
        organizationId,
        territoryId,
        deviceId,
        stationId,
        provenance: `synthetic: deterministic fixture installation for ${code}`,
        dataClassification: syntheticDataClassification,
      });
      (
        [
          ['stage', 'm'],
          ['discharge', 'm3/s'],
          ['accumulated_volume', 'm3'],
        ] as const
      ).forEach(([measurementKind, unit], sequence) => {
        seed.sensors.push({
          id: stableId('sensor', hotspot, sequence + 1),
          organizationId,
          territoryId,
          deviceId,
          code: `${code}-SENSOR-${measurementKind.toUpperCase()}`,
          name: `Synthetic ${measurementKind} sensor for ${code}`,
          measurementKind,
          unit,
          dataClassification: syntheticDataClassification,
        });
      });
    }
  }
  for (let basinIndex = 1; basinIndex <= basinIds.length; basinIndex += 1) {
    const basinCode = `SYNTH-DEMO-BASIN-${basinIndex.toString().padStart(2, '0')}`;
    const [basinLongitude, basinLatitude] = basinDefinitions[basinIndex - 1]!.center;
    const collectorWaterwayId = stableId('waterway', 0, basinIndex);
    const territoryId = territoryIds[0]!;
    seed.waterways.push({
      id: collectorWaterwayId,
      hotspotCode: basinCode,
      organizationId: syntheticOrganizationId,
      territoryId,
      basinId: basinIds[basinIndex - 1]!,
      code: `${basinCode}-COLLECTOR`,
      name: `Synthetic basin collector ${basinIndex.toString().padStart(2, '0')} (demo only)`,
      geometry: lineWkt([
        [basinLongitude - 0.1, basinLatitude + 0.1],
        [basinLongitude, basinLatitude],
      ]),
      dataClassification: syntheticDataClassification,
    });
    let sources = [...(basinOutletSources.get(basinIndex) ?? [])];
    let mergeSequence = 0;
    let sectionSequence = 0;
    while (sources.length > 1) {
      const nextSources: typeof sources = [];
      for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 2) {
        const left = sources[sourceIndex]!;
        const right = sources[sourceIndex + 1];
        if (!right) {
          nextSources.push(left);
          continue;
        }
        mergeSequence += 1;
        const isBasinOutlet = sources.length === 2;
        const coordinates: readonly [number, number] = [
          (left.coordinates[0] + right.coordinates[0]) / 2,
          (left.coordinates[1] + right.coordinates[1]) / 2,
        ];
        const target = {
          id: stableId('junction', 0, basinIndex * 1000 + mergeSequence),
          territoryId: left.territoryId,
          coordinates,
        };
        seed.junctions.push({
          id: target.id,
          hotspotCode: basinCode,
          organizationId: syntheticOrganizationId,
          territoryId: target.territoryId,
          code: isBasinOutlet
            ? `${basinCode}-OUTLET`
            : `${basinCode}-MERGE-${mergeSequence.toString().padStart(3, '0')}`,
          name: isBasinOutlet
            ? `Synthetic basin outlet ${basinIndex.toString().padStart(2, '0')} (demo only)`
            : `Synthetic collector merge ${mergeSequence.toString().padStart(3, '0')} for ${basinCode}`,
          geometry: pointWkt(...coordinates),
          dataClassification: syntheticDataClassification,
        });
        for (const source of [left, right]) {
          sectionSequence += 1;
          seed.sections.push({
            id: stableId('section', 0, basinIndex * 1000 + sectionSequence),
            hotspotCode: basinCode,
            organizationId: syntheticOrganizationId,
            territoryId: source.territoryId,
            waterwayId: collectorWaterwayId,
            upstreamJunctionId: source.id,
            downstreamJunctionId: target.id,
            code: `${basinCode}-COLLECTOR-${sectionSequence.toString().padStart(3, '0')}`,
            name: `Synthetic pairwise collector section ${sectionSequence.toString().padStart(3, '0')} for ${basinCode}`,
            geometry: lineWkt([source.coordinates, coordinates]),
            dataClassification: syntheticDataClassification,
          });
        }
        nextSources.push(target);
      }
      sources = nextSources;
    }
  }
  return seed;
}

export function syntheticNetworkSeedCounts(seed: SyntheticNetworkSeed) {
  return {
    hotspots: seed.hotspotCodes.length,
    regions: seed.regions.length,
    basins: seed.basins.length,
    waterways: seed.waterways.length,
    junctions: seed.junctions.length,
    sections: seed.sections.length,
    controlStructures: seed.controlStructures.length,
    stations: seed.stations.length,
    devices: seed.devices.length,
    installations: seed.installations.length,
    sensors: seed.sensors.length,
  };
}

async function insertSpatialAsset(
  pool: PoolClient,
  table: 'water_regions' | 'water_basins' | 'waterways' | 'network_junctions',
  asset: SyntheticSpatialAsset,
  relationshipColumn?: 'region_id' | 'basin_id',
  relationshipId?: string,
): Promise<void> {
  const columns = relationshipColumn
    ? `id, organization_id, territory_id, ${relationshipColumn}, code, name, geometry, data_classification`
    : 'id, organization_id, territory_id, code, name, geometry, data_classification';
  const values = relationshipColumn
    ? '$1, $2, $3, $4, $5, $6, ST_GeomFromText($7, 4326), $8'
    : '$1, $2, $3, $4, $5, ST_GeomFromText($6, 4326), $7';
  const update = relationshipColumn
    ? `territory_id = EXCLUDED.territory_id, ${relationshipColumn} = EXCLUDED.${relationshipColumn}, name = EXCLUDED.name, geometry = EXCLUDED.geometry, data_classification = EXCLUDED.data_classification, updated_at = now()`
    : 'territory_id = EXCLUDED.territory_id, name = EXCLUDED.name, geometry = EXCLUDED.geometry, data_classification = EXCLUDED.data_classification, updated_at = now()';
  const parameters = relationshipColumn
    ? [
        asset.id,
        asset.organizationId,
        asset.territoryId,
        relationshipId,
        asset.code,
        asset.name,
        asset.geometry,
        'synthetic',
      ]
    : [
        asset.id,
        asset.organizationId,
        asset.territoryId,
        asset.code,
        asset.name,
        asset.geometry,
        'synthetic',
      ];
  await pool.query(
    `INSERT INTO ${table} (${columns}) VALUES (${values})
     ON CONFLICT (id) DO UPDATE SET ${update}`,
    parameters,
  );
}

export async function seedSyntheticNetwork(
  pool: PoolClient,
): Promise<ReturnType<typeof syntheticNetworkSeedCounts>> {
  const seed = buildSyntheticNetworkSeed();
  for (const region of seed.regions) await insertSpatialAsset(pool, 'water_regions', region);
  for (const basin of seed.basins)
    await insertSpatialAsset(pool, 'water_basins', basin, 'region_id', basin.regionId);
  for (const waterway of seed.waterways)
    await insertSpatialAsset(pool, 'waterways', waterway, 'basin_id', waterway.basinId);
  for (const junction of seed.junctions)
    await insertSpatialAsset(pool, 'network_junctions', junction);

  for (const section of seed.sections) {
    await pool.query(
      `INSERT INTO water_sections
         (id, organization_id, territory_id, waterway_id, upstream_junction_id, downstream_junction_id,
          code, name, geometry, data_classification)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_GeomFromText($9, 4326), 'synthetic')
       ON CONFLICT (id) DO UPDATE SET
         territory_id = EXCLUDED.territory_id, waterway_id = EXCLUDED.waterway_id,
         upstream_junction_id = EXCLUDED.upstream_junction_id,
         downstream_junction_id = EXCLUDED.downstream_junction_id, name = EXCLUDED.name,
         geometry = EXCLUDED.geometry, data_classification = EXCLUDED.data_classification, updated_at = now()`,
      [
        section.id,
        section.organizationId,
        section.territoryId,
        section.waterwayId,
        section.upstreamJunctionId,
        section.downstreamJunctionId,
        section.code,
        section.name,
        section.geometry,
      ],
    );
  }
  for (const controlStructure of seed.controlStructures) {
    await pool.query(
      `INSERT INTO control_structures
         (id, organization_id, territory_id, section_id, code, name, kind, geometry, data_classification)
       VALUES ($1, $2, $3, $4, $5, $6, 'gate', ST_GeomFromText($7, 4326), 'synthetic')
       ON CONFLICT (id) DO UPDATE SET
         territory_id = EXCLUDED.territory_id, section_id = EXCLUDED.section_id, name = EXCLUDED.name,
         kind = EXCLUDED.kind, geometry = EXCLUDED.geometry,
         data_classification = EXCLUDED.data_classification, updated_at = now()`,
      [
        controlStructure.id,
        controlStructure.organizationId,
        controlStructure.territoryId,
        controlStructure.sectionId,
        controlStructure.code,
        controlStructure.name,
        controlStructure.geometry,
      ],
    );
  }
  for (const station of seed.stations) {
    await pool.query(
      `INSERT INTO monitoring_stations
         (id, organization_id, territory_id, junction_id, code, name, geometry, data_classification)
       VALUES ($1, $2, $3, $4, $5, $6, ST_GeomFromText($7, 4326), 'synthetic')
       ON CONFLICT (id) DO UPDATE SET
         territory_id = EXCLUDED.territory_id, junction_id = EXCLUDED.junction_id, name = EXCLUDED.name,
         geometry = EXCLUDED.geometry, data_classification = EXCLUDED.data_classification, updated_at = now()`,
      [
        station.id,
        station.organizationId,
        station.territoryId,
        station.junctionId,
        station.code,
        station.name,
        station.geometry,
      ],
    );
  }
  for (const device of seed.devices) {
    await pool.query(
      `INSERT INTO telemetry_devices
         (id, organization_id, territory_id, code, name, protocol, data_classification)
       VALUES ($1, $2, $3, $4, $5, 'mqtt', 'synthetic')
       ON CONFLICT (id) DO UPDATE SET
         territory_id = EXCLUDED.territory_id, name = EXCLUDED.name, protocol = EXCLUDED.protocol,
         data_classification = EXCLUDED.data_classification, updated_at = now()`,
      [device.id, device.organizationId, device.territoryId, device.code, device.name],
    );
  }
  for (const installation of seed.installations) {
    await pool.query(
      `INSERT INTO telemetry_device_installations
         (id, organization_id, territory_id, device_id, station_id, effective_from, provenance, data_classification)
       VALUES ($1, $2, $3, $4, $5, '2026-01-01T00:00:00.000Z', $6, 'synthetic')
       ON CONFLICT (id) DO UPDATE SET
         territory_id = EXCLUDED.territory_id, device_id = EXCLUDED.device_id,
         station_id = EXCLUDED.station_id, effective_from = EXCLUDED.effective_from,
         effective_until = NULL, provenance = EXCLUDED.provenance,
         data_classification = EXCLUDED.data_classification, updated_at = now()`,
      [
        installation.id,
        installation.organizationId,
        installation.territoryId,
        installation.deviceId,
        installation.stationId,
        installation.provenance,
      ],
    );
  }
  for (const sensor of seed.sensors) {
    await pool.query(
      `INSERT INTO telemetry_sensors
         (id, organization_id, territory_id, device_id, code, name, measurement_kind, unit, data_classification)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'synthetic')
       ON CONFLICT (id) DO UPDATE SET
         territory_id = EXCLUDED.territory_id, device_id = EXCLUDED.device_id, name = EXCLUDED.name,
         measurement_kind = EXCLUDED.measurement_kind, unit = EXCLUDED.unit,
         data_classification = EXCLUDED.data_classification, updated_at = now()`,
      [
        sensor.id,
        sensor.organizationId,
        sensor.territoryId,
        sensor.deviceId,
        sensor.code,
        sensor.name,
        sensor.measurementKind,
        sensor.unit,
      ],
    );
  }
  return syntheticNetworkSeedCounts(seed);
}

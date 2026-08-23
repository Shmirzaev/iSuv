CREATE EXTENSION IF NOT EXISTS postgis;

-- Identity was introduced before platform-wide records.  Renaming the type is
-- metadata-only in PostgreSQL and keeps existing identity columns intact while
-- making classification a generic governed-record concept.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'identity_data_classification')
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'record_data_classification') THEN
    ALTER TYPE identity_data_classification RENAME TO record_data_classification;
  END IF;
END $$;

DO $$
BEGIN
  CREATE TYPE network_asset_lifecycle AS ENUM ('planned', 'active', 'retired');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE network_asset_status AS ENUM (
    'operational', 'maintenance', 'decommissioned', 'unknown'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE control_structure_kind AS ENUM ('weir', 'gate', 'sluice', 'pump', 'check_dam', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE telemetry_device_protocol AS ENUM ('mqtt', 'opc_ua', 'modbus', 'scada', 'manual');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE sensor_measurement_kind AS ENUM ('stage', 'discharge', 'accumulated_volume');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Uses every vertex, not a planar distance heuristic. The geometries below
-- are constrained to SRID 4326, so longitude/latitude bounds are meaningful.
CREATE OR REPLACE FUNCTION network_wgs84_coordinates_in_bounds(candidate geometry)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM ST_DumpPoints(candidate) AS point
    WHERE ST_X(point.geom) < -180 OR ST_X(point.geom) > 180
       OR ST_Y(point.geom) < -90 OR ST_Y(point.geom) > 90
  );
$$;

CREATE TABLE IF NOT EXISTS water_regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  lifecycle network_asset_lifecycle NOT NULL DEFAULT 'active',
  status network_asset_status NOT NULL DEFAULT 'operational',
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  geometry geometry(MultiPolygon, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT water_regions_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT water_regions_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT water_regions_geometry_valid CHECK (
    geometry IS NULL OR (
      ST_IsValid(geometry) AND NOT ST_IsEmpty(geometry)
      AND network_wgs84_coordinates_in_bounds(geometry)
    )
  ),
  CONSTRAINT water_regions_territory_same_organization FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories (organization_id, id),
  CONSTRAINT water_regions_organization_code_unique UNIQUE (organization_id, code),
  CONSTRAINT water_regions_organization_id_unique UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS water_basins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  region_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  lifecycle network_asset_lifecycle NOT NULL DEFAULT 'active',
  status network_asset_status NOT NULL DEFAULT 'operational',
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  geometry geometry(MultiPolygon, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT water_basins_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT water_basins_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT water_basins_geometry_valid CHECK (
    geometry IS NULL OR (
      ST_IsValid(geometry) AND NOT ST_IsEmpty(geometry)
      AND network_wgs84_coordinates_in_bounds(geometry)
    )
  ),
  CONSTRAINT water_basins_territory_same_organization FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories (organization_id, id),
  CONSTRAINT water_basins_region_same_organization FOREIGN KEY (organization_id, region_id)
    REFERENCES water_regions (organization_id, id),
  CONSTRAINT water_basins_organization_code_unique UNIQUE (organization_id, code),
  CONSTRAINT water_basins_organization_id_unique UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS waterways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  basin_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  lifecycle network_asset_lifecycle NOT NULL DEFAULT 'active',
  status network_asset_status NOT NULL DEFAULT 'operational',
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  geometry geometry(LineString, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waterways_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT waterways_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT waterways_geometry_valid CHECK (
    geometry IS NULL OR (
      ST_IsValid(geometry) AND NOT ST_IsEmpty(geometry)
      AND network_wgs84_coordinates_in_bounds(geometry)
    )
  ),
  CONSTRAINT waterways_territory_same_organization FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories (organization_id, id),
  CONSTRAINT waterways_basin_same_organization FOREIGN KEY (organization_id, basin_id)
    REFERENCES water_basins (organization_id, id),
  CONSTRAINT waterways_organization_code_unique UNIQUE (organization_id, code),
  CONSTRAINT waterways_organization_id_unique UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS network_junctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  lifecycle network_asset_lifecycle NOT NULL DEFAULT 'active',
  status network_asset_status NOT NULL DEFAULT 'operational',
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  geometry geometry(Point, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT network_junctions_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT network_junctions_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT network_junctions_geometry_valid CHECK (
    geometry IS NULL OR (
      ST_IsValid(geometry) AND NOT ST_IsEmpty(geometry)
      AND network_wgs84_coordinates_in_bounds(geometry)
    )
  ),
  CONSTRAINT network_junctions_territory_same_organization FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories (organization_id, id),
  CONSTRAINT network_junctions_organization_code_unique UNIQUE (organization_id, code),
  CONSTRAINT network_junctions_organization_id_unique UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS water_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  waterway_id uuid,
  upstream_junction_id uuid NOT NULL,
  downstream_junction_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  lifecycle network_asset_lifecycle NOT NULL DEFAULT 'active',
  status network_asset_status NOT NULL DEFAULT 'operational',
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  geometry geometry(LineString, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT water_sections_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT water_sections_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT water_sections_distinct_junctions CHECK (upstream_junction_id <> downstream_junction_id),
  CONSTRAINT water_sections_geometry_valid CHECK (
    geometry IS NULL OR (
      ST_IsValid(geometry) AND NOT ST_IsEmpty(geometry)
      AND network_wgs84_coordinates_in_bounds(geometry)
    )
  ),
  CONSTRAINT water_sections_territory_same_organization FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories (organization_id, id),
  CONSTRAINT water_sections_waterway_same_organization FOREIGN KEY (organization_id, waterway_id)
    REFERENCES waterways (organization_id, id),
  CONSTRAINT water_sections_upstream_same_organization FOREIGN KEY (organization_id, upstream_junction_id)
    REFERENCES network_junctions (organization_id, id),
  CONSTRAINT water_sections_downstream_same_organization FOREIGN KEY (organization_id, downstream_junction_id)
    REFERENCES network_junctions (organization_id, id),
  CONSTRAINT water_sections_organization_code_unique UNIQUE (organization_id, code),
  CONSTRAINT water_sections_organization_id_unique UNIQUE (organization_id, id)
);

-- Sections are the sole authoritative directed topology edges. There is no
-- duplicate topology table to drift out of sync with the physical network.

CREATE TABLE IF NOT EXISTS control_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  section_id uuid,
  junction_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  kind control_structure_kind NOT NULL,
  lifecycle network_asset_lifecycle NOT NULL DEFAULT 'active',
  status network_asset_status NOT NULL DEFAULT 'operational',
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  geometry geometry(Point, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_structures_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT control_structures_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT control_structures_geometry_valid CHECK (
    geometry IS NULL OR (
      ST_IsValid(geometry) AND NOT ST_IsEmpty(geometry)
      AND network_wgs84_coordinates_in_bounds(geometry)
    )
  ),
  CONSTRAINT control_structures_attaches_to_one_network_feature CHECK (
    num_nonnulls(section_id, junction_id) = 1
  ),
  CONSTRAINT control_structures_territory_same_organization FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories (organization_id, id),
  CONSTRAINT control_structures_section_same_organization FOREIGN KEY (organization_id, section_id)
    REFERENCES water_sections (organization_id, id),
  CONSTRAINT control_structures_junction_same_organization FOREIGN KEY (organization_id, junction_id)
    REFERENCES network_junctions (organization_id, id),
  CONSTRAINT control_structures_organization_code_unique UNIQUE (organization_id, code),
  CONSTRAINT control_structures_organization_id_unique UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS monitoring_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  section_id uuid,
  junction_id uuid,
  control_structure_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  lifecycle network_asset_lifecycle NOT NULL DEFAULT 'active',
  status network_asset_status NOT NULL DEFAULT 'operational',
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  geometry geometry(Point, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT monitoring_stations_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT monitoring_stations_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT monitoring_stations_geometry_valid CHECK (
    geometry IS NULL OR (
      ST_IsValid(geometry) AND NOT ST_IsEmpty(geometry)
      AND network_wgs84_coordinates_in_bounds(geometry)
    )
  ),
  CONSTRAINT monitoring_stations_attaches_to_one_network_feature CHECK (
    num_nonnulls(section_id, junction_id, control_structure_id) = 1
  ),
  CONSTRAINT monitoring_stations_territory_same_organization FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories (organization_id, id),
  CONSTRAINT monitoring_stations_section_same_organization FOREIGN KEY (organization_id, section_id)
    REFERENCES water_sections (organization_id, id),
  CONSTRAINT monitoring_stations_junction_same_organization FOREIGN KEY (organization_id, junction_id)
    REFERENCES network_junctions (organization_id, id),
  CONSTRAINT monitoring_stations_control_structure_same_organization
    FOREIGN KEY (organization_id, control_structure_id)
    REFERENCES control_structures (organization_id, id),
  CONSTRAINT monitoring_stations_organization_code_unique UNIQUE (organization_id, code),
  CONSTRAINT monitoring_stations_organization_id_unique UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS telemetry_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  protocol telemetry_device_protocol NOT NULL,
  lifecycle network_asset_lifecycle NOT NULL DEFAULT 'active',
  status network_asset_status NOT NULL DEFAULT 'operational',
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telemetry_devices_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT telemetry_devices_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT telemetry_devices_territory_same_organization FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories (organization_id, id),
  CONSTRAINT telemetry_devices_organization_code_unique UNIQUE (organization_id, code),
  CONSTRAINT telemetry_devices_organization_id_unique UNIQUE (organization_id, id)
);

-- An installation is temporal provenance, not a mutable device location. A
-- relocation closes one validity window and opens another.
CREATE TABLE IF NOT EXISTS telemetry_device_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  device_id uuid NOT NULL,
  station_id uuid NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  provenance text NOT NULL,
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telemetry_device_installations_effective_window CHECK (
    effective_until IS NULL OR effective_until > effective_from
  ),
  CONSTRAINT telemetry_device_installations_provenance_not_blank CHECK (btrim(provenance) <> ''),
  CONSTRAINT telemetry_device_installations_territory_same_organization
    FOREIGN KEY (organization_id, territory_id) REFERENCES territories (organization_id, id),
  CONSTRAINT telemetry_device_installations_device_same_organization
    FOREIGN KEY (organization_id, device_id) REFERENCES telemetry_devices (organization_id, id),
  CONSTRAINT telemetry_device_installations_station_same_organization
    FOREIGN KEY (organization_id, station_id) REFERENCES monitoring_stations (organization_id, id),
  CONSTRAINT telemetry_device_installations_effective_non_overlap EXCLUDE USING gist (
    device_id WITH =,
    tstzrange(effective_from, effective_until, '[)') WITH &&
  )
);

CREATE TABLE IF NOT EXISTS telemetry_sensors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  device_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  measurement_kind sensor_measurement_kind NOT NULL,
  unit text NOT NULL,
  lifecycle network_asset_lifecycle NOT NULL DEFAULT 'active',
  status network_asset_status NOT NULL DEFAULT 'operational',
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telemetry_sensors_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT telemetry_sensors_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT telemetry_sensors_measurement_unit CHECK (
    (measurement_kind = 'stage' AND unit = 'm')
    OR (measurement_kind = 'discharge' AND unit = 'm3/s')
    OR (measurement_kind = 'accumulated_volume' AND unit = 'm3')
  ),
  CONSTRAINT telemetry_sensors_territory_same_organization FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories (organization_id, id),
  CONSTRAINT telemetry_sensors_device_same_organization FOREIGN KEY (organization_id, device_id)
    REFERENCES telemetry_devices (organization_id, id),
  CONSTRAINT telemetry_sensors_organization_code_unique UNIQUE (organization_id, code),
  CONSTRAINT telemetry_sensors_organization_id_unique UNIQUE (organization_id, id)
);

CREATE INDEX IF NOT EXISTS water_regions_geometry_gix ON water_regions USING gist (geometry);
CREATE INDEX IF NOT EXISTS water_basins_geometry_gix ON water_basins USING gist (geometry);
CREATE INDEX IF NOT EXISTS waterways_geometry_gix ON waterways USING gist (geometry);
CREATE INDEX IF NOT EXISTS network_junctions_geometry_gix ON network_junctions USING gist (geometry);
CREATE INDEX IF NOT EXISTS water_sections_geometry_gix ON water_sections USING gist (geometry);
CREATE INDEX IF NOT EXISTS control_structures_geometry_gix ON control_structures USING gist (geometry);
CREATE INDEX IF NOT EXISTS monitoring_stations_geometry_gix ON monitoring_stations USING gist (geometry);
CREATE INDEX IF NOT EXISTS telemetry_device_installations_current_idx
  ON telemetry_device_installations (device_id, effective_from, effective_until);
CREATE OR REPLACE FUNCTION reject_network_asset_code_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'network asset code is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS water_regions_code_immutable ON water_regions;
CREATE TRIGGER water_regions_code_immutable BEFORE UPDATE OF code ON water_regions
  FOR EACH ROW EXECUTE FUNCTION reject_network_asset_code_change();
DROP TRIGGER IF EXISTS water_basins_code_immutable ON water_basins;
CREATE TRIGGER water_basins_code_immutable BEFORE UPDATE OF code ON water_basins
  FOR EACH ROW EXECUTE FUNCTION reject_network_asset_code_change();
DROP TRIGGER IF EXISTS waterways_code_immutable ON waterways;
CREATE TRIGGER waterways_code_immutable BEFORE UPDATE OF code ON waterways
  FOR EACH ROW EXECUTE FUNCTION reject_network_asset_code_change();
DROP TRIGGER IF EXISTS network_junctions_code_immutable ON network_junctions;
CREATE TRIGGER network_junctions_code_immutable BEFORE UPDATE OF code ON network_junctions
  FOR EACH ROW EXECUTE FUNCTION reject_network_asset_code_change();
DROP TRIGGER IF EXISTS water_sections_code_immutable ON water_sections;
CREATE TRIGGER water_sections_code_immutable BEFORE UPDATE OF code ON water_sections
  FOR EACH ROW EXECUTE FUNCTION reject_network_asset_code_change();
DROP TRIGGER IF EXISTS control_structures_code_immutable ON control_structures;
CREATE TRIGGER control_structures_code_immutable BEFORE UPDATE OF code ON control_structures
  FOR EACH ROW EXECUTE FUNCTION reject_network_asset_code_change();
DROP TRIGGER IF EXISTS monitoring_stations_code_immutable ON monitoring_stations;
CREATE TRIGGER monitoring_stations_code_immutable BEFORE UPDATE OF code ON monitoring_stations
  FOR EACH ROW EXECUTE FUNCTION reject_network_asset_code_change();
DROP TRIGGER IF EXISTS telemetry_devices_code_immutable ON telemetry_devices;
CREATE TRIGGER telemetry_devices_code_immutable BEFORE UPDATE OF code ON telemetry_devices
  FOR EACH ROW EXECUTE FUNCTION reject_network_asset_code_change();
DROP TRIGGER IF EXISTS telemetry_sensors_code_immutable ON telemetry_sensors;
CREATE TRIGGER telemetry_sensors_code_immutable BEFORE UPDATE OF code ON telemetry_sensors
  FOR EACH ROW EXECUTE FUNCTION reject_network_asset_code_change();

-- A directed cycle makes upstream/downstream accounting and travel-time
-- propagation non-deterministic.  Serialize topology mutations per organization
-- so a pair of concurrent reciprocal edges cannot both validate a stale graph.
CREATE OR REPLACE FUNCTION reject_network_topology_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text, 1));

  IF EXISTS (
    WITH RECURSIVE reachable(junction_id, path) AS (
      SELECT NEW.downstream_junction_id, ARRAY[NEW.downstream_junction_id]
      UNION ALL
      SELECT edge.downstream_junction_id, reachable.path || edge.downstream_junction_id
      FROM water_sections edge
      JOIN reachable ON edge.upstream_junction_id = reachable.junction_id
      WHERE edge.organization_id = NEW.organization_id
        AND edge.id IS DISTINCT FROM NEW.id
        AND NOT edge.downstream_junction_id = ANY(reachable.path)
    )
    SELECT 1 FROM reachable WHERE junction_id = NEW.upstream_junction_id
  ) THEN
    RAISE EXCEPTION 'network topology cycle is not permitted'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS water_sections_reject_cycle ON water_sections;
CREATE TRIGGER water_sections_reject_cycle
  BEFORE INSERT OR UPDATE OF organization_id, upstream_junction_id, downstream_junction_id
  ON water_sections
  FOR EACH ROW
  EXECUTE FUNCTION reject_network_topology_cycle();

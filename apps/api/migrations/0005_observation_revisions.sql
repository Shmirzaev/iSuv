DO $$
BEGIN
  CREATE TYPE observation_quality_state AS ENUM ('unknown', 'valid', 'suspect', 'invalid', 'estimated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE audit_event_resource ADD VALUE IF NOT EXISTS 'observation';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'observation.corrected';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'observation.rejected';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'observation.estimated';

DO $$
BEGIN
  CREATE TYPE observation_revision_state AS ENUM ('raw', 'automatically_validated', 'expert_validated', 'corrected', 'estimated', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE observation_totalizer_transition AS ENUM ('normal', 'reset_reported', 'rollover_reported', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS observation_lineages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  sensor_id uuid NOT NULL,
  device_id uuid NOT NULL,
  device_installation_id uuid NOT NULL,
  station_id uuid NOT NULL,
  measurement_kind sensor_measurement_kind NOT NULL,
  unit text NOT NULL,
  data_classification record_data_classification NOT NULL,
  source_system text NOT NULL,
  source_event_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT observation_lineages_source_event_bounded CHECK (btrim(source_event_id) <> '' AND length(source_event_id) <= 256),
  CONSTRAINT observation_lineages_source_system_bounded CHECK (btrim(source_system) <> '' AND length(source_system) <= 128),
  CONSTRAINT observation_lineages_territory_same_organization FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories (organization_id, id),
  CONSTRAINT observation_lineages_sensor_same_organization FOREIGN KEY (organization_id, sensor_id)
    REFERENCES telemetry_sensors (organization_id, id),
  CONSTRAINT observation_lineages_device_same_organization FOREIGN KEY (organization_id, device_id)
    REFERENCES telemetry_devices (organization_id, id),
  CONSTRAINT observation_lineages_installation_id_fk FOREIGN KEY (device_installation_id)
    REFERENCES telemetry_device_installations (id),
  CONSTRAINT observation_lineages_station_same_organization FOREIGN KEY (organization_id, station_id)
    REFERENCES monitoring_stations (organization_id, id),
  CONSTRAINT observation_lineages_source_identity_unique UNIQUE (organization_id, source_system, source_event_id)
);

CREATE TABLE IF NOT EXISTS observation_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lineage_id uuid NOT NULL REFERENCES observation_lineages(id),
  revision integer NOT NULL CHECK (revision >= 1),
  state observation_revision_state NOT NULL,
  quality_state observation_quality_state NOT NULL,
  quality_reason text,
  value numeric NOT NULL,
  unit text NOT NULL,
  uncertainty numeric,
  uncertainty_method text,
  uncertainty_confidence numeric,
  provenance text NOT NULL,
  data_classification record_data_classification NOT NULL,
  correction_reason text,
  totalizer_transition observation_totalizer_transition,
  measurement_method text,
  raw_payload_ref text,
  raw_payload_hash text,
  calibration_ref text,
  rating_curve_ref text,
  -- Receipt time must advance inside an outer test/import transaction; transaction-start now()
  -- cannot distinguish as-of revision boundaries.
  ingested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT observation_revisions_lineage_revision_unique UNIQUE (lineage_id, revision),
  CONSTRAINT observation_revisions_unit_not_blank CHECK (btrim(unit) <> ''),
  CONSTRAINT observation_revisions_provenance_bounded CHECK (btrim(provenance) <> '' AND length(provenance) <= 256),
  -- These are technical representation limits, not hydrological plausibility thresholds.
  CONSTRAINT observation_revisions_value_finite_precision CHECK (value > -1000000000000000000::numeric AND value < 1000000000000000000::numeric AND scale(value) <= 12),
  CONSTRAINT observation_revisions_uncertainty_finite_precision CHECK (uncertainty IS NULL OR (uncertainty >= 0 AND uncertainty < 1000000000000000000::numeric AND scale(uncertainty) <= 12)),
  CONSTRAINT observation_revisions_uncertainty_metadata CHECK (
    (uncertainty IS NULL AND uncertainty_method IS NULL AND uncertainty_confidence IS NULL)
    OR (uncertainty IS NOT NULL AND uncertainty_method IS NOT NULL AND btrim(uncertainty_method) <> '' AND length(uncertainty_method) <= 256
      AND (uncertainty_confidence IS NULL OR (uncertainty_confidence >= 0 AND uncertainty_confidence <= 1 AND scale(uncertainty_confidence) <= 12)))
  ),
  CONSTRAINT observation_revisions_raw_payload_ref_bounded CHECK (raw_payload_ref IS NULL OR (btrim(raw_payload_ref) <> '' AND length(raw_payload_ref) <= 512)),
  CONSTRAINT observation_revisions_raw_payload_hash_sha256 CHECK (raw_payload_hash IS NULL OR raw_payload_hash ~* '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT observation_revisions_reference_lengths CHECK (
    (measurement_method IS NULL OR (btrim(measurement_method) <> '' AND length(measurement_method) <= 256)) AND
    (calibration_ref IS NULL OR (btrim(calibration_ref) <> '' AND length(calibration_ref) <= 512)) AND
    (rating_curve_ref IS NULL OR (btrim(rating_curve_ref) <> '' AND length(rating_curve_ref) <= 512))
  ),
  CONSTRAINT observation_revisions_reason_lengths CHECK (
    (quality_reason IS NULL OR (btrim(quality_reason) <> '' AND length(quality_reason) <= 1000)) AND
    (correction_reason IS NULL OR (btrim(correction_reason) <> '' AND length(correction_reason) <= 1000))
  ),
  CONSTRAINT observation_revisions_quality_reason_required CHECK (
    quality_state = 'valid' OR quality_reason IS NOT NULL
  ),
  CONSTRAINT observation_revisions_human_reason_required CHECK (
    state NOT IN ('corrected', 'estimated', 'rejected') OR correction_reason IS NOT NULL
  ),
  CONSTRAINT observation_revisions_rejected_invalid CHECK (
    state <> 'rejected' OR quality_state = 'invalid'
  ),
  CONSTRAINT observation_revisions_estimated_invariants CHECK (
    (state = 'estimated') = (quality_state = 'estimated')
  ),
  CONSTRAINT observation_revisions_estimated_evidence CHECK (
    state <> 'estimated' OR (uncertainty IS NOT NULL AND uncertainty_method IS NOT NULL AND measurement_method IS NOT NULL AND btrim(measurement_method) <> '')
  ),
  CONSTRAINT observation_revisions_raw_unreliable CHECK (
    state <> 'raw' OR (quality_state IN ('unknown', 'suspect', 'invalid') AND quality_reason IS NOT NULL AND measurement_method IS NOT NULL AND btrim(measurement_method) <> '')
  ),
  CONSTRAINT observation_revisions_raw_snapshot_pair CHECK (
    (raw_payload_ref IS NULL) = (raw_payload_hash IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS observation_lineages_sensor_observed_idx
  ON observation_lineages (sensor_id, observed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS observation_lineages_territory_observed_idx
  ON observation_lineages (territory_id, observed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS observation_revisions_lineage_ingested_idx
  ON observation_revisions (lineage_id, ingested_at DESC, revision DESC);

CREATE OR REPLACE FUNCTION validate_observation_lineage_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sensor_device_id uuid;
  sensor_territory_id uuid;
  installation_device_id uuid;
  installation_territory_id uuid;
  installation_from timestamptz;
  installation_until timestamptz;
  installation_station_id uuid;
  installation_classification record_data_classification;
  device_territory_id uuid;
  device_classification record_data_classification;
  station_territory_id uuid;
  station_classification record_data_classification;
  sensor_kind sensor_measurement_kind;
  sensor_unit text;
  sensor_classification record_data_classification;
BEGIN
  SELECT device_id, territory_id, measurement_kind, unit, data_classification
    INTO sensor_device_id, sensor_territory_id, sensor_kind, sensor_unit, sensor_classification
  FROM telemetry_sensors WHERE id = NEW.sensor_id AND organization_id = NEW.organization_id;
  SELECT device_id, territory_id, station_id, effective_from, effective_until, data_classification
    INTO installation_device_id, installation_territory_id, installation_station_id, installation_from, installation_until, installation_classification
  FROM telemetry_device_installations
  WHERE id = NEW.device_installation_id AND organization_id = NEW.organization_id;
  SELECT territory_id, data_classification INTO device_territory_id, device_classification
  FROM telemetry_devices WHERE id = NEW.device_id AND organization_id = NEW.organization_id;
  SELECT territory_id, data_classification INTO station_territory_id, station_classification
  FROM monitoring_stations WHERE id = NEW.station_id AND organization_id = NEW.organization_id;
  IF sensor_device_id IS NULL OR installation_device_id IS NULL
     OR device_territory_id IS NULL OR station_territory_id IS NULL
     OR NEW.device_id <> sensor_device_id OR NEW.device_id <> installation_device_id
     OR NEW.territory_id <> installation_territory_id OR NEW.territory_id <> station_territory_id
     OR NEW.station_id <> installation_station_id OR NEW.measurement_kind <> sensor_kind
     OR NEW.unit <> sensor_unit OR NEW.data_classification <> sensor_classification OR NEW.data_classification <> installation_classification
     OR NEW.data_classification <> device_classification OR NEW.data_classification <> station_classification
     OR NEW.observed_at < installation_from
     OR (installation_until IS NOT NULL AND NEW.observed_at >= installation_until) THEN
    RAISE EXCEPTION 'observation lineage sensor, device, installation, territory, and observed time must agree'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_observation_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_revision integer;
  expected_kind sensor_measurement_kind;
  original_raw_payload_ref text;
  original_raw_payload_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.lineage_id::text, 2));
  SELECT COALESCE(MAX(revision), 0) + 1 INTO expected_revision
  FROM observation_revisions WHERE lineage_id = NEW.lineage_id;
  IF NEW.revision <> expected_revision THEN
    RAISE EXCEPTION 'observation revisions must be appended in deterministic order'
      USING ERRCODE = '23514';
  END IF;
  SELECT measurement_kind INTO expected_kind FROM observation_lineages WHERE id = NEW.lineage_id;
  IF NEW.unit <> (SELECT unit FROM observation_lineages WHERE id = NEW.lineage_id)
     OR NEW.data_classification <> (SELECT data_classification FROM observation_lineages WHERE id = NEW.lineage_id) THEN
    RAISE EXCEPTION 'observation unit and classification must match the source sensor'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.revision = 1 AND NEW.state <> 'raw' THEN
    RAISE EXCEPTION 'the original observation revision must be raw' USING ERRCODE = '23514';
  END IF;
  IF NEW.revision > 1 AND NEW.state = 'raw' THEN
    RAISE EXCEPTION 'only the original observation revision may be raw' USING ERRCODE = '23514';
  END IF;
  IF NEW.revision > 1 THEN
    SELECT raw_payload_ref, raw_payload_hash INTO original_raw_payload_ref, original_raw_payload_hash
    FROM observation_revisions WHERE lineage_id = NEW.lineage_id AND revision = 1;
    IF NEW.raw_payload_ref IS DISTINCT FROM original_raw_payload_ref
       OR NEW.raw_payload_hash IS DISTINCT FROM original_raw_payload_hash THEN
      RAISE EXCEPTION 'raw source evidence is immutable across observation revisions' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF expected_kind = 'accumulated_volume' AND (NEW.value < 0 OR NEW.totalizer_transition IS NULL) THEN
    RAISE EXCEPTION 'accumulated volume requires a nonnegative counter and transition state' USING ERRCODE = '23514';
  END IF;
  IF expected_kind <> 'accumulated_volume' AND NEW.totalizer_transition IS NOT NULL THEN
    RAISE EXCEPTION 'only accumulated volume has a totalizer transition' USING ERRCODE = '23514';
  END IF;
  IF expected_kind = 'stage' AND NEW.unit <> 'm'
     OR expected_kind = 'discharge' AND NEW.unit <> 'm3/s'
     OR expected_kind = 'accumulated_volume' AND NEW.unit <> 'm3' THEN
    RAISE EXCEPTION 'observation unit must agree with quantity kind' USING ERRCODE = '23514';
  END IF;
  IF expected_kind <> 'stage' AND NEW.rating_curve_ref IS NOT NULL THEN
    RAISE EXCEPTION 'rating curve references are only relevant to stage observations' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION reject_observation_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'observation lineage and revisions are append-only' USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS observation_lineages_validate_provenance ON observation_lineages;
CREATE TRIGGER observation_lineages_validate_provenance
  BEFORE INSERT ON observation_lineages FOR EACH ROW
  EXECUTE FUNCTION validate_observation_lineage_provenance();
DROP TRIGGER IF EXISTS observation_revisions_validate ON observation_revisions;
CREATE TRIGGER observation_revisions_validate
  BEFORE INSERT ON observation_revisions FOR EACH ROW
  EXECUTE FUNCTION validate_observation_revision();
DROP TRIGGER IF EXISTS observation_lineages_append_only ON observation_lineages;
CREATE TRIGGER observation_lineages_append_only
  BEFORE UPDATE OR DELETE ON observation_lineages FOR EACH ROW
  EXECUTE FUNCTION reject_observation_history_mutation();
DROP TRIGGER IF EXISTS observation_revisions_append_only ON observation_revisions;
CREATE TRIGGER observation_revisions_append_only
  BEFORE UPDATE OR DELETE ON observation_revisions FOR EACH ROW
  EXECUTE FUNCTION reject_observation_history_mutation();

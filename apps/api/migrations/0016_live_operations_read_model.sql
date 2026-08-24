-- Immutable synthetic operational read-model fixture.  It is deliberately
-- separate from reporting fixtures and canonical observation/health streams.
CREATE TABLE IF NOT EXISTS live_operations_synthetic_scenarios (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), territory_id uuid NOT NULL REFERENCES territories(id),
  version integer NOT NULL CHECK(version > 0), reference_at timestamptz NOT NULL, known_at timestamptz NOT NULL,
  presentation_time_zone text NOT NULL CHECK(presentation_time_zone='Asia/Tashkent'), provenance text NOT NULL CHECK(btrim(provenance)<>''),
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic', official_telemetry boolean NOT NULL DEFAULT false,
  CHECK(data_classification='synthetic' AND NOT official_telemetry AND known_at>=reference_at), UNIQUE(organization_id, territory_id, version)
);
CREATE TABLE IF NOT EXISTS live_operations_synthetic_rows (
  scenario_id uuid NOT NULL REFERENCES live_operations_synthetic_scenarios(id), station_id uuid NOT NULL REFERENCES monitoring_stations(id),
  device_id uuid NOT NULL REFERENCES telemetry_devices(id), installation_id uuid NOT NULL REFERENCES telemetry_device_installations(id),
  territory_id uuid NOT NULL REFERENCES territories(id), data_state text NOT NULL CHECK(data_state IN('reported','unreliable','no_data')),
  connection_status device_connection_status NOT NULL, device_fault text NOT NULL CHECK(device_fault IN('reported','none','unknown')),
  fault_code text, stage_m numeric(20,6), discharge_m3s numeric(20,6), counter_m3 numeric(20,6),
  observed_at timestamptz, ingested_at timestamptz, last_seen_received_at timestamptz, power_voltage numeric, signal_strength_dbm numeric,
  provenance text NOT NULL CHECK(btrim(provenance)<>''), PRIMARY KEY(scenario_id,station_id), UNIQUE(scenario_id,device_id),
  CHECK((data_state='no_data' AND stage_m IS NULL AND discharge_m3s IS NULL AND counter_m3 IS NULL AND observed_at IS NULL) OR (data_state<>'no_data' AND stage_m IS NOT NULL AND discharge_m3s IS NOT NULL AND counter_m3 IS NOT NULL AND observed_at IS NOT NULL)),
  CHECK((device_fault='reported' AND fault_code IS NOT NULL) OR (device_fault<>'reported' AND fault_code IS NULL))
);
-- Per-quantity state is retained even where the compact list fixture has the
-- same state for all three values.  This avoids ever treating an absent stage
-- as an absent counter (or vice versa) in future scenario versions.
ALTER TABLE live_operations_synthetic_rows ADD COLUMN IF NOT EXISTS stage_data_state text;
ALTER TABLE live_operations_synthetic_rows ADD COLUMN IF NOT EXISTS discharge_data_state text;
ALTER TABLE live_operations_synthetic_rows ADD COLUMN IF NOT EXISTS counter_data_state text;
UPDATE live_operations_synthetic_rows SET
 stage_data_state=COALESCE(stage_data_state,data_state),
 discharge_data_state=COALESCE(discharge_data_state,data_state),
 counter_data_state=COALESCE(counter_data_state,data_state)
WHERE stage_data_state IS NULL OR discharge_data_state IS NULL OR counter_data_state IS NULL;
ALTER TABLE live_operations_synthetic_rows ALTER COLUMN stage_data_state SET NOT NULL;
ALTER TABLE live_operations_synthetic_rows ALTER COLUMN discharge_data_state SET NOT NULL;
ALTER TABLE live_operations_synthetic_rows ALTER COLUMN counter_data_state SET NOT NULL;
ALTER TABLE live_operations_synthetic_rows DROP CONSTRAINT IF EXISTS live_operations_synthetic_rows_check;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='live_ops_stage_state_ck') THEN ALTER TABLE live_operations_synthetic_rows ADD CONSTRAINT live_ops_stage_state_ck CHECK(stage_data_state IN('reported','unreliable','no_data')); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='live_ops_discharge_state_ck') THEN ALTER TABLE live_operations_synthetic_rows ADD CONSTRAINT live_ops_discharge_state_ck CHECK(discharge_data_state IN('reported','unreliable','no_data')); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='live_ops_counter_state_ck') THEN ALTER TABLE live_operations_synthetic_rows ADD CONSTRAINT live_ops_counter_state_ck CHECK(counter_data_state IN('reported','unreliable','no_data')); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='live_ops_quantity_presence_ck') THEN ALTER TABLE live_operations_synthetic_rows ADD CONSTRAINT live_ops_quantity_presence_ck CHECK((stage_data_state='no_data')=(stage_m IS NULL) AND (discharge_data_state='no_data')=(discharge_m3s IS NULL) AND (counter_data_state='no_data')=(counter_m3 IS NULL) AND ((stage_m IS NOT NULL OR discharge_m3s IS NOT NULL OR counter_m3 IS NOT NULL)=(observed_at IS NOT NULL AND ingested_at IS NOT NULL))); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='live_ops_overall_state_ck') THEN ALTER TABLE live_operations_synthetic_rows ADD CONSTRAINT live_ops_overall_state_ck CHECK(data_state=(CASE WHEN stage_data_state='no_data' OR discharge_data_state='no_data' OR counter_data_state='no_data' THEN 'no_data' WHEN stage_data_state='unreliable' OR discharge_data_state='unreliable' OR counter_data_state='unreliable' THEN 'unreliable' ELSE 'reported' END)); END IF;
END $$;
CREATE TABLE IF NOT EXISTS live_operations_synthetic_trend_points (
 scenario_id uuid NOT NULL REFERENCES live_operations_synthetic_scenarios(id), station_id uuid NOT NULL REFERENCES monitoring_stations(id), sensor_kind sensor_measurement_kind NOT NULL,
 point_at timestamptz NOT NULL, raw_value numeric, validated_value numeric, gap boolean NOT NULL DEFAULT false, provenance text NOT NULL CHECK(btrim(provenance)<>''),
 PRIMARY KEY(scenario_id,station_id,sensor_kind,point_at), CHECK((gap AND raw_value IS NULL AND validated_value IS NULL) OR (NOT gap AND raw_value IS NOT NULL)),
 CHECK(sensor_kind='stage')
);
CREATE INDEX IF NOT EXISTS live_operations_synthetic_scope_idx ON live_operations_synthetic_rows(scenario_id,territory_id,station_id);
CREATE OR REPLACE FUNCTION live_operations_synthetic_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'live operations synthetic fixtures are immutable' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS live_operations_synthetic_scenarios_immutable ON live_operations_synthetic_scenarios;
CREATE TRIGGER live_operations_synthetic_scenarios_immutable BEFORE UPDATE OR DELETE ON live_operations_synthetic_scenarios FOR EACH ROW EXECUTE FUNCTION live_operations_synthetic_immutable();
DROP TRIGGER IF EXISTS live_operations_synthetic_rows_immutable ON live_operations_synthetic_rows;
CREATE TRIGGER live_operations_synthetic_rows_immutable BEFORE UPDATE OR DELETE ON live_operations_synthetic_rows FOR EACH ROW EXECUTE FUNCTION live_operations_synthetic_immutable();
DROP TRIGGER IF EXISTS live_operations_synthetic_trend_immutable ON live_operations_synthetic_trend_points;
CREATE TRIGGER live_operations_synthetic_trend_immutable BEFORE UPDATE OR DELETE ON live_operations_synthetic_trend_points FOR EACH ROW EXECUTE FUNCTION live_operations_synthetic_immutable();

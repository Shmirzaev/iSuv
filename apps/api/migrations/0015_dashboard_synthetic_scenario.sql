-- Immutable, explicitly synthetic dashboard reporting fixture. It is a
-- narrow read model: no raw telemetry, allocation, balance, alarm, incident,
-- notification, forecast, or physical-control record is created here.
CREATE TABLE IF NOT EXISTS dashboard_synthetic_scenarios (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL REFERENCES territories(id),
  version integer NOT NULL CHECK(version > 0),
  reference_at timestamptz NOT NULL,
  known_at timestamptz NOT NULL,
  presentation_time_zone text NOT NULL CHECK(presentation_time_zone = 'Asia/Tashkent'),
  provenance text NOT NULL CHECK(btrim(provenance) <> ''),
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  official_compliance_eligible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(data_classification = 'synthetic' AND NOT official_compliance_eligible),
  CHECK(known_at >= reference_at),
  UNIQUE(organization_id, territory_id, version)
);

CREATE TABLE IF NOT EXISTS dashboard_synthetic_reporting_rows (
  scenario_id uuid NOT NULL REFERENCES dashboard_synthetic_scenarios(id),
  hotspot_code text NOT NULL CHECK(hotspot_code ~ '^SYN-HOTSPOT-[0-9]{3}$'),
  territory_id uuid NOT NULL REFERENCES territories(id),
  station_id uuid NOT NULL REFERENCES monitoring_stations(id),
  device_id uuid NOT NULL REFERENCES telemetry_devices(id),
  period text NOT NULL CHECK(period IN ('today','week','month','season','year')),
  metric_role text NOT NULL CHECK(metric_role IN ('regional_ingress_member','delivery_member','none')),
  data_state text NOT NULL CHECK(data_state IN ('reported','no_data','unreliable','unconfigured')),
  quality text NOT NULL CHECK(quality IN ('valid','unreliable','no_data','unconfigured')),
  inflow_m3s numeric(20,6),
  planned_m3 numeric(20,6),
  actual_m3 numeric(20,6),
  prior_actual_m3 numeric(20,6),
  active_critical_alarm boolean NOT NULL DEFAULT false,
  PRIMARY KEY(scenario_id, period, station_id),
  UNIQUE(scenario_id, period, device_id),
  CHECK((data_state = 'reported' AND quality = 'valid') OR
        (data_state = 'no_data' AND quality = 'no_data') OR
        (data_state = 'unreliable' AND quality = 'unreliable') OR
        (data_state = 'unconfigured' AND quality = 'unconfigured')),
  CHECK((data_state = 'reported' AND inflow_m3s IS NOT NULL AND inflow_m3s >= 0) OR
        (data_state <> 'reported' AND inflow_m3s IS NULL)),
  CHECK((planned_m3 IS NULL AND actual_m3 IS NULL AND prior_actual_m3 IS NULL) OR
        (data_state = 'reported' AND metric_role = 'delivery_member' AND planned_m3 >= 0 AND actual_m3 >= 0 AND prior_actual_m3 >= 0)),
  CHECK((metric_role = 'regional_ingress_member' AND data_state = 'reported' AND inflow_m3s IS NOT NULL) OR metric_role <> 'regional_ingress_member')
);
-- `0015` was first introduced with one row per asset.  The replay-safe
-- upgrade makes every value's reporting interval an immutable primary-key
-- dimension, so an old daily fixture can never be relabelled as a week/month.
ALTER TABLE dashboard_synthetic_reporting_rows
  ADD COLUMN IF NOT EXISTS period text NOT NULL DEFAULT 'today'
  CHECK(period IN ('today','week','month','season','year'));
ALTER TABLE dashboard_synthetic_reporting_rows
  DROP CONSTRAINT IF EXISTS dashboard_synthetic_reporting_rows_pkey;
ALTER TABLE dashboard_synthetic_reporting_rows
  ADD CONSTRAINT dashboard_synthetic_reporting_rows_pkey PRIMARY KEY(scenario_id, period, station_id);
ALTER TABLE dashboard_synthetic_reporting_rows
  DROP CONSTRAINT IF EXISTS dashboard_synthetic_reporting_rows_scenario_id_device_id_key;
ALTER TABLE dashboard_synthetic_reporting_rows
  DROP CONSTRAINT IF EXISTS dashboard_synthetic_reporting_rows_scenario_id_period_device_id;
ALTER TABLE dashboard_synthetic_reporting_rows
  DROP CONSTRAINT IF EXISTS dashboard_reporting_period_device_uq;
ALTER TABLE dashboard_synthetic_reporting_rows
  ADD CONSTRAINT dashboard_reporting_period_device_uq UNIQUE(scenario_id, period, device_id);
CREATE INDEX IF NOT EXISTS dashboard_synthetic_reporting_scope_idx
  ON dashboard_synthetic_reporting_rows(scenario_id, period, territory_id, station_id);

CREATE OR REPLACE FUNCTION dashboard_synthetic_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'dashboard synthetic reporting fixtures are immutable' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS dashboard_synthetic_scenarios_immutable ON dashboard_synthetic_scenarios;
CREATE TRIGGER dashboard_synthetic_scenarios_immutable
  BEFORE UPDATE OR DELETE ON dashboard_synthetic_scenarios
  FOR EACH ROW EXECUTE FUNCTION dashboard_synthetic_immutable();
DROP TRIGGER IF EXISTS dashboard_synthetic_reporting_rows_immutable ON dashboard_synthetic_reporting_rows;
CREATE TRIGGER dashboard_synthetic_reporting_rows_immutable
  BEFORE UPDATE OR DELETE ON dashboard_synthetic_reporting_rows
  FOR EACH ROW EXECUTE FUNCTION dashboard_synthetic_immutable();

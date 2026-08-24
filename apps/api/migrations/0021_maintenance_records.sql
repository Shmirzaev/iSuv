-- Bounded, synthetic-only maintenance history. This is an auditable record
-- of maintenance activity, not a work-order or a remote-control pathway.
ALTER TYPE audit_event_resource ADD VALUE IF NOT EXISTS 'maintenance_record';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'maintenance_record.created';

CREATE TABLE IF NOT EXISTS maintenance_records (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  device_id uuid NOT NULL REFERENCES telemetry_devices(id),
  record_version integer NOT NULL DEFAULT 1 CHECK(record_version = 1),
  maintenance_type text NOT NULL CHECK(maintenance_type IN ('inspection','preventive','corrective','calibration')),
  status text NOT NULL CHECK(status IN ('planned','scheduled','in_progress','completed','cancelled')),
  scheduled_start_at timestamptz NOT NULL,
  scheduled_end_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES identity_users(id),
  creation_reason text NOT NULL CHECK(btrim(creation_reason) <> ''),
  created_request_id text NOT NULL CHECK(btrim(created_request_id) <> ''),
  audit_event_id uuid NOT NULL UNIQUE REFERENCES audit_events(id),
  provenance text NOT NULL CHECK(btrim(provenance) <> ''),
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  official_record boolean NOT NULL DEFAULT false,
  CONSTRAINT maintenance_records_territory_same_organization FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories(organization_id, id),
  CHECK(data_classification = 'synthetic' AND NOT official_record),
  CHECK(scheduled_end_at > scheduled_start_at),
  CHECK(started_at IS NULL OR started_at >= scheduled_start_at),
  CHECK(completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at)),
  CHECK((status = 'completed') = (completed_at IS NOT NULL)),
  CHECK(status <> 'completed' OR started_at IS NOT NULL),
  CHECK(recorded_at >= created_at)
);

CREATE INDEX IF NOT EXISTS maintenance_records_device_history_idx
  ON maintenance_records(organization_id, territory_id, device_id, recorded_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.maintenance_record_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.telemetry_devices device
    WHERE device.id = NEW.device_id
      AND device.organization_id = NEW.organization_id
      AND device.territory_id = NEW.territory_id
  ) THEN
    RAISE EXCEPTION 'maintenance record device scope is invalid' USING ERRCODE = '23514';
  END IF;
  IF NEW.data_classification <> 'synthetic' OR NEW.official_record OR NEW.record_version <> 1 THEN
    RAISE EXCEPTION 'maintenance record must be synthetic immutable version one' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.audit_events audit
    WHERE audit.id = NEW.audit_event_id
      AND audit.organization_id = NEW.organization_id
      AND audit.territory_id = NEW.territory_id
      AND audit.actor_user_id = NEW.created_by_user_id
      AND audit.resource::text = 'maintenance_record'
      AND audit.action::text = 'maintenance_record.created'
      AND audit.resource_id = NEW.id
      AND audit.reason = NEW.creation_reason
      AND audit.request_id = NEW.created_request_id
      AND audit.occurred_at = NEW.recorded_at
      AND audit.data_classification = 'synthetic'
      AND audit.provenance = NEW.provenance
  ) THEN
    RAISE EXCEPTION 'maintenance record requires matching immutable audit event' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.maintenance_record_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'maintenance records are immutable; create a new audited record instead' USING ERRCODE = '23514';
END $$;

DROP TRIGGER IF EXISTS maintenance_records_validate ON maintenance_records;
CREATE TRIGGER maintenance_records_validate
  BEFORE INSERT ON maintenance_records
  FOR EACH ROW EXECUTE FUNCTION public.maintenance_record_validate();
DROP TRIGGER IF EXISTS maintenance_records_immutable ON maintenance_records;
CREATE TRIGGER maintenance_records_immutable
  BEFORE UPDATE OR DELETE ON maintenance_records
  FOR EACH ROW EXECUTE FUNCTION public.maintenance_record_immutable();

-- Device availability is a separate synthetic scenario dimension. It must not
-- be inferred from, or collapsed into, station measurement quality.
CREATE TABLE IF NOT EXISTS dashboard_synthetic_device_states (
  scenario_id uuid NOT NULL REFERENCES dashboard_synthetic_scenarios(id),
  period text NOT NULL CHECK(period IN ('today','week','month','season','year')),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  device_id uuid NOT NULL REFERENCES telemetry_devices(id),
  connection_state text NOT NULL CHECK(connection_state IN ('online','offline','unknown')),
  provenance text NOT NULL CHECK(btrim(provenance) <> ''),
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  official_telemetry boolean NOT NULL DEFAULT false,
  PRIMARY KEY(scenario_id, period, device_id),
  CONSTRAINT dashboard_synthetic_device_states_territory_same_organization FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories(organization_id, id),
  CHECK(data_classification = 'synthetic' AND NOT official_telemetry)
);

CREATE OR REPLACE FUNCTION public.dashboard_synthetic_device_state_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS(
    WITH RECURSIVE scenario AS (
      SELECT organization_id, territory_id
      FROM public.dashboard_synthetic_scenarios
      WHERE id = NEW.scenario_id
    ), descendants AS (
      SELECT territory_id AS id FROM scenario
      UNION ALL
      SELECT child.id
      FROM public.territories child
      JOIN descendants parent ON child.parent_territory_id = parent.id
    )
    SELECT 1
    FROM scenario
    JOIN descendants ON descendants.id = NEW.territory_id
    JOIN public.telemetry_devices device ON device.id = NEW.device_id
    WHERE scenario.organization_id = NEW.organization_id
      AND device.organization_id = NEW.organization_id
      AND device.territory_id = NEW.territory_id
  ) THEN
    RAISE EXCEPTION 'dashboard device state scope is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE INDEX IF NOT EXISTS dashboard_synthetic_device_states_scope_idx
  ON dashboard_synthetic_device_states(scenario_id, period, territory_id, device_id);
DROP TRIGGER IF EXISTS dashboard_synthetic_device_states_validate ON dashboard_synthetic_device_states;
CREATE TRIGGER dashboard_synthetic_device_states_validate
  BEFORE INSERT ON dashboard_synthetic_device_states
  FOR EACH ROW EXECUTE FUNCTION public.dashboard_synthetic_device_state_validate();
DROP TRIGGER IF EXISTS dashboard_synthetic_device_states_immutable ON dashboard_synthetic_device_states;
CREATE TRIGGER dashboard_synthetic_device_states_immutable
  BEFORE UPDATE OR DELETE ON dashboard_synthetic_device_states
  FOR EACH ROW EXECUTE FUNCTION public.dashboard_synthetic_immutable();

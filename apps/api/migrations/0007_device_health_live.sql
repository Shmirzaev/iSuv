-- Device-health is a separate, append-only operational fact stream.  It is
-- intentionally not an observation-quality state and never manufactures a
-- water quantity for an offline device.
DO $$ BEGIN
  CREATE TYPE device_connection_status AS ENUM ('communicating', 'offline', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'telemetry_device_installations'::regclass
      AND conname = 'telemetry_device_installations_organization_id_unique'
  ) THEN
    ALTER TABLE telemetry_device_installations
      ADD CONSTRAINT telemetry_device_installations_organization_id_unique UNIQUE (organization_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS device_health_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  device_id uuid NOT NULL,
  device_installation_id uuid NOT NULL,
  source_system text NOT NULL,
  source_event_id text NOT NULL,
  source_payload_hash text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  connection_status device_connection_status NOT NULL,
  device_fault text NOT NULL CHECK (device_fault IN ('reported', 'none', 'unknown')),
  fault_code text,
  power_voltage numeric,
  signal_strength_dbm numeric,
  provenance text NOT NULL,
  data_classification record_data_classification NOT NULL,
  data_condition text NOT NULL CHECK (data_condition IN ('current','stale','unreliable','unknown','no_data','unconfigured')),
  state_priority smallint NOT NULL CHECK (state_priority IN (1,2)),
  CONSTRAINT device_health_events_source_bounded CHECK (btrim(source_system) <> '' AND length(source_system) <= 128 AND btrim(source_event_id) <> '' AND length(source_event_id) <= 256),
  CONSTRAINT device_health_events_provenance_bounded CHECK (btrim(provenance) <> '' AND length(provenance) <= 256),
  CONSTRAINT device_health_events_fault_shape CHECK ((device_fault = 'reported' AND fault_code IS NOT NULL AND btrim(fault_code) <> '') OR (device_fault <> 'reported' AND fault_code IS NULL)),
  CONSTRAINT device_health_events_installation_fk FOREIGN KEY (device_installation_id)
    REFERENCES telemetry_device_installations (id),
  CONSTRAINT device_health_events_device_same_organization_fk FOREIGN KEY (organization_id, device_id)
    REFERENCES telemetry_devices (organization_id, id),
  CONSTRAINT device_health_events_installation_same_organization_fk FOREIGN KEY (organization_id, device_installation_id)
    REFERENCES telemetry_device_installations (organization_id, id),
  CONSTRAINT device_health_events_territory_fk FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories (organization_id, id),
  CONSTRAINT device_health_events_source_unique UNIQUE (organization_id, source_system, source_event_id)
);
CREATE INDEX IF NOT EXISTS device_health_events_device_received_idx ON device_health_events (device_id, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS device_health_events_territory_received_idx ON device_health_events (territory_id, received_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS device_health_current (
  device_id uuid PRIMARY KEY REFERENCES telemetry_devices(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  device_installation_id uuid NOT NULL,
  latest_event_id uuid NOT NULL REFERENCES device_health_events(id),
  connection_status device_connection_status NOT NULL,
  device_fault text NOT NULL CHECK (device_fault IN ('reported', 'none', 'unknown')),
  last_seen_received_at timestamptz NOT NULL,
  state_occurred_at timestamptz NOT NULL,
  state_priority smallint NOT NULL CHECK (state_priority IN (1,2)),
  state_order_key text NOT NULL,
  last_observed_at timestamptz,
  fault_code text,
  power_voltage numeric,
  signal_strength_dbm numeric,
  provenance text NOT NULL,
  data_classification record_data_classification NOT NULL,
  data_condition text NOT NULL CHECK (data_condition IN ('current','stale','unreliable','unknown','no_data','unconfigured')),
  CONSTRAINT device_health_current_installation_fk FOREIGN KEY (device_installation_id)
    REFERENCES telemetry_device_installations (id),
  CONSTRAINT device_health_current_device_same_organization_fk FOREIGN KEY (organization_id, device_id)
    REFERENCES telemetry_devices (organization_id, id),
  CONSTRAINT device_health_current_installation_same_organization_fk FOREIGN KEY (organization_id, device_installation_id)
    REFERENCES telemetry_device_installations (organization_id, id),
  CONSTRAINT device_health_current_territory_fk FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories (organization_id, id)
);

-- Stable bigint cursors survive API process restarts. SSE only ever replays a
-- bounded window; clients behind the retained cursor receive an explicit reset.
CREATE TABLE IF NOT EXISTS device_live_event_journal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  device_id uuid NOT NULL,
  health_event_id uuid NOT NULL UNIQUE REFERENCES device_health_events(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT device_live_event_journal_device_same_organization_fk FOREIGN KEY (organization_id, device_id)
    REFERENCES telemetry_devices (organization_id, id),
  CONSTRAINT device_live_event_journal_territory_same_organization_fk FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories (organization_id, id)
);
CREATE INDEX IF NOT EXISTS device_live_event_journal_org_idx ON device_live_event_journal (organization_id, id);
CREATE INDEX IF NOT EXISTS device_live_event_journal_device_idx ON device_live_event_journal (device_id, id);

CREATE OR REPLACE FUNCTION reject_device_health_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'device health facts are append-only' USING ERRCODE = '23514';
END; $$;
DROP TRIGGER IF EXISTS device_health_events_append_only ON device_health_events;
CREATE TRIGGER device_health_events_append_only BEFORE UPDATE OR DELETE ON device_health_events
  FOR EACH ROW EXECUTE FUNCTION reject_device_health_event_mutation();

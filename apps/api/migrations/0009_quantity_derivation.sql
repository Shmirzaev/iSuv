CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS rating_curves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  station_id uuid NOT NULL,
  stage_sensor_id uuid NOT NULL,
  device_installation_id uuid NOT NULL REFERENCES telemetry_device_installations(id),
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  provenance text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rating_curves_synthetic_only CHECK (data_classification = 'synthetic'),
  CONSTRAINT rating_curves_provenance_bounded CHECK (btrim(provenance) <> '' AND length(provenance) <= 256),
  CONSTRAINT rating_curves_territory_fk FOREIGN KEY (organization_id, territory_id) REFERENCES territories(organization_id, id),
  CONSTRAINT rating_curves_station_fk FOREIGN KEY (organization_id, station_id) REFERENCES monitoring_stations(organization_id, id),
  CONSTRAINT rating_curves_sensor_fk FOREIGN KEY (organization_id, stage_sensor_id) REFERENCES telemetry_sensors(organization_id, id),
  CONSTRAINT rating_curves_scope_unique UNIQUE (organization_id, station_id, stage_sensor_id, device_installation_id)
);

CREATE TABLE IF NOT EXISTS rating_curve_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curve_id uuid NOT NULL REFERENCES rating_curves(id),
  version integer NOT NULL CHECK (version >= 1),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  knots jsonb NOT NULL,
  approved_by_user_id uuid NOT NULL REFERENCES identity_users(id),
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rating_curve_versions_version_unique UNIQUE (curve_id, version),
  CONSTRAINT rating_curve_versions_effective_range CHECK (effective_until IS NULL OR effective_until > effective_from),
  CONSTRAINT rating_curve_versions_knots_array CHECK (jsonb_typeof(knots) = 'array'),
  CONSTRAINT rating_curve_versions_nonoverlap EXCLUDE USING gist (
    curve_id WITH =, tstzrange(effective_from, effective_until, '[)') WITH &&
  )
);
CREATE INDEX IF NOT EXISTS rating_curve_versions_effective_idx ON rating_curve_versions(curve_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS integration_coverage_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  station_id uuid NOT NULL,
  sensor_id uuid NOT NULL,
  device_installation_id uuid NOT NULL REFERENCES telemetry_device_installations(id),
  method text NOT NULL CHECK (method IN ('direct_discharge', 'stage_rating_curve', 'accumulated_volume_delta')),
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  provenance text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT integration_coverage_policies_synthetic_only CHECK (data_classification = 'synthetic'),
  CONSTRAINT integration_coverage_policies_provenance_bounded CHECK (btrim(provenance) <> '' AND length(provenance) <= 256),
  CONSTRAINT integration_coverage_policies_territory_fk FOREIGN KEY (organization_id, territory_id) REFERENCES territories(organization_id, id),
  CONSTRAINT integration_coverage_policies_station_fk FOREIGN KEY (organization_id, station_id) REFERENCES monitoring_stations(organization_id, id),
  CONSTRAINT integration_coverage_policies_sensor_fk FOREIGN KEY (organization_id, sensor_id) REFERENCES telemetry_sensors(organization_id, id),
  CONSTRAINT integration_coverage_policies_scope_unique UNIQUE (organization_id, station_id, sensor_id, device_installation_id, method)
);

CREATE TABLE IF NOT EXISTS integration_coverage_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES integration_coverage_policies(id),
  version integer NOT NULL CHECK (version >= 1),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  max_gap_microseconds bigint NOT NULL CHECK (max_gap_microseconds > 0),
  approved_by_user_id uuid NOT NULL REFERENCES identity_users(id),
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT integration_coverage_policy_versions_unique UNIQUE (policy_id, version),
  CONSTRAINT integration_coverage_policy_versions_effective_range CHECK (effective_until IS NULL OR effective_until > effective_from),
  CONSTRAINT integration_coverage_policy_versions_nonoverlap EXCLUDE USING gist (
    policy_id WITH =, tstzrange(effective_from, effective_until, '[)') WITH &&
  )
);
CREATE INDEX IF NOT EXISTS integration_coverage_policy_versions_effective_idx ON integration_coverage_policy_versions(policy_id, effective_from DESC);

-- Reapply the named method constraint so raw idempotency verification also
-- upgrades an existing copy of this still-unreleased migration.
ALTER TABLE integration_coverage_policies DROP CONSTRAINT IF EXISTS integration_coverage_policies_method_check;
ALTER TABLE integration_coverage_policies
  ADD CONSTRAINT integration_coverage_policies_method_check
  CHECK (method IN ('direct_discharge', 'stage_rating_curve', 'accumulated_volume_delta'));

CREATE OR REPLACE FUNCTION validate_quantity_curve_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sensor_kind sensor_measurement_kind; sensor_unit text; sensor_territory uuid; sensor_device uuid;
  station_territory uuid; installation_station uuid; installation_territory uuid; installation_device uuid;
BEGIN
  SELECT measurement_kind,unit,territory_id,device_id INTO sensor_kind,sensor_unit,sensor_territory,sensor_device FROM telemetry_sensors WHERE id=NEW.stage_sensor_id AND organization_id=NEW.organization_id;
  SELECT territory_id INTO station_territory FROM monitoring_stations WHERE id=NEW.station_id AND organization_id=NEW.organization_id;
  SELECT station_id,territory_id,device_id INTO installation_station,installation_territory,installation_device FROM telemetry_device_installations WHERE id=NEW.device_installation_id AND organization_id=NEW.organization_id;
  IF sensor_kind IS DISTINCT FROM 'stage' OR sensor_unit IS DISTINCT FROM 'm' OR sensor_territory IS NULL
     OR NEW.territory_id <> sensor_territory OR NEW.territory_id <> station_territory OR NEW.territory_id <> installation_territory
     OR NEW.station_id <> installation_station OR sensor_device <> installation_device THEN
    RAISE EXCEPTION 'rating curve must govern one synthetic stage sensor and its matching station installation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION validate_quantity_curve_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_version integer; item jsonb; prior_stage numeric := NULL; prior_discharge numeric := NULL; stage_value numeric; discharge_value numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.curve_id::text, 9));
  IF EXISTS (SELECT 1 FROM rating_curve_versions WHERE id=NEW.id) THEN RETURN NEW; END IF;
  SELECT COALESCE(MAX(version),0)+1 INTO expected_version FROM rating_curve_versions WHERE curve_id=NEW.curve_id;
  IF NEW.version <> expected_version THEN RAISE EXCEPTION 'rating curve versions must be appended in deterministic order' USING ERRCODE='23514'; END IF;
  IF jsonb_array_length(NEW.knots) < 2 THEN RAISE EXCEPTION 'rating curve requires at least two knots' USING ERRCODE='23514'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.knots) LOOP
    IF jsonb_typeof(item) <> 'object' OR NOT (item ? 'stageM') OR NOT (item ? 'dischargeM3s')
       OR jsonb_typeof(item->'stageM') <> 'string' OR jsonb_typeof(item->'dischargeM3s') <> 'string'
       OR (item->>'stageM') !~ '^(0|[1-9][0-9]{0,17})(\.[0-9]{1,12})?$'
       OR (item->>'dischargeM3s') !~ '^(0|[1-9][0-9]{0,17})(\.[0-9]{1,12})?$' THEN
      RAISE EXCEPTION 'rating knots require nonnegative finite decimal stageM and dischargeM3s strings' USING ERRCODE='23514';
    END IF;
    stage_value := (item->>'stageM')::numeric; discharge_value := (item->>'dischargeM3s')::numeric;
    IF prior_stage IS NOT NULL AND stage_value <= prior_stage THEN RAISE EXCEPTION 'rating knot stages must strictly ascend' USING ERRCODE='23514'; END IF;
    IF prior_discharge IS NOT NULL AND discharge_value < prior_discharge THEN RAISE EXCEPTION 'rating knot discharge must not decrease' USING ERRCODE='23514'; END IF;
    prior_stage := stage_value; prior_discharge := discharge_value;
  END LOOP;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION validate_quantity_policy_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sensor_kind sensor_measurement_kind; sensor_unit text; sensor_territory uuid; sensor_device uuid;
  station_territory uuid; installation_station uuid; installation_territory uuid; installation_device uuid;
BEGIN
  SELECT measurement_kind,unit,territory_id,device_id INTO sensor_kind,sensor_unit,sensor_territory,sensor_device FROM telemetry_sensors WHERE id=NEW.sensor_id AND organization_id=NEW.organization_id;
  SELECT territory_id INTO station_territory FROM monitoring_stations WHERE id=NEW.station_id AND organization_id=NEW.organization_id;
  SELECT station_id,territory_id,device_id INTO installation_station,installation_territory,installation_device FROM telemetry_device_installations WHERE id=NEW.device_installation_id AND organization_id=NEW.organization_id;
  IF sensor_territory IS NULL OR NEW.territory_id <> sensor_territory OR NEW.territory_id <> station_territory OR NEW.territory_id <> installation_territory
     OR NEW.station_id <> installation_station OR sensor_device <> installation_device
     OR (NEW.method='direct_discharge' AND (sensor_kind <> 'discharge' OR sensor_unit <> 'm3/s'))
     OR (NEW.method='stage_rating_curve' AND (sensor_kind <> 'stage' OR sensor_unit <> 'm'))
     OR (NEW.method='accumulated_volume_delta' AND (sensor_kind <> 'accumulated_volume' OR sensor_unit <> 'm3')) THEN
    RAISE EXCEPTION 'coverage policy must govern the matching synthetic sensor, installation, station, and method' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION validate_quantity_policy_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_version integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.policy_id::text, 10));
  IF EXISTS (SELECT 1 FROM integration_coverage_policy_versions WHERE id=NEW.id) THEN RETURN NEW; END IF;
  SELECT COALESCE(MAX(version),0)+1 INTO expected_version FROM integration_coverage_policy_versions WHERE policy_id=NEW.policy_id;
  IF NEW.version <> expected_version THEN RAISE EXCEPTION 'coverage policy versions must be appended in deterministic order' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION reject_quantity_model_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'quantity derivation models are immutable and effective-dated' USING ERRCODE='23514'; END $$;

DROP TRIGGER IF EXISTS rating_curves_validate_scope ON rating_curves;
CREATE TRIGGER rating_curves_validate_scope BEFORE INSERT ON rating_curves FOR EACH ROW EXECUTE FUNCTION validate_quantity_curve_scope();
DROP TRIGGER IF EXISTS rating_curves_immutable ON rating_curves;
CREATE TRIGGER rating_curves_immutable BEFORE UPDATE OR DELETE ON rating_curves FOR EACH ROW EXECUTE FUNCTION reject_quantity_model_mutation();
DROP TRIGGER IF EXISTS rating_curve_versions_validate ON rating_curve_versions;
CREATE TRIGGER rating_curve_versions_validate BEFORE INSERT ON rating_curve_versions FOR EACH ROW EXECUTE FUNCTION validate_quantity_curve_version();
DROP TRIGGER IF EXISTS rating_curve_versions_immutable ON rating_curve_versions;
CREATE TRIGGER rating_curve_versions_immutable BEFORE UPDATE OR DELETE ON rating_curve_versions FOR EACH ROW EXECUTE FUNCTION reject_quantity_model_mutation();
DROP TRIGGER IF EXISTS integration_coverage_policies_validate_scope ON integration_coverage_policies;
CREATE TRIGGER integration_coverage_policies_validate_scope BEFORE INSERT ON integration_coverage_policies FOR EACH ROW EXECUTE FUNCTION validate_quantity_policy_scope();
DROP TRIGGER IF EXISTS integration_coverage_policies_immutable ON integration_coverage_policies;
CREATE TRIGGER integration_coverage_policies_immutable BEFORE UPDATE OR DELETE ON integration_coverage_policies FOR EACH ROW EXECUTE FUNCTION reject_quantity_model_mutation();
DROP TRIGGER IF EXISTS integration_coverage_policy_versions_validate ON integration_coverage_policy_versions;
CREATE TRIGGER integration_coverage_policy_versions_validate BEFORE INSERT ON integration_coverage_policy_versions FOR EACH ROW EXECUTE FUNCTION validate_quantity_policy_version();
DROP TRIGGER IF EXISTS integration_coverage_policy_versions_immutable ON integration_coverage_policy_versions;
CREATE TRIGGER integration_coverage_policy_versions_immutable BEFORE UPDATE OR DELETE ON integration_coverage_policy_versions FOR EACH ROW EXECUTE FUNCTION reject_quantity_model_mutation();

-- The registry is deliberately write-closed to the API in this release, but
-- direct database administration still has to be governed and auditable.
ALTER TYPE audit_event_resource ADD VALUE IF NOT EXISTS 'quantity_model';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'rating_curve.created';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'rating_curve_version.approved';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'integration_coverage_policy.created';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'integration_coverage_policy_version.approved';

ALTER TABLE rating_curves
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES identity_users(id),
  ADD COLUMN IF NOT EXISTS creation_reason text,
  ADD COLUMN IF NOT EXISTS created_request_id text;
ALTER TABLE integration_coverage_policies
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES identity_users(id),
  ADD COLUMN IF NOT EXISTS creation_reason text,
  ADD COLUMN IF NOT EXISTS created_request_id text;
ALTER TABLE rating_curve_versions
  ADD COLUMN IF NOT EXISTS requested_by_user_id uuid REFERENCES identity_users(id),
  ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS request_reason text,
  ADD COLUMN IF NOT EXISTS requested_request_id text,
  ADD COLUMN IF NOT EXISTS approval_reason text,
  ADD COLUMN IF NOT EXISTS approved_request_id text;
ALTER TABLE integration_coverage_policy_versions
  ADD COLUMN IF NOT EXISTS requested_by_user_id uuid REFERENCES identity_users(id),
  ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS request_reason text,
  ADD COLUMN IF NOT EXISTS requested_request_id text,
  ADD COLUMN IF NOT EXISTS approval_reason text,
  ADD COLUMN IF NOT EXISTS approved_request_id text;

ALTER TABLE rating_curves DROP CONSTRAINT IF EXISTS rating_curves_creator_evidence;
ALTER TABLE integration_coverage_policies DROP CONSTRAINT IF EXISTS integration_coverage_policies_creator_evidence;
ALTER TABLE rating_curve_versions DROP CONSTRAINT IF EXISTS rating_curve_versions_governance_evidence;
ALTER TABLE integration_coverage_policy_versions DROP CONSTRAINT IF EXISTS integration_coverage_policy_versions_governance_evidence;
ALTER TABLE rating_curves
  ADD CONSTRAINT rating_curves_creator_evidence CHECK (created_by_user_id IS NOT NULL AND creation_reason IS NOT NULL AND btrim(creation_reason) <> '' AND created_request_id IS NOT NULL AND btrim(created_request_id) <> '');
ALTER TABLE integration_coverage_policies
  ADD CONSTRAINT integration_coverage_policies_creator_evidence CHECK (created_by_user_id IS NOT NULL AND creation_reason IS NOT NULL AND btrim(creation_reason) <> '' AND created_request_id IS NOT NULL AND btrim(created_request_id) <> '');
ALTER TABLE rating_curve_versions
  ADD CONSTRAINT rating_curve_versions_governance_evidence CHECK (requested_by_user_id IS NOT NULL AND request_reason IS NOT NULL AND btrim(request_reason) <> '' AND requested_request_id IS NOT NULL AND btrim(requested_request_id) <> '' AND approval_reason IS NOT NULL AND btrim(approval_reason) <> '' AND approved_request_id IS NOT NULL AND btrim(approved_request_id) <> '' AND approved_by_user_id <> requested_by_user_id);
ALTER TABLE integration_coverage_policy_versions
  ADD CONSTRAINT integration_coverage_policy_versions_governance_evidence CHECK (requested_by_user_id IS NOT NULL AND request_reason IS NOT NULL AND btrim(request_reason) <> '' AND requested_request_id IS NOT NULL AND btrim(requested_request_id) <> '' AND approval_reason IS NOT NULL AND btrim(approval_reason) <> '' AND approved_request_id IS NOT NULL AND btrim(approved_request_id) <> '' AND approved_by_user_id <> requested_by_user_id);

CREATE OR REPLACE FUNCTION quantity_model_actor_may_act(actor_id uuid,target_organization uuid,target_territory uuid,required_action text,evaluated_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE ancestors(id,parent_territory_id,path) AS (
   SELECT id,parent_territory_id,ARRAY[id] FROM territories WHERE id=target_territory AND organization_id=target_organization
   UNION ALL SELECT parent.id,parent.parent_territory_id,ancestors.path||parent.id FROM territories parent JOIN ancestors ON ancestors.parent_territory_id=parent.id WHERE NOT parent.id=ANY(ancestors.path)
 ) SELECT EXISTS (
   SELECT 1 FROM identity_users actor JOIN user_role_grants grant_row ON grant_row.user_id=actor.id
   WHERE actor.id=actor_id AND actor.is_active AND grant_row.cancelled_at IS NULL
     AND grant_row.effective_from<=evaluated_at AND (grant_row.effective_until IS NULL OR grant_row.effective_until>evaluated_at)
     AND ((required_action='request' AND grant_row.role IN ('system_admin','national_admin','regional_director','hydrologist')) OR (required_action='approve' AND grant_row.role IN ('system_admin','national_admin','regional_director')))
     AND ((grant_row.role='system_admin' AND grant_row.scope='system') OR (actor.organization_id=target_organization AND grant_row.role='national_admin' AND grant_row.scope='national') OR (actor.organization_id=target_organization AND grant_row.scope='territory' AND EXISTS(SELECT 1 FROM ancestors WHERE id=grant_row.territory_id)))
 );
$$;
CREATE OR REPLACE FUNCTION quantity_model_validate_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.created_at := clock_timestamp();
 IF NOT quantity_model_actor_may_act(NEW.created_by_user_id,NEW.organization_id,NEW.territory_id,'request',NEW.created_at) THEN
   RAISE EXCEPTION 'quantity model creator is not authorized for governed scope' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION quantity_model_validate_curve_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scope_row rating_curves%ROWTYPE;
BEGIN
 NEW.requested_at := clock_timestamp();
 NEW.approved_at := NEW.requested_at;
 SELECT * INTO STRICT scope_row FROM rating_curves WHERE id=NEW.curve_id;
 IF NOT quantity_model_actor_may_act(NEW.requested_by_user_id,scope_row.organization_id,scope_row.territory_id,'request',NEW.requested_at)
    OR NOT quantity_model_actor_may_act(NEW.approved_by_user_id,scope_row.organization_id,scope_row.territory_id,'approve',NEW.approved_at) THEN
   RAISE EXCEPTION 'rating curve request or approval actor is not authorized' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION quantity_model_validate_policy_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scope_row integration_coverage_policies%ROWTYPE;
BEGIN
 NEW.requested_at := clock_timestamp();
 NEW.approved_at := NEW.requested_at;
 SELECT * INTO STRICT scope_row FROM integration_coverage_policies WHERE id=NEW.policy_id;
 IF NOT quantity_model_actor_may_act(NEW.requested_by_user_id,scope_row.organization_id,scope_row.territory_id,'request',NEW.requested_at)
    OR NOT quantity_model_actor_may_act(NEW.approved_by_user_id,scope_row.organization_id,scope_row.territory_id,'approve',NEW.approved_at) THEN
   RAISE EXCEPTION 'coverage policy request or approval actor is not authorized' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION quantity_model_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE organization_value uuid; territory_value uuid; actor_value uuid; action_value text; reason_value text; request_value text; row_count integer;
BEGIN
 IF TG_TABLE_NAME='rating_curves' THEN organization_value:=NEW.organization_id;territory_value:=NEW.territory_id;actor_value:=NEW.created_by_user_id;action_value:='rating_curve.created';reason_value:=NEW.creation_reason;request_value:=NEW.created_request_id;
 ELSIF TG_TABLE_NAME='integration_coverage_policies' THEN organization_value:=NEW.organization_id;territory_value:=NEW.territory_id;actor_value:=NEW.created_by_user_id;action_value:='integration_coverage_policy.created';reason_value:=NEW.creation_reason;request_value:=NEW.created_request_id;
 ELSIF TG_TABLE_NAME='rating_curve_versions' THEN SELECT organization_id,territory_id INTO STRICT organization_value,territory_value FROM rating_curves WHERE id=NEW.curve_id;actor_value:=NEW.approved_by_user_id;action_value:='rating_curve_version.approved';reason_value:=NEW.approval_reason;request_value:=NEW.approved_request_id;
 ELSE SELECT organization_id,territory_id INTO STRICT organization_value,territory_value FROM integration_coverage_policies WHERE id=NEW.policy_id;actor_value:=NEW.approved_by_user_id;action_value:='integration_coverage_policy_version.approved';reason_value:=NEW.approval_reason;request_value:=NEW.approved_request_id;
 END IF;
 INSERT INTO audit_events(organization_id,territory_id,actor_user_id,actor_organization_id,action,resource,resource_id,old_state,new_state,reason,request_id,occurred_at,data_classification,provenance)
 SELECT organization_value,territory_value,actor.id,actor.organization_id,action_value::audit_event_action,'quantity_model',NEW.id,NULL,to_jsonb(NEW),reason_value,request_value,clock_timestamp(),'synthetic','database:quantity-model-governance' FROM identity_users actor WHERE actor.id=actor_value AND actor.is_active;
 GET DIAGNOSTICS row_count=ROW_COUNT;
 IF row_count<>1 THEN RAISE EXCEPTION 'quantity model audit actor is inactive or absent' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS rating_curves_governed_insert ON rating_curves;
CREATE TRIGGER rating_curves_governed_insert BEFORE INSERT ON rating_curves FOR EACH ROW EXECUTE FUNCTION quantity_model_validate_identity();
DROP TRIGGER IF EXISTS integration_coverage_policies_governed_insert ON integration_coverage_policies;
CREATE TRIGGER integration_coverage_policies_governed_insert BEFORE INSERT ON integration_coverage_policies FOR EACH ROW EXECUTE FUNCTION quantity_model_validate_identity();
DROP TRIGGER IF EXISTS rating_curve_versions_governed_insert ON rating_curve_versions;
CREATE TRIGGER rating_curve_versions_governed_insert BEFORE INSERT ON rating_curve_versions FOR EACH ROW EXECUTE FUNCTION quantity_model_validate_curve_version();
DROP TRIGGER IF EXISTS integration_coverage_policy_versions_governed_insert ON integration_coverage_policy_versions;
CREATE TRIGGER integration_coverage_policy_versions_governed_insert BEFORE INSERT ON integration_coverage_policy_versions FOR EACH ROW EXECUTE FUNCTION quantity_model_validate_policy_version();
DROP TRIGGER IF EXISTS rating_curves_audit_insert ON rating_curves;
CREATE TRIGGER rating_curves_audit_insert AFTER INSERT ON rating_curves FOR EACH ROW EXECUTE FUNCTION quantity_model_audit();
DROP TRIGGER IF EXISTS integration_coverage_policies_audit_insert ON integration_coverage_policies;
CREATE TRIGGER integration_coverage_policies_audit_insert AFTER INSERT ON integration_coverage_policies FOR EACH ROW EXECUTE FUNCTION quantity_model_audit();
DROP TRIGGER IF EXISTS rating_curve_versions_audit_insert ON rating_curve_versions;
CREATE TRIGGER rating_curve_versions_audit_insert AFTER INSERT ON rating_curve_versions FOR EACH ROW EXECUTE FUNCTION quantity_model_audit();
DROP TRIGGER IF EXISTS integration_coverage_policy_versions_audit_insert ON integration_coverage_policy_versions;
CREATE TRIGGER integration_coverage_policy_versions_audit_insert AFTER INSERT ON integration_coverage_policy_versions FOR EACH ROW EXECUTE FUNCTION quantity_model_audit();

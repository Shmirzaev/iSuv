-- Planned-vs-actual is decision support only. All models in this migration are
-- explicitly synthetic; it creates no autonomous OT-control path.
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'allocation_plan_entry_measurement_binding.created';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'section_tolerance_policy.created';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'section_tolerance_policy_version.requested';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'section_tolerance_policy_version.approved';
ALTER TYPE audit_event_resource ADD VALUE IF NOT EXISTS 'tolerance_policy';

CREATE TABLE IF NOT EXISTS allocation_plan_entry_measurement_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entry_id uuid NOT NULL UNIQUE REFERENCES allocation_plan_entries(id),
 station_id uuid NOT NULL REFERENCES monitoring_stations(id), sensor_id uuid NOT NULL REFERENCES telemetry_sensors(id),
 device_installation_id uuid NOT NULL REFERENCES telemetry_device_installations(id),
 method text NOT NULL CHECK(method IN ('direct_discharge','stage_rating_curve','accumulated_volume_delta')),
 reference_plane text NOT NULL CHECK(reference_plane IN ('upstream','downstream','on_section')),
 purpose text NOT NULL DEFAULT 'section_delivery' CHECK(purpose='section_delivery'),
 data_classification record_data_classification NOT NULL CHECK(data_classification='synthetic'),
 provenance text NOT NULL CHECK(btrim(provenance)<>'' AND length(provenance)<=256),
 created_by_user_id uuid NOT NULL REFERENCES identity_users(id), creation_reason text NOT NULL CHECK(btrim(creation_reason)<>''),
 created_request_id text NOT NULL CHECK(btrim(created_request_id)<>''), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS section_tolerance_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), territory_id uuid NOT NULL,
 water_section_id uuid NOT NULL, data_classification record_data_classification NOT NULL CHECK(data_classification='synthetic'),
 provenance text NOT NULL CHECK(btrim(provenance)<>''), created_by_user_id uuid NOT NULL REFERENCES identity_users(id), creation_reason text NOT NULL CHECK(btrim(creation_reason)<>''),
 created_request_id text NOT NULL CHECK(btrim(created_request_id)<>''), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,water_section_id), FOREIGN KEY(organization_id,territory_id) REFERENCES territories(organization_id,id),
 FOREIGN KEY(organization_id,water_section_id) REFERENCES water_sections(organization_id,id)
);
CREATE TABLE IF NOT EXISTS section_tolerance_policy_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), policy_id uuid NOT NULL REFERENCES section_tolerance_policies(id), version integer NOT NULL CHECK(version>=1),
 status text NOT NULL CHECK(status IN ('requested','approved')),
 effective_from timestamptz NOT NULL, effective_until timestamptz NOT NULL,
 under_absolute_m3 numeric(30,12) CHECK(under_absolute_m3>=0), over_absolute_m3 numeric(30,12) CHECK(over_absolute_m3>=0),
 under_percent numeric(30,12) CHECK(under_percent>=0), over_percent numeric(30,12) CHECK(over_percent>=0),
 combination text NOT NULL CHECK(combination IN ('all','any')), applies_to_zero_plan boolean NOT NULL,
 requested_by_user_id uuid NOT NULL REFERENCES identity_users(id), requested_at timestamptz NOT NULL DEFAULT clock_timestamp(), request_reason text NOT NULL CHECK(btrim(request_reason)<>''), requested_request_id text NOT NULL CHECK(btrim(requested_request_id)<>''),
 approved_by_user_id uuid REFERENCES identity_users(id), approved_at timestamptz, approval_reason text, approved_request_id text,
 CONSTRAINT tolerance_version_unique UNIQUE(policy_id,version), CONSTRAINT tolerance_window CHECK(effective_until IS NULL OR effective_until>effective_from),
 CONSTRAINT tolerance_side_limits CHECK((under_absolute_m3 IS NOT NULL OR under_percent IS NOT NULL) AND (over_absolute_m3 IS NOT NULL OR over_percent IS NOT NULL)),
 CONSTRAINT tolerance_approval_state CHECK((status='requested' AND approved_by_user_id IS NULL AND approved_at IS NULL AND approval_reason IS NULL AND approved_request_id IS NULL) OR (status='approved' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL AND btrim(approval_reason)<>' ' AND btrim(approval_reason)<>'' AND btrim(approved_request_id)<>' ' AND btrim(approved_request_id)<>'' AND approved_by_user_id<>requested_by_user_id))
);

CREATE OR REPLACE FUNCTION allocation_deviation_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'allocation deviation governance records are immutable' USING ERRCODE='23514'; END $$;
CREATE OR REPLACE FUNCTION allocation_deviation_validate_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry_row allocation_plan_entries%ROWTYPE; plan_row allocation_plans%ROWTYPE; version_row allocation_plan_versions%ROWTYPE; installation telemetry_device_installations%ROWTYPE; station_ok boolean; section_row water_sections%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'measurement bindings are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT entry_row FROM allocation_plan_entries WHERE id=NEW.entry_id; SELECT * INTO STRICT version_row FROM allocation_plan_versions WHERE id=entry_row.plan_version_id; SELECT * INTO STRICT plan_row FROM allocation_plans WHERE id=version_row.plan_id;
 SELECT * INTO STRICT installation FROM telemetry_device_installations WHERE id=NEW.device_installation_id;
 SELECT * INTO STRICT section_row FROM water_sections WHERE id=plan_row.water_section_id;
 NEW.created_at := clock_timestamp();
 SELECT EXISTS(SELECT 1 FROM telemetry_sensors sensor WHERE sensor.id=NEW.sensor_id AND sensor.organization_id=plan_row.organization_id AND sensor.territory_id=plan_row.territory_id AND sensor.device_id=installation.device_id
   AND ((NEW.method='direct_discharge' AND sensor.measurement_kind='discharge' AND sensor.unit='m3/s') OR (NEW.method='stage_rating_curve' AND sensor.measurement_kind='stage' AND sensor.unit='m') OR (NEW.method='accumulated_volume_delta' AND sensor.measurement_kind='accumulated_volume' AND sensor.unit='m3'))) INTO station_ok;
 station_ok := station_ok AND installation.station_id=NEW.station_id AND installation.organization_id=plan_row.organization_id AND installation.territory_id=plan_row.territory_id AND installation.effective_from<=entry_row.interval_start AND (installation.effective_until IS NULL OR installation.effective_until>=entry_row.interval_end)
   AND EXISTS(SELECT 1 FROM monitoring_stations station LEFT JOIN control_structures control ON control.id=station.control_structure_id WHERE station.id=NEW.station_id AND station.organization_id=plan_row.organization_id AND station.territory_id=plan_row.territory_id AND (
     (NEW.reference_plane='upstream' AND COALESCE(station.junction_id,control.junction_id)=section_row.upstream_junction_id)
     OR (NEW.reference_plane='downstream' AND COALESCE(station.junction_id,control.junction_id)=section_row.downstream_junction_id)
     OR (NEW.reference_plane='on_section' AND (station.section_id=plan_row.water_section_id OR control.section_id=plan_row.water_section_id))));
 IF version_row.status<>'draft' OR NEW.data_classification<>'synthetic' OR NOT station_ok OR NOT allocation_plan_version_actor_allowed(NEW.created_by_user_id,version_row.plan_id,'write') THEN
  RAISE EXCEPTION 'binding must be authorized, synthetic, draft-only and match the planned section measurement scope' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION allocation_deviation_require_bindings() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status='draft' AND NEW.status='requested' AND EXISTS(SELECT 1 FROM allocation_plan_entries entry_row WHERE entry_row.plan_version_id=OLD.id AND NOT EXISTS(SELECT 1 FROM allocation_plan_entry_measurement_bindings binding WHERE binding.entry_id=entry_row.id)) THEN
  RAISE EXCEPTION 'each allocation plan entry requires an immutable measurement binding before request' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION allocation_deviation_validate_policy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'tolerance policies are immutable' USING ERRCODE='23514'; END IF;
 NEW.created_at := clock_timestamp();
 IF NEW.data_classification<>'synthetic' OR NOT allocation_plan_actor_may_act(NEW.created_by_user_id,NEW.organization_id,NEW.territory_id,'write',NEW.created_at) OR NOT EXISTS(SELECT 1 FROM water_sections WHERE id=NEW.water_section_id AND organization_id=NEW.organization_id AND territory_id=NEW.territory_id) THEN
  RAISE EXCEPTION 'tolerance policy must be synthetic and authorized for its section scope' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION allocation_deviation_validate_policy_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy_row section_tolerance_policies%ROWTYPE; expected integer; BEGIN
 SELECT * INTO STRICT policy_row FROM section_tolerance_policies WHERE id=NEW.policy_id; PERFORM pg_advisory_xact_lock(hashtext(NEW.policy_id::text));
 IF TG_OP='INSERT' THEN
  NEW.requested_at := clock_timestamp();
  SELECT COALESCE(max(version),0)+1 INTO expected FROM section_tolerance_policy_versions WHERE policy_id=NEW.policy_id;
  IF NEW.status<>'requested' OR NEW.version<>expected OR NEW.approved_by_user_id IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.approval_reason IS NOT NULL OR NEW.approved_request_id IS NOT NULL OR NOT allocation_plan_actor_may_act(NEW.requested_by_user_id,policy_row.organization_id,policy_row.territory_id,'write',NEW.requested_at) THEN
   RAISE EXCEPTION 'tolerance policy version must be sequential, requested, and territory-authorized' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD.status='requested' AND NEW.status='approved'
    AND NEW.policy_id=OLD.policy_id AND NEW.version=OLD.version AND NEW.effective_from=OLD.effective_from AND NEW.effective_until IS NOT DISTINCT FROM OLD.effective_until
    AND NEW.under_absolute_m3 IS NOT DISTINCT FROM OLD.under_absolute_m3 AND NEW.over_absolute_m3 IS NOT DISTINCT FROM OLD.over_absolute_m3 AND NEW.under_percent IS NOT DISTINCT FROM OLD.under_percent AND NEW.over_percent IS NOT DISTINCT FROM OLD.over_percent
    AND NEW.combination=OLD.combination AND NEW.applies_to_zero_plan=OLD.applies_to_zero_plan AND NEW.requested_by_user_id=OLD.requested_by_user_id AND NEW.requested_at=OLD.requested_at AND NEW.request_reason=OLD.request_reason AND NEW.requested_request_id=OLD.requested_request_id THEN
  NEW.approved_at := clock_timestamp();
  IF NEW.approved_by_user_id=OLD.requested_by_user_id OR NEW.approval_reason IS NULL OR btrim(NEW.approval_reason)='' OR NEW.approved_request_id IS NULL OR btrim(NEW.approved_request_id)='' OR NEW.effective_from<NEW.approved_at OR NOT allocation_plan_actor_may_act(NEW.approved_by_user_id,policy_row.organization_id,policy_row.territory_id,'approve',NEW.approved_at) THEN
   RAISE EXCEPTION 'tolerance policy approval must be distinct, future-effective, and territory-authorized' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM section_tolerance_policy_versions prior WHERE prior.policy_id=NEW.policy_id AND prior.status='approved' AND prior.id<>NEW.id AND tstzrange(prior.effective_from,prior.effective_until,'[)') && tstzrange(NEW.effective_from,NEW.effective_until,'[)')) THEN
   RAISE EXCEPTION 'tolerance policy approved windows cannot overlap' USING ERRCODE='23P01'; END IF;
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'tolerance policy versions are immutable except requested-to-approved transition' USING ERRCODE='23514';
END $$;
CREATE OR REPLACE FUNCTION allocation_deviation_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org uuid; territory uuid; actor uuid; action_value audit_event_action; resource_value audit_event_resource; reason_value text; request_value text; classification record_data_classification; inserted_count integer; old_value jsonb; BEGIN
 IF TG_OP='UPDATE' THEN old_value:=to_jsonb(OLD); END IF;
 IF TG_TABLE_NAME='allocation_plan_entry_measurement_bindings' THEN
  SELECT plan.organization_id,plan.territory_id,plan.data_classification INTO org,territory,classification FROM allocation_plan_entries entry_row JOIN allocation_plan_versions version_row ON version_row.id=entry_row.plan_version_id JOIN allocation_plans plan ON plan.id=version_row.plan_id WHERE entry_row.id=NEW.entry_id;
  actor:=NEW.created_by_user_id; action_value:='allocation_plan_entry_measurement_binding.created'; resource_value:='allocation_plan'; reason_value:=NEW.creation_reason; request_value:=NEW.created_request_id;
 ELSIF TG_TABLE_NAME='section_tolerance_policies' THEN
  org:=NEW.organization_id; territory:=NEW.territory_id; classification:=NEW.data_classification; actor:=NEW.created_by_user_id; action_value:='section_tolerance_policy.created'; resource_value:='tolerance_policy'; reason_value:=NEW.creation_reason; request_value:=NEW.created_request_id;
 ELSE
  SELECT organization_id,territory_id,data_classification INTO org,territory,classification FROM section_tolerance_policies WHERE id=NEW.policy_id;
  IF NEW.status='requested' THEN
   actor:=NEW.requested_by_user_id; action_value:='section_tolerance_policy_version.requested'; reason_value:=NEW.request_reason; request_value:=NEW.requested_request_id;
  ELSE
   actor:=NEW.approved_by_user_id; action_value:='section_tolerance_policy_version.approved'; reason_value:=NEW.approval_reason; request_value:=NEW.approved_request_id;
  END IF;
  resource_value:='tolerance_policy';
 END IF;
 INSERT INTO audit_events(organization_id,territory_id,actor_user_id,actor_organization_id,action,resource,resource_id,old_state,new_state,reason,request_id,occurred_at,data_classification,provenance) SELECT org,territory,actor,user_row.organization_id,action_value,resource_value,NEW.id,old_value,to_jsonb(NEW),reason_value,request_value,clock_timestamp(),classification,'database:planned-actual-governance' FROM identity_users user_row WHERE user_row.id=actor AND user_row.is_active;
 GET DIAGNOSTICS inserted_count=ROW_COUNT; IF inserted_count<>1 THEN RAISE EXCEPTION 'allocation deviation audit actor is inactive or absent' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS allocation_entry_binding_validate ON allocation_plan_entry_measurement_bindings;
DROP TRIGGER IF EXISTS allocation_entry_binding_audit ON allocation_plan_entry_measurement_bindings;
DROP TRIGGER IF EXISTS allocation_plan_version_binding_required ON allocation_plan_versions;
DROP TRIGGER IF EXISTS tolerance_policy_validate ON section_tolerance_policies;
DROP TRIGGER IF EXISTS tolerance_policy_audit ON section_tolerance_policies;
DROP TRIGGER IF EXISTS tolerance_policy_version_validate ON section_tolerance_policy_versions;
DROP TRIGGER IF EXISTS tolerance_policy_version_audit ON section_tolerance_policy_versions;
CREATE TRIGGER allocation_entry_binding_validate BEFORE INSERT OR UPDATE OR DELETE ON allocation_plan_entry_measurement_bindings FOR EACH ROW EXECUTE FUNCTION allocation_deviation_validate_binding();
CREATE TRIGGER allocation_entry_binding_audit AFTER INSERT ON allocation_plan_entry_measurement_bindings FOR EACH ROW EXECUTE FUNCTION allocation_deviation_audit();
CREATE TRIGGER allocation_plan_version_binding_required BEFORE UPDATE ON allocation_plan_versions FOR EACH ROW EXECUTE FUNCTION allocation_deviation_require_bindings();
CREATE TRIGGER tolerance_policy_validate BEFORE INSERT OR UPDATE OR DELETE ON section_tolerance_policies FOR EACH ROW EXECUTE FUNCTION allocation_deviation_validate_policy();
CREATE TRIGGER tolerance_policy_audit AFTER INSERT ON section_tolerance_policies FOR EACH ROW EXECUTE FUNCTION allocation_deviation_audit();
CREATE TRIGGER tolerance_policy_version_validate BEFORE INSERT OR UPDATE OR DELETE ON section_tolerance_policy_versions FOR EACH ROW EXECUTE FUNCTION allocation_deviation_validate_policy_version();
CREATE TRIGGER tolerance_policy_version_audit AFTER INSERT OR UPDATE ON section_tolerance_policy_versions FOR EACH ROW EXECUTE FUNCTION allocation_deviation_audit();

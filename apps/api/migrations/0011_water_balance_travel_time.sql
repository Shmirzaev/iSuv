CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TYPE audit_event_resource ADD VALUE IF NOT EXISTS 'water_balance_model';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'water_balance_model.created';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'water_balance_version.requested';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'water_balance_version.approved';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'water_balance_component.created';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'water_balance_assumption.created';

CREATE TABLE IF NOT EXISTS water_balance_models (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), junction_id uuid NOT NULL REFERENCES network_junctions(id),
 territory_id uuid NOT NULL, provenance text NOT NULL, data_classification record_data_classification NOT NULL DEFAULT 'synthetic', created_by_user_id uuid NOT NULL REFERENCES identity_users(id), creation_reason text NOT NULL, created_request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(junction_id), CHECK(data_classification='synthetic'), CHECK(btrim(provenance)<>''), CHECK(btrim(creation_reason)<>''), CHECK(btrim(created_request_id)<>'')
);
CREATE TABLE IF NOT EXISTS water_balance_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), model_id uuid NOT NULL REFERENCES water_balance_models(id), version integer NOT NULL, status text NOT NULL CHECK(status IN ('requested','approved')), effective_from timestamptz NOT NULL, effective_until timestamptz NOT NULL, provenance text NOT NULL, requested_by_user_id uuid NOT NULL REFERENCES identity_users(id), requested_at timestamptz NOT NULL DEFAULT clock_timestamp(), request_reason text NOT NULL, requested_request_id text NOT NULL, approved_by_user_id uuid REFERENCES identity_users(id), approved_at timestamptz, approval_reason text, approved_request_id text,
 UNIQUE(model_id,version), CHECK(effective_until>effective_from), CHECK(btrim(provenance)<>''), CHECK(btrim(request_reason)<>''), CHECK(btrim(requested_request_id)<>''), CHECK((status='requested' AND approved_by_user_id IS NULL AND approved_at IS NULL AND approval_reason IS NULL AND approved_request_id IS NULL) OR (status='approved' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL AND approved_by_user_id<>requested_by_user_id AND btrim(approval_reason)<>'' AND btrim(approved_request_id)<>'')),
 EXCLUDE USING gist(model_id WITH =, tstzrange(effective_from,effective_until,'[)') WITH &&) WHERE(status='approved')
);
CREATE TABLE IF NOT EXISTS water_balance_version_components (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES water_balance_versions(id), water_section_id uuid NOT NULL REFERENCES water_sections(id), station_id uuid NOT NULL REFERENCES monitoring_stations(id), sensor_id uuid NOT NULL REFERENCES telemetry_sensors(id), device_installation_id uuid NOT NULL REFERENCES telemetry_device_installations(id), method text NOT NULL CHECK(method IN ('direct_discharge','stage_rating_curve','accumulated_volume_delta')), role text NOT NULL CHECK(role IN ('incoming','outgoing')), reference_plane text NOT NULL CHECK(reference_plane IN ('upstream','downstream')), travel_time_microseconds bigint NOT NULL CHECK(travel_time_microseconds BETWEEN 0 AND 31536000000000), provenance text NOT NULL, data_classification record_data_classification NOT NULL DEFAULT 'synthetic', created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(version_id,water_section_id), UNIQUE(version_id,sensor_id,device_installation_id,method), CHECK(data_classification='synthetic'), CHECK(btrim(provenance)<>'')
);
CREATE TABLE IF NOT EXISTS water_balance_version_assumptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES water_balance_versions(id), interval_start timestamptz NOT NULL, interval_end timestamptz NOT NULL, storage_change_m3 numeric NOT NULL, known_addition_m3 numeric NOT NULL CHECK(known_addition_m3>=0), known_removal_m3 numeric NOT NULL CHECK(known_removal_m3>=0), provenance text NOT NULL, data_classification record_data_classification NOT NULL DEFAULT 'synthetic', created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(version_id,interval_start,interval_end), CHECK(interval_end>interval_start), CHECK(data_classification='synthetic'), CHECK(btrim(provenance)<>'')
);

CREATE OR REPLACE FUNCTION water_balance_actor_allowed(actor_id uuid, org uuid, territory uuid, action text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT action IN ('write','approve') AND allocation_plan_actor_may_act(actor_id,org,territory,'approve',clock_timestamp()) $$;
CREATE OR REPLACE FUNCTION water_balance_model_validate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.created_at:=clock_timestamp();
 IF NOT EXISTS(SELECT 1 FROM network_junctions j WHERE j.id=NEW.junction_id AND j.organization_id=NEW.organization_id AND j.territory_id=NEW.territory_id AND j.lifecycle='active') OR NOT water_balance_actor_allowed(NEW.created_by_user_id,NEW.organization_id,NEW.territory_id,'write') THEN RAISE EXCEPTION 'water balance model scope or author is invalid' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION water_balance_component_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v water_balance_versions%ROWTYPE; m water_balance_models%ROWTYPE; s water_sections%ROWTYPE; st monitoring_stations%ROWTYPE; kind sensor_measurement_kind; unit_value text; inst_station uuid; inst_from timestamptz; inst_until timestamptz; expected_role text; expected_plane text; source_shift interval;
BEGIN
  SELECT * INTO STRICT v FROM water_balance_versions WHERE id=NEW.version_id; SELECT * INTO STRICT m FROM water_balance_models WHERE id=v.model_id; SELECT * INTO STRICT s FROM water_sections WHERE id=NEW.water_section_id AND lifecycle='active'; SELECT * INTO STRICT st FROM monitoring_stations WHERE id=NEW.station_id AND lifecycle='active'; SELECT measurement_kind,unit INTO kind,unit_value FROM telemetry_sensors WHERE id=NEW.sensor_id AND organization_id=m.organization_id AND territory_id=s.territory_id; SELECT station_id,effective_from,effective_until INTO inst_station,inst_from,inst_until FROM telemetry_device_installations WHERE id=NEW.device_installation_id AND organization_id=m.organization_id AND territory_id=s.territory_id AND device_id=(SELECT device_id FROM telemetry_sensors WHERE id=NEW.sensor_id);
 IF v.status<>'requested' OR s.organization_id<>m.organization_id OR st.organization_id<>m.organization_id OR st.territory_id<>s.territory_id OR kind IS NULL OR inst_station<>NEW.station_id OR v.effective_from<inst_from OR v.effective_until>COALESCE(inst_until,'infinity') OR NOT water_balance_actor_allowed(v.requested_by_user_id,m.organization_id,s.territory_id,'write') OR (NEW.method='direct_discharge' AND (kind<>'discharge' OR unit_value<>'m3/s')) OR (NEW.method='stage_rating_curve' AND (kind<>'stage' OR unit_value<>'m')) OR (NEW.method='accumulated_volume_delta' AND (kind<>'accumulated_volume' OR unit_value<>'m3')) THEN RAISE EXCEPTION 'water balance component sensor, station, installation, or method invalid' USING ERRCODE='23514'; END IF;
 IF s.downstream_junction_id=m.junction_id THEN expected_role:='incoming'; expected_plane:='downstream'; ELSIF s.upstream_junction_id=m.junction_id THEN expected_role:='outgoing'; expected_plane:='upstream'; ELSE RAISE EXCEPTION 'component section is not incident to model junction' USING ERRCODE='23514'; END IF;
 IF NEW.role<>expected_role OR (NEW.reference_plane=expected_plane AND NEW.travel_time_microseconds<>0) THEN RAISE EXCEPTION 'component role or adjacent-plane travel time invalid' USING ERRCODE='23514'; END IF;
 source_shift:=CASE WHEN NEW.role='incoming' AND NEW.reference_plane='upstream' THEN -NEW.travel_time_microseconds*interval '1 microsecond' WHEN NEW.role='outgoing' AND NEW.reference_plane='downstream' THEN NEW.travel_time_microseconds*interval '1 microsecond' ELSE interval '0' END;
 IF inst_from>v.effective_from+source_shift OR (inst_until IS NOT NULL AND inst_until<v.effective_until+source_shift) THEN RAISE EXCEPTION 'component installation does not cover its shifted source window' USING ERRCODE='23514'; END IF;
 IF (NEW.reference_plane='upstream' AND COALESCE(st.junction_id,(SELECT control.junction_id FROM control_structures control WHERE control.id=st.control_structure_id))<>s.upstream_junction_id) OR (NEW.reference_plane='downstream' AND COALESCE(st.junction_id,(SELECT control.junction_id FROM control_structures control WHERE control.id=st.control_structure_id))<>s.downstream_junction_id) THEN RAISE EXCEPTION 'station must be at the component reference-plane junction' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION water_balance_assumption_validate() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE v water_balance_versions%ROWTYPE; BEGIN SELECT * INTO STRICT v FROM water_balance_versions WHERE id=NEW.version_id; IF v.status<>'requested' OR NEW.interval_start<v.effective_from OR NEW.interval_end>v.effective_until THEN RAISE EXCEPTION 'assumption is outside requested version window' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION water_balance_version_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m water_balance_models%ROWTYPE; expected integer; incident_count integer; component_count integer; all_authorized boolean;
BEGIN SELECT * INTO STRICT m FROM water_balance_models WHERE id=NEW.model_id; NEW.requested_at:=clock_timestamp(); SELECT COALESCE(max(version),0)+1 INTO expected FROM water_balance_versions WHERE model_id=NEW.model_id; IF NEW.version<>expected OR NEW.status<>'requested' OR NOT water_balance_actor_allowed(NEW.requested_by_user_id,m.organization_id,m.territory_id,'write') THEN RAISE EXCEPTION 'water balance version request invalid' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION water_balance_version_update_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m water_balance_models%ROWTYPE; incident_count integer; component_count integer; all_authorized boolean;
BEGIN
 IF OLD.status='requested' AND OLD.approved_by_user_id IS NULL AND OLD.approved_at IS NULL AND OLD.approval_reason IS NULL AND OLD.approved_request_id IS NULL AND NEW.status='approved' AND NEW.id=OLD.id AND NEW.model_id=OLD.model_id AND NEW.version=OLD.version AND NEW.effective_from=OLD.effective_from AND NEW.effective_until=OLD.effective_until AND NEW.provenance=OLD.provenance AND NEW.requested_by_user_id=OLD.requested_by_user_id AND NEW.requested_at=OLD.requested_at AND NEW.request_reason=OLD.request_reason AND NEW.requested_request_id=OLD.requested_request_id THEN
  NEW.approved_at:=clock_timestamp(); SELECT * INTO STRICT m FROM water_balance_models WHERE id=NEW.model_id;
  SELECT count(*) INTO incident_count FROM water_sections WHERE lifecycle='active' AND (upstream_junction_id=m.junction_id OR downstream_junction_id=m.junction_id);
  SELECT count(*) INTO component_count FROM water_balance_version_components WHERE version_id=NEW.id;
  SELECT bool_and(water_balance_actor_allowed(NEW.approved_by_user_id,m.organization_id,s.territory_id,'approve')) INTO all_authorized FROM water_balance_version_components c JOIN water_sections s ON s.id=c.water_section_id WHERE c.version_id=NEW.id;
  IF NEW.approved_by_user_id=OLD.requested_by_user_id OR NEW.approval_reason IS NULL OR btrim(NEW.approval_reason)='' OR NEW.approved_request_id IS NULL OR btrim(NEW.approved_request_id)='' OR component_count<>incident_count OR NOT COALESCE(all_authorized,false) OR NOT EXISTS(SELECT 1 FROM water_balance_version_assumptions a WHERE a.version_id=NEW.id) THEN RAISE EXCEPTION 'water balance approval requires exact canonical components, assumptions, and scoped distinct approver' USING ERRCODE='23514'; END IF; RETURN NEW;
 END IF; RAISE EXCEPTION 'water balance versions are immutable' USING ERRCODE='23514';
END $$;
CREATE OR REPLACE FUNCTION water_balance_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'water balance components and assumptions are immutable' USING ERRCODE='23514'; END $$;
CREATE OR REPLACE FUNCTION water_balance_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m water_balance_models%ROWTYPE; actor uuid; action_name text; request_value text; reason_value text; resource_value uuid; old_json jsonb; new_json jsonb;
BEGIN
 IF TG_TABLE_NAME='water_balance_models' THEN m:=NEW; actor:=NEW.created_by_user_id; action_name:='water_balance_model.created'; request_value:=NEW.created_request_id; reason_value:=NEW.creation_reason; resource_value:=NEW.id; old_json:=NULL; new_json:=to_jsonb(NEW);
 ELSE SELECT * INTO m FROM water_balance_models WHERE id=NEW.model_id; actor:=CASE WHEN TG_OP='INSERT' THEN NEW.requested_by_user_id ELSE NEW.approved_by_user_id END; action_name:=CASE WHEN TG_OP='INSERT' THEN 'water_balance_version.requested' ELSE 'water_balance_version.approved' END; request_value:=CASE WHEN TG_OP='INSERT' THEN NEW.requested_request_id ELSE NEW.approved_request_id END; reason_value:=CASE WHEN TG_OP='INSERT' THEN NEW.request_reason ELSE NEW.approval_reason END; resource_value:=NEW.id; old_json:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END; new_json:=to_jsonb(NEW); END IF;
 INSERT INTO audit_events(organization_id,territory_id,actor_user_id,actor_organization_id,action,resource,resource_id,old_state,new_state,reason,request_id,data_classification,provenance) SELECT m.organization_id,m.territory_id,actor,u.organization_id,action_name::audit_event_action,'water_balance_model',resource_value,old_json,new_json,reason_value,request_value,'synthetic',m.provenance FROM identity_users u WHERE u.id=actor AND u.is_active; IF NOT FOUND THEN RAISE EXCEPTION 'water balance audit actor is inactive or absent' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION water_balance_detail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_row water_balance_versions%ROWTYPE; model_row water_balance_models%ROWTYPE; inserted_count integer; action_value audit_event_action;
BEGIN
 SELECT * INTO STRICT version_row FROM water_balance_versions WHERE id=NEW.version_id;
 SELECT * INTO STRICT model_row FROM water_balance_models WHERE id=version_row.model_id;
 action_value:=CASE WHEN TG_TABLE_NAME='water_balance_version_components' THEN 'water_balance_component.created'::audit_event_action ELSE 'water_balance_assumption.created'::audit_event_action END;
 INSERT INTO audit_events(organization_id,territory_id,actor_user_id,actor_organization_id,action,resource,resource_id,old_state,new_state,reason,request_id,data_classification,provenance)
 SELECT model_row.organization_id,model_row.territory_id,version_row.requested_by_user_id,user_row.organization_id,action_value,'water_balance_model',NEW.id,NULL,to_jsonb(NEW),version_row.request_reason,version_row.requested_request_id,'synthetic',NEW.provenance
 FROM identity_users user_row WHERE user_row.id=version_row.requested_by_user_id AND user_row.is_active;
 GET DIAGNOSTICS inserted_count=ROW_COUNT; IF inserted_count<>1 THEN RAISE EXCEPTION 'water balance detail audit actor is inactive or absent' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS water_balance_models_validate ON water_balance_models;
CREATE TRIGGER water_balance_models_validate BEFORE INSERT ON water_balance_models FOR EACH ROW EXECUTE FUNCTION water_balance_model_validate();
DROP TRIGGER IF EXISTS water_balance_models_immutable ON water_balance_models;
CREATE TRIGGER water_balance_models_immutable BEFORE UPDATE OR DELETE ON water_balance_models FOR EACH ROW EXECUTE FUNCTION water_balance_immutable();
DROP TRIGGER IF EXISTS water_balance_versions_validate ON water_balance_versions;
CREATE TRIGGER water_balance_versions_validate BEFORE INSERT ON water_balance_versions FOR EACH ROW EXECUTE FUNCTION water_balance_version_validate();
DROP TRIGGER IF EXISTS water_balance_versions_update ON water_balance_versions;
CREATE TRIGGER water_balance_versions_update BEFORE UPDATE ON water_balance_versions FOR EACH ROW EXECUTE FUNCTION water_balance_version_update_validate();
DROP TRIGGER IF EXISTS water_balance_components_validate ON water_balance_version_components;
CREATE TRIGGER water_balance_components_validate BEFORE INSERT ON water_balance_version_components FOR EACH ROW EXECUTE FUNCTION water_balance_component_validate();
DROP TRIGGER IF EXISTS water_balance_components_immutable ON water_balance_version_components;
CREATE TRIGGER water_balance_components_immutable BEFORE UPDATE OR DELETE ON water_balance_version_components FOR EACH ROW EXECUTE FUNCTION water_balance_immutable();
DROP TRIGGER IF EXISTS water_balance_assumptions_validate ON water_balance_version_assumptions;
CREATE TRIGGER water_balance_assumptions_validate BEFORE INSERT ON water_balance_version_assumptions FOR EACH ROW EXECUTE FUNCTION water_balance_assumption_validate();
DROP TRIGGER IF EXISTS water_balance_assumptions_immutable ON water_balance_version_assumptions;
CREATE TRIGGER water_balance_assumptions_immutable BEFORE UPDATE OR DELETE ON water_balance_version_assumptions FOR EACH ROW EXECUTE FUNCTION water_balance_immutable();
DROP TRIGGER IF EXISTS water_balance_models_audit ON water_balance_models;
CREATE TRIGGER water_balance_models_audit AFTER INSERT ON water_balance_models FOR EACH ROW EXECUTE FUNCTION water_balance_audit();
DROP TRIGGER IF EXISTS water_balance_versions_audit ON water_balance_versions;
CREATE TRIGGER water_balance_versions_audit AFTER INSERT OR UPDATE ON water_balance_versions FOR EACH ROW EXECUTE FUNCTION water_balance_audit();
DROP TRIGGER IF EXISTS water_balance_components_audit ON water_balance_version_components;
CREATE TRIGGER water_balance_components_audit AFTER INSERT ON water_balance_version_components FOR EACH ROW EXECUTE FUNCTION water_balance_detail_audit();
DROP TRIGGER IF EXISTS water_balance_assumptions_audit ON water_balance_version_assumptions;
CREATE TRIGGER water_balance_assumptions_audit AFTER INSERT ON water_balance_version_assumptions FOR EACH ROW EXECUTE FUNCTION water_balance_detail_audit();

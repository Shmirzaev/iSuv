-- Governed synthetic alarm catalog and automatic episode materialization.
-- Incident workflow, escalation, notifications, and OT control are intentionally absent.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TYPE audit_event_resource ADD VALUE IF NOT EXISTS 'alarm_catalog';
ALTER TYPE audit_event_resource ADD VALUE IF NOT EXISTS 'alarm';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'alarm_catalog.created';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'alarm_catalog_policy.requested';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'alarm_catalog_policy.approved';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'alarm.created';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'alarm.cleared';

CREATE TABLE IF NOT EXISTS alarm_catalog_event_types (
  code text PRIMARY KEY,
  event_domain text NOT NULL CHECK (event_domain IN ('water', 'device', 'data_quality', 'network_integrity')),
  source_kind text NOT NULL CHECK (source_kind IN ('observation_threshold', 'allocation_deviation', 'balance_residual', 'device_health', 'network')),
  activation_support text NOT NULL CHECK (activation_support IN ('p4_001_rule_signal', 'unconfigured')),
  water_condition text NOT NULL,
  system_condition text NOT NULL,
  CHECK (code IN (
    'over_allocation','under_allocation','unexplained_balance','sudden_flow_change',
    'high_stage','dry_canal','sensor_frozen','sensor_impossible','communication_loss',
    'power_problem','calibration_overdue','network_inconsistency'
  ))
);

INSERT INTO alarm_catalog_event_types(
  code,event_domain,source_kind,activation_support,water_condition,system_condition
) VALUES
  ('over_allocation','water','allocation_deviation','p4_001_rule_signal','over_allocation','not_assessed'),
  ('under_allocation','water','allocation_deviation','p4_001_rule_signal','under_allocation','not_assessed'),
  ('unexplained_balance','water','balance_residual','unconfigured','unexplained_balance','not_assessed'),
  ('sudden_flow_change','water','observation_threshold','p4_001_rule_signal','sudden_flow_change','not_assessed'),
  ('high_stage','water','observation_threshold','p4_001_rule_signal','high_stage','not_assessed'),
  ('dry_canal','water','observation_threshold','p4_001_rule_signal','dry_canal','not_assessed'),
  ('sensor_frozen','data_quality','device_health','unconfigured','not_assessed','sensor_frozen'),
  ('sensor_impossible','data_quality','device_health','unconfigured','not_assessed','sensor_impossible'),
  ('communication_loss','device','device_health','unconfigured','not_assessed','communication_loss'),
  ('power_problem','device','device_health','unconfigured','not_assessed','power_problem'),
  ('calibration_overdue','device','device_health','unconfigured','not_assessed','calibration_overdue'),
  ('network_inconsistency','network_integrity','network','unconfigured','not_assessed','network_inconsistency')
ON CONFLICT (code) DO UPDATE SET
  event_domain=EXCLUDED.event_domain,source_kind=EXCLUDED.source_kind,
  activation_support=EXCLUDED.activation_support,water_condition=EXCLUDED.water_condition,
  system_condition=EXCLUDED.system_condition;

CREATE TABLE IF NOT EXISTS alarm_catalogs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL REFERENCES territories(id), event_type text NOT NULL REFERENCES alarm_catalog_event_types(code),
  title text NOT NULL CHECK (btrim(title)<>'' AND length(title)<=256), provenance text NOT NULL CHECK (btrim(provenance)<>''),
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  created_by_user_id uuid NOT NULL REFERENCES identity_users(id), creation_reason text NOT NULL CHECK (btrim(creation_reason)<>''),
  created_request_id text NOT NULL CHECK (btrim(created_request_id)<>''), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (data_classification='synthetic'), UNIQUE(organization_id,territory_id,event_type)
);

CREATE TABLE IF NOT EXISTS alarm_catalog_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), catalog_id uuid NOT NULL REFERENCES alarm_catalogs(id),
  version integer NOT NULL CHECK(version>0), status text NOT NULL DEFAULT 'requested' CHECK(status IN('requested','approved')),
  effective_from timestamptz NOT NULL,effective_until timestamptz NOT NULL,rule_id uuid REFERENCES alarm_rules(id),
  activation_support text NOT NULL CHECK(activation_support IN('p4_001_rule_signal','unconfigured')),
  water_condition text NOT NULL CHECK(water_condition IN('over_allocation','under_allocation','high_stage','dry_canal','sudden_flow_change','unexplained_balance','not_assessed','unassessable')),
  system_condition text NOT NULL CHECK(system_condition IN('sensor_frozen','sensor_impossible','communication_loss','power_problem','calibration_overdue','network_inconsistency','not_assessed','unconfigured','unassessable')),
  severity text NOT NULL CHECK(severity IN('information','advisory','warning','critical')),
  provenance text NOT NULL CHECK(btrim(provenance)<>''),requested_by_user_id uuid NOT NULL REFERENCES identity_users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),request_reason text NOT NULL CHECK(btrim(request_reason)<>''),
  requested_request_id text NOT NULL CHECK(btrim(requested_request_id)<>''),approved_by_user_id uuid REFERENCES identity_users(id),
  approved_at timestamptz,approval_reason text,approved_request_id text,UNIQUE(catalog_id,version),
  CHECK(effective_until>effective_from),
  CHECK((activation_support='p4_001_rule_signal' AND rule_id IS NOT NULL) OR(activation_support='unconfigured' AND rule_id IS NULL)),
  CHECK((status='requested' AND approved_by_user_id IS NULL AND approved_at IS NULL AND approval_reason IS NULL AND approved_request_id IS NULL)
    OR(status='approved' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL AND approved_by_user_id<>requested_by_user_id AND approval_reason IS NOT NULL AND approved_request_id IS NOT NULL)),
  EXCLUDE USING gist(catalog_id WITH =,tstzrange(effective_from,effective_until,'[)') WITH &&) WHERE(status='approved'),
  EXCLUDE USING gist(rule_id WITH =,tstzrange(effective_from,effective_until,'[)') WITH &&)
    WHERE(status='approved' AND rule_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS alarms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),territory_id uuid NOT NULL REFERENCES territories(id),
  catalog_id uuid NOT NULL REFERENCES alarm_catalogs(id),catalog_version_id uuid NOT NULL REFERENCES alarm_catalog_versions(id),
  rule_id uuid NOT NULL REFERENCES alarm_rules(id),rule_version_id uuid NOT NULL REFERENCES alarm_rule_versions(id),event_type text NOT NULL REFERENCES alarm_catalog_event_types(code),
  water_condition text NOT NULL,system_condition text NOT NULL,severity text NOT NULL CHECK(severity IN('information','advisory','warning','critical')),
  automatic_state text NOT NULL DEFAULT 'active' CHECK(automatic_state IN('active','cleared')),
  activation_signal_run_id uuid NOT NULL REFERENCES alarm_rule_evaluation_runs(id),activation_episode_start timestamptz NOT NULL,
  activated_effective_at timestamptz NOT NULL,activated_known_at timestamptz NOT NULL,detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cleared_signal_run_id uuid REFERENCES alarm_rule_evaluation_runs(id),cleared_effective_at timestamptz,cleared_known_at timestamptz,cleared_at timestamptz,
  materialized_by_user_id uuid NOT NULL REFERENCES identity_users(id),materialized_request_id text NOT NULL CHECK(btrim(materialized_request_id)<>''),
  cleared_by_user_id uuid REFERENCES identity_users(id),cleared_request_id text,provenance text NOT NULL CHECK(btrim(provenance)<>''),
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',official_compliance_eligible boolean NOT NULL DEFAULT false,
  CHECK(data_classification='synthetic' AND NOT official_compliance_eligible),
  CHECK((automatic_state='active' AND cleared_signal_run_id IS NULL AND cleared_effective_at IS NULL AND cleared_known_at IS NULL AND cleared_at IS NULL AND cleared_by_user_id IS NULL AND cleared_request_id IS NULL)
    OR(automatic_state='cleared' AND cleared_signal_run_id IS NOT NULL AND cleared_effective_at IS NOT NULL AND cleared_known_at IS NOT NULL AND cleared_at IS NOT NULL AND cleared_by_user_id IS NOT NULL AND cleared_request_id IS NOT NULL)),
  UNIQUE(catalog_version_id,rule_version_id,activation_episode_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS alarms_open_catalog_rule_uq ON alarms(catalog_id,rule_id) WHERE automatic_state='active';
CREATE INDEX IF NOT EXISTS alarms_territory_detected_idx ON alarms(territory_id,detected_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS alarm_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),alarm_id uuid NOT NULL REFERENCES alarms(id),signal_run_id uuid NOT NULL REFERENCES alarm_rule_evaluation_runs(id),
  effective_at timestamptz NOT NULL,known_at timestamptz NOT NULL,evidence_status text NOT NULL CHECK(evidence_status IN('assessable','unassessable')),
  result jsonb NOT NULL,evidence jsonb NOT NULL,provenance text NOT NULL CHECK(btrim(provenance)<>''),
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(alarm_id,signal_run_id),CHECK(data_classification='synthetic'),CHECK(jsonb_typeof(result)='object' AND jsonb_typeof(evidence)='array')
);

CREATE OR REPLACE FUNCTION alarm_catalog_actor_may_act(actor_id uuid,target_organization uuid,target_territory uuid,required_action text,evaluated_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH RECURSIVE target_ancestors AS(
    SELECT id,parent_territory_id FROM territories WHERE id=target_territory AND organization_id=target_organization
    UNION ALL SELECT parent.id,parent.parent_territory_id FROM territories parent JOIN target_ancestors child ON child.parent_territory_id=parent.id WHERE parent.organization_id=target_organization
  ),actor AS(SELECT organization_id FROM identity_users WHERE id=actor_id AND is_active)
  SELECT EXISTS(SELECT 1 FROM user_role_grants role_grant CROSS JOIN actor WHERE role_grant.user_id=actor_id
    AND role_grant.organization_id=target_organization AND role_grant.cancelled_at IS NULL
    AND role_grant.effective_from<=evaluated_at
    AND(role_grant.effective_until IS NULL OR role_grant.effective_until>evaluated_at)
    AND((required_action='write' AND role_grant.role IN('system_admin','national_admin','regional_director','basin_dispatcher','district_operator'))
      OR(required_action='approve' AND role_grant.role IN('system_admin','national_admin','regional_director','hydrologist')))
    AND((role_grant.role='system_admin' AND role_grant.scope='system' AND role_grant.territory_id IS NULL)
      OR(actor.organization_id=target_organization AND role_grant.role='national_admin' AND role_grant.scope='national' AND role_grant.territory_id IS NULL)
      OR(actor.organization_id=target_organization AND role_grant.scope='territory' AND EXISTS(SELECT 1 FROM target_ancestors ancestor WHERE ancestor.id=role_grant.territory_id))))
$$;

CREATE OR REPLACE FUNCTION alarm_catalog_condition_compatible(event_code text,condition jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT CASE event_code
  WHEN 'over_allocation' THEN condition->>'kind'='allocation_deviation' AND condition->>'direction'='over'
  WHEN 'under_allocation' THEN condition->>'kind'='allocation_deviation' AND condition->>'direction'='under'
  WHEN 'high_stage' THEN condition->>'kind'='observation_threshold' AND condition->>'quantity'='stage' AND condition->>'unit'='m' AND condition->>'direction'='high'
  WHEN 'dry_canal' THEN condition->>'kind'='observation_threshold' AND condition->>'direction'='low' AND condition->>'quantity' IN('stage','discharge')
    AND((condition->>'quantity'='stage' AND condition->>'unit'='m')OR(condition->>'quantity'='discharge' AND condition->>'unit'='m3/s'))
  WHEN 'sudden_flow_change' THEN condition->>'kind'='observation_threshold' AND condition->>'quantity'='discharge' AND condition->>'unit'='m3/s' AND jsonb_typeof(condition->'rateGate')='object'
  ELSE false END $$;

CREATE OR REPLACE FUNCTION alarm_catalog_validate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  NEW.created_at:=clock_timestamp();
  IF NOT EXISTS(SELECT 1 FROM territories WHERE id=NEW.territory_id AND organization_id=NEW.organization_id)
    OR NOT alarm_catalog_actor_may_act(NEW.created_by_user_id,NEW.organization_id,NEW.territory_id,'write',NEW.created_at)
  THEN RAISE EXCEPTION 'alarm catalog scope or author is invalid' USING ERRCODE='23514';END IF;RETURN NEW;END $$;

CREATE OR REPLACE FUNCTION alarm_catalog_version_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE catalog_row alarm_catalogs%ROWTYPE;event_row alarm_catalog_event_types%ROWTYPE;rule_row alarm_rules%ROWTYPE;expected_version integer;BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.catalog_id::text));SELECT * INTO STRICT catalog_row FROM alarm_catalogs WHERE id=NEW.catalog_id;
  SELECT * INTO STRICT event_row FROM alarm_catalog_event_types WHERE code=catalog_row.event_type;
  SELECT COALESCE(max(version),0)+1 INTO expected_version FROM alarm_catalog_versions WHERE catalog_id=NEW.catalog_id;
  NEW.version:=expected_version;NEW.status:='requested';NEW.requested_at:=clock_timestamp();
  IF NEW.approved_by_user_id IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.approval_reason IS NOT NULL OR NEW.approved_request_id IS NOT NULL
    OR NOT alarm_catalog_actor_may_act(NEW.requested_by_user_id,catalog_row.organization_id,catalog_row.territory_id,'write',NEW.requested_at)
    OR NEW.water_condition<>event_row.water_condition OR NEW.system_condition<>event_row.system_condition OR NEW.activation_support<>event_row.activation_support
  THEN RAISE EXCEPTION 'alarm catalog version request is invalid' USING ERRCODE='23514';END IF;
  IF NEW.rule_id IS NOT NULL THEN SELECT * INTO STRICT rule_row FROM alarm_rules WHERE id=NEW.rule_id;
    IF rule_row.organization_id<>catalog_row.organization_id OR rule_row.territory_id<>catalog_row.territory_id OR NOT EXISTS(
      SELECT 1 FROM alarm_rule_versions rv WHERE rv.rule_id=NEW.rule_id AND rv.status='approved'
        AND tstzrange(rv.effective_from,rv.effective_until,'[)')&&tstzrange(NEW.effective_from,NEW.effective_until,'[)')
        AND alarm_catalog_condition_compatible(catalog_row.event_type,rv.condition))
    THEN RAISE EXCEPTION 'alarm catalog rule binding is invalid' USING ERRCODE='23514';END IF;END IF;RETURN NEW;END $$;

CREATE OR REPLACE FUNCTION alarm_catalog_version_update_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE catalog_row alarm_catalogs%ROWTYPE;BEGIN
  IF OLD.status='requested' AND NEW.status='approved' AND NEW.id=OLD.id AND NEW.catalog_id=OLD.catalog_id AND NEW.version=OLD.version
    AND NEW.effective_from=OLD.effective_from AND NEW.effective_until=OLD.effective_until AND NEW.rule_id IS NOT DISTINCT FROM OLD.rule_id
    AND NEW.activation_support=OLD.activation_support AND NEW.water_condition=OLD.water_condition AND NEW.system_condition=OLD.system_condition
    AND NEW.severity=OLD.severity AND NEW.provenance=OLD.provenance AND NEW.requested_by_user_id=OLD.requested_by_user_id
    AND NEW.requested_at=OLD.requested_at AND NEW.request_reason=OLD.request_reason AND NEW.requested_request_id=OLD.requested_request_id
    AND NEW.approved_by_user_id IS NOT NULL AND NEW.approved_by_user_id<>OLD.requested_by_user_id
    AND NEW.approval_reason IS NOT NULL AND btrim(NEW.approval_reason)<>'' AND NEW.approved_request_id IS NOT NULL AND btrim(NEW.approved_request_id)<>''
  THEN SELECT * INTO STRICT catalog_row FROM alarm_catalogs WHERE id=NEW.catalog_id;NEW.approved_at:=clock_timestamp();
    IF NOT alarm_catalog_actor_may_act(NEW.approved_by_user_id,catalog_row.organization_id,catalog_row.territory_id,'approve',NEW.approved_at)
    THEN RAISE EXCEPTION 'alarm catalog approval is invalid' USING ERRCODE='23514';END IF;RETURN NEW;END IF;
  RAISE EXCEPTION 'alarm catalog versions are immutable' USING ERRCODE='23514';END $$;

CREATE OR REPLACE FUNCTION alarm_record_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE catalog_row alarm_catalogs%ROWTYPE;version_row alarm_catalog_versions%ROWTYPE;run_row alarm_rule_evaluation_runs%ROWTYPE;rule_version_row alarm_rule_versions%ROWTYPE;BEGIN
  SELECT * INTO STRICT catalog_row FROM alarm_catalogs WHERE id=NEW.catalog_id;SELECT * INTO STRICT version_row FROM alarm_catalog_versions WHERE id=NEW.catalog_version_id;
  SELECT * INTO STRICT run_row FROM alarm_rule_evaluation_runs WHERE id=NEW.activation_signal_run_id;
  SELECT * INTO STRICT rule_version_row FROM alarm_rule_versions WHERE id=NEW.rule_version_id;NEW.detected_at:=clock_timestamp();
  IF catalog_row.organization_id<>NEW.organization_id OR catalog_row.territory_id<>NEW.territory_id OR catalog_row.event_type<>NEW.event_type
    OR version_row.catalog_id<>NEW.catalog_id OR version_row.status<>'approved' OR version_row.rule_id<>NEW.rule_id
    OR version_row.water_condition<>NEW.water_condition OR version_row.system_condition<>NEW.system_condition OR version_row.severity<>NEW.severity
    OR run_row.rule_id<>NEW.rule_id OR run_row.rule_version_id<>NEW.rule_version_id OR run_row.state<>'active'
    OR run_row.effective_at<>NEW.activated_effective_at OR run_row.known_at<>NEW.activated_known_at OR run_row.result->>'qualifyingStart' IS NULL
    OR(run_row.result->>'qualifyingStart')::timestamptz<>NEW.activation_episode_start
    OR version_row.effective_from>run_row.effective_at OR version_row.effective_until<=run_row.effective_at
    OR version_row.approved_at>run_row.known_at OR rule_version_row.rule_id<>NEW.rule_id
    OR NOT alarm_catalog_condition_compatible(NEW.event_type,rule_version_row.condition)
    OR NOT alarm_catalog_actor_may_act(NEW.materialized_by_user_id,NEW.organization_id,NEW.territory_id,'write',NEW.detected_at)
  THEN RAISE EXCEPTION 'alarm materialization snapshot is invalid' USING ERRCODE='23514';END IF;RETURN NEW;END $$;

CREATE OR REPLACE FUNCTION alarm_record_update_validate() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE run_row alarm_rule_evaluation_runs%ROWTYPE;BEGIN
  IF OLD.automatic_state='active' AND NEW.automatic_state='cleared' AND NEW.id=OLD.id AND NEW.organization_id=OLD.organization_id
    AND NEW.territory_id=OLD.territory_id AND NEW.catalog_id=OLD.catalog_id AND NEW.catalog_version_id=OLD.catalog_version_id
    AND NEW.rule_id=OLD.rule_id AND NEW.rule_version_id=OLD.rule_version_id AND NEW.event_type=OLD.event_type
    AND NEW.water_condition=OLD.water_condition AND NEW.system_condition=OLD.system_condition AND NEW.severity=OLD.severity
    AND NEW.activation_signal_run_id=OLD.activation_signal_run_id AND NEW.activation_episode_start=OLD.activation_episode_start
    AND NEW.activated_effective_at=OLD.activated_effective_at AND NEW.activated_known_at=OLD.activated_known_at AND NEW.detected_at=OLD.detected_at
    AND NEW.materialized_by_user_id=OLD.materialized_by_user_id AND NEW.materialized_request_id=OLD.materialized_request_id
    AND NEW.provenance=OLD.provenance AND NEW.data_classification=OLD.data_classification AND NEW.official_compliance_eligible=OLD.official_compliance_eligible
    AND NEW.cleared_signal_run_id IS NOT NULL AND NEW.cleared_by_user_id IS NOT NULL AND NEW.cleared_request_id IS NOT NULL
  THEN SELECT * INTO STRICT run_row FROM alarm_rule_evaluation_runs WHERE id=NEW.cleared_signal_run_id;NEW.cleared_at:=clock_timestamp();
    IF run_row.rule_id<>NEW.rule_id OR run_row.rule_version_id<>NEW.rule_version_id
      OR run_row.state<>'inactive' OR run_row.effective_at<>NEW.cleared_effective_at OR run_row.known_at<>NEW.cleared_known_at
      OR NEW.cleared_effective_at<NEW.activated_effective_at OR NOT alarm_catalog_actor_may_act(NEW.cleared_by_user_id,NEW.organization_id,NEW.territory_id,'write',NEW.cleared_at)
    THEN RAISE EXCEPTION 'alarm automatic clear is invalid' USING ERRCODE='23514';END IF;RETURN NEW;END IF;
  RAISE EXCEPTION 'alarm records are immutable except governed automatic clear' USING ERRCODE='23514';END $$;

CREATE OR REPLACE FUNCTION alarm_evidence_validate() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE alarm_row alarms%ROWTYPE;run_row alarm_rule_evaluation_runs%ROWTYPE;BEGIN
  SELECT * INTO STRICT alarm_row FROM alarms WHERE id=NEW.alarm_id;SELECT * INTO STRICT run_row FROM alarm_rule_evaluation_runs WHERE id=NEW.signal_run_id;NEW.created_at:=clock_timestamp();
  IF run_row.rule_id<>alarm_row.rule_id OR run_row.rule_version_id<>alarm_row.rule_version_id
    OR run_row.effective_at<>NEW.effective_at OR run_row.known_at<>NEW.known_at
    OR run_row.result IS DISTINCT FROM NEW.result OR run_row.evidence IS DISTINCT FROM NEW.evidence
    OR NEW.evidence_status<>(CASE WHEN run_row.state='deferred' THEN 'unassessable' ELSE 'assessable' END)
  THEN RAISE EXCEPTION 'alarm evidence snapshot is invalid' USING ERRCODE='23514';END IF;RETURN NEW;END $$;

CREATE OR REPLACE FUNCTION alarm_catalog_immutable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'alarm catalog records are immutable' USING ERRCODE='23514';END$$;

CREATE OR REPLACE FUNCTION alarm_catalog_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE catalog_row alarm_catalogs%ROWTYPE;actor_id uuid;action_value audit_event_action;request_value text;reason_value text;resource_value uuid;old_value jsonb;new_value jsonb;inserted_count integer;BEGIN
  IF TG_TABLE_NAME='alarm_catalogs' THEN catalog_row:=NEW;actor_id:=NEW.created_by_user_id;action_value:='alarm_catalog.created';request_value:=NEW.created_request_id;reason_value:=NEW.creation_reason;resource_value:=NEW.id;old_value:=NULL;new_value:=to_jsonb(NEW);
  ELSE SELECT * INTO STRICT catalog_row FROM alarm_catalogs WHERE id=NEW.catalog_id;actor_id:=CASE WHEN TG_OP='INSERT' THEN NEW.requested_by_user_id ELSE NEW.approved_by_user_id END;
    action_value:=CASE WHEN TG_OP='INSERT' THEN 'alarm_catalog_policy.requested'::audit_event_action ELSE 'alarm_catalog_policy.approved'::audit_event_action END;
    request_value:=CASE WHEN TG_OP='INSERT' THEN NEW.requested_request_id ELSE NEW.approved_request_id END;reason_value:=CASE WHEN TG_OP='INSERT' THEN NEW.request_reason ELSE NEW.approval_reason END;
    resource_value:=NEW.id;old_value:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;new_value:=to_jsonb(NEW);END IF;
  INSERT INTO audit_events(organization_id,territory_id,actor_user_id,actor_organization_id,action,resource,resource_id,old_state,new_state,reason,request_id,data_classification,provenance)
  SELECT catalog_row.organization_id,catalog_row.territory_id,actor_id,actor.organization_id,action_value,'alarm_catalog',resource_value,old_value,new_value,reason_value,request_value,'synthetic',catalog_row.provenance FROM identity_users actor WHERE actor.id=actor_id AND actor.is_active;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;IF inserted_count<>1 THEN RAISE EXCEPTION 'alarm catalog audit actor is invalid' USING ERRCODE='23514';END IF;RETURN NEW;END $$;

CREATE OR REPLACE FUNCTION alarm_record_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_id uuid;action_value audit_event_action;request_value text;old_value jsonb;inserted_count integer;BEGIN
  actor_id:=CASE WHEN TG_OP='INSERT' THEN NEW.materialized_by_user_id ELSE NEW.cleared_by_user_id END;action_value:=CASE WHEN TG_OP='INSERT' THEN 'alarm.created'::audit_event_action ELSE 'alarm.cleared'::audit_event_action END;
  request_value:=CASE WHEN TG_OP='INSERT' THEN NEW.materialized_request_id ELSE NEW.cleared_request_id END;old_value:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  INSERT INTO audit_events(organization_id,territory_id,actor_user_id,actor_organization_id,action,resource,resource_id,old_state,new_state,reason,request_id,data_classification,provenance)
  SELECT NEW.organization_id,NEW.territory_id,actor_id,actor.organization_id,action_value,'alarm',NEW.id,old_value,to_jsonb(NEW),'automatic governed signal materialization',request_value,'synthetic',NEW.provenance FROM identity_users actor WHERE actor.id=actor_id AND actor.is_active;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;IF inserted_count<>1 THEN RAISE EXCEPTION 'alarm audit actor is invalid' USING ERRCODE='23514';END IF;RETURN NEW;END $$;

DROP TRIGGER IF EXISTS alarm_catalogs_validate ON alarm_catalogs;CREATE TRIGGER alarm_catalogs_validate BEFORE INSERT ON alarm_catalogs FOR EACH ROW EXECUTE FUNCTION alarm_catalog_validate();
DROP TRIGGER IF EXISTS alarm_catalogs_immutable ON alarm_catalogs;CREATE TRIGGER alarm_catalogs_immutable BEFORE UPDATE OR DELETE ON alarm_catalogs FOR EACH ROW EXECUTE FUNCTION alarm_catalog_immutable();
DROP TRIGGER IF EXISTS alarm_catalog_versions_validate ON alarm_catalog_versions;CREATE TRIGGER alarm_catalog_versions_validate BEFORE INSERT ON alarm_catalog_versions FOR EACH ROW EXECUTE FUNCTION alarm_catalog_version_validate();
DROP TRIGGER IF EXISTS alarm_catalog_versions_update ON alarm_catalog_versions;CREATE TRIGGER alarm_catalog_versions_update BEFORE UPDATE ON alarm_catalog_versions FOR EACH ROW EXECUTE FUNCTION alarm_catalog_version_update_validate();
DROP TRIGGER IF EXISTS alarm_catalog_versions_delete ON alarm_catalog_versions;CREATE TRIGGER alarm_catalog_versions_delete BEFORE DELETE ON alarm_catalog_versions FOR EACH ROW EXECUTE FUNCTION alarm_catalog_immutable();
DROP TRIGGER IF EXISTS alarms_validate ON alarms;CREATE TRIGGER alarms_validate BEFORE INSERT ON alarms FOR EACH ROW EXECUTE FUNCTION alarm_record_validate();
DROP TRIGGER IF EXISTS alarms_update ON alarms;CREATE TRIGGER alarms_update BEFORE UPDATE ON alarms FOR EACH ROW EXECUTE FUNCTION alarm_record_update_validate();
DROP TRIGGER IF EXISTS alarms_delete ON alarms;CREATE TRIGGER alarms_delete BEFORE DELETE ON alarms FOR EACH ROW EXECUTE FUNCTION alarm_catalog_immutable();
DROP TRIGGER IF EXISTS alarm_evidence_validate ON alarm_evidence;CREATE TRIGGER alarm_evidence_validate BEFORE INSERT ON alarm_evidence FOR EACH ROW EXECUTE FUNCTION alarm_evidence_validate();
DROP TRIGGER IF EXISTS alarm_evidence_immutable ON alarm_evidence;CREATE TRIGGER alarm_evidence_immutable BEFORE UPDATE OR DELETE ON alarm_evidence FOR EACH ROW EXECUTE FUNCTION alarm_catalog_immutable();
DROP TRIGGER IF EXISTS alarm_catalogs_audit ON alarm_catalogs;CREATE TRIGGER alarm_catalogs_audit AFTER INSERT ON alarm_catalogs FOR EACH ROW EXECUTE FUNCTION alarm_catalog_audit();
DROP TRIGGER IF EXISTS alarm_catalog_versions_audit ON alarm_catalog_versions;CREATE TRIGGER alarm_catalog_versions_audit AFTER INSERT OR UPDATE ON alarm_catalog_versions FOR EACH ROW EXECUTE FUNCTION alarm_catalog_audit();
DROP TRIGGER IF EXISTS alarms_audit ON alarms;CREATE TRIGGER alarms_audit AFTER INSERT OR UPDATE ON alarms FOR EACH ROW EXECUTE FUNCTION alarm_record_audit();

-- P4-001 stores governed synthetic condition rules and immutable evaluations.
-- It creates no alarm severity, incident workflow, notification, or physical-control path.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TYPE audit_event_resource ADD VALUE IF NOT EXISTS 'alarm_rule';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'alarm_rule.created';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'alarm_rule_version.requested';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'alarm_rule_version.approved';

CREATE TABLE IF NOT EXISTS alarm_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('observation_sensor', 'allocation_plan')),
  subject_id uuid NOT NULL,
  provenance text NOT NULL,
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  created_by_user_id uuid NOT NULL REFERENCES identity_users(id),
  creation_reason text NOT NULL,
  created_request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT alarm_rules_territory_same_organization FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories(organization_id, id),
  CONSTRAINT alarm_rules_synthetic_only CHECK (data_classification = 'synthetic'),
  CONSTRAINT alarm_rules_text_bounded CHECK (
    btrim(provenance) <> '' AND length(provenance) <= 256
    AND btrim(creation_reason) <> '' AND length(creation_reason) <= 1000
    AND btrim(created_request_id) <> '' AND length(created_request_id) <= 256
  )
);

CREATE TABLE IF NOT EXISTS alarm_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES alarm_rules(id),
  version integer NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('requested', 'approved')),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz NOT NULL,
  algorithm_version text NOT NULL DEFAULT 'alarm-condition-v1'
    CHECK (algorithm_version = 'alarm-condition-v1'),
  condition jsonb NOT NULL,
  provenance text NOT NULL,
  requested_by_user_id uuid NOT NULL REFERENCES identity_users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_reason text NOT NULL,
  requested_request_id text NOT NULL,
  approved_by_user_id uuid REFERENCES identity_users(id),
  approved_at timestamptz,
  approval_reason text,
  approved_request_id text,
  UNIQUE (rule_id, version),
  CONSTRAINT alarm_rule_versions_forward CHECK (effective_until > effective_from),
  CONSTRAINT alarm_rule_versions_text_bounded CHECK (
    btrim(provenance) <> '' AND length(provenance) <= 256
    AND btrim(request_reason) <> '' AND length(request_reason) <= 1000
    AND btrim(requested_request_id) <> '' AND length(requested_request_id) <= 256
    AND (approval_reason IS NULL OR (btrim(approval_reason) <> '' AND length(approval_reason) <= 1000))
    AND (approved_request_id IS NULL OR (btrim(approved_request_id) <> '' AND length(approved_request_id) <= 256))
  ),
  CONSTRAINT alarm_rule_versions_state_evidence CHECK (
    (status = 'requested'
      AND approved_by_user_id IS NULL AND approved_at IS NULL
      AND approval_reason IS NULL AND approved_request_id IS NULL)
    OR
    (status = 'approved'
      AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL
      AND approved_by_user_id <> requested_by_user_id
      AND approval_reason IS NOT NULL AND approved_request_id IS NOT NULL)
  ),
  EXCLUDE USING gist (
    rule_id WITH =,
    tstzrange(effective_from, effective_until, '[)') WITH &&
  ) WHERE (status = 'approved')
);

CREATE TABLE IF NOT EXISTS alarm_rule_evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES alarm_rules(id),
  rule_version_id uuid REFERENCES alarm_rule_versions(id),
  effective_at timestamptz NOT NULL,
  known_at timestamptz NOT NULL,
  input_fingerprint text NOT NULL,
  algorithm_version text NOT NULL CHECK (algorithm_version = 'alarm-condition-v1'),
  state text NOT NULL CHECK (state IN ('inactive', 'pending_activation', 'active', 'pending_clear', 'deferred')),
  reason text,
  result jsonb NOT NULL,
  evidence jsonb NOT NULL,
  evidence_count integer NOT NULL CHECK (evidence_count >= 0 AND evidence_count <= 4096),
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT alarm_rule_evaluation_fingerprint CHECK (input_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT alarm_rule_evaluation_synthetic CHECK (data_classification = 'synthetic'),
  CONSTRAINT alarm_rule_evaluation_reason CHECK (
    (state = 'deferred' AND reason IS NOT NULL AND btrim(reason) <> '') OR state <> 'deferred'
  ),
  UNIQUE (rule_version_id, effective_at, known_at, input_fingerprint)
);

ALTER TABLE alarm_rule_evaluation_runs ALTER COLUMN rule_version_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS alarm_rule_evaluations_identity_idx
  ON alarm_rule_evaluation_runs(rule_id, effective_at, known_at, input_fingerprint);

CREATE INDEX IF NOT EXISTS alarm_rule_evaluations_rule_cutoff_idx
  ON alarm_rule_evaluation_runs(rule_id, effective_at DESC, known_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS alarm_rule_current_signals (
  rule_id uuid PRIMARY KEY REFERENCES alarm_rules(id),
  evaluation_run_id uuid NOT NULL UNIQUE REFERENCES alarm_rule_evaluation_runs(id),
  effective_at timestamptz NOT NULL,
  known_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('inactive', 'pending_activation', 'active', 'pending_clear', 'deferred')),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION alarm_rule_actor_may_act(
  actor_id uuid,
  target_organization uuid,
  target_territory uuid,
  required_action text,
  evaluated_at timestamptz
) RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH RECURSIVE target_ancestors(id, parent_territory_id, path) AS (
    SELECT territory.id, territory.parent_territory_id, ARRAY[territory.id]
    FROM territories territory
    WHERE territory.id = target_territory AND territory.organization_id = target_organization
    UNION ALL
    SELECT parent.id, parent.parent_territory_id, ancestors.path || parent.id
    FROM territories parent
    JOIN target_ancestors ancestors ON parent.id = ancestors.parent_territory_id
    WHERE NOT parent.id = ANY(ancestors.path)
  )
  SELECT required_action IN ('write', 'approve') AND EXISTS (
    SELECT 1
    FROM identity_users actor
    JOIN user_role_grants role_grant ON role_grant.user_id = actor.id
    WHERE actor.id = actor_id AND actor.is_active
      AND role_grant.cancelled_at IS NULL
      AND role_grant.effective_from <= evaluated_at
      AND (role_grant.effective_until IS NULL OR role_grant.effective_until > evaluated_at)
      AND (
        (required_action = 'write' AND role_grant.role IN (
          'system_admin', 'national_admin', 'regional_director', 'basin_dispatcher', 'district_operator'
        ))
        OR
        (required_action = 'approve' AND role_grant.role IN (
          'system_admin', 'national_admin', 'regional_director', 'hydrologist'
        ))
      )
      AND (
        (role_grant.role = 'system_admin' AND role_grant.scope = 'system')
        OR
        (actor.organization_id = target_organization
          AND role_grant.role = 'national_admin' AND role_grant.scope = 'national')
        OR
        (actor.organization_id = target_organization AND role_grant.scope = 'territory'
          AND EXISTS (SELECT 1 FROM target_ancestors ancestor WHERE ancestor.id = role_grant.territory_id))
      )
  )
$$;

CREATE OR REPLACE FUNCTION alarm_rule_decimal(value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN value ~ '^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$'
    AND abs(value::numeric) < 1000000000000000000::numeric
    AND scale(value::numeric) <= 12;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION alarm_rule_duration(value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN value ~ '^[1-9][0-9]{0,13}$'
    AND value::numeric <= 31536000000000::numeric;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION alarm_rule_condition_valid(definition jsonb, rule_row alarm_rules)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE rate_definition jsonb;
BEGIN
  IF jsonb_typeof(definition) <> 'object' THEN RETURN false; END IF;
  IF definition->>'kind' = 'observation_threshold' THEN
    IF rule_row.subject_kind <> 'observation_sensor'
      OR definition->>'sensorId' <> rule_row.subject_id::text
      OR NOT (definition ?& ARRAY[
        'kind','sensorId','quantity','unit','direction','enter','clear',
        'enterPersistenceMicroseconds','clearPersistenceMicroseconds','maxGapMicroseconds',
        'uncertaintyBound','rateGate'
      ])
      OR definition - ARRAY[
        'kind','sensorId','quantity','unit','direction','enter','clear',
        'enterPersistenceMicroseconds','clearPersistenceMicroseconds','maxGapMicroseconds',
        'uncertaintyBound','rateGate'
      ] <> '{}'::jsonb
      OR definition->>'quantity' NOT IN ('stage','discharge')
      OR definition->>'direction' NOT IN ('high','low')
      OR (definition->>'quantity' = 'stage' AND definition->>'unit' <> 'm')
      OR (definition->>'quantity' = 'discharge' AND definition->>'unit' <> 'm3/s')
      OR NOT alarm_rule_decimal(definition->>'enter')
      OR NOT alarm_rule_decimal(definition->>'clear')
      OR NOT alarm_rule_decimal(definition->>'uncertaintyBound')
      OR (definition->>'uncertaintyBound')::numeric < 0
      OR NOT alarm_rule_duration(definition->>'enterPersistenceMicroseconds')
      OR NOT alarm_rule_duration(definition->>'clearPersistenceMicroseconds')
      OR NOT alarm_rule_duration(definition->>'maxGapMicroseconds')
      OR (definition->>'direction' = 'high' AND (definition->>'clear')::numeric >= (definition->>'enter')::numeric)
      OR (definition->>'direction' = 'low' AND (definition->>'clear')::numeric <= (definition->>'enter')::numeric)
    THEN RETURN false; END IF;
    rate_definition := definition->'rateGate';
    IF rate_definition IS NOT NULL AND jsonb_typeof(rate_definition) <> 'null' THEN
      IF jsonb_typeof(rate_definition) <> 'object'
        OR NOT (rate_definition ?& ARRAY['direction','unit','enter','clear'])
        OR rate_definition - ARRAY['direction','unit','enter','clear'] <> '{}'::jsonb
        OR rate_definition->>'direction' NOT IN ('rise','fall')
        OR (definition->>'quantity' = 'stage' AND rate_definition->>'unit' <> 'm/s')
        OR (definition->>'quantity' = 'discharge' AND rate_definition->>'unit' <> 'm3/s2')
        OR NOT alarm_rule_decimal(rate_definition->>'enter')
        OR NOT alarm_rule_decimal(rate_definition->>'clear')
        OR (rate_definition->>'clear')::numeric < 0
        OR (rate_definition->>'enter')::numeric <= (rate_definition->>'clear')::numeric
      THEN RETURN false; END IF;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM telemetry_sensors sensor
      WHERE sensor.id = rule_row.subject_id
        AND sensor.organization_id = rule_row.organization_id
        AND sensor.territory_id = rule_row.territory_id
        AND sensor.lifecycle = 'active'
        AND sensor.data_classification = 'synthetic'
        AND sensor.measurement_kind::text = definition->>'quantity'
        AND sensor.unit = definition->>'unit'
    );
  ELSIF definition->>'kind' = 'allocation_deviation' THEN
    IF rule_row.subject_kind <> 'allocation_plan'
      OR definition->>'planId' <> rule_row.subject_id::text
      OR NOT (definition ?& ARRAY[
        'kind','planId','direction','enterPersistenceMicroseconds',
        'clearPersistenceMicroseconds','maxGapMicroseconds'
      ])
      OR definition - ARRAY[
        'kind','planId','direction','enterPersistenceMicroseconds',
        'clearPersistenceMicroseconds','maxGapMicroseconds'
      ] <> '{}'::jsonb
      OR definition->>'direction' NOT IN ('over','under')
      OR NOT alarm_rule_duration(definition->>'enterPersistenceMicroseconds')
      OR NOT alarm_rule_duration(definition->>'clearPersistenceMicroseconds')
      OR NOT alarm_rule_duration(definition->>'maxGapMicroseconds')
    THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM allocation_plans plan
      WHERE plan.id = rule_row.subject_id
        AND plan.organization_id = rule_row.organization_id
        AND plan.territory_id = rule_row.territory_id
    );
  END IF;
  RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION alarm_rule_validate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at := clock_timestamp();
  IF NOT alarm_rule_actor_may_act(
    NEW.created_by_user_id, NEW.organization_id, NEW.territory_id, 'write', NEW.created_at
  ) THEN RAISE EXCEPTION 'alarm rule subject, scope, or author is invalid' USING ERRCODE = '23514'; END IF;
  IF NEW.subject_kind = 'observation_sensor' AND NOT EXISTS (
    SELECT 1 FROM telemetry_sensors sensor
    WHERE sensor.id = NEW.subject_id AND sensor.organization_id = NEW.organization_id
      AND sensor.territory_id = NEW.territory_id AND sensor.lifecycle = 'active'
      AND sensor.data_classification = 'synthetic'
  ) THEN RAISE EXCEPTION 'alarm rule observation subject is invalid' USING ERRCODE = '23514'; END IF;
  IF NEW.subject_kind = 'allocation_plan' AND NOT EXISTS (
    SELECT 1 FROM allocation_plans plan
    WHERE plan.id = NEW.subject_id AND plan.organization_id = NEW.organization_id
      AND plan.territory_id = NEW.territory_id
  ) THEN RAISE EXCEPTION 'alarm rule allocation subject is invalid' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION alarm_rule_version_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rule_row alarm_rules%ROWTYPE; expected_version integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.rule_id::text));
  SELECT * INTO STRICT rule_row FROM alarm_rules WHERE id = NEW.rule_id;
  SELECT COALESCE(max(version), 0) + 1 INTO expected_version
  FROM alarm_rule_versions WHERE rule_id = NEW.rule_id;
  NEW.requested_at := clock_timestamp();
  IF NEW.version <> expected_version OR NEW.status <> 'requested'
    OR NEW.algorithm_version <> 'alarm-condition-v1'
    OR NOT alarm_rule_condition_valid(NEW.condition, rule_row)
    OR NOT alarm_rule_actor_may_act(
      NEW.requested_by_user_id, rule_row.organization_id, rule_row.territory_id, 'write', NEW.requested_at
    )
  THEN RAISE EXCEPTION 'alarm rule version request is invalid' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION alarm_rule_version_update_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rule_row alarm_rules%ROWTYPE;
BEGIN
  IF OLD.status = 'requested'
    AND OLD.approved_by_user_id IS NULL AND OLD.approved_at IS NULL
    AND OLD.approval_reason IS NULL AND OLD.approved_request_id IS NULL
    AND NEW.status = 'approved'
    AND NEW.id = OLD.id AND NEW.rule_id = OLD.rule_id AND NEW.version = OLD.version
    AND NEW.effective_from = OLD.effective_from AND NEW.effective_until = OLD.effective_until
    AND NEW.algorithm_version = OLD.algorithm_version AND NEW.condition = OLD.condition
    AND NEW.provenance = OLD.provenance
    AND NEW.requested_by_user_id = OLD.requested_by_user_id
    AND NEW.requested_at = OLD.requested_at
    AND NEW.request_reason = OLD.request_reason
    AND NEW.requested_request_id = OLD.requested_request_id
  THEN
    SELECT * INTO STRICT rule_row FROM alarm_rules WHERE id = NEW.rule_id;
    NEW.approved_at := clock_timestamp();
    IF NEW.approved_by_user_id IS NULL OR NEW.approved_by_user_id = OLD.requested_by_user_id
      OR NEW.approval_reason IS NULL OR btrim(NEW.approval_reason) = ''
      OR NEW.approved_request_id IS NULL OR btrim(NEW.approved_request_id) = ''
      OR NOT alarm_rule_actor_may_act(
        NEW.approved_by_user_id, rule_row.organization_id, rule_row.territory_id, 'approve', NEW.approved_at
      )
    THEN RAISE EXCEPTION 'alarm rule approval is invalid' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'alarm rule versions are immutable' USING ERRCODE = '23514';
END $$;

CREATE OR REPLACE FUNCTION alarm_rule_evaluation_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_row alarm_rule_versions%ROWTYPE;
BEGIN
  NEW.created_at := clock_timestamp();
  IF NEW.algorithm_version <> 'alarm-condition-v1'
    OR jsonb_typeof(NEW.result) <> 'object' OR jsonb_typeof(NEW.evidence) <> 'array'
    OR jsonb_array_length(NEW.evidence) <> NEW.evidence_count
    OR NEW.result->>'ruleId' IS DISTINCT FROM NEW.rule_id::text
    OR (NEW.result->>'effectiveAt')::timestamptz <> NEW.effective_at
    OR (NEW.result->>'knownAt')::timestamptz <> NEW.known_at
    OR NEW.result->>'state' IS DISTINCT FROM NEW.state
    OR NEW.result->>'reason' IS DISTINCT FROM NEW.reason
    OR NEW.result->>'dataClassification' IS DISTINCT FROM 'synthetic'
    OR NEW.result->>'officialComplianceEligible' IS DISTINCT FROM 'false'
    OR NEW.result->>'alarmEligible' IS DISTINCT FROM 'false'
    OR NEW.result->'evidence' IS DISTINCT FROM NEW.evidence
  THEN RAISE EXCEPTION 'alarm rule evaluation snapshot is invalid' USING ERRCODE = '23514'; END IF;

  IF NEW.rule_version_id IS NULL THEN
    IF NEW.result->'versionId' IS DISTINCT FROM 'null'::jsonb
      OR NEW.state <> 'deferred' OR NEW.reason <> 'unconfigured_rule'
      OR NEW.evidence_count <> 0
      OR EXISTS (
        SELECT 1 FROM alarm_rule_versions configured
        WHERE configured.rule_id = NEW.rule_id AND configured.status = 'approved'
          AND configured.effective_from <= NEW.effective_at
          AND configured.effective_until > NEW.effective_at
          AND configured.approved_at <= NEW.known_at
      )
    THEN RAISE EXCEPTION 'alarm rule unconfigured snapshot is invalid' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO STRICT version_row FROM alarm_rule_versions WHERE id = NEW.rule_version_id;
  IF version_row.rule_id <> NEW.rule_id OR version_row.status <> 'approved'
    OR version_row.effective_from > NEW.effective_at OR version_row.effective_until <= NEW.effective_at
    OR version_row.approved_at > NEW.known_at OR NEW.algorithm_version <> version_row.algorithm_version
    OR NEW.result->>'versionId' IS DISTINCT FROM NEW.rule_version_id::text
  THEN RAISE EXCEPTION 'alarm rule evaluation version binding is invalid' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION alarm_rule_current_signal_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_row alarm_rule_evaluation_runs%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'alarm rule current projection cannot be deleted directly' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO STRICT run_row FROM alarm_rule_evaluation_runs WHERE id = NEW.evaluation_run_id;
  IF run_row.rule_id <> NEW.rule_id OR run_row.effective_at <> NEW.effective_at
    OR run_row.known_at <> NEW.known_at OR run_row.state <> NEW.state
    OR (TG_OP = 'UPDATE' AND NEW.evaluation_run_id <> OLD.evaluation_run_id
      AND NOT (
        NEW.effective_at > OLD.effective_at
        OR (NEW.effective_at = OLD.effective_at AND NEW.known_at > OLD.known_at)
      ))
  THEN RAISE EXCEPTION 'alarm rule current projection is inconsistent' USING ERRCODE = '23514'; END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION rebuild_alarm_rule_current_signals() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE rebuilt bigint;
BEGIN
  INSERT INTO alarm_rule_current_signals(
    rule_id,evaluation_run_id,effective_at,known_at,state,updated_at
  )
  SELECT DISTINCT ON (run.rule_id)
    run.rule_id,run.id,run.effective_at,run.known_at,run.state,clock_timestamp()
  FROM alarm_rule_evaluation_runs run
  ORDER BY run.rule_id,run.effective_at DESC,run.known_at DESC,run.id DESC
  ON CONFLICT(rule_id) DO UPDATE SET
    evaluation_run_id=EXCLUDED.evaluation_run_id,effective_at=EXCLUDED.effective_at,
    known_at=EXCLUDED.known_at,state=EXCLUDED.state,updated_at=clock_timestamp();
  GET DIAGNOSTICS rebuilt = ROW_COUNT;
  RETURN rebuilt;
END $$;

CREATE OR REPLACE FUNCTION alarm_rule_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'alarm rule records are immutable' USING ERRCODE = '23514'; END $$;

CREATE OR REPLACE FUNCTION alarm_rule_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rule_row alarm_rules%ROWTYPE; actor_id uuid; action_value audit_event_action;
  request_value text; reason_value text; resource_value uuid;
  old_value jsonb; new_value jsonb; inserted_count integer;
BEGIN
  IF TG_TABLE_NAME = 'alarm_rules' THEN
    rule_row := NEW; actor_id := NEW.created_by_user_id; action_value := 'alarm_rule.created';
    request_value := NEW.created_request_id; reason_value := NEW.creation_reason;
    resource_value := NEW.id; old_value := NULL; new_value := to_jsonb(NEW);
  ELSE
    SELECT * INTO STRICT rule_row FROM alarm_rules WHERE id = NEW.rule_id;
    actor_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.requested_by_user_id ELSE NEW.approved_by_user_id END;
    action_value := CASE WHEN TG_OP = 'INSERT' THEN 'alarm_rule_version.requested'::audit_event_action ELSE 'alarm_rule_version.approved'::audit_event_action END;
    request_value := CASE WHEN TG_OP = 'INSERT' THEN NEW.requested_request_id ELSE NEW.approved_request_id END;
    reason_value := CASE WHEN TG_OP = 'INSERT' THEN NEW.request_reason ELSE NEW.approval_reason END;
    resource_value := NEW.id; old_value := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END; new_value := to_jsonb(NEW);
  END IF;
  INSERT INTO audit_events(
    organization_id, territory_id, actor_user_id, actor_organization_id,
    action, resource, resource_id, old_state, new_state, reason, request_id,
    data_classification, provenance
  )
  SELECT rule_row.organization_id, rule_row.territory_id, actor_id, actor.organization_id,
    action_value, 'alarm_rule', resource_value, old_value, new_value, reason_value,
    request_value, 'synthetic', rule_row.provenance
  FROM identity_users actor WHERE actor.id = actor_id AND actor.is_active;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count <> 1 THEN RAISE EXCEPTION 'alarm rule audit actor is inactive or absent' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS alarm_rules_validate ON alarm_rules;
CREATE TRIGGER alarm_rules_validate BEFORE INSERT ON alarm_rules FOR EACH ROW EXECUTE FUNCTION alarm_rule_validate();
DROP TRIGGER IF EXISTS alarm_rules_immutable ON alarm_rules;
CREATE TRIGGER alarm_rules_immutable BEFORE UPDATE OR DELETE ON alarm_rules FOR EACH ROW EXECUTE FUNCTION alarm_rule_immutable();
DROP TRIGGER IF EXISTS alarm_rule_versions_validate ON alarm_rule_versions;
CREATE TRIGGER alarm_rule_versions_validate BEFORE INSERT ON alarm_rule_versions FOR EACH ROW EXECUTE FUNCTION alarm_rule_version_validate();
DROP TRIGGER IF EXISTS alarm_rule_versions_update ON alarm_rule_versions;
CREATE TRIGGER alarm_rule_versions_update BEFORE UPDATE ON alarm_rule_versions FOR EACH ROW EXECUTE FUNCTION alarm_rule_version_update_validate();
DROP TRIGGER IF EXISTS alarm_rule_versions_delete ON alarm_rule_versions;
CREATE TRIGGER alarm_rule_versions_delete BEFORE DELETE ON alarm_rule_versions FOR EACH ROW EXECUTE FUNCTION alarm_rule_immutable();
DROP TRIGGER IF EXISTS alarm_rule_evaluations_validate ON alarm_rule_evaluation_runs;
CREATE TRIGGER alarm_rule_evaluations_validate BEFORE INSERT ON alarm_rule_evaluation_runs FOR EACH ROW EXECUTE FUNCTION alarm_rule_evaluation_validate();
DROP TRIGGER IF EXISTS alarm_rule_evaluations_immutable ON alarm_rule_evaluation_runs;
CREATE TRIGGER alarm_rule_evaluations_immutable BEFORE UPDATE OR DELETE ON alarm_rule_evaluation_runs FOR EACH ROW EXECUTE FUNCTION alarm_rule_immutable();
DROP TRIGGER IF EXISTS alarm_rule_current_signals_validate ON alarm_rule_current_signals;
CREATE TRIGGER alarm_rule_current_signals_validate BEFORE INSERT OR UPDATE OR DELETE ON alarm_rule_current_signals FOR EACH ROW EXECUTE FUNCTION alarm_rule_current_signal_validate();
DROP TRIGGER IF EXISTS alarm_rules_audit ON alarm_rules;
CREATE TRIGGER alarm_rules_audit AFTER INSERT ON alarm_rules FOR EACH ROW EXECUTE FUNCTION alarm_rule_audit();
DROP TRIGGER IF EXISTS alarm_rule_versions_audit ON alarm_rule_versions;
CREATE TRIGGER alarm_rule_versions_audit AFTER INSERT OR UPDATE ON alarm_rule_versions FOR EACH ROW EXECUTE FUNCTION alarm_rule_audit();

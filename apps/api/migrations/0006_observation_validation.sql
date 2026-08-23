CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TYPE audit_event_resource ADD VALUE IF NOT EXISTS 'validation_profile';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'validation_profile.created';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'validation_profile_version.created';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'validation_profile_version.approved';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'observation.automatically_validated';

DO $$ BEGIN
  CREATE TYPE validation_profile_version_status AS ENUM ('draft', 'approved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS validation_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  sensor_id uuid NOT NULL,
  measurement_kind sensor_measurement_kind NOT NULL,
  data_classification record_data_classification NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT validation_profiles_name_bounded CHECK (btrim(name) <> '' AND length(name) <= 160),
  CONSTRAINT validation_profiles_territory_same_organization FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories (organization_id, id),
  CONSTRAINT validation_profiles_sensor_same_organization FOREIGN KEY (organization_id, sensor_id)
    REFERENCES telemetry_sensors (organization_id, id),
  CONSTRAINT validation_profiles_scope_unique UNIQUE (organization_id, territory_id, sensor_id, measurement_kind, data_classification, name)
);

CREATE TABLE IF NOT EXISTS validation_profile_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES validation_profiles(id),
  version integer NOT NULL CHECK (version >= 1),
  status validation_profile_version_status NOT NULL DEFAULT 'draft',
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  rules jsonb NOT NULL,
  drafted_by_user_id uuid NOT NULL,
  drafted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_by_user_id uuid,
  approved_at timestamptz,
  approval_reason text,
  CONSTRAINT validation_profile_versions_unique UNIQUE (profile_id, version),
  CONSTRAINT validation_profile_versions_effective_range CHECK (effective_until IS NULL OR effective_until > effective_from),
  CONSTRAINT validation_profile_versions_rules_object CHECK (jsonb_typeof(rules) = 'object'),
  CONSTRAINT validation_profile_versions_draft_author_fk FOREIGN KEY (drafted_by_user_id) REFERENCES identity_users(id),
  CONSTRAINT validation_profile_versions_approver_fk FOREIGN KEY (approved_by_user_id) REFERENCES identity_users(id),
  CONSTRAINT validation_profile_versions_approval_state CHECK (
    (status = 'draft' AND approved_by_user_id IS NULL AND approved_at IS NULL AND approval_reason IS NULL)
    OR (status = 'approved' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL
      AND approval_reason IS NOT NULL AND btrim(approval_reason) <> '' AND approved_by_user_id <> drafted_by_user_id)
  ),
  CONSTRAINT validation_profile_versions_approved_non_overlap EXCLUDE USING gist (
    profile_id WITH =,
    tstzrange(effective_from, effective_until, '[)') WITH &&
  ) WHERE (status = 'approved')
);
CREATE INDEX IF NOT EXISTS validation_profile_versions_effective_idx
  ON validation_profile_versions (profile_id, effective_from DESC) WHERE status = 'approved';

ALTER TABLE observation_revisions ADD CONSTRAINT observation_revisions_lineage_id_unique UNIQUE (lineage_id, id);

CREATE TABLE IF NOT EXISTS observation_validation_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lineage_id uuid NOT NULL REFERENCES observation_lineages(id),
  source_revision_id uuid NOT NULL,
  profile_version_id uuid NOT NULL REFERENCES validation_profile_versions(id),
  algorithm_version text NOT NULL CHECK (algorithm_version = 'v1'),
  resulting_revision_id uuid NOT NULL,
  evidence jsonb NOT NULL,
  evaluated_at timestamptz NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES identity_users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT observation_validation_executions_source_revision_fk FOREIGN KEY (lineage_id, source_revision_id)
    REFERENCES observation_revisions (lineage_id, id),
  CONSTRAINT observation_validation_executions_resulting_revision_fk FOREIGN KEY (lineage_id, resulting_revision_id)
    REFERENCES observation_revisions (lineage_id, id),
  CONSTRAINT observation_validation_executions_idempotency UNIQUE (lineage_id, source_revision_id, profile_version_id, algorithm_version),
  CONSTRAINT observation_validation_executions_evidence_array CHECK (jsonb_typeof(evidence) = 'array')
);

CREATE OR REPLACE FUNCTION validate_validation_profile_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sensor_kind sensor_measurement_kind; sensor_classification record_data_classification;
BEGIN
  SELECT measurement_kind, data_classification INTO sensor_kind, sensor_classification
  FROM telemetry_sensors WHERE id = NEW.sensor_id AND organization_id = NEW.organization_id;
  IF sensor_kind IS NULL OR sensor_kind <> NEW.measurement_kind OR sensor_classification <> NEW.data_classification THEN
    RAISE EXCEPTION 'validation profile sensor kind and classification must match its organization-scoped sensor' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION validate_validation_profile_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'validation profile versions are append-only' USING ERRCODE = '23514'; END IF;
  IF OLD.status = 'draft' AND NEW.status = 'approved'
     AND NEW.profile_id = OLD.profile_id AND NEW.version = OLD.version
     AND NEW.effective_from = OLD.effective_from AND NEW.effective_until IS NOT DISTINCT FROM OLD.effective_until
     AND NEW.rules = OLD.rules AND NEW.drafted_by_user_id = OLD.drafted_by_user_id AND NEW.drafted_at = OLD.drafted_at
     AND NEW.approved_by_user_id IS NOT NULL AND NEW.approved_at IS NOT NULL
     AND NEW.approval_reason IS NOT NULL AND NEW.approved_by_user_id <> OLD.drafted_by_user_id THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'validation profile versions are immutable except a distinct-author approval' USING ERRCODE = '23514';
END; $$;
CREATE OR REPLACE FUNCTION validate_validation_profile_version_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile_organization uuid; author_organization uuid;
BEGIN
  SELECT organization_id INTO profile_organization FROM validation_profiles WHERE id = NEW.profile_id;
  SELECT organization_id INTO author_organization FROM identity_users WHERE id = NEW.drafted_by_user_id AND is_active = true;
  IF NEW.status <> 'draft' OR NEW.approved_by_user_id IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.approval_reason IS NOT NULL
     OR author_organization IS DISTINCT FROM profile_organization THEN
    RAISE EXCEPTION 'profile versions must begin as a same-organization draft' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION validate_validation_profile_version_approval_organization()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile_organization uuid; approver_organization uuid;
BEGIN
  SELECT profile.organization_id, actor.organization_id INTO profile_organization, approver_organization
  FROM validation_profiles profile JOIN identity_users actor ON actor.id = NEW.approved_by_user_id AND actor.is_active = true
  WHERE profile.id = NEW.profile_id;
  IF approver_organization IS DISTINCT FROM profile_organization THEN
    RAISE EXCEPTION 'profile approver must be active and in the profile organization' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION reject_validation_profile_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'validation profiles are append-only' USING ERRCODE = '23514';
END; $$;
DROP TRIGGER IF EXISTS validation_profiles_scope ON validation_profiles;
CREATE TRIGGER validation_profiles_scope BEFORE INSERT ON validation_profiles FOR EACH ROW EXECUTE FUNCTION validate_validation_profile_scope();
DROP TRIGGER IF EXISTS validation_profiles_append_only ON validation_profiles;
CREATE TRIGGER validation_profiles_append_only BEFORE UPDATE OR DELETE ON validation_profiles FOR EACH ROW EXECUTE FUNCTION reject_validation_profile_mutation();
DROP TRIGGER IF EXISTS validation_profile_versions_append_only ON validation_profile_versions;
CREATE TRIGGER validation_profile_versions_append_only BEFORE UPDATE OR DELETE ON validation_profile_versions FOR EACH ROW EXECUTE FUNCTION validate_validation_profile_version_mutation();
DROP TRIGGER IF EXISTS validation_profile_versions_begin_draft ON validation_profile_versions;
CREATE TRIGGER validation_profile_versions_begin_draft BEFORE INSERT ON validation_profile_versions FOR EACH ROW EXECUTE FUNCTION validate_validation_profile_version_insert();
DROP TRIGGER IF EXISTS validation_profile_versions_same_org_approver ON validation_profile_versions;
CREATE TRIGGER validation_profile_versions_same_org_approver BEFORE UPDATE ON validation_profile_versions FOR EACH ROW EXECUTE FUNCTION validate_validation_profile_version_approval_organization();
DROP TRIGGER IF EXISTS observation_validation_executions_append_only ON observation_validation_executions;
CREATE TRIGGER observation_validation_executions_append_only BEFORE UPDATE OR DELETE ON observation_validation_executions FOR EACH ROW EXECUTE FUNCTION reject_observation_history_mutation();

-- A scope has exactly one profile; version intervals therefore cannot be bypassed
-- through a second profile with a different display name.
ALTER TABLE validation_profiles DROP CONSTRAINT IF EXISTS validation_profiles_scope_unique;
ALTER TABLE validation_profiles ADD CONSTRAINT validation_profiles_scope_unique
  UNIQUE (organization_id, territory_id, sensor_id, measurement_kind, data_classification);

CREATE OR REPLACE FUNCTION validation_rules_are_approved_safe(candidate jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE candidate_key text; numeric_value numeric;
BEGIN
  IF jsonb_typeof(candidate) <> 'object' OR candidate = '{}'::jsonb THEN RETURN false; END IF;
  FOR candidate_key IN SELECT jsonb_object_keys(candidate) LOOP
    IF candidate_key NOT IN ('staleAfterSeconds', 'lateAfterSeconds', 'maximumRatePerSecond', 'frozenAfterCount', 'acceptReportedCounterTransitions', 'minimumValue', 'maximumValue', 'allowBootstrapWithoutPrior') THEN RETURN false; END IF;
  END LOOP;
  FOREACH candidate_key IN ARRAY ARRAY['staleAfterSeconds', 'lateAfterSeconds'] LOOP
    IF candidate ? candidate_key THEN
      IF jsonb_typeof(candidate -> candidate_key) <> 'number' OR candidate ->> candidate_key !~ '^\d+$' THEN RETURN false; END IF;
      numeric_value := (candidate ->> candidate_key)::numeric;
      IF numeric_value > 31536000 THEN RETURN false; END IF;
    END IF;
  END LOOP;
  IF candidate ? 'maximumRatePerSecond' AND (jsonb_typeof(candidate -> 'maximumRatePerSecond') <> 'string' OR candidate ->> 'maximumRatePerSecond' !~ '^(0|[1-9][0-9]{0,17})(\.[0-9]{1,12})?$') THEN RETURN false; END IF;
  FOREACH candidate_key IN ARRAY ARRAY['minimumValue', 'maximumValue'] LOOP
    IF candidate ? candidate_key AND (jsonb_typeof(candidate -> candidate_key) <> 'string' OR candidate ->> candidate_key !~ '^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,12})?$') THEN RETURN false; END IF;
  END LOOP;
  IF candidate ? 'minimumValue' AND candidate ? 'maximumValue' AND (candidate ->> 'minimumValue')::numeric > (candidate ->> 'maximumValue')::numeric THEN RETURN false; END IF;
  IF candidate ? 'frozenAfterCount' THEN
    IF jsonb_typeof(candidate -> 'frozenAfterCount') <> 'number' OR candidate ->> 'frozenAfterCount' !~ '^\d+$' THEN RETURN false; END IF;
    numeric_value := (candidate ->> 'frozenAfterCount')::numeric;
    IF numeric_value < 2 OR numeric_value > 1000 THEN RETURN false; END IF;
  END IF;
  FOREACH candidate_key IN ARRAY ARRAY['acceptReportedCounterTransitions', 'allowBootstrapWithoutPrior'] LOOP
    IF candidate ? candidate_key AND (jsonb_typeof(candidate -> candidate_key) <> 'boolean' OR candidate ->> candidate_key <> 'true') THEN RETURN false; END IF;
  END LOOP;
  IF candidate ? 'allowBootstrapWithoutPrior' AND NOT (candidate ? 'minimumValue' OR candidate ? 'maximumValue') THEN RETURN false; END IF;
  RETURN true;
END;
$$;

-- Profile authority is normally organization-local. The sole cross-organization
-- exception is an active user with a currently effective, noncancelled
-- system_admin/system grant; national scope deliberately remains local.
CREATE OR REPLACE FUNCTION validation_profile_actor_may_act(
  actor_id uuid,
  profile_organization_id uuid,
  evaluated_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM identity_users actor
    WHERE actor.id = actor_id
      AND actor.is_active = true
      AND (
        actor.organization_id = profile_organization_id
        OR EXISTS (
          SELECT 1
          FROM user_role_grants role_grant
          WHERE role_grant.user_id = actor.id
            AND role_grant.role = 'system_admin'
            AND role_grant.scope = 'system'
            AND role_grant.cancelled_at IS NULL
            AND role_grant.effective_from <= evaluated_at
            AND (role_grant.effective_until IS NULL OR role_grant.effective_until > evaluated_at)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION validate_validation_profile_version_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile_organization uuid;
BEGIN
  SELECT organization_id INTO profile_organization FROM validation_profiles WHERE id = NEW.profile_id;
  IF NEW.status <> 'draft' OR NEW.approved_by_user_id IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.approval_reason IS NOT NULL
     OR NOT validation_profile_actor_may_act(NEW.drafted_by_user_id, profile_organization, clock_timestamp()) THEN
    RAISE EXCEPTION 'profile versions must begin as an authorized active draft' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_validation_profile_version_approval_organization()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile_organization uuid;
BEGIN
  SELECT organization_id INTO profile_organization FROM validation_profiles WHERE id = NEW.profile_id;
  IF NOT validation_profile_actor_may_act(NEW.approved_by_user_id, profile_organization, clock_timestamp()) THEN
    RAISE EXCEPTION 'profile approver must be active and authorized for the profile organization' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_validation_profile_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'validation profile versions are append-only' USING ERRCODE = '23514'; END IF;
  IF OLD.status = 'draft' AND NEW.status = 'approved'
     AND NEW.profile_id = OLD.profile_id AND NEW.version = OLD.version
     AND NEW.effective_from = OLD.effective_from AND NEW.effective_until IS NOT DISTINCT FROM OLD.effective_until
     AND NEW.rules = OLD.rules AND NEW.drafted_by_user_id = OLD.drafted_by_user_id AND NEW.drafted_at = OLD.drafted_at
     AND NEW.approved_by_user_id IS NOT NULL AND NEW.approved_at IS NOT NULL
     AND NEW.approval_reason IS NOT NULL AND NEW.approved_by_user_id <> OLD.drafted_by_user_id THEN
    IF NOT validation_rules_are_approved_safe(NEW.rules) THEN
      RAISE EXCEPTION 'approved validation profile rules must be complete and well-formed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'validation profile versions are immutable except a distinct-author approval' USING ERRCODE = '23514';
END;
$$;

-- Allocation plans deliberately model only approved, time-bounded planned
-- delivery volumes.  They do not infer flow, actual delivery, tolerance or control.
DO $$ BEGIN
  CREATE TYPE allocation_plan_version_status AS ENUM ('draft', 'requested', 'approved', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE audit_event_resource ADD VALUE IF NOT EXISTS 'allocation_plan';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'allocation_plan.created';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'allocation_plan_version.created';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'allocation_plan_version.requested';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'allocation_plan_version.approved';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'allocation_plan_version.superseded';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'allocation_plan_entry.created';

CREATE TABLE IF NOT EXISTS allocation_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  water_section_id uuid NOT NULL,
  data_classification record_data_classification NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES identity_users(id),
  creation_reason text NOT NULL CHECK (btrim(creation_reason) <> ''),
  created_request_id text NOT NULL CHECK (btrim(created_request_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT allocation_plans_section_unique UNIQUE (water_section_id),
  CONSTRAINT allocation_plans_territory_same_organization FOREIGN KEY (organization_id, territory_id) REFERENCES territories(organization_id, id),
  CONSTRAINT allocation_plans_section_same_organization FOREIGN KEY (organization_id, water_section_id) REFERENCES water_sections(organization_id, id),
  CONSTRAINT allocation_plans_organization_id_unique UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS allocation_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES allocation_plans(id),
  version integer NOT NULL CHECK (version >= 1),
  status allocation_plan_version_status NOT NULL DEFAULT 'draft',
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  drafted_by_user_id uuid NOT NULL REFERENCES identity_users(id),
  draft_reason text NOT NULL CHECK (btrim(draft_reason) <> ''),
  draft_request_id text NOT NULL CHECK (btrim(draft_request_id) <> ''),
  drafted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  requested_by_user_id uuid REFERENCES identity_users(id),
  requested_at timestamptz,
  request_reason text,
  requested_request_id text,
  approved_by_user_id uuid REFERENCES identity_users(id),
  approved_at timestamptz,
  approval_reason text,
  legal_reference text,
  approved_request_id text,
  superseded_effective_at timestamptz,
  superseded_at timestamptz,
  superseded_by_version_id uuid,
  superseded_by_user_id uuid REFERENCES identity_users(id),
  supersession_reason text,
  superseded_request_id text,
  governed_effective_until timestamptz GENERATED ALWAYS AS (COALESCE(superseded_effective_at, effective_until)) STORED,
  CONSTRAINT allocation_plan_versions_plan_version_unique UNIQUE (plan_id, version),
  CONSTRAINT allocation_plan_versions_window CHECK (effective_until IS NULL OR effective_until > effective_from),
  CONSTRAINT allocation_plan_versions_requested_shape CHECK ((status IN ('requested','approved','superseded')) = (requested_by_user_id IS NOT NULL AND requested_at IS NOT NULL AND request_reason IS NOT NULL AND btrim(request_reason) <> '' AND requested_request_id IS NOT NULL AND btrim(requested_request_id) <> '')),
  CONSTRAINT allocation_plan_versions_approved_shape CHECK ((status IN ('approved','superseded')) = (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL AND approval_reason IS NOT NULL AND btrim(approval_reason) <> '' AND legal_reference IS NOT NULL AND btrim(legal_reference) <> '' AND approved_request_id IS NOT NULL AND btrim(approved_request_id) <> ''))
  ,CONSTRAINT allocation_plan_versions_supersession_shape CHECK ((status='superseded') = (superseded_effective_at IS NOT NULL AND superseded_at IS NOT NULL AND superseded_by_version_id IS NOT NULL AND superseded_by_user_id IS NOT NULL AND supersession_reason IS NOT NULL AND btrim(supersession_reason) <> '' AND superseded_request_id IS NOT NULL AND btrim(superseded_request_id) <> ''))
  ,CONSTRAINT allocation_plan_versions_superseded_after_approval CHECK (superseded_at IS NULL OR superseded_at >= approved_at)
  ,CONSTRAINT allocation_plan_versions_successor_fk FOREIGN KEY (superseded_by_version_id) REFERENCES allocation_plan_versions(id)
  ,CONSTRAINT allocation_plan_versions_governed_nonoverlap EXCLUDE USING gist (
    plan_id WITH =,
    tstzrange(effective_from, governed_effective_until, '[)') WITH &&
  ) WHERE (status IN ('approved', 'superseded')) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS allocation_plan_versions_plan_effective_idx ON allocation_plan_versions(plan_id, effective_from, effective_until);
CREATE TABLE IF NOT EXISTS allocation_plan_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_version_id uuid NOT NULL REFERENCES allocation_plan_versions(id),
  interval_start timestamptz NOT NULL,
  interval_end timestamptz NOT NULL,
  planned_volume_m3 numeric(30,12) NOT NULL CHECK (planned_volume_m3 >= 0),
  unit text NOT NULL DEFAULT 'm3' CHECK (unit = 'm3'),
  created_by_user_id uuid NOT NULL REFERENCES identity_users(id),
  creation_reason text NOT NULL CHECK (btrim(creation_reason) <> ''),
  created_request_id text NOT NULL CHECK (btrim(created_request_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT allocation_plan_entries_interval CHECK (interval_end > interval_start),
  CONSTRAINT allocation_plan_entries_interval_unique UNIQUE(plan_version_id, interval_start),
  CONSTRAINT allocation_plan_entries_nonoverlap EXCLUDE USING gist (plan_version_id WITH =, tstzrange(interval_start, interval_end, '[)') WITH &&)
);
CREATE INDEX IF NOT EXISTS allocation_plan_entries_version_interval_idx ON allocation_plan_entries(plan_version_id, interval_start);

CREATE OR REPLACE FUNCTION allocation_plan_actor_may_act(
  actor_id uuid,
  target_organization uuid,
  target_territory uuid,
  required_action text,
  evaluated_at timestamptz
)
RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE target_ancestors(id, parent_territory_id, path) AS (
   SELECT territory.id, territory.parent_territory_id, ARRAY[territory.id]
   FROM territories territory
   WHERE territory.id=target_territory AND territory.organization_id=target_organization
   UNION ALL
   SELECT parent.id, parent.parent_territory_id, ancestors.path || parent.id
   FROM territories parent
   JOIN target_ancestors ancestors ON parent.id=ancestors.parent_territory_id
   WHERE NOT parent.id=ANY(ancestors.path)
 )
 SELECT EXISTS (
   SELECT 1
   FROM identity_users actor
   JOIN user_role_grants role_grant ON role_grant.user_id=actor.id
   WHERE actor.id=actor_id AND actor.is_active
     AND role_grant.cancelled_at IS NULL
     AND role_grant.effective_from <= evaluated_at
     AND (role_grant.effective_until IS NULL OR role_grant.effective_until > evaluated_at)
     AND (
       (required_action='write' AND role_grant.role IN ('system_admin','national_admin','regional_director'))
       OR (required_action='approve' AND role_grant.role IN ('system_admin','national_admin','regional_director','hydrologist'))
     )
     AND (
       (role_grant.role='system_admin' AND role_grant.scope='system')
       OR (actor.organization_id=target_organization AND role_grant.role='national_admin' AND role_grant.scope='national')
       OR (actor.organization_id=target_organization AND role_grant.scope='territory' AND EXISTS (
         SELECT 1 FROM target_ancestors ancestor WHERE ancestor.id=role_grant.territory_id
       ))
     )
 );
$$;
CREATE OR REPLACE FUNCTION allocation_plan_version_actor_allowed(actor_id uuid, plan_id_value uuid, required_action text)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT allocation_plan_actor_may_act(actor_id, organization_id, territory_id, required_action, clock_timestamp())
 FROM allocation_plans WHERE id=plan_id_value
$$;
CREATE OR REPLACE FUNCTION allocation_plan_validate_entry()
RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE plan_window allocation_plan_versions%ROWTYPE; BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'allocation plan entries are immutable' USING ERRCODE = '23514'; END IF;
 SELECT * INTO plan_window FROM allocation_plan_versions WHERE id = NEW.plan_version_id;
 IF plan_window.status <> 'draft' OR NEW.interval_start < plan_window.effective_from OR (plan_window.effective_until IS NOT NULL AND NEW.interval_end > plan_window.effective_until)
    OR NEW.created_at < statement_timestamp() OR NEW.created_at > clock_timestamp()
    OR NOT allocation_plan_version_actor_allowed(NEW.created_by_user_id, plan_window.plan_id, 'write') THEN
   RAISE EXCEPTION 'entry must be an authorized insert into a draft within its effective interval' USING ERRCODE = '23514';
 END IF;
 RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION reject_allocation_plan_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'allocation plans are immutable' USING ERRCODE = '23514'; END $$;
CREATE OR REPLACE FUNCTION allocation_plan_validate_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.data_classification <> 'synthetic' OR NOT EXISTS (SELECT 1 FROM water_sections section_row WHERE section_row.id=NEW.water_section_id AND section_row.lifecycle='active' AND section_row.organization_id=NEW.organization_id AND section_row.territory_id=NEW.territory_id) THEN
   RAISE EXCEPTION 'allocation plan must be synthetic and match its active water section scope' USING ERRCODE = '23514';
 END IF;
 IF NEW.created_at < statement_timestamp() OR NEW.created_at > clock_timestamp()
    OR NOT allocation_plan_actor_may_act(NEW.created_by_user_id, NEW.organization_id, NEW.territory_id, 'write', clock_timestamp()) THEN
   RAISE EXCEPTION 'allocation plan creator is not authorized for its governed scope' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;

-- Every transition takes
-- the plan lock so the deferred governed-range exclusion is evaluated against
-- one serial lifecycle at commit, including direct SQL attempts.
CREATE OR REPLACE FUNCTION allocation_plan_validate_version_insert()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.plan_id::text));
  IF NEW.status <> 'draft' OR NEW.drafted_at < statement_timestamp() OR NEW.drafted_at > clock_timestamp()
     OR NEW.requested_by_user_id IS NOT NULL OR NEW.requested_at IS NOT NULL OR NEW.request_reason IS NOT NULL
     OR NEW.requested_request_id IS NOT NULL OR NEW.approved_by_user_id IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.approval_reason IS NOT NULL OR NEW.legal_reference IS NOT NULL OR NEW.approved_request_id IS NOT NULL
     OR NEW.superseded_effective_at IS NOT NULL OR NEW.superseded_at IS NOT NULL OR NEW.superseded_by_version_id IS NOT NULL OR NEW.superseded_by_user_id IS NOT NULL OR NEW.supersession_reason IS NOT NULL OR NEW.superseded_request_id IS NOT NULL
     OR NOT allocation_plan_version_actor_allowed(NEW.drafted_by_user_id, NEW.plan_id, 'write') THEN
    RAISE EXCEPTION 'allocation plan versions must begin as authorized clean drafts' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION allocation_plan_validate_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE locked_plan uuid;
BEGIN
  locked_plan := COALESCE(NEW.plan_id, OLD.plan_id);
  PERFORM pg_advisory_xact_lock(hashtext(locked_plan::text));
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'allocation plan versions are immutable' USING ERRCODE = '23514'; END IF;
  IF OLD.status='draft' AND NEW.status='requested'
     AND NEW.plan_id=OLD.plan_id AND NEW.version=OLD.version AND NEW.effective_from=OLD.effective_from AND NEW.effective_until IS NOT DISTINCT FROM OLD.effective_until
     AND NEW.drafted_by_user_id=OLD.drafted_by_user_id AND NEW.draft_reason=OLD.draft_reason AND NEW.draft_request_id=OLD.draft_request_id AND NEW.drafted_at=OLD.drafted_at
     AND NEW.requested_by_user_id IS NOT NULL AND NEW.requested_at IS NOT NULL AND NEW.requested_at >= statement_timestamp() AND NEW.requested_at <= clock_timestamp() AND NEW.requested_at >= OLD.drafted_at AND NEW.request_reason IS NOT NULL AND NEW.requested_request_id IS NOT NULL
     AND NEW.approved_by_user_id IS NULL AND NEW.approved_at IS NULL AND NEW.approval_reason IS NULL AND NEW.legal_reference IS NULL AND NEW.approved_request_id IS NULL
     AND NEW.superseded_effective_at IS NULL AND NEW.superseded_at IS NULL AND NEW.superseded_by_version_id IS NULL AND NEW.superseded_by_user_id IS NULL AND NEW.supersession_reason IS NULL AND NEW.superseded_request_id IS NULL
     AND allocation_plan_version_actor_allowed(NEW.requested_by_user_id, NEW.plan_id, 'write') THEN RETURN NEW; END IF;
  IF OLD.status='requested' AND NEW.status='approved'
     AND NEW.plan_id=OLD.plan_id AND NEW.version=OLD.version AND NEW.effective_from=OLD.effective_from AND NEW.effective_until IS NOT DISTINCT FROM OLD.effective_until
     AND NEW.drafted_by_user_id=OLD.drafted_by_user_id AND NEW.draft_reason=OLD.draft_reason AND NEW.draft_request_id=OLD.draft_request_id AND NEW.drafted_at=OLD.drafted_at AND NEW.requested_by_user_id=OLD.requested_by_user_id AND NEW.requested_at=OLD.requested_at AND NEW.request_reason=OLD.request_reason AND NEW.requested_request_id=OLD.requested_request_id
     AND NEW.approved_by_user_id IS NOT NULL AND NEW.approved_at IS NOT NULL AND NEW.approved_at >= statement_timestamp() AND NEW.approved_at <= clock_timestamp()
     AND NEW.approved_at >= OLD.requested_at AND NEW.effective_from >= NEW.approved_at
     AND NEW.approval_reason IS NOT NULL AND NEW.legal_reference IS NOT NULL AND NEW.approved_request_id IS NOT NULL AND NEW.approved_by_user_id <> NEW.requested_by_user_id
     AND NEW.superseded_effective_at IS NULL AND NEW.superseded_at IS NULL AND NEW.superseded_by_version_id IS NULL AND NEW.superseded_by_user_id IS NULL AND NEW.supersession_reason IS NULL AND NEW.superseded_request_id IS NULL
     AND allocation_plan_version_actor_allowed(NEW.approved_by_user_id, NEW.plan_id, 'approve') AND EXISTS (SELECT 1 FROM allocation_plan_entries WHERE plan_version_id=OLD.id) THEN RETURN NEW; END IF;
  IF OLD.status='approved' AND NEW.status='superseded'
     AND NEW.plan_id=OLD.plan_id AND NEW.version=OLD.version AND NEW.effective_from=OLD.effective_from AND NEW.effective_until IS NOT DISTINCT FROM OLD.effective_until
     AND NEW.superseded_effective_at > OLD.effective_from AND (OLD.effective_until IS NULL OR NEW.superseded_effective_at < OLD.effective_until) AND NEW.superseded_at >= OLD.approved_at
     AND NEW.superseded_by_version_id IS NOT NULL AND NEW.superseded_by_user_id IS NOT NULL AND NEW.supersession_reason IS NOT NULL AND NEW.superseded_request_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM allocation_plan_versions successor WHERE successor.id=NEW.superseded_by_version_id AND successor.plan_id=OLD.plan_id AND successor.status='approved' AND successor.effective_from=NEW.superseded_effective_at AND successor.approved_at=NEW.superseded_at)
     AND NOT EXISTS (SELECT 1 FROM allocation_plan_entries entry_row WHERE entry_row.plan_version_id=OLD.id AND entry_row.interval_start < NEW.superseded_effective_at AND entry_row.interval_end > NEW.superseded_effective_at)
     AND NEW.drafted_by_user_id=OLD.drafted_by_user_id AND NEW.draft_reason=OLD.draft_reason AND NEW.draft_request_id=OLD.draft_request_id AND NEW.drafted_at=OLD.drafted_at AND NEW.requested_by_user_id=OLD.requested_by_user_id AND NEW.requested_at=OLD.requested_at AND NEW.request_reason=OLD.request_reason AND NEW.requested_request_id=OLD.requested_request_id
     AND NEW.approved_by_user_id=OLD.approved_by_user_id AND NEW.approved_at=OLD.approved_at AND NEW.approval_reason=OLD.approval_reason AND NEW.legal_reference=OLD.legal_reference AND NEW.approved_request_id=OLD.approved_request_id
     AND allocation_plan_version_actor_allowed(NEW.superseded_by_user_id, NEW.plan_id, 'approve') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'allocation plan versions are immutable except governed lifecycle transitions' USING ERRCODE = '23514';
END $$;

CREATE OR REPLACE FUNCTION allocation_plan_audit_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_organization uuid;
BEGIN
  SELECT organization_id INTO STRICT actor_organization FROM identity_users WHERE id=NEW.created_by_user_id;
  INSERT INTO audit_events(
    organization_id,territory_id,actor_user_id,actor_organization_id,action,resource,resource_id,
    old_state,new_state,reason,request_id,occurred_at,data_classification,provenance
  ) VALUES (
    NEW.organization_id,NEW.territory_id,NEW.created_by_user_id,actor_organization,
    'allocation_plan.created','allocation_plan',NEW.id,NULL,to_jsonb(NEW),
    NEW.creation_reason,NEW.created_request_id,NEW.created_at,NEW.data_classification,'database:allocation-plan-lifecycle'
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION allocation_plan_version_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  plan_scope allocation_plans%ROWTYPE;
  actor_id uuid;
  actor_organization uuid;
  action_value text;
  reason_value text;
  request_value text;
  occurred_value timestamptz;
BEGIN
  SELECT * INTO STRICT plan_scope FROM allocation_plans WHERE id=NEW.plan_id;
  IF TG_OP='INSERT' THEN
    actor_id := NEW.drafted_by_user_id;
    action_value := 'allocation_plan_version.created';
    reason_value := NEW.draft_reason;
    request_value := NEW.draft_request_id;
    occurred_value := NEW.drafted_at;
  ELSIF OLD.status='draft' AND NEW.status='requested' THEN
    actor_id := NEW.requested_by_user_id;
    action_value := 'allocation_plan_version.requested';
    reason_value := NEW.request_reason;
    request_value := NEW.requested_request_id;
    occurred_value := NEW.requested_at;
  ELSIF OLD.status='requested' AND NEW.status='approved' THEN
    actor_id := NEW.approved_by_user_id;
    action_value := 'allocation_plan_version.approved';
    reason_value := NEW.approval_reason;
    request_value := NEW.approved_request_id;
    occurred_value := NEW.approved_at;
  ELSIF OLD.status='approved' AND NEW.status='superseded' THEN
    actor_id := NEW.superseded_by_user_id;
    action_value := 'allocation_plan_version.superseded';
    reason_value := NEW.supersession_reason;
    request_value := NEW.superseded_request_id;
    occurred_value := NEW.superseded_at;
  ELSE
    RAISE EXCEPTION 'unrecognized allocation plan lifecycle transition for audit' USING ERRCODE='23514';
  END IF;
  SELECT organization_id INTO STRICT actor_organization FROM identity_users WHERE id=actor_id;
  INSERT INTO audit_events(
    organization_id,territory_id,actor_user_id,actor_organization_id,action,resource,resource_id,
    old_state,new_state,reason,request_id,occurred_at,data_classification,provenance
  ) VALUES (
    plan_scope.organization_id,plan_scope.territory_id,actor_id,actor_organization,
    action_value::audit_event_action,'allocation_plan',NEW.id,
    CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,to_jsonb(NEW),
    reason_value,request_value,occurred_value,plan_scope.data_classification,'database:allocation-plan-lifecycle'
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION allocation_plan_entry_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  plan_scope allocation_plans%ROWTYPE;
  actor_organization uuid;
BEGIN
  SELECT plan.* INTO STRICT plan_scope
  FROM allocation_plans plan
  JOIN allocation_plan_versions version_row ON version_row.plan_id=plan.id
  WHERE version_row.id=NEW.plan_version_id;
  SELECT organization_id INTO STRICT actor_organization FROM identity_users WHERE id=NEW.created_by_user_id;
  INSERT INTO audit_events(
    organization_id,territory_id,actor_user_id,actor_organization_id,action,resource,resource_id,
    old_state,new_state,reason,request_id,occurred_at,data_classification,provenance
  ) VALUES (
    plan_scope.organization_id,plan_scope.territory_id,NEW.created_by_user_id,actor_organization,
    'allocation_plan_entry.created','allocation_plan',NEW.id,NULL,to_jsonb(NEW),
    NEW.creation_reason,NEW.created_request_id,NEW.created_at,plan_scope.data_classification,
    'database:allocation-plan-lifecycle'
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS allocation_plans_validate_insert ON allocation_plans;
CREATE TRIGGER allocation_plans_validate_insert BEFORE INSERT ON allocation_plans FOR EACH ROW EXECUTE FUNCTION allocation_plan_validate_insert();
DROP TRIGGER IF EXISTS allocation_plans_audit_insert ON allocation_plans;
CREATE TRIGGER allocation_plans_audit_insert AFTER INSERT ON allocation_plans FOR EACH ROW EXECUTE FUNCTION allocation_plan_audit_insert();
DROP TRIGGER IF EXISTS allocation_plans_immutable ON allocation_plans;
CREATE TRIGGER allocation_plans_immutable BEFORE UPDATE OR DELETE ON allocation_plans FOR EACH ROW EXECUTE FUNCTION reject_allocation_plan_mutation();
DROP TRIGGER IF EXISTS allocation_plan_versions_insert ON allocation_plan_versions;
CREATE TRIGGER allocation_plan_versions_insert BEFORE INSERT ON allocation_plan_versions FOR EACH ROW EXECUTE FUNCTION allocation_plan_validate_version_insert();
DROP TRIGGER IF EXISTS allocation_plan_versions_immutable ON allocation_plan_versions;
CREATE TRIGGER allocation_plan_versions_immutable BEFORE UPDATE OR DELETE ON allocation_plan_versions FOR EACH ROW EXECUTE FUNCTION allocation_plan_validate_version_mutation();
DROP TRIGGER IF EXISTS allocation_plan_versions_audit ON allocation_plan_versions;
CREATE TRIGGER allocation_plan_versions_audit AFTER INSERT OR UPDATE ON allocation_plan_versions FOR EACH ROW EXECUTE FUNCTION allocation_plan_version_audit();
DROP TRIGGER IF EXISTS allocation_plan_entries_immutable ON allocation_plan_entries;
CREATE TRIGGER allocation_plan_entries_immutable BEFORE INSERT OR UPDATE OR DELETE ON allocation_plan_entries FOR EACH ROW EXECUTE FUNCTION allocation_plan_validate_entry();
DROP TRIGGER IF EXISTS allocation_plan_entries_audit ON allocation_plan_entries;
CREATE TRIGGER allocation_plan_entries_audit AFTER INSERT ON allocation_plan_entries FOR EACH ROW EXECUTE FUNCTION allocation_plan_entry_audit();

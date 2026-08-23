DO $$
BEGIN
  CREATE TYPE audit_event_resource AS ENUM ('user_role_grant');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE audit_event_action AS ENUM (
    'user_role_grant.created',
    'user_role_grant.revoked',
    'user_role_grant.cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'user_role_grant.cancelled';

ALTER TABLE user_role_grants
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

ALTER TABLE user_role_grants
  DROP CONSTRAINT IF EXISTS user_role_grants_cancelled_after_created;

ALTER TABLE user_role_grants
  DROP CONSTRAINT IF EXISTS user_role_grants_cancelled_before_effective;

ALTER TABLE user_role_grants
  ADD CONSTRAINT user_role_grants_cancelled_before_effective CHECK (
    cancelled_at IS NULL OR (
      cancelled_at >= created_at
      AND cancelled_at < effective_from
    )
  );

ALTER TABLE user_role_grants
  DROP CONSTRAINT IF EXISTS user_role_grants_effective_scope_non_overlap;

ALTER TABLE user_role_grants
  ADD CONSTRAINT user_role_grants_effective_scope_non_overlap EXCLUDE USING gist (
    user_id WITH =,
    role WITH =,
    scope WITH =,
    scope_territory_key WITH =,
    tstzrange(effective_from, effective_until, '[)') WITH &&
  ) WHERE (cancelled_at IS NULL);

CREATE INDEX IF NOT EXISTS user_role_grants_effective_uncancelled_idx
  ON user_role_grants (user_id, effective_from, effective_until)
  WHERE cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  actor_organization_id uuid NOT NULL,
  action audit_event_action NOT NULL,
  resource audit_event_resource NOT NULL,
  resource_id uuid NOT NULL,
  old_state jsonb,
  new_state jsonb,
  reason text NOT NULL,
  request_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  data_classification record_data_classification NOT NULL,
  provenance text NOT NULL,
  CONSTRAINT audit_events_state_present CHECK (old_state IS NOT NULL OR new_state IS NOT NULL),
  CONSTRAINT audit_events_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT audit_events_request_id_not_blank CHECK (btrim(request_id) <> ''),
  CONSTRAINT audit_events_provenance_not_blank CHECK (btrim(provenance) <> ''),
  CONSTRAINT audit_events_territory_same_organization FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories (organization_id, id),
  CONSTRAINT audit_events_actor_same_organization FOREIGN KEY (actor_organization_id, actor_user_id)
    REFERENCES identity_users (organization_id, id)
);

CREATE INDEX IF NOT EXISTS audit_events_organization_occurred_idx
  ON audit_events (organization_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_occurred_idx
  ON audit_events (actor_user_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_action_resource_occurred_idx
  ON audit_events (action, resource, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_territory_occurred_idx
  ON audit_events (territory_id, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only' USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_audit_event_mutation();

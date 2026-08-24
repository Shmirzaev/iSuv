-- Audit explorer filters retain deterministic newest-first keyset pagination.
-- The append-only audit event relation and its immutable state remain unchanged.
CREATE INDEX IF NOT EXISTS audit_events_territory_resource_occurred_idx
  ON audit_events (territory_id, resource_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_territory_actor_occurred_idx
  ON audit_events (territory_id, actor_user_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_territory_request_occurred_idx
  ON audit_events (territory_id, request_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_territory_action_resource_occurred_idx
  ON audit_events (territory_id, action, resource, occurred_at DESC, id DESC);

-- Detail reads remain exact rather than truncated, so bound immutable state at
-- the write boundary. Existing synthetic report evidence is well below 256 KiB.
ALTER TABLE audit_events
  DROP CONSTRAINT IF EXISTS audit_events_state_payload_bounded;
ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_state_payload_bounded CHECK (
    octet_length(COALESCE(old_state::text, ''))
      + octet_length(COALESCE(new_state::text, '')) <= 262144
  );

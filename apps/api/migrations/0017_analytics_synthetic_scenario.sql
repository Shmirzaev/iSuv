-- Immutable-cutoff metadata for the governed P6 composition.  This is not a
-- reporting-row source: P6 accounting is calculated through P3 services.
CREATE TABLE IF NOT EXISTS analytics_synthetic_scenarios (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL REFERENCES territories(id),
  version integer NOT NULL CHECK(version > 0),
  reference_at timestamptz NOT NULL,
  known_at timestamptz NOT NULL,
  provenance text NOT NULL CHECK(btrim(provenance)<>''),
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic' CHECK(data_classification='synthetic'),
  official_compliance_eligible boolean NOT NULL DEFAULT false CHECK(official_compliance_eligible=false),
  CHECK(known_at >= reference_at),
  UNIQUE(organization_id,territory_id,version)
);
CREATE OR REPLACE FUNCTION analytics_synthetic_scenarios_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'analytics scenarios are immutable' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS analytics_synthetic_scenarios_immutable ON analytics_synthetic_scenarios;
CREATE TRIGGER analytics_synthetic_scenarios_immutable BEFORE UPDATE OR DELETE ON analytics_synthetic_scenarios FOR EACH ROW EXECUTE FUNCTION analytics_synthetic_scenarios_immutable();

-- Upgrade existing installations with the same narrow, transaction-local
-- synthetic bootstrap exception used by the seed service. Normal API calls do
-- not set this setting and retain the historical-effective-time rejection.
CREATE OR REPLACE FUNCTION allocation_plan_validate_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE locked_plan uuid;
BEGIN
 locked_plan:=COALESCE(NEW.plan_id,OLD.plan_id); PERFORM pg_advisory_xact_lock(hashtext(locked_plan::text));
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'allocation plan versions are immutable' USING ERRCODE='23514'; END IF;
 IF OLD.status='draft' AND NEW.status='requested' AND NEW.plan_id=OLD.plan_id AND NEW.version=OLD.version AND NEW.effective_from=OLD.effective_from AND NEW.effective_until IS NOT DISTINCT FROM OLD.effective_until AND NEW.drafted_by_user_id=OLD.drafted_by_user_id AND NEW.draft_reason=OLD.draft_reason AND NEW.draft_request_id=OLD.draft_request_id AND NEW.drafted_at=OLD.drafted_at AND NEW.requested_by_user_id IS NOT NULL AND NEW.requested_at IS NOT NULL AND NEW.requested_at>=statement_timestamp() AND NEW.requested_at<=clock_timestamp() AND NEW.requested_at>=OLD.drafted_at AND NEW.request_reason IS NOT NULL AND NEW.requested_request_id IS NOT NULL AND NEW.approved_by_user_id IS NULL AND NEW.approved_at IS NULL AND NEW.approval_reason IS NULL AND NEW.legal_reference IS NULL AND NEW.approved_request_id IS NULL AND NEW.superseded_effective_at IS NULL AND NEW.superseded_at IS NULL AND NEW.superseded_by_version_id IS NULL AND NEW.superseded_by_user_id IS NULL AND NEW.supersession_reason IS NULL AND NEW.superseded_request_id IS NULL AND allocation_plan_version_actor_allowed(NEW.requested_by_user_id,NEW.plan_id,'write') THEN RETURN NEW; END IF;
 IF OLD.status='requested' AND NEW.status='approved' AND NEW.plan_id=OLD.plan_id AND NEW.version=OLD.version AND NEW.effective_from=OLD.effective_from AND NEW.effective_until IS NOT DISTINCT FROM OLD.effective_until AND NEW.drafted_by_user_id=OLD.drafted_by_user_id AND NEW.draft_reason=OLD.draft_reason AND NEW.draft_request_id=OLD.draft_request_id AND NEW.drafted_at=OLD.drafted_at AND NEW.requested_by_user_id=OLD.requested_by_user_id AND NEW.requested_at=OLD.requested_at AND NEW.request_reason=OLD.request_reason AND NEW.requested_request_id=OLD.requested_request_id AND NEW.approved_by_user_id IS NOT NULL AND NEW.approved_at IS NOT NULL AND NEW.approved_at>=statement_timestamp() AND NEW.approved_at<=clock_timestamp() AND NEW.approved_at>=OLD.requested_at AND (NEW.effective_from>=NEW.approved_at OR (current_setting('isuv.seed_allow_synthetic_historical_plan',true)='on' AND EXISTS(SELECT 1 FROM allocation_plans p WHERE p.id=NEW.plan_id AND p.data_classification='synthetic'))) AND NEW.approval_reason IS NOT NULL AND NEW.legal_reference IS NOT NULL AND NEW.approved_request_id IS NOT NULL AND NEW.approved_by_user_id<>NEW.requested_by_user_id AND NEW.superseded_effective_at IS NULL AND NEW.superseded_at IS NULL AND NEW.superseded_by_version_id IS NULL AND NEW.superseded_by_user_id IS NULL AND NEW.supersession_reason IS NULL AND NEW.superseded_request_id IS NULL AND allocation_plan_version_actor_allowed(NEW.approved_by_user_id,NEW.plan_id,'approve') AND EXISTS(SELECT 1 FROM allocation_plan_entries WHERE plan_version_id=OLD.id) THEN RETURN NEW; END IF;
 IF OLD.status='approved' AND NEW.status='superseded' AND NEW.plan_id=OLD.plan_id AND NEW.version=OLD.version AND NEW.effective_from=OLD.effective_from AND NEW.effective_until IS NOT DISTINCT FROM OLD.effective_until AND NEW.superseded_effective_at>OLD.effective_from AND (OLD.effective_until IS NULL OR NEW.superseded_effective_at<OLD.effective_until) AND NEW.superseded_at>=OLD.approved_at AND NEW.superseded_by_version_id IS NOT NULL AND NEW.superseded_by_user_id IS NOT NULL AND NEW.supersession_reason IS NOT NULL AND NEW.superseded_request_id IS NOT NULL AND EXISTS(SELECT 1 FROM allocation_plan_versions successor WHERE successor.id=NEW.superseded_by_version_id AND successor.plan_id=OLD.plan_id AND successor.status='approved' AND successor.effective_from=NEW.superseded_effective_at AND successor.approved_at=NEW.superseded_at) AND NOT EXISTS(SELECT 1 FROM allocation_plan_entries entry_row WHERE entry_row.plan_version_id=OLD.id AND entry_row.interval_start<NEW.superseded_effective_at AND entry_row.interval_end>NEW.superseded_effective_at) AND NEW.drafted_by_user_id=OLD.drafted_by_user_id AND NEW.draft_reason=OLD.draft_reason AND NEW.draft_request_id=OLD.draft_request_id AND NEW.drafted_at=OLD.drafted_at AND NEW.requested_by_user_id=OLD.requested_by_user_id AND NEW.requested_at=OLD.requested_at AND NEW.request_reason=OLD.request_reason AND NEW.requested_request_id=OLD.requested_request_id AND NEW.approved_by_user_id=OLD.approved_by_user_id AND NEW.approved_at=OLD.approved_at AND NEW.approval_reason=OLD.approval_reason AND NEW.legal_reference=OLD.legal_reference AND NEW.approved_request_id=OLD.approved_request_id AND allocation_plan_version_actor_allowed(NEW.superseded_by_user_id,NEW.plan_id,'approve') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'allocation plan versions are immutable except governed lifecycle transitions' USING ERRCODE='23514';
END $$;

-- The tolerance approval path has the same seed-only historical-effective
-- requirement. Replacing the function here upgrades installations that
-- already recorded migration 0010; callers that do not set the local seed
-- flag retain the future-effective rule.
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
  IF NEW.approved_by_user_id=OLD.requested_by_user_id OR NEW.approval_reason IS NULL OR btrim(NEW.approval_reason)='' OR NEW.approved_request_id IS NULL OR btrim(NEW.approved_request_id)='' OR (NEW.effective_from<NEW.approved_at AND NOT (current_setting('isuv.seed_allow_synthetic_historical_tolerance',true)='on' AND policy_row.data_classification='synthetic')) OR NOT allocation_plan_actor_may_act(NEW.approved_by_user_id,policy_row.organization_id,policy_row.territory_id,'approve',NEW.approved_at) THEN
   RAISE EXCEPTION 'tolerance policy approval must be distinct, future-effective, and territory-authorized' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM section_tolerance_policy_versions prior WHERE prior.policy_id=NEW.policy_id AND prior.status='approved' AND prior.id<>NEW.id AND tstzrange(prior.effective_from,prior.effective_until,'[)') && tstzrange(NEW.effective_from,NEW.effective_until,'[)')) THEN
   RAISE EXCEPTION 'tolerance policy approved windows cannot overlap' USING ERRCODE='23P01'; END IF;
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'tolerance policy versions are immutable except requested-to-approved transition' USING ERRCODE='23514';
END $$;

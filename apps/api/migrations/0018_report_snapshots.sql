-- Frozen, synthetic report artifacts. Source values are never accepted from a caller.
ALTER TYPE audit_event_resource ADD VALUE IF NOT EXISTS 'report';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'report.generated';
ALTER TYPE audit_event_action ADD VALUE IF NOT EXISTS 'report.exported';

CREATE TABLE IF NOT EXISTS report_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  territory_id uuid NOT NULL REFERENCES territories(id),
  kind text NOT NULL CHECK(kind IN('daily_situation','allocation_compliance','water_balance','device_availability','incident','executive_summary')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  period text NOT NULL CHECK(period IN('today','week','month','season','year')),
  facet text CHECK(facet IN('region','basin','waterway','section')),
  facet_id uuid,
  incident_id uuid REFERENCES incidents(id),
  reference_at timestamptz NOT NULL,
  known_at timestamptz NOT NULL CHECK(known_at>=reference_at),
  presentation_time_zone text NOT NULL CHECK(presentation_time_zone='Asia/Tashkent'),
  method_id text NOT NULL CHECK(method_id='governed_report_snapshot_v1'),
  method_version integer NOT NULL CHECK(method_version=1),
  quality_state text NOT NULL CHECK(quality_state IN('assessed','unassessable','deferred','unconfigured')),
  approval_status text NOT NULL CHECK(approval_status='generated_not_approved'),
  analytics_scenario_id uuid NOT NULL REFERENCES analytics_synthetic_scenarios(id),
  analytics_scenario_version integer NOT NULL CHECK(analytics_scenario_version>0),
  source_revision_policy text NOT NULL CHECK(source_revision_policy='known_at_frozen'),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  payload_canonical text NOT NULL CHECK(btrim(payload_canonical)<>'' AND payload_canonical::jsonb=payload),
  caveats jsonb NOT NULL CHECK(jsonb_typeof(caveats)='array' AND jsonb_array_length(caveats)>0),
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$' AND fingerprint=encode(digest(payload_canonical,'sha256'),'hex')),
  provenance text NOT NULL CHECK(btrim(provenance)<>''),
  data_classification record_data_classification NOT NULL DEFAULT 'synthetic' CHECK(data_classification='synthetic'),
  official_compliance_eligible boolean NOT NULL DEFAULT false CHECK(official_compliance_eligible=false),
  generated_by_user_id uuid NOT NULL REFERENCES identity_users(id),
  generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((facet IS NULL)=(facet_id IS NULL)),
  CHECK((kind='incident')=(incident_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS report_snapshots_territory_generated_idx ON report_snapshots(territory_id,generated_at DESC,id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS report_snapshots_retry_identity_uq ON report_snapshots(organization_id,territory_id,kind,period,COALESCE(facet,''),COALESCE(facet_id,'00000000-0000-4000-8000-000000000000'::uuid),COALESCE(incident_id,'00000000-0000-4000-8000-000000000000'::uuid),reference_at,known_at);
CREATE UNIQUE INDEX IF NOT EXISTS report_snapshots_series_version_uq ON report_snapshots(organization_id,territory_id,kind,period,COALESCE(facet,''),COALESCE(facet_id,'00000000-0000-4000-8000-000000000000'::uuid),COALESCE(incident_id,'00000000-0000-4000-8000-000000000000'::uuid),version);
CREATE TABLE IF NOT EXISTS report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES report_snapshots(id), format text NOT NULL CHECK(format IN('csv','html')),
  exported_by_user_id uuid NOT NULL REFERENCES identity_users(id), request_id text NOT NULL CHECK(btrim(request_id)<>''), exported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(report_id,format,request_id)
);

CREATE OR REPLACE FUNCTION report_actor_may_read(actor_id uuid,target_organization uuid,target_territory uuid,evaluated_at timestamptz) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE ancestors AS (
  SELECT id,parent_territory_id FROM territories WHERE id=target_territory AND organization_id=target_organization
  UNION ALL SELECT parent.id,parent.parent_territory_id FROM territories parent JOIN ancestors child ON child.parent_territory_id=parent.id WHERE parent.organization_id=target_organization
 )
 SELECT EXISTS(SELECT 1 FROM identity_users actor JOIN user_role_grants role_grant ON role_grant.user_id=actor.id
  WHERE actor.id=actor_id AND actor.is_active
   AND role_grant.cancelled_at IS NULL AND role_grant.effective_from<=evaluated_at AND (role_grant.effective_until IS NULL OR role_grant.effective_until>evaluated_at)
   AND role_grant.role IN('system_admin','national_admin','regional_director','basin_dispatcher','hydrologist','auditor')
   AND ((role_grant.role='system_admin' AND role_grant.scope='system' AND role_grant.territory_id IS NULL)
     OR (actor.organization_id=target_organization AND role_grant.organization_id=target_organization AND role_grant.role='national_admin' AND role_grant.scope='national' AND role_grant.territory_id IS NULL)
     OR (actor.organization_id=target_organization AND role_grant.organization_id=target_organization AND role_grant.role NOT IN('system_admin','national_admin') AND role_grant.scope='territory' AND role_grant.territory_id IS NOT NULL AND EXISTS(SELECT 1 FROM ancestors WHERE id=role_grant.territory_id))));
$$;
CREATE OR REPLACE FUNCTION report_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior_version integer;
BEGIN
  IF TG_OP IN('UPDATE','DELETE') THEN RAISE EXCEPTION 'report snapshots are append-only' USING ERRCODE='23514'; END IF;
  IF current_setting('isuv.report_actor_id',true) IS NULL OR NEW.generated_by_user_id::text<>current_setting('isuv.report_actor_id',true) OR current_setting('isuv.report_reason',true) IS NULL OR btrim(current_setting('isuv.report_reason',true))='' OR current_setting('isuv.report_request_id',true) IS NULL OR btrim(current_setting('isuv.report_request_id',true))='' OR NOT report_actor_may_read(NEW.generated_by_user_id,NEW.organization_id,NEW.territory_id,clock_timestamp()) THEN
    RAISE EXCEPTION 'report snapshots require governed report audit context' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.organization_id::text||':'||NEW.territory_id::text||':'||NEW.kind||':'||NEW.period||':'||COALESCE(NEW.facet,'')||':'||COALESCE(NEW.facet_id::text,'')||':'||COALESCE(NEW.incident_id::text,'')));
  SELECT COALESCE(max(version),0) INTO prior_version FROM report_snapshots WHERE organization_id=NEW.organization_id AND territory_id=NEW.territory_id AND kind=NEW.kind AND period=NEW.period AND facet IS NOT DISTINCT FROM NEW.facet AND facet_id IS NOT DISTINCT FROM NEW.facet_id AND incident_id IS NOT DISTINCT FROM NEW.incident_id;
  IF NEW.version<>prior_version+1 THEN RAISE EXCEPTION 'report snapshot versions must be sequential per governed selector' USING ERRCODE='23514'; END IF;
  NEW.generated_at:=clock_timestamp();
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION report_export_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN('UPDATE','DELETE') THEN RAISE EXCEPTION 'report exports are append-only' USING ERRCODE='23514'; END IF;
  IF current_setting('isuv.report_actor_id',true) IS NULL OR NEW.exported_by_user_id::text<>current_setting('isuv.report_actor_id',true) OR NEW.request_id<>current_setting('isuv.report_request_id',true) OR NOT report_actor_may_read(NEW.exported_by_user_id,(SELECT organization_id FROM report_snapshots WHERE id=NEW.report_id),(SELECT territory_id FROM report_snapshots WHERE id=NEW.report_id),clock_timestamp()) THEN
    RAISE EXCEPTION 'report exports require governed report audit context' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION report_snapshot_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_events(organization_id,territory_id,actor_user_id,actor_organization_id,action,resource,resource_id,old_state,new_state,reason,request_id,data_classification,provenance)
  SELECT NEW.organization_id,NEW.territory_id,NEW.generated_by_user_id,u.organization_id,'report.generated','report',NEW.id,NULL,to_jsonb(NEW),current_setting('isuv.report_reason',true),current_setting('isuv.report_request_id',true),'synthetic',NEW.provenance FROM identity_users u WHERE u.id=NEW.generated_by_user_id;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION report_export_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot report_snapshots%ROWTYPE;
BEGIN
  SELECT * INTO STRICT snapshot FROM report_snapshots WHERE id=NEW.report_id;
  INSERT INTO audit_events(organization_id,territory_id,actor_user_id,actor_organization_id,action,resource,resource_id,old_state,new_state,reason,request_id,data_classification,provenance)
  SELECT snapshot.organization_id,snapshot.territory_id,NEW.exported_by_user_id,u.organization_id,'report.exported','report',snapshot.id,NULL,to_jsonb(NEW),'frozen report export',NEW.request_id,'synthetic',snapshot.provenance FROM identity_users u WHERE u.id=NEW.exported_by_user_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS report_snapshots_guard ON report_snapshots;
CREATE TRIGGER report_snapshots_guard BEFORE INSERT OR UPDATE OR DELETE ON report_snapshots FOR EACH ROW EXECUTE FUNCTION report_snapshot_guard();
DROP TRIGGER IF EXISTS report_snapshots_audit ON report_snapshots;
CREATE TRIGGER report_snapshots_audit AFTER INSERT ON report_snapshots FOR EACH ROW EXECUTE FUNCTION report_snapshot_audit();
DROP TRIGGER IF EXISTS report_exports_guard ON report_exports;
CREATE TRIGGER report_exports_guard BEFORE INSERT OR UPDATE OR DELETE ON report_exports FOR EACH ROW EXECUTE FUNCTION report_export_guard();
DROP TRIGGER IF EXISTS report_exports_audit ON report_exports;
CREATE TRIGGER report_exports_audit AFTER INSERT ON report_exports FOR EACH ROW EXECUTE FUNCTION report_export_audit();

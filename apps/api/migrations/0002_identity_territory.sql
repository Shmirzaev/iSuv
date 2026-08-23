CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  CREATE TYPE identity_data_classification AS ENUM ('synthetic', 'official');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE territory_kind AS ENUM ('national', 'region', 'basin', 'district', 'facility');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE identity_user_role AS ENUM (
    'system_admin',
    'national_admin',
    'regional_director',
    'basin_dispatcher',
    'district_operator',
    'hydrologist',
    'maintenance_engineer',
    'auditor'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE authorization_grant_scope AS ENUM ('system', 'national', 'territory');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  data_classification identity_data_classification NOT NULL DEFAULT 'synthetic',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT organizations_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TABLE IF NOT EXISTS territories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  parent_territory_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  kind territory_kind NOT NULL,
  data_classification identity_data_classification NOT NULL DEFAULT 'synthetic',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT territories_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT territories_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT territories_not_own_parent CHECK (id <> parent_territory_id),
  CONSTRAINT territories_organization_code_unique UNIQUE (organization_id, code),
  CONSTRAINT territories_organization_id_unique UNIQUE (organization_id, id),
  CONSTRAINT territories_parent_same_organization FOREIGN KEY (organization_id, parent_territory_id)
    REFERENCES territories (organization_id, id)
);

CREATE INDEX IF NOT EXISTS territories_parent_territory_id_idx
  ON territories (parent_territory_id);

CREATE TABLE IF NOT EXISTS identity_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  external_subject text NOT NULL UNIQUE,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  data_classification identity_data_classification NOT NULL DEFAULT 'synthetic',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_users_external_subject_not_blank CHECK (btrim(external_subject) <> ''),
  CONSTRAINT identity_users_display_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT identity_users_organization_id_unique UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS user_role_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES identity_users(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  role identity_user_role NOT NULL,
  scope authorization_grant_scope NOT NULL,
  territory_id uuid,
  scope_territory_key uuid GENERATED ALWAYS AS (
    COALESCE(territory_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) STORED,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_role_grants_effective_window CHECK (
    effective_until IS NULL OR effective_until > effective_from
  ),
  CONSTRAINT user_role_grants_scope_territory CHECK (
    (scope = 'territory' AND territory_id IS NOT NULL)
    OR (scope IN ('system', 'national') AND territory_id IS NULL)
  ),
  CONSTRAINT user_role_grants_role_scope CHECK (
    (role = 'system_admin' AND scope = 'system')
    OR (role = 'national_admin' AND scope = 'national')
    OR (
      role IN (
        'regional_director',
        'basin_dispatcher',
        'district_operator',
        'hydrologist',
        'maintenance_engineer',
        'auditor'
      )
      AND scope = 'territory'
    )
  ),
  CONSTRAINT user_role_grants_user_same_organization FOREIGN KEY (organization_id, user_id)
    REFERENCES identity_users (organization_id, id),
  CONSTRAINT user_role_grants_territory_same_organization FOREIGN KEY (organization_id, territory_id)
    REFERENCES territories (organization_id, id),
  CONSTRAINT user_role_grants_effective_scope_non_overlap EXCLUDE USING gist (
    user_id WITH =,
    role WITH =,
    scope WITH =,
    scope_territory_key WITH =,
    tstzrange(effective_from, effective_until, '[)') WITH &&
  )
);

CREATE INDEX IF NOT EXISTS user_role_grants_current_user_idx
  ON user_role_grants (user_id, effective_from, effective_until);

-- A cycle would make hierarchy-based authorization ambiguous and can turn an
-- unbounded recursive query into a denial of service.  The parent update is
-- rejected before it is stored; the path guard in the authorization query is
-- retained as defense in depth for legacy or manually-corrupted data.
CREATE OR REPLACE FUNCTION reject_territory_hierarchy_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Serialize all hierarchy mutations for an organization. Without this lock,
  -- two transactions can each validate one side of A -> B / B -> A against a
  -- snapshot that does not yet contain the other update.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text, 0));

  IF NEW.parent_territory_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    WITH RECURSIVE ancestors(id, parent_territory_id, path) AS (
      SELECT id, parent_territory_id, ARRAY[id]
      FROM territories
      WHERE id = NEW.parent_territory_id
      UNION ALL
      SELECT territory.id, territory.parent_territory_id, ancestors.path || territory.id
      FROM territories territory
      JOIN ancestors ON territory.id = ancestors.parent_territory_id
      WHERE NOT territory.id = ANY(ancestors.path)
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'territory hierarchy cycle is not permitted'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS territories_reject_hierarchy_cycle ON territories;
CREATE TRIGGER territories_reject_hierarchy_cycle
  BEFORE INSERT OR UPDATE OF parent_territory_id ON territories
  FOR EACH ROW
  EXECUTE FUNCTION reject_territory_hierarchy_cycle();

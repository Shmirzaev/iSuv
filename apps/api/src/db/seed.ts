import { withDatabase } from './client.js';

export async function seedSystemMetadata(databaseUrl: string | undefined): Promise<void> {
  await withDatabase(databaseUrl, async (pool) => {
    await pool.query(
      "INSERT INTO system_metadata (key, value) VALUES ('seed_classification', 'synthetic') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    );
    await pool.query(`
      INSERT INTO organizations (id, code, name, data_classification)
      VALUES ('a1000000-0000-4000-8000-000000000001', 'UZ-WATER-SYNTH', 'Synthetic Uzbekistan Water Authority', 'synthetic')
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        data_classification = EXCLUDED.data_classification,
        updated_at = now()
    `);
    await pool.query(`
      INSERT INTO territories (id, organization_id, parent_territory_id, code, name, kind, data_classification)
      VALUES
        ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', NULL, 'UZ-SYNTH', 'Synthetic national scope', 'national', 'synthetic'),
        ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'SYR-SYNTH', 'Synthetic Syrdarya region', 'region', 'synthetic'),
        ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'SYR-BASIN-SYNTH', 'Synthetic Syrdarya basin', 'basin', 'synthetic'),
        ('a2000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003', 'SYR-DISTRICT-A-SYNTH', 'Synthetic Syrdarya district A', 'district', 'synthetic'),
        ('a2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003', 'SYR-DISTRICT-B-SYNTH', 'Synthetic Syrdarya district B', 'district', 'synthetic')
      ON CONFLICT (organization_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        parent_territory_id = EXCLUDED.parent_territory_id,
        kind = EXCLUDED.kind,
        data_classification = EXCLUDED.data_classification,
        updated_at = now()
    `);
    await pool.query(`
      INSERT INTO identity_users (id, organization_id, external_subject, display_name, is_active, data_classification)
      VALUES
        ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'synthetic:system-admin', 'Synthetic system administrator', true, 'synthetic'),
        ('a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'synthetic:national-admin', 'Synthetic national administrator', true, 'synthetic'),
        ('a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'synthetic:regional-director', 'Synthetic regional director', true, 'synthetic'),
        ('a3000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'synthetic:basin-dispatcher', 'Synthetic basin dispatcher', true, 'synthetic'),
        ('a3000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'synthetic:district-operator', 'Synthetic district operator', true, 'synthetic'),
        ('a3000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'synthetic:hydrologist', 'Synthetic hydrologist', true, 'synthetic'),
        ('a3000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'synthetic:maintenance-engineer', 'Synthetic maintenance engineer', true, 'synthetic'),
        ('a3000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', 'synthetic:auditor', 'Synthetic auditor', true, 'synthetic')
      ON CONFLICT (external_subject) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        is_active = EXCLUDED.is_active,
        data_classification = EXCLUDED.data_classification,
        updated_at = now()
    `);
    await pool.query(`
      INSERT INTO user_role_grants (id, user_id, organization_id, role, scope, territory_id, effective_from)
      VALUES
        ('a4000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'system_admin', 'system', NULL, '2026-01-01T00:00:00.000Z'),
        ('a4000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'national_admin', 'national', NULL, '2026-01-01T00:00:00.000Z'),
        ('a4000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'regional_director', 'territory', 'a2000000-0000-4000-8000-000000000002', '2026-01-01T00:00:00.000Z'),
        ('a4000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'basin_dispatcher', 'territory', 'a2000000-0000-4000-8000-000000000003', '2026-01-01T00:00:00.000Z'),
        ('a4000000-0000-4000-8000-000000000005', 'a3000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'district_operator', 'territory', 'a2000000-0000-4000-8000-000000000004', '2026-01-01T00:00:00.000Z'),
        ('a4000000-0000-4000-8000-000000000006', 'a3000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'hydrologist', 'territory', 'a2000000-0000-4000-8000-000000000003', '2026-01-01T00:00:00.000Z'),
        ('a4000000-0000-4000-8000-000000000007', 'a3000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'maintenance_engineer', 'territory', 'a2000000-0000-4000-8000-000000000004', '2026-01-01T00:00:00.000Z'),
        ('a4000000-0000-4000-8000-000000000008', 'a3000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', 'auditor', 'territory', 'a2000000-0000-4000-8000-000000000002', '2026-01-01T00:00:00.000Z')
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        organization_id = EXCLUDED.organization_id,
        role = EXCLUDED.role,
        scope = EXCLUDED.scope,
        territory_id = EXCLUDED.territory_id,
        effective_from = EXCLUDED.effective_from,
        effective_until = NULL,
        updated_at = now()
    `);
    console.info(
      JSON.stringify({
        level: 'info',
        event: 'seed_complete',
        classification: 'synthetic',
        seededIdentityUsers: 8,
        seededTerritories: 5,
      }),
    );
  });
}

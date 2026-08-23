import { Pool } from 'pg';

export async function withDatabase<T>(
  databaseUrl: string | undefined,
  action: (pool: Pool) => Promise<T>,
): Promise<T> {
  if (!databaseUrl) throw new Error('DATABASE_URL must be configured');
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    return await action(pool);
  } finally {
    await pool.end();
  }
}

export async function checkDatabase(databaseUrl: string | undefined): Promise<void> {
  await withDatabase(databaseUrl, async (pool) => {
    await pool.query('SELECT 1');
  });
}

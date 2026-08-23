import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withDatabase } from './client.js';

const migrationDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));

export async function applyMigrations(databaseUrl: string | undefined): Promise<void> {
  await withDatabase(databaseUrl, async (pool) => {
    await pool.query(
      'CREATE TABLE IF NOT EXISTS app_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const files = (await readdir(migrationDirectory))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const known = await pool.query('SELECT 1 FROM app_schema_migrations WHERE name = $1', [file]);
      if (known.rowCount) continue;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(await readFile(join(migrationDirectory, file), 'utf8'));
        await client.query('INSERT INTO app_schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.info(
          JSON.stringify({ level: 'info', event: 'migration_applied', migration: file }),
        );
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  });
}

import { withDatabase } from './client.js';

export async function seedSystemMetadata(databaseUrl: string | undefined): Promise<void> {
  await withDatabase(databaseUrl, async (pool) => {
    await pool.query(
      "INSERT INTO system_metadata (key, value) VALUES ('seed_classification', 'synthetic') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    );
    console.info(
      JSON.stringify({ level: 'info', event: 'seed_complete', classification: 'synthetic' }),
    );
  });
}

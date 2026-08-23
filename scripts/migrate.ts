import { applyMigrations } from '../apps/api/src/db/migrations.js';

void applyMigrations(process.env.DATABASE_URL).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

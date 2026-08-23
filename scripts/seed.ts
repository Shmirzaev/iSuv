import { seedSystemMetadata } from '../apps/api/src/db/seed.js';

void seedSystemMetadata(process.env.DATABASE_URL).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

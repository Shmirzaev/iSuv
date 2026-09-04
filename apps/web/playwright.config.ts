import { defineConfig, devices } from '@playwright/test';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl)
  throw new Error('DATABASE_URL is required for the operational browser smoke test.');

const apiOrigin = 'http://127.0.0.1:3107';
const webOrigin = 'http://127.0.0.1:5177';
const localSystemAdministratorId = 'a3000000-0000-4000-8000-000000000001';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['line'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: webOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      name: 'API',
      command: 'pnpm --filter @isuv/api start',
      url: `${apiOrigin}/health/live`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        API_HOST: '127.0.0.1',
        API_PORT: '3107',
        ISUV_ENABLE_LOCAL_IDENTITY: 'true',
      },
    },
    {
      name: 'Web',
      command:
        'pnpm --filter @isuv/web exec vite --configLoader runner --host 127.0.0.1 --port 5177',
      url: webOrigin,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        VITE_API_ORIGIN: apiOrigin,
        ISUV_WEB_LOCAL_USER_ID: localSystemAdministratorId,
      },
    },
  ],
});

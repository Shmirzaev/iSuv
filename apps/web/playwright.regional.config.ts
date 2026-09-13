import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'regional-reference.spec.ts',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  outputDir: '../../tmp/regional-browser-results',
  use: { baseURL: 'http://127.0.0.1:5183', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @isuv/web exec vite --configLoader runner --host 127.0.0.1 --port 5183',
    url: 'http://127.0.0.1:5183',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

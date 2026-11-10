import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    ...devices['iPhone 13'],
    defaultBrowserType: 'chromium',
    timezoneId: 'America/Los_Angeles',
  },
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://localhost:5174/api/health',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NODE_ENV: 'production',
      PORT: '5174',
      APP_ORIGIN: 'http://localhost:5174',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://sincey:sincey_local@localhost:55432/sincey_test',
    },
  },
});

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  retries: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
});

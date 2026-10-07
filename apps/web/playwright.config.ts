import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'quillquest-e2e-'));

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'pnpm --filter @quillquest/sync dev',
      port: 1234,
      reuseExistingServer: false,
      env: { PORT: '1234', DATA_DIR: dataDir, QUILLQUEST_DEV_SECRET: 'e2e-secret', QUILLQUEST_DEV_AUTH: '1', QUILLQUEST_DEV_PGLITE: '1', QUILLQUEST_DEV_DICE: '1', QUILLQUEST_LLM: 'fake', QUILLQUEST_MAIL: 'fake', QUILLQUEST_DEV_MAIL: '1', QUILLQUEST_PUBLIC_URL: 'http://localhost:3100' },
    },
    {
      command: 'pnpm exec next dev -p 3100',
      port: 3100,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { QUILLQUEST_DEV_SECRET: 'e2e-secret', QUILLQUEST_DEV_AUTH: '1', NEXT_PUBLIC_DEV_AUTH: '1', NEXT_PUBLIC_SYNC_URL: 'ws://localhost:1234', SYNC_HTTP_URL: 'http://localhost:1234' },
    },
  ],
  projects: [{ name: 'chromium', use: { browserName: 'chromium', launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' } } }],
});

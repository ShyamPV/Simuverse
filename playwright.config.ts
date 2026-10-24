import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'apps/web/e2e',
  timeout: 60_000,
  fullyParallel: true,
  // Software GL is CPU-bound; more workers starve each other's frame loops.
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1600, height: 900 },
    // Software GL so WebGL2 works on CI machines without a GPU.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } } }],
  webServer: {
    command: 'pnpm build && pnpm --filter @simuverse/web preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});

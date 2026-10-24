import { defineConfig, devices } from '@playwright/test';

/**
 * Rendering backend for the browser tests. Software GL (SwiftShader) works
 * everywhere but is slow for the deep-space scenes; on a machine with a GPU,
 * run with SIMUVERSE_E2E_GPU=1 to use it (ANGLE on D3D11 / default GL).
 */
const gpu = process.env.SIMUVERSE_E2E_GPU === '1';
const glArgs = gpu
  ? [process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'apps/web/e2e',
  timeout: gpu ? 60_000 : 180_000,
  fullyParallel: true,
  // Software GL is CPU-bound; more workers starve each other's frame loops.
  workers: gpu ? 3 : 2,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1600, height: 900 },
    launchOptions: { args: glArgs },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } } }],
  webServer: {
    command: 'pnpm build && pnpm --filter @simuverse/web preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});

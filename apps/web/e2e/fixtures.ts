import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';

const snapshot = readFileSync(fileURLToPath(new URL('../public/data/tle-snapshot.txt', import.meta.url)), 'utf8');

/**
 * Shared test setup:
 *  - never contact CelesTrak from tests (it rate-limits repeat downloads); serve the bundled snapshot;
 *  - fail the test on any console error or uncaught page error.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.route(/celestrak\.org/, (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: snapshot }));
      await use(errors);
      expect(errors, 'console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

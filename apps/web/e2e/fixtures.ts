import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';

const snapshot = readFileSync(fileURLToPath(new URL('../public/data/tle-snapshot.txt', import.meta.url)), 'utf8');

/**
 * Shared test setup:
 *  - never contact CelesTrak from tests (it rate-limits repeat downloads); serve the bundled snapshot;
 *  - fail the test on any console error or uncaught page error (except those matching `ignoreConsole`).
 */
export const test = base.extend<{ consoleErrors: string[]; ignoreConsole: RegExp | null }>({
  ignoreConsole: [null, { option: true }],
  consoleErrors: [
    async ({ page, context, ignoreConsole }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      // Resource failures name the URL, which the message itself doesn't.
      page.on('console', (m) => m.type() === 'error' && errors.push(m.location().url ? `${m.text()} (${m.location().url})` : m.text()));
      // On the context, so pages a test opens itself are covered too.
      await context.route(/celestrak\.org/, (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: snapshot }));
      await use(errors);
      expect(errors.filter((e) => !ignoreConsole?.test(e)), 'console errors').toEqual([]);
    },
    { auto: true },
  ],
});

/**
 * The same, with a browser of its own per test: on software GL the deep-space
 * scenes leave the GPU process busy for minutes after the page closes, which
 * would stall the next test's context in a shared browser.
 */
export const isolatedTest = test.extend({
  context: async ({ playwright, launchOptions, baseURL, viewport, timezoneId }, use) => {
    const browser = await playwright.chromium.launch(launchOptions);
    const context = await browser.newContext({ baseURL, viewport, timezoneId });
    await use(context);
    await browser.close();
  },
});

/** Low quality and the perf overlay: affordable on software GL (CI without a GPU). */
export const LOW_QUALITY_SETTINGS = JSON.stringify({ state: { quality: 'low', showPerf: true }, version: 2 });

export { expect };

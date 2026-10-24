import { LOW_QUALITY_SETTINGS, expect, isolatedTest as test } from './fixtures.ts';

test.use({
  timezoneId: 'Pacific/Auckland',
  // Offline, requests for data that was never cached (Gaia tiles for other parts of the sky, full-size photos) fail, as expected.
  ignoreConsole: /net::ERR_INTERNET_DISCONNECTED|net::ERR_FAILED|Failed to fetch/,
});

test('installs as an offline app and starts without a connection', async ({ page, context }) => {
  await page.addInitScript((s) => localStorage.setItem('simuverse.settings.v1', s), LOW_QUALITY_SETTINGS);
  await page.goto('/');
  // The worker activates once the app shell and core catalogues are cached.
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active?.state === 'activated', null, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText(/^Ready\. The sky, Solar System/)).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  const crumbs = page.getByRole('navigation', { name: 'Cosmic address' });
  await expect(crumbs.getByRole('button', { name: /^Sky · / })).toHaveAttribute('aria-current', 'location', { timeout: 30_000 });
  // Catalogues are there: search works, and the Explore page opens with its images.
  await page.getByRole('button', { name: 'Explore' }).click();
  const explore = page.getByRole('dialog', { name: 'Explore' });
  await expect(explore.getByText(/^[1-9]\d,\d{3} objects$/)).toBeVisible({ timeout: 30_000 });
  await explore.getByRole('searchbox').fill('orion nebula');
  await explore.getByRole('listbox', { name: /Results for/ }).getByRole('option', { name: /Orion Nebula/ }).first().click();
  await expect(explore.getByRole('heading', { level: 2, name: 'Orion Nebula' })).toBeVisible();

  await context.setOffline(false);
});

test('offers a new version once it has downloaded, and switches to it on request', async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem('simuverse.settings.v1', s), LOW_QUALITY_SETTINGS);
  await page.goto('/');
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active?.state === 'activated', null, { timeout: 60_000 });
  // A first visit has nothing to update; a page loaded under the installed version does.
  const prompt = page.getByText('A new version of Simuverse is ready.');
  await expect(prompt).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  // A different script URL stands in for a new deployment.
  await page.evaluate(() => navigator.serviceWorker.register('/sw.js?next'));
  await expect(prompt).toBeVisible({ timeout: 60_000 });
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Reload' }).click();
  await reloaded;
  await expect(page.getByRole('navigation', { name: 'Cosmic address' })).toBeVisible();
  await expect(prompt).toBeHidden();
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(/sw\.js\?next$/);
});

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

// Deterministic default location: the most populous city in the browser's time zone.
test.use({ timezoneId: 'Pacific/Auckland' });

const info = (page: Page) => page.getByRole('complementary', { name: 'Object information' });
const crumbs = (page: Page) => page.getByRole('navigation', { name: 'Cosmic address' });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // The app opens in Sky view at the time-zone default location.
  await expect(crumbs(page).getByRole('button', { name: 'Sky · Auckland' })).toHaveAttribute('aria-current', 'location');
});

/** Sets the simulated time and returns keyboard focus to the 3D view. */
async function setTime(page: Page, local: string) {
  await page.getByLabel('Simulation date and time').fill(local);
  await page.locator('canvas').focus();
}

test('loads catalogues and the DE440 ephemeris', async ({ page }) => {
  await page.keyboard.press('p');
  await expect(page.getByText('stars: loaded')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('ephemeris: DE440')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/satellites: \d+ \((celestrak|cache|stale-cache|snapshot)\)/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/depth: (reversed-z|logarithmic)/)).toBeVisible();
});

test('selecting a planet shows where it is and when it rises and sets', async ({ page }) => {
  await page.keyboard.press('Space');
  await setTime(page, '2026-10-24T23:00');
  await page.keyboard.press('6');
  const panel = info(page);
  await expect(panel.getByRole('heading', { name: 'Saturn' })).toBeVisible();
  await expect(panel.getByText('Constellation', { exact: true })).toBeVisible();
  await expect(panel.getByText('RA / Dec (J2000)', { exact: true })).toBeVisible();
  await expect(panel.getByText('Altitude', { exact: true })).toBeVisible();
  // Rise/transit/set computed in the worker, shown in the observer's time zone.
  await expect(panel.getByText('Transit')).toBeVisible({ timeout: 15_000 });
  // Shown in the locale's clock format (23:49 or 11:49 PM).
  await expect(panel.getByText(/^(23:49|11:49\sPM)$/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('heading', { name: 'Look around' })).toBeVisible();
});

test('tonight summary and city search', async ({ page }) => {
  const sky = page.getByRole('region', { name: 'Sky' });
  await expect(sky.getByText('Sunset')).toBeVisible({ timeout: 15_000 });
  await sky.getByRole('combobox', { name: 'Search for a city' }).fill('Reykjav');
  await sky.getByRole('option').first().getByRole('button').click();
  await expect(crumbs(page).getByRole('button', { name: /^Sky · Reykjav/ })).toBeVisible();
  await expect(sky.getByText(/64\.1\d° N, 21\.\d\d° W/)).toBeVisible();
});

test('zooming out of the sky lifts off into space', async ({ page }) => {
  await page.mouse.move(800, 450);
  // Widen to the maximum field of view, then keep pushing: a few notches lift off.
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 600);
  await expect(crumbs(page).getByRole('button', { name: 'Earth' })).toHaveAttribute('aria-current', 'location', { timeout: 15_000 });
  await page.getByRole('button', { name: /^Sky · Auckland/ }).click();
  await expect(crumbs(page).getByRole('button', { name: 'Sky · Auckland' })).toHaveAttribute('aria-current', 'location');
});

test('universe view focuses bodies and zooms through the cosmic address', async ({ page }) => {
  await crumbs(page).getByRole('button', { name: 'Solar System' }).click();
  await expect(crumbs(page).getByRole('button', { name: 'Solar System' })).toHaveAttribute('aria-current', 'location', { timeout: 15_000 });
  await page.keyboard.press('5');
  await expect(info(page).getByRole('heading', { name: 'Jupiter' })).toBeVisible();
  await crumbs(page).getByRole('button', { name: 'Milky Way' }).click();
  await expect(crumbs(page).getByRole('button', { name: 'Milky Way' })).toHaveAttribute('aria-current', 'location', { timeout: 15_000 });
});

test('time controls pause, speed up and return to now', async ({ page }) => {
  const controls = page.getByRole('group', { name: 'Time controls' });
  await page.locator('canvas').focus();
  await page.keyboard.press('Space');
  await expect(controls.getByText('paused')).toBeVisible();
  await page.keyboard.press('Space');
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  await expect(controls.getByText('×100')).toBeVisible();
  await page.keyboard.press('[');
  await page.keyboard.press('[');
  await page.keyboard.press('[');
  await expect(controls.getByText('−×1')).toBeVisible();
  await page.keyboard.press('n');
  await expect(controls.getByRole('button', { name: /Live/ })).toBeVisible();
});

test('help overlay opens and closes from the keyboard', async ({ page }) => {
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Constellation lines')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('constellation art downloads on first use and toggles from the keyboard', async ({ page }) => {
  const toggle = page.getByRole('region', { name: 'Sky' }).getByRole('switch', { name: /Constellation art/ });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  const atlas = page.waitForResponse((r) => r.url().endsWith('/data/constellation-art.jpg') && r.ok());
  await page.locator('canvas').focus();
  await page.keyboard.press('u');
  await atlas;
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

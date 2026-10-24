import type { Page } from '@playwright/test';
import { LOW_QUALITY_SETTINGS, expect, isolatedTest as test } from './fixtures.ts';

test.use({ timezoneId: 'Pacific/Auckland' });

const info = (page: Page) => page.getByRole('complementary', { name: 'Object information' });
const crumb = (page: Page, name: string | RegExp) =>
  page.getByRole('navigation', { name: 'Cosmic address' }).getByRole('button', { name });
const palette = (page: Page) => page.getByRole('dialog', { name: 'Search and go' });
const hud = (page: Page) => page.getByText(/^to .+ · \d|^speed /).first();

test.beforeEach(async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem('simuverse.settings.v1', s), LOW_QUALITY_SETTINGS);
  await page.goto('/');
  await expect(crumb(page, 'Sky · Auckland')).toHaveAttribute('aria-current', 'location');
});

/** Searches in the command palette and picks the first result; `go` travels there. */
async function search(page: Page, query: string, expected: RegExp, go: boolean) {
  await page.keyboard.press('Control+k');
  const dialog = palette(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').fill(query);
  const first = dialog.getByRole('option').first();
  await expect(first).toContainText(expected, { timeout: 30_000 });
  // From Sky view, Enter shows it in the sky and Shift+Enter goes there.
  await page.keyboard.press(go ? 'Shift+Enter' : 'Enter');
  await expect(dialog).toBeHidden();
}

test('search finds objects by catalogue designation and warps there', async ({ page }) => {
  await search(page, 'm31', /Andromeda Galaxy/, true);
  await expect(page.getByText(/warping to Andromeda Galaxy/)).toBeVisible();
  await expect(info(page).getByRole('heading', { name: 'Andromeda Galaxy' })).toBeVisible();
  await expect(crumb(page, 'Local Group')).toHaveAttribute('aria-current', 'location', { timeout: 30_000 });
  await expect(page.getByText(/warping to/)).toBeHidden({ timeout: 30_000 });
});

test('visits an exoplanet and shows what is known about it', async ({ page }) => {
  await search(page, 'trappist 1 e', /TRAPPIST-1 e/, true);
  const panel = info(page);
  await expect(panel.getByRole('heading', { name: 'TRAPPIST-1 e' })).toBeVisible();
  await expect(panel.getByText('Rocky planet')).toBeVisible();
  await expect(panel.getByText('inside (conservative)')).toBeVisible();
  await expect(panel.getByText('approximate', { exact: true })).toBeVisible();
  await expect(page.getByText(/^to TRAPPIST-1 e/)).toBeVisible({ timeout: 30_000 });
});

test('moons of the outer planets are selectable in the sky', async ({ page }) => {
  await search(page, 'Ganymede', /Moon of Jupiter/, false);
  const panel = info(page);
  await expect(panel.getByRole('heading', { name: 'Ganymede' })).toBeVisible();
  await expect(panel.getByText('Moon of', { exact: true })).toBeVisible();
  // Still in Sky view: the view turned to it.
  await expect(crumb(page, 'Sky · Auckland')).toHaveAttribute('aria-current', 'location');
});

test('the address bar carries a shareable link that restores the view', async ({ page, context }) => {
  await search(page, 'saturn', /Saturn/, true);
  await expect(page.getByText(/^to Saturn/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/warping to/)).toBeHidden({ timeout: 30_000 });
  await expect(page).toHaveURL(/#v=1&m=o&t=saturn&/, { timeout: 10_000 });
  const url = page.url();

  const other = await context.newPage();
  await other.goto(url);
  await expect(info(other).getByRole('heading', { name: 'Saturn' })).toBeVisible({ timeout: 30_000 });
  await expect(other.getByText(/^to Saturn/)).toBeVisible();
  await expect(crumb(other, 'Saturn')).toHaveAttribute('aria-current', 'location');
});

test('free flight: F to fly, WASD moves, F to orbit again', async ({ page }) => {
  await page.locator('canvas').focus();
  await page.keyboard.press('f');
  await expect(page.getByText('free flight', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Free flight' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.down('KeyW');
  // Any non-zero speed: slow frames can carry it into units of c ("speed 0.02 c").
  await expect(page.getByText(/^speed (?!0 m\/s)\d/)).toBeVisible({ timeout: 10_000 });
  await page.keyboard.up('KeyW');
  await page.keyboard.press('f');
  await expect(page.getByText('free flight', { exact: true })).toBeHidden();
  await expect(hud(page)).toBeVisible();
});

test('surprise me goes somewhere', async ({ page }) => {
  await page.locator('canvas').focus();
  // Catalogues stream in first; then R picks a destination.
  await expect(page.getByText(/galaxies: 4\d,\d{3}/)).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('r');
  await expect(page.getByText(/warping to /)).toBeVisible({ timeout: 10_000 });
});

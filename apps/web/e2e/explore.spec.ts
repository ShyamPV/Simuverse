import type { Page } from '@playwright/test';
import { LOW_QUALITY_SETTINGS, expect, isolatedTest as test } from './fixtures.ts';

test.use({ timezoneId: 'Pacific/Auckland' });

const explore = (page: Page) => page.getByRole('dialog', { name: 'Explore' });
const details = (page: Page) => explore(page).getByRole('region', { name: 'Object details' });
const results = (page: Page) => explore(page).getByRole('listbox', { name: /Results for/ });

async function openExplore(page: Page) {
  await page.getByRole('button', { name: 'Explore' }).click();
  await expect(explore(page)).toBeVisible();
  // The catalogue fills in once the deep-sky data has loaded.
  await expect(explore(page).getByText(/^[1-9]\d,\d{3} objects$/)).toBeVisible({ timeout: 30_000 });
}

async function find(page: Page, query: string, name: string) {
  await explore(page).getByRole('searchbox').fill(query);
  await results(page).getByRole('option', { name: new RegExp(name) }).first().click();
  await expect(details(page).getByRole('heading', { level: 2, name })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem('simuverse.settings.v1', s), LOW_QUALITY_SETTINGS);
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Cosmic address' })).toBeVisible();
});

test('shows a featured object, facts and where to find it', async ({ page }) => {
  await openExplore(page);
  await expect(details(page).getByText('Featured today')).toBeVisible();
  await find(page, 'orion nebula', 'Orion Nebula');
  const d = details(page);
  await expect(d.getByRole('heading', { name: /Where to find it/ })).toBeVisible();
  await expect(d.getByText('Orion', { exact: true })).toBeVisible();
  await expect(d.getByText(/^(Naked eye|Binoculars)$/)).toBeVisible();
  await expect(d.getByRole('heading', { name: 'Did you know?' })).toBeVisible();
  await expect(d.getByRole('img', { name: /Orion Nebula/ })).toBeVisible();
});

test('favourites persist across reloads', async ({ page }) => {
  await openExplore(page);
  await find(page, 'sirius', 'Sirius');
  const fav = details(page).getByRole('button', { name: /Favourite/ });
  await fav.click();
  await expect(fav).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await openExplore(page);
  await explore(page).getByRole('button', { name: '★ Favourites' }).click();
  await expect(explore(page).getByRole('listbox', { name: '★ Favourites' }).getByRole('option', { name: /Sirius/ })).toBeVisible();
});

test('lists what is up tonight and the record holders', async ({ page }) => {
  await openExplore(page);
  await explore(page).getByRole('button', { name: 'Visible tonight' }).click();
  await expect(explore(page).getByText(/^Visible tonight · [1-9][\d,]* objects$/)).toBeVisible({ timeout: 30_000 });
  await explore(page).getByRole('button', { name: 'Most extreme' }).click();
  await expect(explore(page).getByText(/Most massive black hole/)).toBeVisible();
});

test('Go there closes Explore and travels to a comet', async ({ page }) => {
  await openExplore(page);
  await find(page, 'halley', 'Halley’s Comet');
  await details(page).getByRole('button', { name: 'Go there' }).click();
  await expect(explore(page)).toBeHidden();
  const info = page.getByRole('complementary', { name: 'Object information' });
  await expect(info.getByRole('heading', { name: 'Halley’s Comet' })).toBeVisible({ timeout: 20_000 });

  // Once the warp has ended, it appears under Visited.
  await expect(page.getByText(/warping to/)).toBeHidden({ timeout: 30_000 });
  await openExplore(page);
  await explore(page).getByRole('button', { name: 'Visited' }).click();
  await expect(explore(page).getByRole('option', { name: /Halley’s Comet/ })).toBeVisible();
});

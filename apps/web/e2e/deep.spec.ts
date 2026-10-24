import type { Page } from '@playwright/test';
import { LOW_QUALITY_SETTINGS, expect, isolatedTest as test } from './fixtures.ts';

test.use({ timezoneId: 'Pacific/Auckland' });

const info = (page: Page) => page.getByRole('complementary', { name: 'Object information' });
const crumb = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Cosmic address' }).getByRole('button', { name });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem('simuverse.settings.v1', s), LOW_QUALITY_SETTINGS);
  await page.goto('/');
  await expect(crumb(page, 'Sky · Auckland')).toHaveAttribute('aria-current', 'location');
});

test('streams Gaia/Tycho star tiles and loads the galaxy catalogue', async ({ page }) => {
  await expect(page.getByText(/gaia\/tycho stars: [1-9][\d,]*/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/galaxies: 4\d,\d{3} \+/)).toBeVisible({ timeout: 30_000 });
});

test('the cosmic address reaches every scale out to the observable universe', async ({ page }) => {
  const levels: [string, string][] = [
    ['Milky Way', 'Milky Way'],
    ['Local Group', 'Local Group'],
    ['Virgo Supercluster', 'Virgo Cluster'],
    ['Laniakea', 'Laniakea'],
    ['Observable Universe', 'Observable universe'],
  ];
  for (const [label, region] of levels) {
    await crumb(page, label).click();
    await expect(info(page).getByRole('heading', { name: region })).toBeVisible({ timeout: 20_000 });
    await expect(crumb(page, label)).toHaveAttribute('aria-current', 'location', { timeout: 30_000 });
  }
  // At cosmological scale the procedural web streams in.
  await expect(page.getByText(/galaxies: [\d,]+ \+ [1-9][\d,]* procedural/)).toBeVisible({ timeout: 30_000 });
});

test('selects Andromeda from its label and travels there', async ({ page }) => {
  await crumb(page, 'Local Group').click();
  const label = page.locator('.sv-label--galaxy .sv-label__text', { hasText: /^Andromeda Galaxy$/ });
  await expect(label).toBeVisible({ timeout: 30_000 });
  await label.click();
  const panel = info(page);
  await expect(panel.getByRole('heading', { name: 'Andromeda Galaxy' })).toBeVisible();
  await expect(panel.getByText('McConnachie 2012 (Local Group)')).toBeVisible();
  await panel.getByRole('button', { name: 'Go there' }).click();
  await expect(page.getByText(/^to Andromeda Galaxy/)).toBeVisible({ timeout: 20_000 });
});

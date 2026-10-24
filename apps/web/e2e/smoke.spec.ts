import { expect, test } from './fixtures.ts';

// The core flow, run in every browser (see SIMUVERSE_E2E_BROWSERS in playwright.config.ts).
test.use({ timezoneId: 'Pacific/Auckland' });

test('opens the sky, browses the catalogue and travels to Saturn', async ({ page }) => {
  await page.goto('/');
  const crumbs = page.getByRole('navigation', { name: 'Cosmic address' });
  await expect(crumbs.getByRole('button', { name: 'Sky · Auckland' })).toHaveAttribute('aria-current', 'location', { timeout: 30_000 });

  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  const explore = page.getByRole('dialog', { name: 'Explore' });
  await expect(explore.getByText(/^[1-9]\d,\d{3} objects$/)).toBeVisible({ timeout: 60_000 });
  await explore.getByRole('button', { name: /Close Explore/ }).click();

  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Search and go' }).getByRole('combobox').fill('saturn');
  // From Sky view, Enter shows it in the sky and Shift+Enter goes there.
  await page.keyboard.press('Shift+Enter');
  const info = page.getByRole('complementary', { name: 'Object information' });
  await expect(info.getByRole('heading', { name: 'Saturn' })).toBeVisible({ timeout: 30_000 });
  await expect(crumbs.getByRole('button', { name: 'Saturn' })).toHaveAttribute('aria-current', 'location', { timeout: 30_000 });
});

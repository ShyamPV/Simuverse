import { type Page, expect, test } from '@playwright/test';

const infoHeading = (page: Page) => page.getByRole('complementary', { name: 'Object information' }).getByRole('heading');

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  // Engine is up once the info panel shows the initial focus.
  await expect(infoHeading(page)).toHaveText('Earth');
});

test.afterEach(() => {
  expect(errors, 'console errors').toEqual([]);
});

test('renders the scene and loads the star catalogue', async ({ page }) => {
  await page.keyboard.press('p');
  const perf = page.getByText(/stars: (loaded|loading…)/);
  await expect(perf).toBeVisible();
  await expect(page.getByText('stars: loaded')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/depth: (reversed-z|logarithmic)/)).toBeVisible();
  // Labels for bright stars and planets are placed by the engine.
  await expect(page.locator('.sv-label--body').first()).toBeAttached();
});

test('number keys and labels focus bodies', async ({ page }) => {
  await page.keyboard.press('6');
  await expect(infoHeading(page)).toHaveText('Saturn');
  await page.getByRole('button', { name: 'Jupiter' }).first().click();
  await expect(infoHeading(page)).toHaveText('Jupiter');
});

test('zooms out through the cosmic address breadcrumb', async ({ page }) => {
  const crumbs = page.getByRole('navigation', { name: 'Cosmic address' });
  await crumbs.getByRole('button', { name: 'Solar System' }).click();
  await expect(crumbs.getByRole('button', { name: 'Solar System' })).toHaveAttribute('aria-current', 'location', { timeout: 15_000 });
  await crumbs.getByRole('button', { name: 'Milky Way' }).click();
  await expect(crumbs.getByRole('button', { name: 'Milky Way' })).toHaveAttribute('aria-current', 'location', { timeout: 15_000 });
  await expect(page.getByText(/to Sun .* ly · .* pc/)).toBeVisible();
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
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

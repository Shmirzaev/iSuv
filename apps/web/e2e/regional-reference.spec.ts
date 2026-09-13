import { expect, test } from '@playwright/test';

const userId = 'a3000000-0000-4000-8000-000000000008';
const organizationId = 'a1000000-0000-4000-8000-000000000001';
const session = {
  user: {
    id: userId,
    organizationId,
    externalSubject: 'synthetic:auditor',
    displayName: 'Synthetic auditor',
    isActive: true,
    dataClassification: 'synthetic',
  },
  organization: {
    id: organizationId,
    code: 'SYNTHETIC',
    name: 'Synthetic water authority',
    dataClassification: 'synthetic',
  },
  currentGrants: [
    {
      id: 'a4000000-0000-4000-8000-000000000008',
      userId,
      organizationId,
      role: 'auditor',
      scope: 'territory',
      territoryId: 'a2000000-0000-4000-8000-000000000002',
      effectiveFrom: '2026-01-01T00:00:00Z',
      effectiveUntil: null,
      cancelledAt: null,
    },
  ],
  resolvedAt: '2026-09-13T12:00:00Z',
};

test('supplied reference maps and workbook register are accessible, responsive, and never live observations', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/session', (route) => route.fulfill({ json: { session } }));
  await page.route('**/api/v1/map-network?**', (route) =>
    route.fulfill({
      status: 403,
      json: {
        error: {
          code: 'FORBIDDEN',
          message: 'Synthetic network fixture unavailable',
          requestId: 'test',
        },
      },
    }),
  );
  await page.addInitScript(() => localStorage.setItem('isuv.locale', 'en'));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/#map');
  await expect(
    page.getByRole('heading', { name: 'Savay and Oqbura-say', exact: true }),
  ).toBeVisible();
  const image = page.locator('.regional-map-image img');
  await expect(image).toHaveJSProperty('complete', true);
  expect(await image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(1000);
  expect((await page.locator('.regional-map-scroll').boundingBox())!.height).toBeGreaterThan(440);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('.regional-zoom output')).toHaveText('150%');
  await expect
    .poll(() =>
      page.locator('.regional-map-scroll').evaluate((el) => el.scrollWidth > el.clientWidth),
    )
    .toBe(true);
  await page.locator('.regional-map-scroll').focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => page.locator('.regional-map-scroll').evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Fit map', exact: true }).click();
  for (const map of [
    'andijan-irrigation',
    'andijan-reference',
    'naryn-network',
    'fergana-valley',
    'savay-area',
  ]) {
    await page.locator('.regional-map-toolbar select').selectOption(map);
    await expect(image).toHaveAttribute('src', `/regional-maps/${map}.webp`);
    await expect
      .poll(() =>
        image.evaluate(
          (el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
  await page.screenshot({ path: info.outputPath('regional-map-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Water intake register (64)' }).click();
  await expect(page.locator('.regional-table-scroll tbody tr')).toHaveCount(64);
  await page.getByRole('button', { name: 'Насос 1', exact: true }).click();
  await expect(page.locator('.regional-inspector')).toBeFocused();
  await expect(page.locator('.regional-inspector')).toContainText('0,80/0,25');
  await expect(page.locator('.regional-inspector')).toContainText('Actual discharge is blank.');
  await expect(page.locator('.regional-inspector')).toContainText('not a live reading');
  await page.screenshot({ path: info.outputPath('regional-register-desktop.png'), fullPage: true });
  await page.getByRole('combobox', { name: 'Canal', exact: true }).selectOption('oqbura');
  await expect(page.locator('.regional-table-scroll tbody tr')).toHaveCount(3);
  await expect(page.locator('.regional-inspector')).not.toContainText('Насос 1');
  await page.getByRole('combobox', { name: 'Canal', exact: true }).selectOption('');
  await page.getByRole('searchbox').fill('Бирлашган');
  await expect(page.locator('.regional-table-scroll tbody tr')).toHaveCount(1);
  await expect(page.locator('.regional-table-scroll')).toContainText('Supplementary sheet');
  await page.getByRole('searchbox').fill('not-a-real-record');
  await expect(page.locator('.regional-table-scroll')).toContainText('No matching records');
  await page.getByRole('searchbox').fill('');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Back to map', exact: true }).click();
  expect(await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('regional-map-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Change color theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: info.outputPath('regional-map-dark-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Change color theme', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ru');
  await expect(page.getByRole('heading', { name: 'Савай и Окбура-сой' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Язык', exact: true }).selectOption('uz');
  await expect(page.getByRole('heading', { name: 'Savay va Oqbura-soy' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Til', exact: true }).selectOption('en');
  await page
    .locator('.regional-view-tabs')
    .getByRole('link', { name: 'Synthetic network', exact: true })
    .click();
  await expect(page).toHaveURL(/view=demo/);
  await expect(page.locator('.regional-view-tabs a[aria-current]')).toHaveText('Synthetic network');
  await page
    .locator('.regional-view-tabs')
    .getByRole('link', { name: 'Regional maps and register', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Savay and Oqbura-say', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

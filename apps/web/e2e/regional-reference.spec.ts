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
  await expect(page.getByRole('heading', { name: 'Explore Andijan', exact: true })).toBeVisible();
  const atlas = page.locator('.atlas-canvas > svg');
  await expect(atlas).toHaveAttribute('data-scene', 'andijan');
  await expect(atlas.locator('.atlas-area')).toHaveCount(5);
  await expect(atlas.locator('.atlas-lake')).toHaveCount(3);
  await expect(atlas.locator('.atlas-settlement')).toHaveCount(13);
  expect((await page.locator('.atlas-canvas').boundingBox())!.height).toBeGreaterThan(440);
  const initialView = await atlas.getAttribute('viewBox');
  await page.locator('.atlas-zoom').getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(atlas).not.toHaveAttribute('viewBox', initialView!);
  const zoomView = await atlas.getAttribute('viewBox');
  await atlas.focus();
  await page.keyboard.press('ArrowRight');
  await expect(atlas).not.toHaveAttribute('viewBox', zoomView!);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(atlas).toHaveAttribute('viewBox', initialView!);
  await atlas.hover();
  await page.mouse.wheel(0, -200);
  await expect(atlas).not.toHaveAttribute('viewBox', initialView!);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await atlas.scrollIntoViewIfNeeded();
  const mapBox = (await atlas.boundingBox())!;
  await page.mouse.move(mapBox.x + 40, mapBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(mapBox.x + 95, mapBox.y + 130, { steps: 5 });
  await page.mouse.up();
  await expect(atlas).not.toHaveAttribute('viewBox', initialView!);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await page.getByRole('button', { name: 'Full-screen map', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.className))
    .toBe('regional-atlas');
  await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
  await page.screenshot({ path: info.outputPath('atlas-andijan-desktop.png'), fullPage: true });
  await atlas.getByRole('button', { name: 'Savay · Oqbura-soy', exact: true }).click();
  await expect(atlas).toHaveAttribute('data-scene', 'savay');
  await expect(atlas.locator('.atlas-area')).toHaveCount(3);
  await expect(atlas.locator('.atlas-pump')).toHaveCount(3);
  await expect(atlas.locator('.atlas-point')).toHaveCount(33);
  const detailView = await atlas.getAttribute('viewBox');
  await page
    .locator('.atlas-feature-bar')
    .getByRole('button', { name: 'Qo‘rg‘ontepa', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(atlas).not.toHaveAttribute('viewBox', detailView!);
  await expect(page.locator('.atlas-breadcrumbs')).toContainText('Qo‘rg‘ontepa');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  // Click an actual river segment, not only its equivalent list button.
  await atlas.scrollIntoViewIfNeeded();
  const riverPoint = await atlas.evaluate((element) => {
    const point = new DOMPoint(527, 422).matrixTransform(
      (element as SVGSVGElement).getScreenCTM()!,
    );
    return { x: point.x, y: point.y };
  });
  await page.mouse.click(riverPoint.x, riverPoint.y);
  await expect(page.locator('.atlas-waterway-card')).toContainText('61 reference records');
  await page.getByRole('button', { name: 'Full-screen map', exact: true }).click();
  await page.getByRole('button', { name: 'Open spreadsheet records', exact: false }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(page.locator('.regional-table-scroll tbody tr')).toHaveCount(61);
  await page.getByRole('button', { name: 'Back to map', exact: true }).click();
  await page
    .locator('.atlas-feature-bar')
    .getByRole('button', { name: '≈ Oqbura-soy', exact: true })
    .click();
  await expect(page.locator('.atlas-waterway-card')).toBeFocused();
  await expect(page.locator('.atlas-waterway-card')).toContainText('3 reference records');
  await page.getByRole('button', { name: 'Open spreadsheet records', exact: false }).click();
  await expect(page.locator('.regional-table-scroll tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Back to map', exact: true }).click();
  await expect(atlas).toHaveAttribute('data-scene', 'savay');
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.locator('.atlas-layer-menu > summary').click();
  await page.getByRole('checkbox', { name: 'Original background' }).check();
  await expect(atlas.locator('image')).toHaveAttribute('href', '/regional-maps/savay-area.webp');
  await page.getByRole('checkbox', { name: 'Original background' }).uncheck();
  await page.locator('.atlas-layer-menu > summary').click();
  await page.screenshot({ path: info.outputPath('atlas-savay-desktop.png'), fullPage: true });
  await page
    .getByRole('combobox', { name: 'Go to a place…', exact: true })
    .selectOption('pump-savay-1');
  await expect(page.locator('.atlas-waterway-card')).toContainText('НС Савай 1');
  await expect(page.locator('.atlas-waterway-card')).toContainText(
    'No live readings or operating status supplied.',
  );
  await expect(
    page
      .locator('.atlas-waterway-card')
      .getByRole('button', { name: 'Open spreadsheet records', exact: false }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Close details' }).click();
  await page
    .getByRole('combobox', { name: 'Go to a place…', exact: true })
    .selectOption('point-33');
  await expect(page.locator('.atlas-waterway-card')).toContainText(
    'Not matched to an Excel row or a sensor.',
  );
  await page.screenshot({ path: info.outputPath('atlas-source-point-detail.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.locator('.atlas-layer-menu > summary').click();
  await page.getByRole('checkbox', { name: 'Numbered source points', exact: true }).uncheck();
  await expect(atlas.locator('.atlas-point')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Roads', exact: true }).uncheck();
  await expect(atlas.locator('.atlas-road')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Roads', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Numbered source points', exact: true }).check();
  await page.locator('.atlas-layer-menu > summary').click();
  await page
    .getByRole('combobox', { name: 'Go to a place…', exact: true })
    .selectOption('place-21');
  await expect(page.locator('.atlas-waterway-card')).toContainText('Chilchibod');
  await expect(atlas.locator('.atlas-settlement')).toHaveCount(30);
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  // Original source gallery stays available, but is no longer the default map.
  await page.locator('.atlas-source-gallery > summary').click();
  const image = page.locator('.regional-map-image img');
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
  await page.locator('.atlas-source-gallery > summary').click();
  await page.getByRole('button', { name: 'Water intake register (64)' }).click();
  await page.getByRole('combobox', { name: 'Canal', exact: true }).selectOption('');
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
  expect((await page.locator('.atlas-canvas').boundingBox())!.height).toBeLessThan(350);
  await page
    .locator('.atlas-feature-bar')
    .getByRole('button', { name: '≈ Oqbura-soy', exact: true })
    .click();
  await expect(page.locator('.atlas-waterway-card')).toContainText('3 reference records');
  await page.getByRole('button', { name: 'Open spreadsheet records', exact: false }).click();
  await expect(page.locator('.regional-table-scroll tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Back to map', exact: true }).click();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Change color theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: info.outputPath('regional-map-dark-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Change color theme', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ru');
  await expect(page.getByRole('heading', { name: 'Карта Андижана' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Язык', exact: true }).selectOption('uz');
  await expect(page.getByRole('heading', { name: 'Andijon xaritasi' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Explore Andijan', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('touch navigation opens the region and its supplied records without a geographic lookup', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.route('**/api/v1/session', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'UNAVAILABLE', message: 'Unavailable', requestId: 'touch-test' } },
    }),
  );
  await page.addInitScript(() => localStorage.setItem('isuv.locale', 'en'));
  await page.goto('/#map');
  const atlas = page.locator('.atlas-canvas > svg');
  await atlas.getByRole('button', { name: 'Savay · Oqbura-soy', exact: true }).tap();
  await expect(atlas).toHaveAttribute('data-scene', 'savay');
  await page
    .locator('.atlas-feature-bar')
    .getByRole('button', { name: '≈ Savay', exact: true })
    .tap();
  await page.getByRole('button', { name: 'Open spreadsheet records', exact: false }).tap();
  await expect(page.locator('.regional-table-scroll tbody tr')).toHaveCount(61);
  await expect(page.locator('.regional-table-scroll')).not.toContainText('SYN-HOTSPOT');
  await context.close();
});

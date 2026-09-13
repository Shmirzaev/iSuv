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

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/session', (route) => route.fulfill({ json: { session } }));
  await page.addInitScript(() => localStorage.setItem('isuv.locale', 'en'));
});

test('actual detailed Andijan PDF preserves source detail and supports district, pointer, keyboard and fullscreen navigation', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const asset = page.waitForResponse('**/regional-maps/andijan-detailed.svg');
  await page.goto('/#map');
  expect((await asset).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Explore Andijan', exact: true })).toBeVisible();
  const map = page.locator('.source-map-canvas > svg');
  await expect(page.locator('.source-map-loading')).toHaveCount(0);
  await expect(map).toHaveAttribute('data-source-view', 'andijan-pdf');
  await expect(map.locator('image')).toHaveAttribute('href', '/regional-maps/andijan-detailed.svg');
  await expect(map.locator('[data-kind="district"]')).toHaveCount(14);
  await expect(page.locator('image[href*="atlas-terrain"]')).toHaveCount(0);
  const initial = (await map.getAttribute('viewBox'))!;
  await page.screenshot({
    path: info.outputPath('andijan-actual-pdf-desktop.png'),
    fullPage: true,
  });
  await map.getByRole('button', { name: 'Andijon', exact: true }).click();
  await expect(map).not.toHaveAttribute('viewBox', initial);
  await expect(page.locator('.source-map-selection')).toContainText('А Н Д И Ж О Н');
  await expect(page.locator('.source-map-selection')).toBeFocused();
  await expect(page.locator('.source-map-selection')).toContainText('No live readings');
  await page.screenshot({ path: info.outputPath('andijan-district-detail.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await expect(map).toBeFocused();
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(map).toHaveAttribute('viewBox', initial);
  await page
    .locator('.source-map-zoom')
    .getByRole('button', { name: 'Zoom in', exact: true })
    .click();
  const zoomed = (await map.getAttribute('viewBox'))!;
  expect(zoomed).not.toBe(initial);
  await map.focus();
  await page.keyboard.press('ArrowRight');
  await expect(map).not.toHaveAttribute('viewBox', zoomed);
  await page.keyboard.press('Escape');
  await expect(map).toHaveAttribute('viewBox', initial);
  await map.hover();
  await page.mouse.wheel(0, -200);
  await expect(map).not.toHaveAttribute('viewBox', initial);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + 70, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + 140, { steps: 5 });
  await page.mouse.up();
  await expect(map).not.toHaveAttribute('viewBox', initial);
  await expect(page.locator('.source-map-selection')).toHaveCount(0);
  // A background click zooms, but a drag must not turn into an accidental click zoom.
  expect(Number((await map.getAttribute('viewBox'))!.split(' ')[2])).toBe(
    Number(initial.split(' ')[2]),
  );
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await map.click({ position: { x: 90, y: 110 } });
  expect(Number((await map.getAttribute('viewBox'))!.split(' ')[2])).toBeLessThan(
    Number(initial.split(' ')[2]),
  );
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Zoom to a district or place' })
    .selectOption('qorgontepa');
  await expect(page.getByRole('button', { name: 'Explore Savay detail' })).toBeVisible();
  await page.getByRole('button', { name: 'Full-screen map', exact: false }).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.className))
    .toBe('andijan-source-map');
  await page.screenshot({ path: info.outputPath('andijan-qorgontepa-fullscreen.png') });
  await page.getByRole('button', { name: 'Exit full screen', exact: false }).click();
  await page.getByRole('button', { name: 'Explore Savay detail' }).click();
  await expect(map).toHaveAttribute('data-source-view', 'savay');
  await expect(map.locator('image')).toHaveAttribute('href', '/regional-maps/savay-area.webp');
  await expect(page.locator('.source-map-loading')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('original Andijan irrigation and Savay maps connect to the unchanged source register', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/#map');
  const map = page.locator('.source-map-canvas > svg');
  await page
    .getByRole('combobox', { name: 'Map view', exact: true })
    .selectOption('andijan-irrigation');
  await expect(page.locator('.source-map-loading')).toHaveCount(0);
  await expect(map.locator('image')).toHaveAttribute(
    'href',
    '/regional-maps/andijan-irrigation.webp',
  );
  await expect(map.locator('[data-kind="irrigation"]')).toHaveCount(5);
  await map.getByRole('button', { name: 'Savay · Oqbura-soy', exact: true }).click();
  await page.getByRole('button', { name: 'Explore Savay detail' }).click();
  await expect(page.locator('.source-map-loading')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('savay-original-desktop.png'), fullPage: true });
  await page
    .getByRole('combobox', { name: 'Zoom to a district or place' })
    .selectOption('pump-savay-1');
  await expect(page.locator('.source-map-selection')).toContainText('НС Савай 1');
  await expect(page.locator('.source-map-selection')).toContainText('No live readings');
  await expect(
    page
      .locator('.source-map-selection')
      .getByRole('button', { name: 'Open spreadsheet records', exact: false }),
  ).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Zoom to a district or place' })
    .selectOption('point-33');
  await expect(page.locator('.source-map-selection')).toContainText(
    'Not matched to an Excel row or a sensor.',
  );
  await expect(map.locator('[data-kind="point"]')).toHaveCount(33);
  await expect(map.locator('[data-kind="pump"]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  // Actual river hit target on the original Savay map.
  const river = await map.evaluate((element) => {
    const p = new DOMPoint(527, 422).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(river.x, river.y);
  await expect(page.locator('.source-map-selection')).toContainText('Savay');
  await page.getByRole('button', { name: 'Full-screen map', exact: false }).click();
  await page.getByRole('button', { name: 'Open spreadsheet records (61)', exact: false }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(page.locator('.regional-table-scroll tbody tr')).toHaveCount(61);
  await page.getByRole('button', { name: 'Back to map', exact: true }).click();
  await page.getByRole('button', { name: '≈ Oqbura-soy', exact: true }).click();
  await page.getByRole('button', { name: 'Open spreadsheet records (3)', exact: false }).click();
  await expect(page.locator('.regional-table-scroll tbody tr')).toHaveCount(3);
  await page.getByRole('combobox', { name: 'Canal', exact: true }).selectOption('');
  await expect(page.locator('.regional-table-scroll tbody tr')).toHaveCount(64);
  await page.getByRole('button', { name: 'Насос 1', exact: true }).click();
  await expect(page.locator('.regional-inspector')).toBeFocused();
  await expect(page.locator('.regional-inspector')).toContainText('0,80/0,25');
  await expect(page.locator('.regional-inspector')).toContainText('Actual discharge is blank.');
  await expect(page.locator('.regional-inspector')).toContainText('not a live reading');
  await page.getByRole('combobox', { name: 'Canal', exact: true }).selectOption('oqbura');
  await expect(page.locator('.regional-inspector')).not.toContainText('Насос 1');
  await page.getByRole('combobox', { name: 'Canal', exact: true }).selectOption('');
  await page.getByRole('searchbox').fill('Бирлашган');
  await expect(page.locator('.regional-table-scroll tbody tr')).toHaveCount(1);
  await expect(page.locator('.regional-table-scroll')).toContainText('Supplementary sheet');
  await page.getByRole('searchbox').fill('not-a-real-record');
  await expect(page.locator('.regional-table-scroll')).toContainText('No matching records');
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: 'Back to map', exact: true }).click();
  await page.locator('.atlas-source-gallery > summary').click();
  const image = page.locator('.regional-map-image img');
  for (const id of [
    'andijan-irrigation',
    'andijan-reference',
    'naryn-network',
    'fergana-valley',
    'savay-area',
  ]) {
    await page.locator('.regional-map-toolbar select').selectOption(id);
    await expect(image).toHaveAttribute('src', '/regional-maps/' + id + '.webp');
    await expect
      .poll(() =>
        image.evaluate(
          (el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
});

test('responsive localized map is usable without operations API and a missing map has an honest retry', async ({
  page,
}, info) => {
  await page.route('**/api/v1/session', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'UNAVAILABLE', message: 'Unavailable', requestId: 'test' } },
    }),
  );
  await page.route('**/regional-maps/andijan-detailed.svg', (route) => route.abort());
  await page.goto('/#map');
  await expect(
    page.getByRole('alert').filter({ hasText: 'The source map could not load.' }),
  ).toBeVisible();
  await page.unroute('**/regional-maps/andijan-detailed.svg');
  await page.getByRole('button', { name: 'Retry map' }).click();
  await expect(page.locator('.source-map-loading')).toHaveCount(0);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(
      true,
    );
    await page
      .getByRole('combobox', { name: 'Zoom to a district or place' })
      .selectOption('andijan');
    await expect(page.locator('.source-map-selection')).toBeVisible();
    expect(await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  }
  expect((await page.locator('.source-map-canvas > svg').boundingBox())!.height).toBeLessThan(250);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('andijan-pdf-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Change color theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('andijan-pdf-dark-mobile.png'), fullPage: true });
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ru');
  await expect(page.getByRole('combobox', { name: 'Вид карты', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Карта Андижана' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Язык', exact: true }).selectOption('uz');
  await expect(
    page.getByRole('combobox', { name: 'Xarita ko‘rinishi', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Andijon xaritasi' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Til', exact: true }).selectOption('en');
  await page
    .locator('.regional-view-tabs')
    .getByRole('link', { name: 'Synthetic network', exact: true })
    .click();
  await expect(page).toHaveURL(/view=demo/);
  await page
    .locator('.regional-view-tabs')
    .getByRole('link', { name: 'Regional maps and register', exact: true })
    .click();
  await expect(page.locator('.source-map-canvas > svg')).toHaveAttribute(
    'data-source-view',
    'andijan-pdf',
  );
});

test('touch users can zoom the PDF, explore Savay and reach its records without geographic lookups', async ({
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
  const map = page.locator('.source-map-canvas > svg');
  await expect(page.locator('.source-map-loading')).toHaveCount(0);
  const initial = (await map.getAttribute('viewBox'))!;
  await map.tap({ position: { x: 130, y: 120 } });
  await expect(map).not.toHaveAttribute('viewBox', initial);
  await page.getByRole('button', { name: 'Reset view', exact: true }).tap();
  await map.scrollIntoViewIfNeeded();
  const box = (await map.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', distance: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints:
        type === 'touchEnd'
          ? []
          : [
              { id: 1, x: box.x + box.width / 2 - distance, y: box.y + box.height / 2 },
              { id: 2, x: box.x + box.width / 2 + distance, y: box.y + box.height / 2 },
            ],
    });
  await touch('touchStart', 25);
  await touch('touchMove', 70);
  await touch('touchEnd', 0);
  expect(Number((await map.getAttribute('viewBox'))!.split(' ')[2])).toBeLessThan(
    Number(initial.split(' ')[2]),
  );
  await expect(page.locator('.source-map-selection')).toHaveCount(0);
  await cdp.detach();
  await page.getByRole('combobox', { name: 'Map view', exact: true }).selectOption('savay');
  await page.getByRole('button', { name: '≈ Savay', exact: true }).tap();
  await page.getByRole('button', { name: 'Open spreadsheet records (61)', exact: false }).tap();
  await expect(page.locator('.regional-table-scroll tbody tr')).toHaveCount(61);
  await expect(page.locator('.regional-table-scroll')).not.toContainText('SYN-HOTSPOT');
  await context.close();
});

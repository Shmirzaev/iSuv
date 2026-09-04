import { expect, test } from '@playwright/test';

const english = 'en';
const russian = 'ru';
const uzbek = 'uz';

async function chooseLocale(page: import('@playwright/test').Page, locale: string) {
  await page.getByRole('combobox', { name: /Language|Язык|Til/ }).selectOption(locale);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

async function expectPageLevelContainment(page: import('@playwright/test').Page) {
  const width = await page.locator('html').evaluate((element) => {
    const client = element.clientWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((candidate) => {
        const bounds = candidate.getBoundingClientRect();
        return bounds.width > 0 && bounds.right > client + 1;
      })
      .slice(0, 10)
      .map((candidate) => ({
        className: candidate.className,
        nodeName: candidate.nodeName,
        right: Math.round(candidate.getBoundingClientRect().right),
        width: Math.round(candidate.getBoundingClientRect().width),
      }));
    return { client, offenders, scroll: element.scrollWidth };
  });
  expect(width.scroll, JSON.stringify(width.offenders)).toBeLessThanOrEqual(width.client + 1);
}

async function expectPageLevelContainmentAt320(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 320, height: 700 });
  await expectPageLevelContainment(page);
  await page.setViewportSize({ width: 1280, height: 720 });
}

test('seeded synthetic operational surfaces remain navigable, explicit, and responsive', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', uzbek);
  await chooseLocale(page, english);

  await expect(
    page.getByText(/Synthetic demonstration data — not government telemetry/),
  ).toBeVisible();
  await expect(page.locator('.synthetic-badge')).toContainText('SYNTHETIC');
  await expect(page.locator('#synthetic-badge-description')).toContainText(
    'does not control infrastructure',
  );
  const initialTheme = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: 'Change color theme' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', initialTheme ?? '');
  const selectedTheme = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: 'Dismiss synthetic-data notice' }).click();
  await expect(
    page.getByText(/Synthetic demonstration data — not government telemetry/),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', selectedTheme ?? '');
  await expect(
    page.getByText(/Synthetic demonstration data — not government telemetry/),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What should I do?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Operational overview' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simple' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const scenarioIdentifier = page.getByText('Scenario identifier', { exact: true });
  await expect(scenarioIdentifier).toBeHidden();
  await page.getByRole('button', { name: 'Detailed' }).click();
  const dashboardProvenance = page.locator('.workspace-header__provenance');
  const dashboardProvenanceSummary = dashboardProvenance.locator('summary');
  await dashboardProvenanceSummary.click();
  await expect(scenarioIdentifier).toBeVisible();
  await dashboardProvenanceSummary.click();
  await page.getByRole('button', { name: 'Simple' }).click();
  await expect(page.getByRole('heading', { name: 'What should I do?' })).toBeVisible();
  const referenceTrigger = page.getByRole('button', { name: 'Reference' });
  await referenceTrigger.click();
  const reference = page.getByRole('dialog', { name: 'Measurement boundary' });
  await expect(reference).toBeFocused();
  await expect(reference.getByText('metres (m)', { exact: true })).toBeVisible();
  await expect(
    reference.getByText('cubic metres per second (m³/s)', { exact: true }),
  ).toBeVisible();
  await expect(reference.getByText('cubic metres (m³)', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(referenceTrigger).toBeFocused();
  const identityTrigger = page.getByRole('button', { name: 'Identity and authorization' });
  await identityTrigger.click();
  const identity = page.getByRole('dialog', { name: 'Identity and authorization' });
  await expect(identity).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(identityTrigger).toBeFocused();
  await expectPageLevelContainmentAt320(page);

  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await navigation.getByRole('link', { name: 'Analytics', exact: true }).click();
  await expect(page).toHaveURL(/#analytics/);
  await expect(
    page.getByRole('heading', { name: 'Delivery and water accounting analytics' }),
  ).toBeVisible();
  await expect(page.getByText('No forecast or AI operational truth is present.')).toBeVisible();
  await expect(page.locator('section[aria-labelledby="analytics-delivery"]')).toContainText('m³');
  await expect(page.locator('.ops-chart').first()).toBeVisible();
  await expect(page.locator('.ops-chart table').first()).toHaveClass(/visually-hidden/);
  const chartBox = await page.locator('.ops-chart__canvas').first().boundingBox();
  expect(chartBox?.height).toBeGreaterThanOrEqual(200);
  expect(chartBox?.width).toBeGreaterThan(500);
  await expectPageLevelContainmentAt320(page);

  await navigation.getByRole('link', { name: 'Live operations', exact: true }).click();
  await expect(page).toHaveURL(/#operations/);
  await expect(page.getByRole('heading', { name: 'Live operations' })).toBeVisible();
  const liveProvenance = page.locator('.workspace-header__provenance');
  await expect(liveProvenance).toContainText('Synthetic scenario / non-official source');
  await expect(liveProvenance).not.toHaveAttribute('open', '');
  await expect(page.locator('.live-stream-status')).toContainText(/Live|Connected/);
  await expect(page.locator('.live-stream-status')).not.toContainText('Reconnecting live updates');
  await expect(page.locator('.status-chip').first()).toBeVisible();
  await expect(page.getByRole('cell', { name: /^No data/ }).first()).toBeVisible();
  const liveRowHeights = await page
    .locator('.live-table tbody tr')
    .evaluateAll((rows) => rows.slice(0, 3).map((row) => row.getBoundingClientRect().height));
  expect(Math.max(...liveRowHeights)).toBeLessThanOrEqual(64);
  await expect(page.locator('.live-pagination')).toContainText(/1–25 of 83/);
  const previousPage = page.getByRole('button', { name: 'Previous page' });
  const nextPage = page.getByRole('button', { name: 'Next page' });
  await expect(previousPage).toBeDisabled();
  await expect(nextPage).toBeEnabled();
  await nextPage.click();
  await expect(page.locator('.live-pagination')).toContainText(/26–50 of 83/);
  await expect(previousPage).toBeEnabled();
  await previousPage.click();
  await expect(page.locator('.live-pagination')).toContainText(/1–25 of 83/);
  await expect(page.locator('.live-status-compact').first()).toBeVisible();
  await expectPageLevelContainmentAt320(page);
  const deviceLink = page.getByRole('link', { name: /^Inspect device:/ }).first();
  await deviceLink.click();
  await expect(page).toHaveURL(/#operations\?deviceId=/);
  const inspectorHeading = page.locator('h2[id^="live-inspector-"]');
  await expect(inspectorHeading).toBeFocused();
  await expect(inspectorHeading).toContainText('Device inspector');
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await expect(page).toHaveURL(/#operations$/);
  await expect(deviceLink).toBeFocused();

  await navigation.getByRole('link', { name: 'Alarms and incidents', exact: true }).click();
  await expect(page).toHaveURL(/#alarms/);
  await expect(page.getByRole('heading', { name: 'Alarm and incident center' })).toBeVisible();
  await expectPageLevelContainmentAt320(page);
  await page.getByRole('button', { name: 'Inspect record' }).first().click();
  await expect(page).toHaveURL(/#alarms\?(alarmId|incidentId)=/);
  const alarmDetail = page.getByRole('heading', { name: 'Alarm and incident detail' });
  await expect(alarmDetail).toBeFocused();
  await expect(page.locator('.alarm-center-panel')).toContainText('Human incident state');

  await navigation.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page).toHaveURL(/#reports/);
  await expect(
    page.getByRole('heading', { name: 'Versioned reports and audit evidence' }),
  ).toBeVisible();
  const templateGroup = page.getByRole('radiogroup');
  const dailyTemplate = templateGroup.getByRole('radio', { name: 'Daily situation' });
  const allocationTemplate = templateGroup.getByRole('radio', {
    name: 'Allocation compliance',
  });
  await expect(dailyTemplate).toBeChecked();
  await dailyTemplate.focus();
  await page.keyboard.press('ArrowRight');
  await expect(allocationTemplate).toBeChecked();
  await expectPageLevelContainmentAt320(page);
  const existingReport = page.getByRole('button', { name: 'Open frozen report' }).first();
  if (await existingReport.count()) await existingReport.click();
  else await page.getByRole('button', { name: 'Generate or retrieve frozen snapshot' }).click();
  await expect(page.getByRole('heading', { name: 'Frozen report detail' })).toBeVisible();
  await expect(page.locator('.reports-detail')).toContainText('Generated at');
  await expect(page.locator('.reports-detail')).toContainText('Content fingerprint');
  await expect(page.locator('.reports-detail')).toContainText('SYNTHETIC / NON-OFFICIAL scenario');

  await navigation.getByRole('link', { name: 'Audit history', exact: true }).click();
  await expect(page).toHaveURL(/#audit/);
  await expect(page.getByRole('heading', { name: 'Authorized audit explorer' })).toBeVisible();
  const auditOpen = page.getByRole('button', { name: 'Open evidence' }).first();
  await auditOpen.click();
  await expect(page).toHaveURL(/#audit\?eventId=/);
  const auditDetail = page.getByRole('heading', { name: 'Audit event evidence' });
  await expect(auditDetail).toBeFocused();
  await expect(page.locator('.audit-detail')).toContainText('Provenance');
  await expect(page.locator('.audit-detail')).toContainText(
    'Synthetic and non-official audit evidence — not proof of real government activity.',
  );
  await page.getByRole('button', { name: 'Return to audit list' }).click();
  await expect(page).toHaveURL(/#audit$/);
  await expect(auditOpen).toBeFocused();

  await chooseLocale(page, russian);
  const russianNavigation = page.getByRole('navigation', { name: 'Основная навигация' });
  await expect(
    russianNavigation.getByRole('link', { name: 'Аналитика', exact: true }),
  ).toBeVisible();
  await chooseLocale(page, uzbek);
  const uzbekNavigation = page.getByRole('navigation', { name: 'Asosiy navigatsiya' });
  await expect(uzbekNavigation.getByRole('link', { name: 'Tahlil', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.topbar__menu-button').click();
  await uzbekNavigation.getByRole('link', { name: 'Audit tarixi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vakolatli audit ko‘ruvchisi' })).toBeVisible();
  const responsive = await page.locator('body').evaluate(() => {
    const table = document.querySelector<HTMLElement>('.audit-table-scroll');
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      tableOverflowsLocally: Boolean(table && table.scrollWidth > table.clientWidth),
    };
  });
  expect(responsive.documentWidth).toBeLessThanOrEqual(responsive.viewport + 1);
  expect(responsive.tableOverflowsLocally).toBe(true);
  await expectPageLevelContainmentAt320(page);
  expect(consoleErrors).toEqual([]);
});

test('map-first workspace keeps evidence compact and station markers interactive', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/#map');
  await chooseLocale(page, english);
  await expect(page.getByRole('heading', { name: 'Map and network' })).toBeVisible();
  await expect(page.locator('.workspace-header__provenance')).toContainText(
    'not official GIS or live control',
  );
  await expect(page.locator('.workspace-header__provenance')).not.toHaveAttribute('open', '');

  const mapCanvas = page.locator('.map-canvas');
  await expect(mapCanvas).toBeVisible();
  const mapCanvasBox = await mapCanvas.boundingBox();
  expect(mapCanvasBox?.y).toBeLessThan(650);
  expect(mapCanvasBox?.height).toBeGreaterThan(500);
  expect(await page.locator('.map-waterway').count()).toBeGreaterThan(0);
  const stationsLayer = page.getByRole('checkbox', { name: 'Stations' });
  await expect(stationsLayer).toBeChecked();
  const marker = page.locator('.map-station-feature').first();
  await expect(marker).toBeVisible();
  await expect(page.locator('.map-sidebar__details[open]')).toHaveCount(1);
  await stationsLayer.uncheck();
  await expect(page.locator('.map-station-feature')).toHaveCount(0);
  await stationsLayer.check();
  await expect(marker).toBeVisible();
  await marker.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#map\?stationId=/);
  await expect(page.getByRole('heading', { name: 'Selected station' })).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  const responsive = await page.locator('body').evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(responsive.documentWidth).toBeLessThanOrEqual(responsive.viewport + 1);
  await expectPageLevelContainmentAt320(page);
  expect(consoleErrors).toEqual([]);
});

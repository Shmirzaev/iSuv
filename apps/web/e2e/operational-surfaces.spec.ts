import { expect, test } from '@playwright/test';

const english = 'en';
const russian = 'ru';
const uzbek = 'uz';

async function chooseLocale(page: import('@playwright/test').Page, locale: string) {
  await page.locator(`input[name="language"][value="${locale}"]`).check();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
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
  await expect(page.getByText('metres (m)', { exact: true })).toBeVisible();
  await expect(page.getByText('cubic metres per second (m³/s)', { exact: true })).toBeVisible();
  await expect(page.getByText('cubic metres (m³)', { exact: true })).toBeVisible();

  const navigation = page.getByRole('navigation');
  await navigation.getByRole('link', { name: 'Analytics', exact: true }).click();
  await expect(page).toHaveURL(/#analytics/);
  await expect(
    page.getByRole('heading', { name: 'Delivery and water accounting analytics' }),
  ).toBeVisible();
  await expect(page.getByText('No forecast or AI operational truth is present.')).toBeVisible();
  await expect(page.locator('section[aria-labelledby="analytics-delivery"]')).toContainText('m³');

  await navigation.getByRole('link', { name: 'Live operations', exact: true }).click();
  await expect(page).toHaveURL(/#operations/);
  await expect(page.getByRole('heading', { name: 'Live operations' })).toBeVisible();
  await expect(
    page.getByText('Synthetic scenario / non-official source', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('strong')
      .filter({ hasText: /^Unreliable$/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: /^No data/ }).first()).toBeVisible();
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
  const existingReport = page.getByRole('button', { name: 'Open frozen report' }).first();
  if (await existingReport.count()) await existingReport.click();
  else await page.getByRole('button', { name: 'Generate or retrieve frozen snapshot' }).click();
  await expect(page.getByRole('heading', { name: 'Frozen report detail' })).toBeVisible();
  await expect(page.locator('.reports-detail')).toContainText('Generated at');
  await expect(page.locator('.reports-detail')).toContainText('Content fingerprint');
  await expect(page.locator('.reports-detail')).toContainText('synthetic');

  await navigation.getByRole('link', { name: 'Audit history', exact: true }).click();
  await expect(page).toHaveURL(/#audit/);
  await expect(page.getByRole('heading', { name: 'Authorized audit explorer' })).toBeVisible();
  const auditOpen = page.getByRole('button', { name: 'Open evidence' }).first();
  await auditOpen.click();
  await expect(page).toHaveURL(/#audit\?eventId=/);
  const auditDetail = page.getByRole('heading', { name: 'Audit event evidence' });
  await expect(auditDetail).toBeFocused();
  await expect(page.locator('.audit-detail')).toContainText('Provenance');
  await expect(page.locator('.audit-detail')).toContainText('SYNTHETIC / NON-OFFICIAL');
  await page.getByRole('button', { name: 'Return to audit list' }).click();
  await expect(page).toHaveURL(/#audit$/);
  await expect(auditOpen).toBeFocused();

  await chooseLocale(page, russian);
  await expect(navigation.getByRole('link', { name: 'Аналитика', exact: true })).toBeVisible();
  await chooseLocale(page, uzbek);
  await expect(navigation.getByRole('link', { name: 'Tahlil', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await navigation.getByRole('link', { name: 'Audit tarixi', exact: true }).click();
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
  expect(consoleErrors).toEqual([]);
});

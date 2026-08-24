import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { Session } from '@isuv/contracts';

import {
  accessibleNavigationItems,
  applyDocumentLocale,
  canDiscoverAlarmWorkspace,
  identityPresentation,
  navigationItems,
  skipTargetId,
} from './app-model.js';
import { initialLocale, locales, translations } from '@isuv/i18n';

const session: Session = {
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    externalSubject: 'synthetic:web-test',
    displayName: 'Synthetic operator',
    isActive: true,
    dataClassification: 'synthetic',
  },
  organization: {
    id: '22222222-2222-4222-8222-222222222222',
    code: 'SYNTHETIC',
    name: 'Synthetic water authority',
    dataClassification: 'synthetic',
  },
  currentGrants: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      userId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      role: 'district_operator',
      scope: 'territory',
      territoryId: '44444444-4444-4444-8444-444444444444',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveUntil: null,
      cancelledAt: null,
    },
  ],
  resolvedAt: '2026-01-01T00:00:00.000Z',
};

test('every shell string has a nonempty Uzbek, Russian, and English translation', () => {
  const keys = Object.keys(translations.en).sort();
  for (const locale of locales) {
    assert.deepEqual(Object.keys(translations[locale]).sort(), keys);
    assert.ok(Object.values(translations[locale]).every((value) => value.trim().length > 0));
  }
  assert.equal(initialLocale('ru'), 'ru');
  assert.equal(initialLocale('unsupported'), 'uz');
});

test('static and synchronous document language match the default Uzbek locale', async () => {
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /<html lang="uz">/);
  const root = { lang: 'en' };
  applyDocumentLocale(root, initialLocale(null));
  assert.equal(root.lang, 'uz');
});

test('keyboard navigation has a skip target and global alarms only for session-derived readers', () => {
  assert.equal(skipTargetId, 'main-content');
  assert.equal(
    accessibleNavigationItems(null).some((item) => item.area === 'alarms'),
    false,
  );
  assert.equal(canDiscoverAlarmWorkspace(session), true);
  assert.equal(
    accessibleNavigationItems(session).find((item) => item.area === 'alarms')?.href,
    '#alarms',
  );
  assert.equal(
    accessibleNavigationItems(session).some((item) => item.area === 'audit'),
    false,
  );
  assert.equal(navigationItems.find((item) => item.area === 'alarms')?.label, 'navAlarms');
});

test('unverified identity never implies territory access', () => {
  assert.deepEqual(identityPresentation({ kind: 'unauthenticated' }), {
    status: 'warning',
    title: 'identityUnavailable',
    detail: 'identityUnavailableDetail',
  });
  assert.deepEqual(identityPresentation({ kind: 'unavailable' }), {
    status: 'unavailable',
    title: 'serviceUnavailable',
    detail: 'serviceUnavailableDetail',
  });
});

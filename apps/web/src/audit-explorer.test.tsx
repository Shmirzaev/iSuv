import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuditEvent } from '@isuv/contracts';
import { translations } from '@isuv/i18n';
import { AuditEventDetail, AuditFiltersForm } from './audit-explorer.js';
import { defaultAuditFilters } from './audit-explorer-model.js';

const id = 'a6000000-0000-4000-8000-000000000001';
const event: AuditEvent = {
  id,
  organizationId: 'a6000000-0000-4000-8000-000000000002',
  territoryId: 'a6000000-0000-4000-8000-000000000003',
  actorUserId: 'a6000000-0000-4000-8000-000000000004',
  actorOrganizationId: 'a6000000-0000-4000-8000-000000000002',
  action: 'incident.closed',
  resource: 'incident',
  resourceId: 'a6000000-0000-4000-8000-000000000005',
  oldState: { status: 'resolved', privateNote: '<untrusted>' },
  newState: { status: 'closed' },
  reason: 'Synthetic closure evidence',
  requestId: 'req-001',
  occurredAt: '2026-08-24T00:00:00.000Z',
  dataClassification: 'synthetic',
  provenance: 'synthetic seeded audit',
};

test('audit detail separates escaped immutable old and new state and provides a stable link', () => {
  const markup = renderToStaticMarkup(
    <AuditEventDetail event={event} locale="en" onClose={() => undefined} state="ready" />,
  );
  for (const text of [
    'Audit event evidence',
    'Prior state',
    'New state',
    'Synthetic and non-official',
    'Target organization identifier',
    'Actor organization identifier',
    '<pre>',
  ])
    assert.match(markup, new RegExp(text));
  assert.ok(markup.includes(`href="#audit?eventId=${id}"`));
  assert.match(markup, /&lt;untrusted&gt;/);
  assert.doesNotMatch(markup, /operate valve|control gate|send command/i);
});

test('audit filters are collapsed by default, keep exact identifier controls, and stay localized', async () => {
  const markup = renderToStaticMarkup(
    <AuditFiltersForm
      busy={false}
      filters={defaultAuditFilters}
      locale="en"
      onApply={() => undefined}
    />,
  );
  assert.match(markup, /Audit filters \(0\)/);
  assert.match(markup, /filter-panel__content" hidden=""/);
  assert.match(markup, /id="audit-action"/);
  const source = await readFile(new URL('./audit-explorer.tsx', import.meta.url), 'utf8');
  for (const marker of [
    'id="audit-action"',
    'id="audit-resource"',
    'id="audit-actor"',
    'id="audit-resource-id"',
    'id="audit-request-id"',
    'type="datetime-local"',
    'pattern={uuidPattern}',
    '<optgroup',
    'auditActionTranslationKey',
  ])
    assert.ok(source.includes(marker), marker);
  for (const locale of ['en', 'ru', 'uz'] as const)
    for (const key of [
      'auditHeading',
      'auditFilters',
      'auditOldState',
      'auditNewState',
      'auditSyntheticNonOfficial',
      'auditActionIncidentClosed',
    ] as const)
      assert.ok(translations[locale][key].length > 0);
});

test('audit detail distinguishes denied and degraded evidence and always offers a safe return', () => {
  const denied = renderToStaticMarkup(
    <AuditEventDetail event={null} locale="en" onClose={() => undefined} state="forbidden" />,
  );
  const degraded = renderToStaticMarkup(
    <AuditEventDetail event={null} locale="en" onClose={() => undefined} state="degraded" />,
  );
  assert.match(denied, /Audit access unavailable/);
  assert.match(degraded, /Audit response needs attention/);
  assert.match(denied, /Return to audit list/);
  assert.match(degraded, /Return to audit list/);
});

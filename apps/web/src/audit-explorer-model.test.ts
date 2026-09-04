import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  auditEventIdFromHash,
  auditEventPath,
  auditEventsPath,
  auditHash,
  auditActionTranslationKey,
  defaultAuditFilters,
  groupedAuditActions,
  shortIdentifier,
} from './audit-explorer-model.js';

const id = 'a6000000-0000-4000-8000-000000000001';

test('audit explorer exposes only a valid event id in its stable hash', () => {
  assert.equal(auditEventIdFromHash(`#audit?eventId=${id}`), id);
  assert.equal(auditEventIdFromHash('#audit?eventId=nope'), null);
  assert.equal(auditEventIdFromHash(`#reports?eventId=${id}`), null);
  assert.equal(auditHash(id), `#audit?eventId=${id}`);
  assert.equal(auditHash(null), '#audit');
});

test('audit paths are bounded, use the server-selected scope, and keep timestamps explicit', () => {
  const path = auditEventsPath(
    { ...defaultAuditFilters, action: 'incident.closed', occurredFrom: '2026-08-24T05:30' },
    'next-token',
  );
  assert.match(path, /limit=25/);
  assert.match(path, /action=incident.closed/);
  assert.match(path, /cursor=next-token/);
  assert.match(path, /occurredFrom=2026-08-24T/);
  assert.equal(auditEventPath(id, null), `/api/v1/audit/events/${id}`);
  assert.equal(
    auditEventPath(id, 'a6000000-0000-4000-8000-000000000002'),
    `/api/v1/audit/events/${id}?territoryId=a6000000-0000-4000-8000-000000000002`,
  );
});

test('audit action values stay server-owned while the UI can group and localize them', () => {
  const groups = groupedAuditActions();
  assert.ok(groups.length > 1);
  assert.equal(auditActionTranslationKey('incident.closed'), 'auditActionIncidentClosed');
  assert.equal(
    auditActionTranslationKey('observation.automatically_validated'),
    'auditActionObservationAutomaticallyValidated',
  );
  assert.ok(groups.some(([, actions]) => actions.includes('incident.closed')));
  assert.equal(shortIdentifier(id), 'a6000000');
  assert.equal(shortIdentifier(null), '—');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { maintenanceHistorySchema, maintenanceRecordSchema } from './maintenance.js';

const record = {
  id: 'da100000-0000-4000-8000-000000000001',
  version: 1,
  organizationId: 'a1000000-0000-4000-8000-000000000001',
  territoryId: 'a2000000-0000-4000-8000-000000000001',
  deviceId: 'a5000000-0000-4000-8000-000000000001',
  type: 'calibration',
  status: 'completed',
  scheduledInterval: {
    start: '2026-08-22T06:00:00.000000Z',
    end: '2026-08-22T07:00:00.000000Z',
  },
  startedAt: '2026-08-22T06:05:00.000000Z',
  completedAt: '2026-08-22T06:45:00.000000Z',
  recordedAt: '2026-08-22T08:00:00.000000Z',
  createdAt: '2026-08-21T12:00:00.000000Z',
  auditEventId: 'da100000-0000-4000-8000-000000000002',
  provenance: 'synthetic maintenance fixture',
  dataClassification: 'synthetic',
  officialRecord: false,
};

test('maintenance records are synthetic, versioned, scope-bound, and temporally coherent', () => {
  assert.equal(maintenanceRecordSchema.safeParse(record).success, true);
  assert.equal(
    maintenanceRecordSchema.safeParse({ ...record, dataClassification: 'official' }).success,
    false,
  );
  assert.equal(maintenanceRecordSchema.safeParse({ ...record, completedAt: null }).success, false);
  assert.equal(maintenanceRecordSchema.safeParse({ ...record, version: 2 }).success, false);
  assert.equal(
    maintenanceRecordSchema.safeParse({
      ...record,
      createdAt: '2026-08-22T08:00:00.000001Z',
      recordedAt: '2026-08-22T13:00:00.000000+05:00',
    }).success,
    false,
  );
});

test('maintenance history distinguishes explicitly unconfigured from synthetic evidence', () => {
  assert.equal(
    maintenanceHistorySchema.safeParse({
      state: 'synthetic_history',
      records: [record],
      source: 'synthetic_scenario',
      reason: null,
    }).success,
    true,
  );
  assert.equal(
    maintenanceHistorySchema.safeParse({
      state: 'unconfigured',
      records: [record],
      source: 'unconfigured',
      reason: 'No source.',
    }).success,
    false,
  );
});

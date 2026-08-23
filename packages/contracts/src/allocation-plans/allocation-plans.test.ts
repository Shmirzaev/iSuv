import assert from 'node:assert/strict';
import test from 'node:test';
import { createAllocationPlanRequestSchema } from './allocation-plans.js';

const base = {
  waterSectionId: 'a1000000-0000-4000-8000-000000000001',
  effectiveFrom: '2026-08-25T00:00:00.000001Z',
  effectiveUntil: '2026-08-26T00:00:00.000000Z',
  reason: 'synthetic governed plan',
  entries: [
    {
      intervalStart: '2026-08-25T00:00:00.000001Z',
      intervalEnd: '2026-08-25T01:00:00.000001Z',
      plannedVolume: '0',
      unit: 'm3' as const,
      targetSemantics: 'whole_interval_target_no_proration' as const,
    },
  ],
};
test('allocation entries accept explicit zero m3 and preserve microsecond half-open bounds', () => {
  assert.equal(createAllocationPlanRequestSchema.safeParse(base).success, true);
  assert.equal(
    createAllocationPlanRequestSchema.safeParse({
      ...base,
      entries: [{ ...base.entries[0], unit: 'm' }],
    }).success,
    false,
  );
  assert.equal(
    createAllocationPlanRequestSchema.safeParse({
      ...base,
      entries: [{ ...base.entries[0], unit: 'm3/s' }],
    }).success,
    false,
  );
  assert.equal(
    createAllocationPlanRequestSchema.safeParse({
      ...base,
      entries: [{ ...base.entries[0], plannedVolume: '-1' }],
    }).success,
    false,
  );
  assert.equal(
    createAllocationPlanRequestSchema.safeParse({
      ...base,
      entries: [{ ...base.entries[0], plannedVolume: 'NaN' }],
    }).success,
    false,
  );
  assert.equal(
    createAllocationPlanRequestSchema.safeParse({
      ...base,
      effectiveFrom: '2026-08-25T00:00:00.0000001Z',
    }).success,
    false,
  );
  assert.equal(
    createAllocationPlanRequestSchema.safeParse({
      ...base,
      effectiveFrom: '2026-08-25 00:00:00',
    }).success,
    false,
  );
  assert.equal(
    createAllocationPlanRequestSchema.safeParse({
      ...base,
      entries: [{ ...base.entries[0]!, intervalEnd: base.entries[0]!.intervalStart }],
    }).success,
    false,
  );
  assert.equal(
    createAllocationPlanRequestSchema.safeParse({
      ...base,
      entries: [
        ...base.entries,
        {
          ...base.entries[0],
          intervalStart: '2026-08-25T00:30:00.000001Z',
          intervalEnd: '2026-08-25T02:00:00.000001Z',
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    createAllocationPlanRequestSchema.parse(base).entries[0]?.targetSemantics,
    'whole_interval_target_no_proration',
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { auditResources } from './model.js';

test('domain audit vocabulary stays aligned with governed operational resources', () => {
  assert.deepEqual(auditResources, [
    'user_role_grant',
    'observation',
    'validation_profile',
    'allocation_plan',
    'quantity_model',
    'tolerance_policy',
    'water_balance_model',
    'alarm_rule',
    'alarm_catalog',
    'alarm',
    'incident',
    'escalation_policy',
    'maintenance_record',
    'report',
  ]);
});

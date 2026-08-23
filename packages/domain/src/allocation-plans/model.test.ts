import assert from 'node:assert/strict';
import test from 'node:test';
import { decideTerritoryAuthorization } from '../authorization/policy.js';
import { nextAllocationPlanLifecycle } from './model.js';
test('allocation lifecycle only permits governed draft-request-approve-supersede transitions', () => {
  assert.equal(nextAllocationPlanLifecycle('draft', 'request'), 'requested');
  assert.equal(nextAllocationPlanLifecycle('requested', 'approve'), 'approved');
  assert.equal(nextAllocationPlanLifecycle('approved', 'supersede'), 'superseded');
  assert.throws(() => nextAllocationPlanLifecycle('draft', 'approve'));
});

test('allocation approval is a dedicated scoped permission and never auditor authority', () => {
  const targetTerritoryId = 'a2000000-0000-4000-8000-000000000004';
  const hydrologist = {
    id: 'b3000000-0000-4000-8000-000000000001',
    role: 'hydrologist' as const,
    scope: 'territory' as const,
    territoryId: targetTerritoryId,
    coversTargetTerritory: true,
  };
  assert.equal(
    decideTerritoryAuthorization({
      action: 'allocation_plan:approve',
      targetTerritoryId,
      grants: [hydrologist],
    }).allowed,
    true,
  );
  assert.equal(
    decideTerritoryAuthorization({
      action: 'allocation_plan:write',
      targetTerritoryId,
      grants: [hydrologist],
    }).allowed,
    false,
  );
  assert.equal(
    decideTerritoryAuthorization({
      action: 'allocation_plan:approve',
      targetTerritoryId,
      grants: [{ ...hydrologist, role: 'auditor' }],
    }).allowed,
    false,
  );
  assert.equal(
    decideTerritoryAuthorization({
      action: 'allocation_plan:approve',
      targetTerritoryId,
      grants: [{ ...hydrologist, coversTargetTerritory: false }],
    }).allowed,
    false,
  );
});

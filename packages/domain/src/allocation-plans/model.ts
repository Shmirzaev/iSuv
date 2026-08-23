export type AllocationPlanLifecycle = 'draft' | 'requested' | 'approved' | 'superseded';

/** Deliberately small pure lifecycle boundary: quantities, conversion, actuals and alarms live elsewhere. */
export function nextAllocationPlanLifecycle(
  current: AllocationPlanLifecycle,
  transition: 'request' | 'approve' | 'supersede',
): AllocationPlanLifecycle {
  if (current === 'draft' && transition === 'request') return 'requested';
  if (current === 'requested' && transition === 'approve') return 'approved';
  if (current === 'approved' && transition === 'supersede') return 'superseded';
  throw new Error(`Invalid allocation plan lifecycle transition: ${current} -> ${transition}`);
}

export const quantityUnits = { stage: 'm', discharge: 'm3/s', volume: 'm3' } as const;
export type QuantityKind = keyof typeof quantityUnits;
export * from './authorization/policy.js';

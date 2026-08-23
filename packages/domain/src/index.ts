export const quantityUnits = {
  stage: 'm',
  discharge: 'm3/s',
  accumulated_volume: 'm3',
} as const;
export type QuantityKind = keyof typeof quantityUnits;
export * from './authorization/policy.js';
export * from './audit/model.js';
export * from './network/model.js';
export * from './observations/model.js';

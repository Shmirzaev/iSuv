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
export * from './telemetry/simulator.js';
export * from './device-health/model.js';
export * from './validation/model.js';
export * from './allocation-plans/model.js';
export * from './quantity-derivation/model.js';
export * from './allocation-deviation/model.js';
export * from './water-balance/model.js';
export * from './alarm-rules/model.js';
export * from './alarms/model.js';
export * from './incidents/model.js';
export * from './dashboard/model.js';
export * from './live-operations/model.js';

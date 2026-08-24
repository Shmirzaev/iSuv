import { z } from 'zod';

export * from './identity/identity.js';
export * from './audit/audit.js';
export * from './observations/observations.js';
export * from './telemetry/telemetry.js';
export * from './device-health/device-health.js';
export * from './validation/validation.js';
export * from './network/network.js';
export * from './allocation-plans/allocation-plans.js';
export * from './quantity-derivation/quantity-derivation.js';
export * from './allocation-deviation/allocation-deviation.js';
export * from './water-balance/water-balance.js';
export * from './alarm-rules/alarm-rules.js';
export * from './alarms/alarms.js';
export * from './incidents/incidents.js';
export * from './dashboard/dashboard.js';
export * from './live-operations/live-operations.js';
export * from './map-network/map-network.js';
export * from './alarm-incident-center/alarm-incident-center.js';

export const healthStatusSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
  timestamp: z.string().datetime({ offset: true }),
});
export type HealthStatus = z.infer<typeof healthStatusSchema>;

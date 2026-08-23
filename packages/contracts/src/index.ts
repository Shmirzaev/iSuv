import { z } from 'zod';

export * from './identity/identity.js';
export * from './audit/audit.js';
export * from './observations/observations.js';
export * from './network/network.js';

export const healthStatusSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
  timestamp: z.string().datetime({ offset: true }),
});
export type HealthStatus = z.infer<typeof healthStatusSchema>;

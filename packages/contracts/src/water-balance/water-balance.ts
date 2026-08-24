import { z } from 'zod';
import {
  quantityDerivationMethodSchema,
  quantityDerivationTimestampSchema,
  exactRationalSchema,
  derivedVolumeResultSchema,
} from '../quantity-derivation/quantity-derivation.js';

const uuid = z.uuid();
export const maxWaterBalanceTravelTimeMicroseconds = 31_536_000_000_000n;
const nonnegativeInteger = z
  .string()
  .regex(/^\d{1,14}$/)
  .refine(
    (value) => BigInt(value) <= maxWaterBalanceTravelTimeMicroseconds,
    'must not exceed 365 days',
  );
const provenance = z.string().trim().min(1).max(256);
const reason = z.string().trim().min(1).max(2000);
const decimal = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const nonnegativeDecimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
function exactMicros(value: string): bigint {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i.exec(
      value,
    );
  if (!m) return 0n;
  const [year, month, day, hour, minute, second, fraction = '', zone] = m.slice(1);
  const y = BigInt(year!),
    mo = BigInt(month!),
    d = BigInt(day!);
  const prior = y - 1n;
  let days =
    365n * prior +
    prior / 4n -
    prior / 100n +
    prior / 400n -
    (365n * 1969n + 1969n / 4n - 1969n / 100n + 1969n / 400n) +
    d -
    1n;
  const lengths = [31n, 28n, 31n, 30n, 31n, 30n, 31n, 31n, 30n, 31n, 30n, 31n];
  const leap = y % 4n === 0n && (y % 100n !== 0n || y % 400n === 0n);
  for (let i = 1n; i < mo; i++) days += lengths[Number(i - 1n)]! + (i === 2n && leap ? 1n : 0n);
  const offset =
    zone === 'Z'
      ? 0n
      : (BigInt(zone!.slice(1, 3)) * 60n + BigInt(zone!.slice(4, 6))) *
        (zone!.startsWith('+') ? 1n : -1n);
  return (
    (days * 86400n +
      BigInt(hour!) * 3600n +
      BigInt(minute!) * 60n +
      BigInt(second!) -
      offset * 60n) *
      1_000_000n +
    BigInt(fraction.padEnd(6, '0'))
  );
}
export const waterBalanceComponentSchema = z.object({
  waterSectionId: uuid,
  stationId: uuid,
  sensorId: uuid,
  deviceInstallationId: uuid,
  method: quantityDerivationMethodSchema,
  role: z.enum(['incoming', 'outgoing']),
  referencePlane: z.enum(['upstream', 'downstream']),
  travelTimeMicroseconds: nonnegativeInteger,
  provenance,
});
export const waterBalanceAssumptionSchema = z
  .object({
    intervalStart: quantityDerivationTimestampSchema,
    intervalEnd: quantityDerivationTimestampSchema,
    storageChangeM3: decimal,
    knownAdditionM3: nonnegativeDecimal,
    knownRemovalM3: nonnegativeDecimal,
    provenance,
  })
  .superRefine((value, ctx) => {
    if (exactMicros(value.intervalEnd) <= exactMicros(value.intervalStart))
      ctx.addIssue({
        code: 'custom',
        path: ['intervalEnd'],
        message: 'must be after intervalStart',
      });
  });
export const createWaterBalanceModelRequestSchema = z.object({
  junctionId: uuid,
  provenance,
  reason,
});
export const requestWaterBalanceVersionRequestSchema = z
  .object({
    effectiveFrom: quantityDerivationTimestampSchema,
    effectiveUntil: quantityDerivationTimestampSchema,
    components: z.array(waterBalanceComponentSchema).min(1),
    assumptions: z.array(waterBalanceAssumptionSchema).min(1),
    provenance,
    reason,
  })
  .superRefine((value, ctx) => {
    if (exactMicros(value.effectiveUntil) <= exactMicros(value.effectiveFrom))
      ctx.addIssue({
        code: 'custom',
        path: ['effectiveUntil'],
        message: 'must be after effectiveFrom',
      });
  });
export const approveWaterBalanceVersionRequestSchema = z.object({ reason });
export const waterBalanceQuerySchema = z
  .object({
    intervalStart: quantityDerivationTimestampSchema,
    intervalEnd: quantityDerivationTimestampSchema,
    knownAt: quantityDerivationTimestampSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (exactMicros(value.intervalEnd) <= exactMicros(value.intervalStart))
      ctx.addIssue({
        code: 'custom',
        path: ['intervalEnd'],
        message: 'must be after intervalStart',
      });
  });
export const waterBalanceResultSchema = z.object({
  outcome: z.enum(['computed', 'deferred']),
  deferReason: z
    .enum(['no_approved_water_balance_model', 'missing_exact_assumption', 'component_not_eligible'])
    .nullable(),
  junctionId: uuid,
  modelId: uuid.nullable(),
  versionId: uuid.nullable(),
  interval: z.object({
    start: quantityDerivationTimestampSchema,
    end: quantityDerivationTimestampSchema,
  }),
  knownAt: quantityDerivationTimestampSchema,
  components: z.array(
    z.object({
      waterSectionId: uuid,
      stationId: uuid,
      sensorId: uuid,
      deviceInstallationId: uuid,
      method: quantityDerivationMethodSchema,
      bindingProvenance: provenance,
      role: z.enum(['incoming', 'outgoing']),
      referencePlane: z.enum(['upstream', 'downstream']),
      travelTimeMicroseconds: nonnegativeInteger,
      sourceInterval: z.object({
        start: quantityDerivationTimestampSchema,
        end: quantityDerivationTimestampSchema,
      }),
      derivation: derivedVolumeResultSchema,
    }),
  ),
  incomingM3: exactRationalSchema.nullable(),
  outgoingM3: exactRationalSchema.nullable(),
  knownAdditionM3: exactRationalSchema.nullable(),
  knownRemovalM3: exactRationalSchema.nullable(),
  storageChangeM3: exactRationalSchema.nullable(),
  assumptionId: uuid.nullable(),
  assumptionProvenance: provenance.nullable(),
  residualM3: exactRationalSchema.nullable(),
  provenance,
  dataClassification: z.literal('synthetic'),
  officialComplianceEligible: z.literal(false),
  alarmEligible: z.literal(false),
});
export const waterBalanceResponseSchema = z.object({ result: waterBalanceResultSchema });
export type CreateWaterBalanceModelRequest = z.infer<typeof createWaterBalanceModelRequestSchema>;
export type RequestWaterBalanceVersionRequest = z.infer<
  typeof requestWaterBalanceVersionRequestSchema
>;
export type WaterBalanceResult = z.infer<typeof waterBalanceResultSchema>;

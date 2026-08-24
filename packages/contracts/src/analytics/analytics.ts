import { z } from 'zod';
import { dashboardPeriodSchema } from '../dashboard/dashboard.js';
import {
  exactRationalSchema,
  quantityDerivationTimestampSchema,
} from '../quantity-derivation/quantity-derivation.js';
import { waterBalanceResultSchema } from '../water-balance/water-balance.js';

const uuid = z.uuid();
const count = z.number().int().nonnegative();
const m3 = exactRationalSchema.extend({ unit: z.literal('m3') }).strict();
const window = z
  .object({ start: quantityDerivationTimestampSchema, end: quantityDerivationTimestampSchema })
  .strict();
const provenance = z
  .object({
    dataClassification: z.literal('synthetic'),
    officialComplianceEligible: z.literal(false),
    label: z.string().min(1),
  })
  .strict();

function equalExact(
  left: { numerator: string; denominator: string },
  right: { numerator: string; denominator: string },
) {
  return (
    BigInt(left.numerator) * BigInt(right.denominator) ===
    BigInt(right.numerator) * BigInt(left.denominator)
  );
}

function sumExact(values: readonly { numerator: string; denominator: string }[]) {
  let numerator = 0n;
  let denominator = 1n;
  for (const value of values) {
    numerator = numerator * BigInt(value.denominator) + BigInt(value.numerator) * denominator;
    denominator *= BigInt(value.denominator);
  }
  return { numerator: numerator.toString(), denominator: denominator.toString() };
}

export const analyticsFacetSchema = z.enum(['region', 'basin', 'waterway', 'section']);
export type AnalyticsFacet = z.infer<typeof analyticsFacetSchema>;
export const analyticsQuerySchema = z
  .object({
    period: dashboardPeriodSchema.default('today'),
    territoryId: uuid.optional(),
    facet: analyticsFacetSchema.optional(),
    facetId: uuid.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.facet === undefined) !== (value.facetId === undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['facetId'],
        message: 'facet and facetId must be supplied together',
      });
  });
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

const deliveryState = z.enum(['assessed', 'unassessable']);
const deliveryGroup = z
  .object({
    sectionId: uuid,
    sectionName: z.string().min(1),
    territoryId: uuid,
    plannedM3: m3.nullable(),
    actualM3: m3.nullable(),
    signedVarianceM3: m3.nullable(),
    absoluteVarianceM3: m3.nullable(),
    condition: z.enum(['over', 'within', 'under', 'unassessable']),
    state: deliveryState,
    reason: z.string().nullable(),
    planVersionId: uuid.nullable(),
    toleranceVersionId: uuid.nullable(),
    method: z
      .enum(['direct_discharge', 'stage_rating_curve', 'accumulated_volume_delta'])
      .nullable(),
    mapTarget: z
      .string()
      .regex(/^#map\?/)
      .nullable(),
    liveTarget: z
      .string()
      .regex(/^#operations\?/)
      .nullable(),
    provenance,
  })
  .strict();

export const analyticsResponseSchema = z
  .object({
    referenceAt: quantityDerivationTimestampSchema,
    knownAt: quantityDerivationTimestampSchema,
    presentationTimeZone: z.literal('Asia/Tashkent'),
    windows: z.object({ selected: window, prior: window }).strict(),
    scenario: z
      .object({
        id: uuid,
        version: z.number().int().positive(),
        method: z.literal('governed_p3_composition_v1'),
        provenance: z.string().min(1),
        synthetic: z.literal(true),
        officialComplianceEligible: z.literal(false),
        forecast: z.literal(false),
      })
      .strict(),
    scope: z
      .object({
        territoryId: uuid,
        descendantTerritoryIds: z.array(uuid).min(1),
        facet: analyticsFacetSchema.nullable(),
        facetId: uuid.nullable(),
        allowedFacets: z.array(
          z.object({ id: uuid, kind: analyticsFacetSchema, label: z.string().min(1) }).strict(),
        ),
        stationDenominator: count,
        deviceDenominator: count,
      })
      .strict(),
    delivery: z
      .object({
        state: z.enum(['assessed', 'unassessable', 'unconfigured']),
        population: z.object({ defined: count, returned: count, complete: z.boolean() }).strict(),
        memberCounts: z
          .object({
            total: count,
            assessed: count,
            over: count,
            within: count,
            under: count,
            unassessable: count,
          })
          .strict(),
        plannedM3: m3.nullable(),
        actualM3: m3.nullable(),
        signedVarianceM3: m3.nullable(),
        absoluteVarianceM3: m3.nullable(),
        exclusionNote: z.string().min(1),
        groups: z.array(deliveryGroup).max(100),
      })
      .strict(),
    deviationMatrix: z
      .object({
        over: z.object({ count, plannedM3: m3, actualM3: m3, absoluteVarianceM3: m3 }).strict(),
        within: z.object({ count, plannedM3: m3, actualM3: m3, absoluteVarianceM3: m3 }).strict(),
        under: z.object({ count, plannedM3: m3, actualM3: m3, absoluteVarianceM3: m3 }).strict(),
        unassessable: z.object({ count }).strict(),
      })
      .strict(),
    balance: waterBalanceResultSchema,
    qualityCoverage: z
      .object({
        denominator: count,
        completeValid: count,
        estimatedExcluded: count,
        unreliable: count,
        noData: count,
        unconfigured: count,
        state: z.enum(['assessed', 'unassessable', 'unconfigured']),
        provenance,
      })
      .strict(),
    availability: z
      .object({
        denominator: count,
        communicating: count,
        offline: count,
        unknown: count,
        cadenceState: z.literal('unconfigured'),
        // Stable code lets the client localize the explanation without treating an
        // English server string as authoritative UI copy.
        reason: z.literal('cadence_unconfigured'),
        provenance,
      })
      .strict(),
    provenance,
  })
  .strict()
  .superRefine((value, ctx) => {
    const c = value.delivery.memberCounts;
    const population = value.delivery.population;
    const returnedAssessed = value.delivery.groups.filter(
      (group) => group.state === 'assessed',
    ).length;
    const returnedUnassessable = value.delivery.groups.length - returnedAssessed;
    if (
      population.defined !== c.total ||
      population.returned !== value.delivery.groups.length ||
      population.returned > population.defined ||
      population.complete !== (population.returned === population.defined) ||
      returnedAssessed !== c.assessed ||
      returnedUnassessable + (population.defined - population.returned) !== c.unassessable
    )
      ctx.addIssue({
        code: 'custom',
        path: ['delivery', 'population'],
        message: 'bounded delivery details must reconcile with the complete defined population',
      });
    if (c.assessed + c.unassessable !== c.total || c.over + c.within + c.under !== c.assessed)
      ctx.addIssue({
        code: 'custom',
        path: ['delivery', 'memberCounts'],
        message: 'delivery member counts must reconcile',
      });
    const aggregates = [
      value.delivery.plannedM3,
      value.delivery.actualM3,
      value.delivery.signedVarianceM3,
      value.delivery.absoluteVarianceM3,
    ];
    if (
      value.delivery.state === 'assessed' &&
      (c.total === 0 ||
        c.assessed !== c.total ||
        c.unassessable !== 0 ||
        !population.complete ||
        aggregates.some((x) => x === null))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['delivery'],
        message: 'assessed delivery needs every member and all exact aggregates',
      });
    if (
      value.delivery.state === 'unassessable' &&
      (c.total === 0 || c.unassessable === 0 || aggregates.some((x) => x !== null))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['delivery'],
        message: 'unassessable delivery cannot expose a partial aggregate',
      });
    if (
      value.delivery.state === 'unconfigured' &&
      (c.total !== 0 || aggregates.some((x) => x !== null))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['delivery'],
        message: 'unconfigured delivery has no members or aggregates',
      });
    if (
      value.qualityCoverage.completeValid +
        value.qualityCoverage.estimatedExcluded +
        value.qualityCoverage.unreliable +
        value.qualityCoverage.noData +
        value.qualityCoverage.unconfigured !==
      value.qualityCoverage.denominator
    )
      ctx.addIssue({
        code: 'custom',
        path: ['qualityCoverage'],
        message: 'quality denominator must reconcile',
      });
    const matrix = value.deviationMatrix;
    if (
      matrix.over.count !== c.over ||
      matrix.within.count !== c.within ||
      matrix.under.count !== c.under ||
      matrix.unassessable.count !== c.unassessable
    )
      ctx.addIssue({
        code: 'custom',
        path: ['deviationMatrix'],
        message: 'deviation matrix counts must reconcile with delivery members',
      });
    if (value.delivery.state === 'assessed') {
      const rows = [matrix.over, matrix.within, matrix.under];
      const expected = [
        ['plannedM3', value.delivery.plannedM3],
        ['actualM3', value.delivery.actualM3],
        ['absoluteVarianceM3', value.delivery.absoluteVarianceM3],
      ] as const;
      for (const [field, aggregate] of expected) {
        const sum = sumExact(rows.map((row) => row[field]));
        if (!aggregate || !equalExact(sum, aggregate))
          ctx.addIssue({
            code: 'custom',
            path: ['deviationMatrix'],
            message: `deviation matrix ${field} must reconcile exactly`,
          });
      }
    }
    const availability = value.availability;
    if (
      availability.communicating + availability.offline + availability.unknown !==
      availability.denominator
    )
      ctx.addIssue({
        code: 'custom',
        path: ['availability'],
        message: 'availability denominator must reconcile',
      });
  });
export type AnalyticsResponse = z.infer<typeof analyticsResponseSchema>;

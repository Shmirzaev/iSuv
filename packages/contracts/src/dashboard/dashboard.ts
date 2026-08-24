import { z } from 'zod';
import {
  exactRationalSchema,
  quantityDerivationTimestampSchema,
} from '../quantity-derivation/quantity-derivation.js';

const uuid = z.uuid();
const nonnegativeInteger = z.number().int().nonnegative();
const nonnegativeDecimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const source = z.enum(['synthetic_scenario', 'unconfigured']);
const dataState = z.enum(['reported', 'no_data', 'unreliable', 'unconfigured']);
const assessedStatus = z.enum(['scenario_classified', 'unassessable', 'unconfigured']);

export const dashboardPeriodSchema = z.enum(['today', 'week', 'month', 'season', 'year']);
export type DashboardPeriod = z.infer<typeof dashboardPeriodSchema>;
export const dashboardQuerySchema = z
  .object({
    period: dashboardPeriodSchema.default('today'),
    territoryId: uuid.optional(),
  })
  .strict();
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

const windowSchema = z
  .object({ start: quantityDerivationTimestampSchema, end: quantityDerivationTimestampSchema })
  .strict();
const exactM3Schema = exactRationalSchema.extend({ unit: z.literal('m3') }).strict();
const exactPercentSchema = z
  .object({
    numerator: z.string().regex(/^\d+$/),
    denominator: z.string().regex(/^[1-9]\d*$/),
    unit: z.literal('percent'),
  })
  .strict();
const nullableM3MetricSchema = z
  .object({
    state: assessedStatus,
    value: exactM3Schema.nullable(),
    unit: z.literal('m3'),
    source,
    reason: z.string().nullable(),
  })
  .strict()
  .superRefine((value, issue) => {
    if (value.state === 'scenario_classified' && !value.value)
      issue.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'classified metric needs m3 value',
      });
    if (value.state !== 'scenario_classified' && value.value)
      issue.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'unassessed metric has no m3 value',
      });
    if (
      value.state === 'scenario_classified' &&
      (value.source !== 'synthetic_scenario' || value.reason !== null)
    )
      issue.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'classified metric must be sourced and have no degradation reason',
      });
    if (value.state === 'unconfigured' && (value.source !== 'unconfigured' || !value.reason))
      issue.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'unconfigured metric needs an unconfigured source and reason',
      });
    if (value.state === 'unassessable' && (value.source !== 'synthetic_scenario' || !value.reason))
      issue.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'unassessable fixture metric needs a source and reason',
      });
  });
const inflowMetricSchema = z
  .object({
    state: assessedStatus,
    value: nonnegativeDecimal.nullable(),
    unit: z.literal('m3/s'),
    source,
    reason: z.string().nullable(),
  })
  .strict()
  .superRefine((value, issue) => {
    if (value.state === 'scenario_classified' && value.value === null)
      issue.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'classified inflow requires m3/s value',
      });
    if (value.state !== 'scenario_classified' && value.value !== null)
      issue.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'unassessed inflow cannot carry m3/s value',
      });
    if (
      value.state === 'scenario_classified' &&
      (value.source !== 'synthetic_scenario' || value.reason !== null)
    )
      issue.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'classified inflow must be sourced and have no degradation reason',
      });
    if (value.state === 'unconfigured' && (value.source !== 'unconfigured' || !value.reason))
      issue.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'unconfigured inflow needs an unconfigured source and reason',
      });
    if (value.state === 'unassessable' && (value.source !== 'synthetic_scenario' || !value.reason))
      issue.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'unassessable inflow needs a synthetic source and reason',
      });
  });

export const dashboardResponseSchema = z
  .object({
    referenceAt: quantityDerivationTimestampSchema,
    knownAt: quantityDerivationTimestampSchema,
    presentationTimeZone: z.literal('Asia/Tashkent'),
    windows: z.object({ selected: windowSchema, prior: windowSchema }).strict(),
    scenario: z
      .object({
        id: uuid,
        version: z.number().int().positive(),
        period: dashboardPeriodSchema,
        provenance: z.string().trim().min(1).max(256),
        dataClassification: z.literal('synthetic'),
        officialComplianceEligible: z.literal(false),
        synthetic: z.literal(true),
        definitions: z
          .object({
            regionalInflowCutSet: z
              .object({
                state: z.enum(['scenario_classified', 'unconfigured']),
                memberStationCount: nonnegativeInteger,
                unit: z.literal('m3/s'),
                provenance: z.string().trim().min(1),
              })
              .strict()
              .superRefine((value, issue) => {
                if (value.state === 'scenario_classified' && value.memberStationCount === 0)
                  issue.addIssue({
                    code: 'custom',
                    path: ['memberStationCount'],
                    message: 'configured definition needs members',
                  });
                if (value.state === 'unconfigured' && value.memberStationCount !== 0)
                  issue.addIssue({
                    code: 'custom',
                    path: ['memberStationCount'],
                    message: 'unconfigured definition has no members',
                  });
              }),
            deliveryComparisonSet: z
              .object({
                state: z.enum(['scenario_classified', 'unconfigured']),
                memberStationCount: nonnegativeInteger,
                unit: z.literal('m3'),
                provenance: z.string().trim().min(1),
              })
              .strict()
              .superRefine((value, issue) => {
                if (value.state === 'scenario_classified' && value.memberStationCount === 0)
                  issue.addIssue({
                    code: 'custom',
                    path: ['memberStationCount'],
                    message: 'configured definition needs members',
                  });
                if (value.state === 'unconfigured' && value.memberStationCount !== 0)
                  issue.addIssue({
                    code: 'custom',
                    path: ['memberStationCount'],
                    message: 'unconfigured definition has no members',
                  });
              }),
          })
          .strict(),
      })
      .strict(),
    scope: z
      .object({
        territoryId: uuid,
        descendantTerritoryIds: z.array(uuid).min(1),
        stationDenominator: nonnegativeInteger,
        deviceDenominator: nonnegativeInteger,
        reportedStationCount: nonnegativeInteger,
        dataStates: z
          .object({
            reported: nonnegativeInteger,
            noData: nonnegativeInteger,
            unreliable: nonnegativeInteger,
            unconfigured: nonnegativeInteger,
          })
          .strict(),
      })
      .strict()
      .superRefine((value, issue) => {
        const states = value.dataStates;
        if (
          states.reported + states.noData + states.unreliable + states.unconfigured !==
          value.stationDenominator
        )
          issue.addIssue({
            code: 'custom',
            path: ['dataStates'],
            message: 'data-state counts must equal station denominator',
          });
        if (value.reportedStationCount !== states.reported)
          issue.addIssue({
            code: 'custom',
            path: ['reportedStationCount'],
            message: 'reported count must equal reported state count',
          });
        if (value.deviceDenominator !== value.stationDenominator)
          issue.addIssue({
            code: 'custom',
            path: ['deviceDenominator'],
            message: 'fixture has one device per station denominator',
          });
      }),
    kpis: z
      .object({
        regionalInflow: inflowMetricSchema,
        deliveredVolume: nullableM3MetricSchema,
        plannedVolume: nullableM3MetricSchema,
        unexplainedBalance: nullableM3MetricSchema,
        compliance: z
          .object({
            state: assessedStatus,
            assessedDenominator: nonnegativeInteger,
            withinCount: nonnegativeInteger,
            overCount: nonnegativeInteger,
            underCount: nonnegativeInteger,
            percentage: exactPercentSchema.nullable(),
            source,
            reason: z.string().nullable(),
          })
          .strict()
          .superRefine((value, issue) => {
            const counts = value.withinCount + value.overCount + value.underCount;
            if (counts !== value.assessedDenominator)
              issue.addIssue({
                code: 'custom',
                path: ['assessedDenominator'],
                message: 'compliance counts must equal assessed denominator',
              });
            if (
              value.state === 'scenario_classified' &&
              (value.assessedDenominator === 0 || value.percentage === null)
            )
              issue.addIssue({
                code: 'custom',
                path: ['percentage'],
                message: 'classified compliance requires denominator and percentage',
              });
            if (
              value.state !== 'scenario_classified' &&
              (value.assessedDenominator !== 0 || value.percentage !== null)
            )
              issue.addIssue({
                code: 'custom',
                path: ['percentage'],
                message: 'unassessed compliance cannot carry denominator or percentage',
              });
            if (
              value.percentage !== null &&
              (BigInt(value.percentage.numerator) !== BigInt(value.withinCount) * 100n ||
                BigInt(value.percentage.denominator) !== BigInt(value.assessedDenominator))
            )
              issue.addIssue({
                code: 'custom',
                path: ['percentage'],
                message: 'compliance percentage must match assessed denominator',
              });
          }),
        activeCriticalAlarms: z.discriminatedUnion('state', [
          z
            .object({
              state: z.literal('scenario_classified'),
              count: nonnegativeInteger,
              source: z.literal('synthetic_scenario'),
              reason: z.null(),
            })
            .strict(),
          z
            .object({
              state: z.literal('unconfigured'),
              count: z.null(),
              source: z.literal('unconfigured'),
              reason: z.string().trim().min(1),
            })
            .strict(),
          z
            .object({
              state: z.literal('unassessable'),
              count: z.null(),
              source: z.literal('synthetic_scenario'),
              reason: z.string().trim().min(1),
            })
            .strict(),
        ]),
        systemConfidence: z
          .object({
            state: z.enum(['unconfigured', 'unassessable']),
            value: z.null(),
            source: z.literal('unconfigured'),
            reason: z.string().trim().min(1),
          })
          .strict(),
      })
      .strict(),
    comparison: z.discriminatedUnion('state', [
      z
        .object({
          state: z.literal('scenario_classified'),
          plannedM3: exactM3Schema,
          actualM3: exactM3Schema,
          priorActualM3: exactM3Schema,
          source: z.literal('synthetic_scenario'),
          reason: z.null(),
        })
        .strict(),
      z
        .object({
          state: z.literal('unassessable'),
          plannedM3: z.null(),
          actualM3: z.null(),
          priorActualM3: z.null(),
          source: z.literal('synthetic_scenario'),
          reason: z.string().trim().min(1),
        })
        .strict(),
    ]),
    deviations: z.array(
      z
        .object({
          stationId: uuid,
          deviceId: uuid,
          hotspotCode: z.string().regex(/^SYN-HOTSPOT-\d{3}$/),
          territoryId: uuid,
          territoryName: z.string().trim().min(1).max(256),
          dataState,
          quality: z.enum(['valid', 'unreliable', 'no_data', 'unconfigured']),
          assessedInterval: windowSchema,
          signedM3: exactM3Schema,
          absoluteM3: exactM3Schema,
          mapTarget: z.string().regex(/^#map\?stationId=/),
          liveTarget: z.string().regex(/^#operations\?stationId=/),
          source: z.literal('synthetic_scenario'),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((value, issue) => {
    for (const [index, deviation] of value.deviations.entries()) {
      if (
        deviation.assessedInterval.start !== value.windows.selected.start ||
        deviation.assessedInterval.end !== value.windows.selected.end
      )
        issue.addIssue({
          code: 'custom',
          path: ['deviations', index, 'assessedInterval'],
          message: 'deviation interval must exactly equal selected dashboard window',
        });
      const signed = BigInt(deviation.signedM3.numerator);
      const absolute = BigInt(deviation.absoluteM3.numerator);
      if (
        absolute * BigInt(deviation.signedM3.denominator) !==
        (signed < 0n ? -signed : signed) * BigInt(deviation.absoluteM3.denominator)
      )
        issue.addIssue({
          code: 'custom',
          path: ['deviations', index, 'absoluteM3'],
          message: 'absolute deviation must equal exact absolute signed deviation',
        });
    }
  });
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;

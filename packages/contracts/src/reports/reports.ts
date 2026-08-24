import { z } from 'zod';
import { analyticsResponseSchema } from '../analytics/analytics.js';
import { dashboardPeriodSchema } from '../dashboard/dashboard.js';
import { incidentResponseSchema } from '../incidents/incidents.js';
import { quantityDerivationTimestampSchema } from '../quantity-derivation/quantity-derivation.js';

const uuid = z.uuid();
const reportKind = z.enum([
  'daily_situation',
  'allocation_compliance',
  'water_balance',
  'device_availability',
  'incident',
  'executive_summary',
]);
export const reportKindSchema = reportKind;
export type ReportKind = z.infer<typeof reportKindSchema>;
const facet = z.enum(['region', 'basin', 'waterway', 'section']);
const provenance = z
  .object({
    dataClassification: z.literal('synthetic'),
    officialComplianceEligible: z.literal(false),
    label: z.string().min(1),
  })
  .strict();

const analyticsShape = analyticsResponseSchema.shape;
const reportContextSchema = z
  .object({
    referenceAt: quantityDerivationTimestampSchema,
    analyticsKnownAt: quantityDerivationTimestampSchema,
    reportKnownAt: quantityDerivationTimestampSchema,
    presentationTimeZone: z.literal('Asia/Tashkent'),
    scope: analyticsShape.scope.pick({
      territoryId: true,
      facet: true,
      facetId: true,
      stationDenominator: true,
      deviceDenominator: true,
    }),
    scenario: analyticsShape.scenario,
  })
  .strict();
const limitationsSchema = z
  .object({
    measurementUncertainty: z.literal('measurement_uncertainty_unavailable'),
    interpretation: z.string().min(1),
  })
  .strict();
const payloadVariant = <T extends ReportKind>(
  reportKind: T,
  content: z.ZodType<Record<string, unknown>>,
) =>
  z
    .object({
      reportKind: z.literal(reportKind),
      context: reportContextSchema,
      content,
      limitations: limitationsSchema,
    })
    .strict();

export const reportPayloadSchema = z.discriminatedUnion('reportKind', [
  payloadVariant(
    'daily_situation',
    z
      .object({
        delivery: analyticsShape.delivery,
        balance: analyticsShape.balance,
        qualityCoverage: analyticsShape.qualityCoverage,
        availability: analyticsShape.availability,
      })
      .strict(),
  ),
  payloadVariant(
    'allocation_compliance',
    z
      .object({
        delivery: analyticsShape.delivery,
        deviationMatrix: analyticsShape.deviationMatrix,
      })
      .strict(),
  ),
  payloadVariant('water_balance', z.object({ balance: analyticsShape.balance }).strict()),
  payloadVariant(
    'device_availability',
    z
      .object({
        qualityCoverage: analyticsShape.qualityCoverage,
        availability: analyticsShape.availability,
      })
      .strict(),
  ),
  payloadVariant('incident', z.object({ incident: incidentResponseSchema }).strict()),
  payloadVariant(
    'executive_summary',
    z
      .object({
        delivery: analyticsShape.delivery,
        balance: analyticsShape.balance,
        qualityCoverage: analyticsShape.qualityCoverage,
        availability: analyticsShape.availability,
      })
      .strict(),
  ),
]);
export type ReportPayload = z.infer<typeof reportPayloadSchema>;

/** Inputs name a governed view only; source IDs, measurements and values are server-owned. */
export const generateReportRequestSchema = z
  .object({
    kind: reportKind,
    territoryId: uuid.optional(),
    period: dashboardPeriodSchema.default('today'),
    facet: facet.optional(),
    facetId: uuid.optional(),
    incidentId: uuid.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.facet === undefined) !== (value.facetId === undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['facetId'],
        message: 'facet and facetId must be supplied together',
      });
    if ((value.kind === 'incident') !== (value.incidentId !== undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['incidentId'],
        message: 'incident reports require one incident; other reports do not accept an incident',
      });
  });
export type GenerateReportRequest = z.infer<typeof generateReportRequestSchema>;

const reportSnapshotBaseSchema = z
  .object({
    id: uuid,
    organizationId: uuid,
    territoryId: uuid,
    kind: reportKind,
    version: z.number().int().positive(),
    period: dashboardPeriodSchema,
    facet: facet.nullable(),
    facetId: uuid.nullable(),
    incidentId: uuid.nullable(),
    referenceAt: quantityDerivationTimestampSchema,
    knownAt: quantityDerivationTimestampSchema,
    presentationTimeZone: z.literal('Asia/Tashkent'),
    method: z
      .object({ id: z.literal('governed_report_snapshot_v1'), version: z.literal(1) })
      .strict(),
    qualityState: z.enum(['assessed', 'unassessable', 'deferred', 'unconfigured']),
    approvalStatus: z.literal('generated_not_approved'),
    generatedByUserId: uuid,
    generatedAt: quantityDerivationTimestampSchema,
    provenance,
    caveats: z.array(z.string().min(1)).min(1),
    sourceSnapshot: z
      .object({
        analyticsScenarioId: uuid,
        analyticsScenarioVersion: z.number().int().positive(),
        sourceRevisionPolicy: z.literal('known_at_frozen'),
      })
      .strict(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    payload: reportPayloadSchema,
  })
  .strict();

export const reportSummarySchema = reportSnapshotBaseSchema.omit({ payload: true });
export type ReportSummary = z.infer<typeof reportSummarySchema>;

export const reportSnapshotSchema = reportSnapshotBaseSchema.superRefine((value, context) => {
  if (value.kind !== value.payload.reportKind)
    context.addIssue({
      code: 'custom',
      path: ['payload', 'reportKind'],
      message: 'report kind must match the frozen payload variant',
    });
  if (
    value.referenceAt !== value.payload.context.referenceAt ||
    value.knownAt !== value.payload.context.reportKnownAt ||
    value.territoryId !== value.payload.context.scope.territoryId
  )
    context.addIssue({
      code: 'custom',
      path: ['payload', 'context'],
      message: 'frozen payload context must match snapshot metadata',
    });
  if (value.kind === 'incident' && value.payload.reportKind === 'incident') {
    const incident = incidentResponseSchema.safeParse(value.payload.content.incident);
    if (!incident.success || value.incidentId !== incident.data.incident.id)
      context.addIssue({
        code: 'custom',
        path: ['incidentId'],
        message: 'incident snapshot identity must match its frozen incident evidence',
      });
  }
});
export type ReportSnapshot = z.infer<typeof reportSnapshotSchema>;
export const reportListQuerySchema = z
  .object({
    territoryId: uuid.optional(),
    kind: reportKind.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const reportListResponseSchema = z
  .object({ reports: z.array(reportSummarySchema) })
  .strict();
export const reportResponseSchema = z.object({ report: reportSnapshotSchema }).strict();
export const reportExportRequestSchema = z.object({ format: z.enum(['csv', 'html']) }).strict();
export type ReportExportRequest = z.infer<typeof reportExportRequestSchema>;

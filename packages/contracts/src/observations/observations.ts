import { z } from 'zod';

const utcTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine(
    (value) => (value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i)?.[1]?.length ?? 0) <= 6,
    'timestamps support at most microsecond precision',
  );
export const observationAsOfQuerySchema = z.object({
  asOf: utcTimestampSchema.optional(),
});
const uuidSchema = z.uuid();
export const decimalStringSchema = z
  .string()
  .regex(
    /^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/,
    'must be a finite decimal within technical precision bounds',
  );
export const nonnegativeDecimalStringSchema = z
  .string()
  .regex(
    /^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/,
    'must be a finite nonnegative decimal within technical precision bounds',
  );

export const measurementKindSchema = z.enum(['stage', 'discharge', 'accumulated_volume']);
export const observationQualityStateSchema = z.enum([
  'unknown',
  'valid',
  'suspect',
  'invalid',
  'estimated',
]);
export const observationWorkflowStateSchema = z.enum([
  'raw',
  'automatically_validated',
  'expert_validated',
  'corrected',
  'estimated',
  'rejected',
]);
export const observationUnitSchema = z.enum(['m', 'm3/s', 'm3']);
export const totalizerTransitionSchema = z.enum([
  'normal',
  'reset_reported',
  'rollover_reported',
  'unknown',
]);

const snapshotSchema = z.object({
  measurementMethod: z.string().trim().min(1).max(256).nullable(),
  uncertaintyMethod: z.string().trim().min(1).max(256).nullable(),
  uncertaintyConfidence: nonnegativeDecimalStringSchema
    .refine((value) => Number(value) <= 1, 'must be at most 1')
    .nullable(),
  rawPayloadRef: z.string().trim().min(1).max(512).nullable(),
  rawPayloadHash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/i)
    .nullable(),
  calibrationRef: z.string().trim().min(1).max(512).nullable(),
  ratingCurveRef: z.string().trim().min(1).max(512).nullable(),
});
const measurementFields = {
  value: decimalStringSchema,
  uncertainty: nonnegativeDecimalStringSchema.nullable(),
  qualityState: observationQualityStateSchema,
  qualityReason: z.string().trim().min(1).max(1000).nullable(),
  totalizerTransition: totalizerTransitionSchema.nullable(),
};

function refine(
  value: {
    measurementKind: z.infer<typeof measurementKindSchema>;
    unit: z.infer<typeof observationUnitSchema>;
    value: string;
    qualityState: z.infer<typeof observationQualityStateSchema>;
    qualityReason: string | null;
    totalizerTransition: z.infer<typeof totalizerTransitionSchema> | null;
    workflowState?: z.infer<typeof observationWorkflowStateSchema> | undefined;
    correctionReason?: string | null | undefined;
    measurementMethod?: string | null | undefined;
    uncertaintyMethod?: string | null | undefined;
    uncertaintyConfidence?: string | null | undefined;
    uncertainty: string | null;
    ratingCurveRef?: string | null | undefined;
  },
  context: z.RefinementCtx,
): void {
  const expected =
    value.measurementKind === 'stage' ? 'm' : value.measurementKind === 'discharge' ? 'm3/s' : 'm3';
  if (value.unit !== expected)
    context.addIssue({
      code: 'custom',
      path: ['unit'],
      message: 'unit must match measurement kind',
    });
  if (
    value.measurementKind === 'accumulated_volume' &&
    !nonnegativeDecimalStringSchema.safeParse(value.value).success
  )
    context.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'accumulated volume is a nonnegative counter reading',
    });
  if (value.measurementKind === 'accumulated_volume' && !value.totalizerTransition)
    context.addIssue({
      code: 'custom',
      path: ['totalizerTransition'],
      message: 'counter transition is required for accumulated volume',
    });
  if (value.measurementKind !== 'accumulated_volume' && value.totalizerTransition)
    context.addIssue({
      code: 'custom',
      path: ['totalizerTransition'],
      message: 'only accumulated volume has a counter transition',
    });
  if (value.qualityState !== 'valid' && !value.qualityReason)
    context.addIssue({
      code: 'custom',
      path: ['qualityReason'],
      message: 'a reason is required for non-valid data',
    });
  if (value.ratingCurveRef && value.measurementKind !== 'stage')
    context.addIssue({
      code: 'custom',
      path: ['ratingCurveRef'],
      message: 'a rating-curve reference is only relevant to stage data',
    });
  if (value.workflowState === 'rejected' && value.qualityState !== 'invalid')
    context.addIssue({ code: 'custom', path: ['qualityState'], message: 'rejected means invalid' });
  if ((value.workflowState === 'estimated') !== (value.qualityState === 'estimated'))
    context.addIssue({
      code: 'custom',
      path: ['qualityState'],
      message: 'estimated quality is reserved for the estimated workflow',
    });
  if (
    value.workflowState === 'estimated' &&
    (!value.correctionReason ||
      !value.measurementMethod ||
      !value.uncertainty ||
      !value.uncertaintyMethod ||
      value.qualityState !== 'estimated')
  )
    context.addIssue({
      code: 'custom',
      path: ['workflowState'],
      message: 'estimated requires estimated quality, reason, method, and uncertainty',
    });
  if (
    (value.workflowState === 'corrected' || value.workflowState === 'estimated') &&
    !value.correctionReason
  )
    context.addIssue({ code: 'custom', path: ['correctionReason'], message: 'reason required' });
  if (value.uncertainty === null && (value.uncertaintyMethod || value.uncertaintyConfidence))
    context.addIssue({
      code: 'custom',
      path: ['uncertainty'],
      message: 'uncertainty metadata requires a value',
    });
  if (value.uncertainty !== null && !value.uncertaintyMethod)
    context.addIssue({
      code: 'custom',
      path: ['uncertaintyMethod'],
      message: 'uncertainty requires a method',
    });
}

export const observationSchema = z
  .object({
    id: uuidSchema,
    lineageId: uuidSchema,
    revision: z.number().int().positive(),
    organizationId: uuidSchema,
    territoryId: uuidSchema,
    stationId: uuidSchema,
    sensorId: uuidSchema,
    deviceId: uuidSchema,
    deviceInstallationId: uuidSchema,
    measurementKind: measurementKindSchema,
    unit: observationUnitSchema,
    sourceSystem: z.string().min(1).max(128),
    sourceEventId: z.string().min(1).max(256),
    observedAt: utcTimestampSchema,
    ingestedAt: utcTimestampSchema,
    workflowState: observationWorkflowStateSchema,
    ...measurementFields,
    provenance: z.string().min(1).max(256),
    dataClassification: z.enum(['synthetic', 'official']),
    correctionReason: z.string().min(1).max(1000).nullable(),
    ...snapshotSchema.shape,
  })
  .superRefine(refine);
export type Observation = z.infer<typeof observationSchema>;

export const ingestObservationRequestSchema = z
  .object({
    sensorId: uuidSchema,
    deviceId: uuidSchema,
    measurementKind: measurementKindSchema,
    sourceSystem: z.string().trim().min(1).max(128),
    sourceEventId: z.string().trim().min(1).max(256),
    observedAt: utcTimestampSchema,
    unit: observationUnitSchema,
    ...measurementFields,
    provenance: z.string().trim().min(1).max(256),
    measurementMethod: z.string().trim().min(1).max(256),
    uncertaintyMethod: snapshotSchema.shape.uncertaintyMethod.optional(),
    uncertaintyConfidence: snapshotSchema.shape.uncertaintyConfidence.optional(),
    rawPayloadRef: snapshotSchema.shape.rawPayloadRef.optional(),
    rawPayloadHash: snapshotSchema.shape.rawPayloadHash.optional(),
    calibrationRef: snapshotSchema.shape.calibrationRef.optional(),
    ratingCurveRef: snapshotSchema.shape.ratingCurveRef.optional(),
  })
  .superRefine((value, context) => {
    refine(value, context);
    if (value.qualityState === 'valid' || value.qualityState === 'estimated')
      context.addIssue({
        code: 'custom',
        path: ['qualityState'],
        message: 'raw ingestion cannot claim valid or estimated quality',
      });
    if (!value.qualityReason)
      context.addIssue({
        code: 'custom',
        path: ['qualityReason'],
        message: 'a reason is required for non-valid data',
      });
  });
export type IngestObservationRequest = z.infer<typeof ingestObservationRequestSchema>;

export const correctObservationRequestSchema = z
  .object({
    workflowState: z.enum(['corrected', 'estimated', 'rejected']),
    ...measurementFields,
    provenance: z.string().trim().min(1).max(256),
    correctionReason: z.string().trim().min(1).max(1000),
    measurementMethod: snapshotSchema.shape.measurementMethod.optional(),
    uncertaintyMethod: snapshotSchema.shape.uncertaintyMethod.optional(),
    uncertaintyConfidence: snapshotSchema.shape.uncertaintyConfidence.optional(),
    calibrationRef: snapshotSchema.shape.calibrationRef.optional(),
    ratingCurveRef: snapshotSchema.shape.ratingCurveRef.optional(),
  })
  .superRefine((value, context) => {
    if (value.qualityState !== 'valid' && !value.qualityReason)
      context.addIssue({
        code: 'custom',
        path: ['qualityReason'],
        message: 'a reason is required for non-valid data',
      });
    if (value.workflowState === 'rejected' && value.qualityState !== 'invalid')
      context.addIssue({
        code: 'custom',
        path: ['qualityState'],
        message: 'rejected means invalid',
      });
    if ((value.workflowState === 'estimated') !== (value.qualityState === 'estimated'))
      context.addIssue({
        code: 'custom',
        path: ['qualityState'],
        message: 'estimated quality is reserved for the estimated workflow',
      });
    if (
      value.workflowState === 'estimated' &&
      (!value.measurementMethod ||
        !value.uncertainty ||
        !value.uncertaintyMethod ||
        value.qualityState !== 'estimated')
    )
      context.addIssue({
        code: 'custom',
        path: ['workflowState'],
        message: 'estimated requires estimated quality, method, and uncertainty',
      });
  });
export type CorrectObservationRequest = z.infer<typeof correctObservationRequestSchema>;

export const ingestObservationResponseSchema = z.object({
  observation: observationSchema,
  idempotent: z.boolean(),
});
export type IngestObservationResponse = z.infer<typeof ingestObservationResponseSchema>;
export const observationResponseSchema = z.object({ observation: observationSchema });
export const observationHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(256).optional(),
});
export type ObservationHistoryQuery = z.infer<typeof observationHistoryQuerySchema>;
export const observationHistoryResponseSchema = z.object({
  observations: z.array(observationSchema),
  nextCursor: z.string().nullable(),
});
export type ObservationHistoryResponse = z.infer<typeof observationHistoryResponseSchema>;
export const observationUnits = {
  stage: 'm',
  discharge: 'm3/s',
  accumulated_volume: 'm3',
} as const;

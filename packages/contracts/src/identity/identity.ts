import { z } from 'zod';

export const userRoleSchema = z.enum([
  'system_admin',
  'national_admin',
  'regional_director',
  'basin_dispatcher',
  'district_operator',
  'hydrologist',
  'maintenance_engineer',
  'auditor',
]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const grantScopeSchema = z.enum(['system', 'national', 'territory']);
export type GrantScope = z.infer<typeof grantScopeSchema>;

const utcTimestampSchema = z.string().datetime({ offset: true });

export const organizationSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  dataClassification: z.enum(['synthetic', 'official']),
});
export type Organization = z.infer<typeof organizationSchema>;

export const territorySchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  parentTerritoryId: z.uuid().nullable(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  kind: z.enum(['national', 'region', 'basin', 'district', 'facility']),
});
export type Territory = z.infer<typeof territorySchema>;

export const identityUserSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  externalSubject: z.string().min(1).max(256),
  displayName: z.string().min(1).max(256),
  isActive: z.boolean(),
  dataClassification: z.enum(['synthetic', 'official']),
});
export type IdentityUser = z.infer<typeof identityUserSchema>;

export const authorizationGrantSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    organizationId: z.uuid(),
    role: userRoleSchema,
    scope: grantScopeSchema,
    territoryId: z.uuid().nullable(),
    effectiveFrom: utcTimestampSchema,
    effectiveUntil: utcTimestampSchema.nullable(),
    cancelledAt: utcTimestampSchema.nullable(),
  })
  .superRefine((grant, context) => {
    const territoryRequired = grant.scope === 'territory';
    if (territoryRequired !== (grant.territoryId !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'territoryId is required only for territory-scoped grants',
        path: ['territoryId'],
      });
    }
  });
export type AuthorizationGrant = z.infer<typeof authorizationGrantSchema>;

export const sessionSchema = z.object({
  user: identityUserSchema,
  organization: organizationSchema,
  currentGrants: z.array(authorizationGrantSchema),
  resolvedAt: utcTimestampSchema,
});
export type Session = z.infer<typeof sessionSchema>;

export const sessionResponseSchema = z.object({ session: sessionSchema });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const currentGrantsResponseSchema = z.object({
  currentGrants: z.array(authorizationGrantSchema),
});
export type CurrentGrantsResponse = z.infer<typeof currentGrantsResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_ERROR', 'CONFLICT']),
    message: z.string(),
    requestId: z.string().min(1),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface IdentityRequestHeaders {
  headers: Record<string, string | string[] | undefined>;
}

export interface ResolvedIdentity {
  userId: string;
  provider: 'local-development';
}

/**
 * Boundary for OIDC/SAML/MFA-ready identity integrations. Domain services receive
 * only stable internal user IDs and never trust browser-provided role claims.
 */
export interface IdentityProvider {
  resolve(request: IdentityRequestHeaders): Promise<ResolvedIdentity | null>;
}

export interface LocalDevelopmentIdentityProviderOptions {
  enabled?: boolean;
}

export function createLocalDevelopmentIdentityProvider(
  options: LocalDevelopmentIdentityProviderOptions = {},
): IdentityProvider {
  const enabled = options.enabled ?? process.env.ISUV_ENABLE_LOCAL_IDENTITY === 'true';

  return {
    async resolve(request): Promise<ResolvedIdentity | null> {
      // This adapter is deliberately opt-in; production defaults to fail closed.
      if (!enabled) return null;
      const value = request.headers['x-isuv-user-id'];
      const candidate = Array.isArray(value) ? value[0] : value;
      if (!candidate || !uuidPattern.test(candidate)) return null;
      return { userId: candidate, provider: 'local-development' };
    },
  };
}

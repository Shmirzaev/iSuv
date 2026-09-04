const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface IdentityRequestHeaders {
  headers: Record<string, string | string[] | undefined>;
}

export interface ResolvedIdentity {
  userId: string;
  /** Adapter identifier (for example local-development, oidc, or saml). */
  provider: string;
}

/**
 * Boundary for OIDC/SAML/MFA-ready identity integrations. Domain services receive
 * only stable internal user IDs and never trust browser-provided role claims.
 */
export interface IdentityProvider {
  resolve(request: IdentityRequestHeaders): Promise<ResolvedIdentity | null>;
}

export interface LocalDevelopmentIdentityProviderOptions {
  /**
   * Injectable for deterministic tests and hosts that establish the runtime
   * environment before constructing adapters. Defaults to NODE_ENV.
   */
  environment?: string | undefined;
  enabled?: boolean;
}

export interface PublicDemoIdentityProviderOptions {
  environment?: string | undefined;
  enabled?: boolean;
  userId?: string | undefined;
}

export function createLocalDevelopmentIdentityProvider(
  options: LocalDevelopmentIdentityProviderOptions = {},
): IdentityProvider {
  const environment = options.environment ?? process.env.NODE_ENV;
  const isProduction = environment?.trim().toLowerCase() === 'production';
  const enabled =
    !isProduction && (options.enabled ?? process.env.ISUV_ENABLE_LOCAL_IDENTITY === 'true');

  return {
    async resolve(request): Promise<ResolvedIdentity | null> {
      // This header adapter is deliberately opt-in and always fails closed in
      // production: it exists only to make local/test fixtures usable without
      // coupling application code to a real identity provider.
      if (!enabled) return null;
      const value = request.headers['x-isuv-user-id'];
      const candidate = Array.isArray(value) ? value[0] : value;
      if (!candidate || !uuidPattern.test(candidate)) return null;
      return { userId: candidate, provider: 'local-development' };
    },
  };
}

/**
 * Fixed, server-owned identity for the explicitly read-only synthetic public demo.
 * The application-level public-demo guard rejects every unsafe HTTP method before
 * protected routes resolve this identity. Client headers are deliberately ignored.
 */
export function createPublicDemoIdentityProvider(
  options: PublicDemoIdentityProviderOptions = {},
): IdentityProvider {
  const environment = (options.environment ?? process.env.NODE_ENV)?.trim().toLowerCase();
  const enabled = options.enabled ?? process.env.ISUV_PUBLIC_DEMO === 'true';
  const userId = options.userId ?? process.env.ISUV_PUBLIC_DEMO_USER_ID;

  if (!enabled)
    return {
      async resolve() {
        return null;
      },
    };
  if (environment !== 'production') {
    throw new Error('Public demo identity requires NODE_ENV=production.');
  }
  if (!userId || !uuidPattern.test(userId)) {
    throw new Error('Public demo identity requires a valid fixed synthetic user ID.');
  }

  return {
    async resolve() {
      return { userId, provider: 'synthetic-public-demo-read-only' };
    },
  };
}

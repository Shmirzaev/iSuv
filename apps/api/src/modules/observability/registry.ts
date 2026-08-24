const apiErrorCodes = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'CONFLICT',
  'UNAVAILABLE',
  'unclassified',
] as const;
type ApiErrorCode = (typeof apiErrorCodes)[number];
type StatusClass = '4xx' | '5xx';

export interface ProcessMetricsSnapshot {
  apiErrors: ReadonlyArray<{
    route: string;
    statusClass: StatusClass;
    code: ApiErrorCode;
    count: number;
  }>;
  observationIngestion: Record<'accepted' | 'idempotent', number>;
  validation: Record<'applied' | 'deferred', number>;
}

function parsedPayload(payload: unknown): Record<string, unknown> | null {
  if (typeof payload === 'string') {
    if (payload.length > 8_192) return null;
    try {
      const parsed: unknown = JSON.parse(payload);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

/** Accept route templates only; literal UUID paths never become a metric label. */
export function normalizeMetricRoute(route: string | undefined): string {
  if (!route || route.length > 160 || !route.startsWith('/')) return 'unmatched';
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(route))
    return 'unmatched';
  if (!/^[A-Za-z0-9/_:.-]+$/.test(route)) return 'unmatched';
  return route;
}

function apiCode(payload: Record<string, unknown> | null): ApiErrorCode {
  const code = (payload?.error as Record<string, unknown> | undefined)?.code;
  return typeof code === 'string' && apiErrorCodes.includes(code as ApiErrorCode)
    ? (code as ApiErrorCode)
    : 'unclassified';
}

/**
 * Deliberately process-local counters. They reset on restart and are labelled
 * only by bounded route templates, status classes, and contract error codes.
 */
export class InProcessOperationalMetricsRegistry {
  private readonly errors = new Map<string, number>();
  private readonly observationIngestion = { accepted: 0, idempotent: 0 };
  private readonly validation = { applied: 0, deferred: 0 };
  private static readonly maxErrorSeries = 256;

  public recordResponse(route: string | undefined, statusCode: number, payload: unknown): void {
    const body = parsedPayload(payload);
    if (route === '/api/v1/observations' && statusCode >= 200 && statusCode < 300) {
      if (body?.idempotent === true) this.observationIngestion.idempotent += 1;
      else if (body?.idempotent === false) this.observationIngestion.accepted += 1;
    }
    if (
      route === '/api/v1/observations/:lineageId/validate' &&
      statusCode >= 200 &&
      statusCode < 300
    ) {
      if (body?.outcome === 'applied') this.validation.applied += 1;
      else if (body?.outcome === 'deferred') this.validation.deferred += 1;
    }
    if (statusCode < 400) return;
    const statusClass: StatusClass = statusCode >= 500 ? '5xx' : '4xx';
    const normalizedRoute = normalizeMetricRoute(route);
    const code = apiCode(body);
    const key = `${normalizedRoute}\u0000${statusClass}\u0000${code}`;
    if (
      !this.errors.has(key) &&
      this.errors.size >= InProcessOperationalMetricsRegistry.maxErrorSeries
    )
      return;
    this.errors.set(key, (this.errors.get(key) ?? 0) + 1);
  }

  public snapshot(): ProcessMetricsSnapshot {
    return {
      apiErrors: [...this.errors.entries()]
        .map(([key, count]) => {
          const [route, statusClass, code] = key.split('\u0000') as [
            string,
            StatusClass,
            ApiErrorCode,
          ];
          return { route, statusClass, code, count };
        })
        .sort((left, right) =>
          `${left.route}:${left.statusClass}:${left.code}`.localeCompare(
            `${right.route}:${right.statusClass}:${right.code}`,
          ),
        ),
      observationIngestion: { ...this.observationIngestion },
      validation: { ...this.validation },
    };
  }
}

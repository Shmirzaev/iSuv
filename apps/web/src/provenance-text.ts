/**
 * Human-facing provenance fragments are API-owned sentences. Normalize only the
 * join boundary so a complete source label cannot become `telemetry.; synthetic`.
 */
export function joinProvenance(parts: readonly (string | null | undefined)[]): string {
  const values = parts
    .map((part) => part?.trim().replace(/^[\s;.,]+/u, ''))
    .filter((part): part is string => Boolean(part));
  return values
    .map((part, index) => (index < values.length - 1 ? part.replace(/[\s;.,:]+$/u, '') : part))
    .join('; ');
}

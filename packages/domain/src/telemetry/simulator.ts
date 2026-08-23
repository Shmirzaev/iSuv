/**
 * Deterministic, deliberately fictional telemetry fixtures. This module does
 * not know allocations, thresholds, or any physical-control protocol. `over`
 * and `under` are scenario labels only, never compliance decisions.
 */
export type TelemetryScenario =
  | 'normal'
  | 'over'
  | 'under'
  | 'stale'
  | 'offline'
  | 'spike'
  | 'frozen'
  | 'device_fault'
  | 'reset'
  | 'rollover';
export type SyntheticMeasurementKind = 'stage' | 'discharge' | 'accumulated_volume';
export type SyntheticUnit = 'm' | 'm3/s' | 'm3';
export type SyntheticRawQuality = 'unknown' | 'suspect' | 'invalid';

export interface SyntheticTelemetryPoint {
  hotspot: number;
  deviceId: string;
  sensorId: string;
  kind: SyntheticMeasurementKind;
  unit: SyntheticUnit;
  value: string;
  observedAt: string;
  sourceEventId: string;
  scenario: TelemetryScenario;
  qualityState: SyntheticRawQuality;
  qualityReason: string;
  totalizerTransition: 'normal' | 'reset_reported' | 'rollover_reported' | 'unknown' | null;
}

export interface SyntheticTelemetryStatus {
  hotspot: number;
  deviceId: string;
  observedAt: string;
  sourceEventId: string;
  status: 'offline' | 'device_fault';
  scenario: 'offline' | 'device_fault';
  provenance: 'synthetic';
  faultCode: string | null;
}

export interface SyntheticTelemetryEnvelope {
  version: 'v1';
  classification: 'synthetic';
  seed: string;
  scenario: TelemetryScenario;
  /** UTC scenario clock; stale readings retain a deliberately older observation time. */
  generatedAt: string;
  points: SyntheticTelemetryPoint[];
  /** Status/gap facts; an offline device never creates a numeric zero/null observation. */
  statuses: SyntheticTelemetryStatus[];
}

function id(type: '08' | '0a', hotspot: number, sequence = 0): string {
  return `f1${type}${hotspot.toString(16).padStart(4, '0')}-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`;
}
function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}
const offsetTimestampPattern =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i;

/**
 * JavaScript Dates are millisecond precision, while the observation contract
 * accepts microseconds. Parse whole seconds and the fractional component
 * separately so event identity and observed-at values do not collapse.
 */
function canonicalUtc(value: string): string {
  const match = offsetTimestampPattern.exec(value);
  if (!match) throw new Error('Synthetic telemetry requires a valid UTC timestamp.');
  const localWholeSecond = match[1]!;
  const fraction = match[2] ?? '';
  const offset = match[3]!;
  const localEpoch = Date.parse(`${localWholeSecond}Z`);
  if (Number.isNaN(localEpoch))
    throw new Error('Synthetic telemetry requires a valid UTC timestamp.');
  const offsetMinutes =
    offset === 'Z'
      ? 0
      : (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6))) *
        (offset.startsWith('+') ? 1 : -1);
  const utcWholeSecond = new Date(localEpoch - offsetMinutes * 60_000).toISOString().slice(0, 19);
  return `${utcWholeSecond}.${fraction.padEnd(6, '0')}Z`;
}

function shiftCanonicalUtc(value: string, seconds: number): string {
  const wholeSecond = value.slice(0, 19);
  const fraction = value.slice(20, 26);
  return `${new Date(Date.parse(`${wholeSecond}Z`) + seconds * 1_000).toISOString().slice(0, 19)}.${fraction}Z`;
}
function qualityForScenario(
  scenario: TelemetryScenario,
): Pick<SyntheticTelemetryPoint, 'qualityState' | 'qualityReason'> {
  if (scenario === 'spike')
    return {
      qualityState: 'suspect',
      qualityReason: 'synthetic spike candidate; validation pending',
    };
  if (scenario === 'device_fault')
    return { qualityState: 'invalid', qualityReason: 'synthetic numeric device-fault reading' };
  return { qualityState: 'unknown', qualityReason: 'synthetic raw telemetry; validation pending' };
}

/** Builds all 83 seeded devices / 249 seeded sensors using their stable asset IDs. */
export function simulateTelemetryEnvelope(
  seed: string,
  at: string,
  step: number,
  scenario: TelemetryScenario,
): SyntheticTelemetryEnvelope {
  const generatedAt = canonicalUtc(at);
  const staleAt = shiftCanonicalUtc(generatedAt, -15 * 60);
  const statuses: SyntheticTelemetryStatus[] =
    scenario === 'offline' || scenario === 'device_fault'
      ? Array.from({ length: 83 }, (_, index) => {
          const hotspot = index + 1;
          return {
            hotspot,
            deviceId: id('08', hotspot),
            observedAt: generatedAt,
            // The scenario clock is part of event identity: a later simulator
            // run is a new source event, while exact replay remains idempotent.
            sourceEventId: `synthetic:${seed}:${generatedAt}:${scenario}:${step}:${hotspot}:status`,
            status: scenario,
            scenario,
            provenance: 'synthetic',
            faultCode: scenario === 'device_fault' ? 'SYNTHETIC_DEVICE_FAULT' : null,
          };
        })
      : [];
  const points =
    scenario === 'offline'
      ? []
      : Array.from({ length: 83 }, (_, x) => x + 1).flatMap((h) =>
          (['stage', 'discharge', 'accumulated_volume'] as const).map((kind, i) => {
            const base =
              kind === 'stage'
                ? 2 + (hash(`${seed}:${h}`) % 100) / 100
                : kind === 'discharge'
                  ? 5 + (hash(`${seed}:${h}:q`) % 300) / 10
                  : 1000 + h * 100;
            // Independent synthetic cadence terms make stage and discharge
            // change between ordinary samples without deriving one from the
            // other. Frozen remains the explicit no-change scenario.
            const cadence =
              scenario === 'frozen'
                ? 0
                : kind === 'stage'
                  ? (((step + (hash(`${seed}:${h}:stage-cadence`) % 9)) % 9) - 4) * 0.005
                  : kind === 'discharge'
                    ? (((step + (hash(`${seed}:${h}:discharge-cadence`) % 11)) % 11) - 5) * 0.15
                    : 0;
            const multiplier =
              scenario === 'over'
                ? 1.25
                : scenario === 'under'
                  ? 0.75
                  : scenario === 'spike'
                    ? 4
                    : 1;
            // Accumulated volume remains a nonnegative totalizer reading. A
            // scenario changes its synthetic per-step counter increment, not
            // an inferred interval-delivery value.
            const counterIncrement =
              scenario === 'over' ? 16 : scenario === 'under' ? 5 : scenario === 'spike' ? 60 : 10;
            const v =
              kind === 'accumulated_volume'
                ? scenario === 'reset'
                  ? 1
                  : scenario === 'rollover'
                    ? 2
                    : base + (scenario === 'frozen' ? 0 : step * counterIncrement)
                : (base + cadence) * multiplier;
            return {
              hotspot: h,
              deviceId: id('08', h),
              sensorId: id('0a', h, i + 1),
              kind,
              unit: (kind === 'stage'
                ? 'm'
                : kind === 'discharge'
                  ? 'm3/s'
                  : 'm3') as SyntheticUnit,
              value: v.toFixed(4),
              observedAt: scenario === 'stale' ? staleAt : generatedAt,
              sourceEventId: `synthetic:${seed}:${generatedAt}:${scenario}:${step}:${h}:${kind}`,
              scenario,
              ...qualityForScenario(scenario),
              totalizerTransition: (kind === 'accumulated_volume'
                ? scenario === 'reset'
                  ? 'reset_reported'
                  : scenario === 'rollover'
                    ? 'rollover_reported'
                    : 'normal'
                : null) as SyntheticTelemetryPoint['totalizerTransition'],
            };
          }),
        );
  return {
    version: 'v1',
    classification: 'synthetic',
    seed,
    scenario,
    generatedAt,
    points,
    statuses,
  };
}

/** Compatibility helper for numeric-reading-only callers. */
export function simulateTelemetry(
  seed: string,
  at: string,
  step: number,
  scenario: TelemetryScenario,
): SyntheticTelemetryPoint[] {
  return simulateTelemetryEnvelope(seed, at, step, scenario).points;
}

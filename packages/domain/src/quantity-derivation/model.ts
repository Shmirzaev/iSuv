export interface Rational {
  numerator: bigint;
  denominator: bigint;
}
export interface ExactObservation {
  observedAt: string;
  value: string;
  lineageId: string;
  revisionId: string;
  sensorId: string;
  deviceInstallationId: string;
  measurementMethod: string | null;
  totalizerTransition: string | null;
  workflowState: string;
  qualityState: string;
}
export interface RatingKnot {
  stageM: string;
  dischargeM3s: string;
}
export type DeriveReason =
  | 'missing_exact_endpoint'
  | 'observation_gap_exceeds_policy'
  | 'observations_not_strictly_ordered'
  | 'mixed_sensor_installation_or_method'
  | 'unusable_observation'
  | 'stage_outside_rating_curve'
  | 'negative_discharge_not_configured'
  | 'counter_policy_not_approved'
  | 'counter_reset_or_rollover'
  | 'counter_decrease'
  | 'counter_missing_endpoint';
export type ExactDerivation =
  | { outcome: 'computed'; value: Rational; coveredStart: string; coveredEnd: string }
  | {
      outcome: 'deferred';
      reason: DeriveReason;
      coveredStart: string | null;
      coveredEnd: string | null;
    };

function abs(value: bigint) {
  return value < 0n ? -value : value;
}
function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return abs(a);
}
export function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n) throw new Error('zero denominator');
  const sign = denominator < 0n ? -1n : 1n;
  const d = denominator * sign;
  const n = numerator * sign;
  const divisor = gcd(n, d);
  return { numerator: n / divisor, denominator: d / divisor };
}
export function add(a: Rational, b: Rational) {
  return rational(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}
export function sub(a: Rational, b: Rational) {
  return rational(
    a.numerator * b.denominator - b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}
export function mul(a: Rational, b: Rational) {
  return rational(a.numerator * b.numerator, a.denominator * b.denominator);
}
export function div(a: Rational, b: Rational) {
  return rational(a.numerator * b.denominator, a.denominator * b.numerator);
}
export function compare(a: Rational, b: Rational) {
  const n = a.numerator * b.denominator - b.numerator * a.denominator;
  return n < 0n ? -1 : n > 0n ? 1 : 0;
}
export function parseExactDecimal(value: string): Rational {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error('invalid decimal');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  return rational(
    (negative ? -1n : 1n) * BigInt(`${whole}${fraction}`),
    10n ** BigInt(fraction.length),
  );
}
function leap(year: bigint) {
  return year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n);
}
function daysBeforeYear(year: bigint): bigint {
  const y = year - 1n;
  return 365n * y + y / 4n - y / 100n + y / 400n;
}
function daysSinceEpoch(year: bigint, month: bigint, day: bigint): bigint {
  const monthDays = [31n, 28n, 31n, 30n, 31n, 30n, 31n, 31n, 30n, 31n, 30n, 31n];
  let days = daysBeforeYear(year) - daysBeforeYear(1970n) + day - 1n;
  for (let i = 1n; i < month; i++)
    days += monthDays[Number(i - 1n)]! + (i === 2n && leap(year) ? 1n : 0n);
  return days;
}
/** Parses the accepted ISO-8601 form without converting through JS floating point milliseconds. */
export function utcMicros(value: string): bigint {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i.exec(
      value,
    );
  if (!match) throw new Error('invalid UTC timestamp');
  const [, y, mo, d, h, mi, s, fraction = '', zone] = match;
  const normalizedZone = zone!;
  const offset =
    normalizedZone === 'Z'
      ? 0n
      : (BigInt(normalizedZone.slice(1, 3)) * 60n + BigInt(normalizedZone.slice(4, 6))) *
        (normalizedZone.startsWith('+') ? 1n : -1n);
  return (
    (daysSinceEpoch(BigInt(y!), BigInt(mo!), BigInt(d!)) * 86_400n +
      BigInt(h!) * 3600n +
      BigInt(mi!) * 60n +
      BigInt(s!) -
      offset * 60n) *
      1_000_000n +
    BigInt(fraction.padEnd(6, '0'))
  );
}
export function isGovernedUsable(observation: ExactObservation) {
  return (
    observation.qualityState === 'valid' &&
    ['automatically_validated', 'expert_validated', 'corrected'].includes(observation.workflowState)
  );
}
export function interpolateStage(knots: readonly RatingKnot[], stage: Rational): Rational | null {
  const parsed = knots.map((knot) => ({
    stage: parseExactDecimal(knot.stageM),
    discharge: parseExactDecimal(knot.dischargeM3s),
  }));
  if (
    parsed.length < 2 ||
    compare(stage, parsed[0]!.stage) < 0 ||
    compare(stage, parsed.at(-1)!.stage) > 0
  )
    return null;
  for (let index = 0; index < parsed.length; index++) {
    if (compare(stage, parsed[index]!.stage) === 0) return parsed[index]!.discharge;
    if (index && compare(stage, parsed[index]!.stage) < 0) {
      const low = parsed[index - 1]!;
      const high = parsed[index]!;
      return add(
        low.discharge,
        mul(
          sub(high.discharge, low.discharge),
          div(sub(stage, low.stage), sub(high.stage, low.stage)),
        ),
      );
    }
  }
  return parsed.at(-1)!.discharge;
}
export function integrateSeries(
  requestedStart: string,
  requestedEnd: string,
  observations: readonly ExactObservation[],
  maxGapMicroseconds: bigint,
  mapper: (value: string) => Rational | null = parseExactDecimal,
): ExactDerivation {
  if (!observations.length)
    return {
      outcome: 'deferred',
      reason: 'missing_exact_endpoint',
      coveredStart: null,
      coveredEnd: null,
    };
  const start = utcMicros(requestedStart),
    end = utcMicros(requestedEnd);
  const times = observations.map((o) => utcMicros(o.observedAt));
  for (let i = 1; i < times.length; i++)
    if (times[i]! <= times[i - 1]!)
      return {
        outcome: 'deferred',
        reason: 'observations_not_strictly_ordered',
        coveredStart: observations[0]!.observedAt,
        coveredEnd: observations.at(-1)!.observedAt,
      };
  if (times[0] !== start || times.at(-1) !== end)
    return {
      outcome: 'deferred',
      reason: 'missing_exact_endpoint',
      coveredStart: observations[0]!.observedAt,
      coveredEnd: observations.at(-1)!.observedAt,
    };
  const first = observations[0]!;
  if (!first.measurementMethod || observations.some((o) => !isGovernedUsable(o)))
    return {
      outcome: 'deferred',
      reason: 'unusable_observation',
      coveredStart: first.observedAt,
      coveredEnd: observations.at(-1)!.observedAt,
    };
  if (
    observations.some(
      (o) =>
        o.sensorId !== first.sensorId ||
        o.deviceInstallationId !== first.deviceInstallationId ||
        o.measurementMethod !== first.measurementMethod,
    )
  )
    return {
      outcome: 'deferred',
      reason: 'mixed_sensor_installation_or_method',
      coveredStart: first.observedAt,
      coveredEnd: observations.at(-1)!.observedAt,
    };
  let volume = rational(0n);
  for (let i = 1; i < observations.length; i++) {
    const delta = times[i]! - times[i - 1]!;
    if (delta > maxGapMicroseconds)
      return {
        outcome: 'deferred',
        reason: 'observation_gap_exceeds_policy',
        coveredStart: first.observedAt,
        coveredEnd: observations[i - 1]!.observedAt,
      };
    const low = mapper(observations[i - 1]!.value),
      high = mapper(observations[i]!.value);
    if (!low || !high)
      return {
        outcome: 'deferred',
        reason: 'stage_outside_rating_curve',
        coveredStart: first.observedAt,
        coveredEnd: observations[i - 1]!.observedAt,
      };
    if (compare(low, rational(0n)) < 0 || compare(high, rational(0n)) < 0)
      return {
        outcome: 'deferred',
        reason: 'negative_discharge_not_configured',
        coveredStart: first.observedAt,
        coveredEnd: observations[i - 1]!.observedAt,
      };
    volume = add(volume, mul(add(low, high), rational(delta, 2_000_000n)));
  }
  return {
    outcome: 'computed',
    value: volume,
    coveredStart: requestedStart,
    coveredEnd: requestedEnd,
  };
}
export function deriveCounterInterval(
  requestedStart: string,
  requestedEnd: string,
  observations: readonly ExactObservation[],
  maxGapMicroseconds: bigint,
  approvedPolicy: boolean,
): ExactDerivation {
  if (!approvedPolicy)
    return {
      outcome: 'deferred',
      reason: 'counter_policy_not_approved',
      coveredStart: null,
      coveredEnd: null,
    };
  if (!observations.length)
    return {
      outcome: 'deferred',
      reason: 'counter_missing_endpoint',
      coveredStart: null,
      coveredEnd: null,
    };
  const start = utcMicros(requestedStart);
  const end = utcMicros(requestedEnd);
  const times = observations.map((observation) => utcMicros(observation.observedAt));
  for (let index = 1; index < times.length; index += 1)
    if (times[index]! <= times[index - 1]!)
      return {
        outcome: 'deferred',
        reason: 'observations_not_strictly_ordered',
        coveredStart: observations[0]!.observedAt,
        coveredEnd: observations.at(-1)!.observedAt,
      };
  if (times[0] !== start || times.at(-1) !== end)
    return {
      outcome: 'deferred',
      reason: 'counter_missing_endpoint',
      coveredStart: observations[0]!.observedAt,
      coveredEnd: observations.at(-1)!.observedAt,
    };
  const first = observations[0]!;
  if (
    !first.measurementMethod ||
    observations.some((observation) => !isGovernedUsable(observation))
  )
    return {
      outcome: 'deferred',
      reason: 'unusable_observation',
      coveredStart: first.observedAt,
      coveredEnd: observations.at(-1)!.observedAt,
    };
  if (
    observations.some(
      (observation) =>
        observation.sensorId !== first.sensorId ||
        observation.deviceInstallationId !== first.deviceInstallationId ||
        observation.measurementMethod !== first.measurementMethod,
    )
  )
    return {
      outcome: 'deferred',
      reason: 'mixed_sensor_installation_or_method',
      coveredStart: first.observedAt,
      coveredEnd: observations.at(-1)!.observedAt,
    };
  if (observations.some((observation) => observation.totalizerTransition !== 'normal'))
    return {
      outcome: 'deferred',
      reason: 'counter_reset_or_rollover',
      coveredStart: first.observedAt,
      coveredEnd: observations.at(-1)!.observedAt,
    };
  for (let index = 1; index < observations.length; index += 1) {
    if (times[index]! - times[index - 1]! > maxGapMicroseconds)
      return {
        outcome: 'deferred',
        reason: 'observation_gap_exceeds_policy',
        coveredStart: first.observedAt,
        coveredEnd: observations[index - 1]!.observedAt,
      };
    if (
      compare(
        parseExactDecimal(observations[index]!.value),
        parseExactDecimal(observations[index - 1]!.value),
      ) < 0
    )
      return {
        outcome: 'deferred',
        reason: 'counter_decrease',
        coveredStart: first.observedAt,
        coveredEnd: observations[index - 1]!.observedAt,
      };
  }
  return {
    outcome: 'computed',
    value: sub(parseExactDecimal(observations.at(-1)!.value), parseExactDecimal(first.value)),
    coveredStart: requestedStart,
    coveredEnd: requestedEnd,
  };
}

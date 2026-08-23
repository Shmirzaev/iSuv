import {
  compare,
  mul,
  parseExactDecimal,
  rational,
  sub,
  type Rational,
} from '../quantity-derivation/model.js';

export type DeviationSide = 'under' | 'within' | 'over' | 'unassessable';
export interface SectionTolerance {
  underAbsoluteM3: string | null;
  overAbsoluteM3: string | null;
  underPercent: string | null;
  overPercent: string | null;
  combination: 'all' | 'any';
  appliesToZeroPlan: boolean;
}
export interface DeviationEvaluation {
  delta: Rational;
  absoluteDelta: Rational;
  percent: Rational | null;
  condition: DeviationSide;
}

function absolute(value: Rational): Rational {
  return value.numerator < 0n ? rational(-value.numerator, value.denominator) : value;
}
function exceeds(value: Rational, threshold: string | null): boolean | null {
  return threshold === null ? null : compare(value, parseExactDecimal(threshold)) > 0;
}
/**
 * Exact, deterministic planned-vs-actual evaluation. Equality is within
 * tolerance; no value is rounded through IEEE floating point.
 */
export function evaluateAllocationDeviation(
  plannedM3: string,
  actualM3: Rational,
  tolerance: SectionTolerance,
): DeviationEvaluation {
  const planned = parseExactDecimal(plannedM3);
  const delta = sub(actualM3, planned);
  const absoluteDelta = absolute(delta);
  if (compare(planned, rational(0n)) === 0) {
    const direction = compare(delta, rational(0n));
    const applicableAbsolute =
      direction < 0 ? tolerance.underAbsoluteM3 : direction > 0 ? tolerance.overAbsoluteM3 : null;
    return {
      delta,
      absoluteDelta,
      percent: null,
      condition:
        direction === 0
          ? 'within'
          : !tolerance.appliesToZeroPlan || applicableAbsolute === null
            ? 'unassessable'
            : exceeds(absoluteDelta, applicableAbsolute)
              ? direction < 0
                ? 'under'
                : 'over'
              : 'within',
    };
  }
  const percent = mul(
    rational(100n),
    rational(delta.numerator * planned.denominator, delta.denominator * planned.numerator),
  );
  const under = compare(delta, rational(0n)) < 0;
  const over = compare(delta, rational(0n)) > 0;
  const decide = (absoluteLimit: string | null, percentLimit: string | null): boolean => {
    const checks = [
      exceeds(absoluteDelta, absoluteLimit),
      exceeds(absolute(percent), percentLimit),
    ].filter((value): value is boolean => value !== null);
    // DB guarantees a tolerance on each side. all means every configured
    // limit must be exceeded; any means one configured limit is enough.
    return tolerance.combination === 'all' ? checks.every(Boolean) : checks.some(Boolean);
  };
  return {
    delta,
    absoluteDelta,
    percent,
    condition: under
      ? decide(tolerance.underAbsoluteM3, tolerance.underPercent)
        ? 'under'
        : 'within'
      : over
        ? decide(tolerance.overAbsoluteM3, tolerance.overPercent)
          ? 'over'
          : 'within'
        : 'within',
  };
}

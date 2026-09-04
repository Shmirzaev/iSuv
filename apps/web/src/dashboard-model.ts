import type { DashboardPeriod, DashboardResponse } from '@isuv/contracts';

import type { Locale, TranslationKey } from '@isuv/i18n';

import { formatDecimal, formatPresentationTimestamp } from './format.js';

export const dashboardPeriods: readonly DashboardPeriod[] = [
  'today',
  'week',
  'month',
  'season',
  'year',
];

export function dashboardPath(period: DashboardPeriod): string {
  return `/api/v1/dashboard?period=${encodeURIComponent(period)}`;
}

export function periodKey(period: DashboardPeriod): TranslationKey {
  const keys: Record<DashboardPeriod, TranslationKey> = {
    today: 'periodToday',
    week: 'periodWeek',
    month: 'periodMonth',
    season: 'periodSeason',
    year: 'periodYear',
  };
  return keys[period];
}

export type DashboardAssessment = DashboardResponse['kpis']['regionalInflow']['state'];

export function dashboardAssessmentPresentation(state: DashboardAssessment): {
  icon: string;
  label: TranslationKey;
} {
  if (state === 'scenario_classified') return { icon: '◆', label: 'statusScenarioClassified' };
  if (state === 'unassessable') return { icon: '⊘', label: 'statusUnassessable' };
  return { icon: '⚙', label: 'statusUnconfigured' };
}

export function dashboardDataStatePresentation(
  state: DashboardResponse['deviations'][number]['dataState'],
): { icon: string; label: TranslationKey } {
  const values: Record<
    DashboardResponse['deviations'][number]['dataState'],
    { icon: string; label: TranslationKey }
  > = {
    reported: { icon: '✓', label: 'statusReported' },
    no_data: { icon: '—', label: 'statusNoData' },
    unreliable: { icon: '!', label: 'statusUnreliable' },
    unconfigured: { icon: '⚙', label: 'statusUnconfigured' },
  };
  return values[state];
}

export function dashboardQualityKey(
  quality: DashboardResponse['deviations'][number]['quality'],
): TranslationKey {
  const keys: Record<DashboardResponse['deviations'][number]['quality'], TranslationKey> = {
    valid: 'qualityValid',
    no_data: 'qualityNoData',
    unreliable: 'qualityUnreliable',
    unconfigured: 'qualityUnconfigured',
  };
  return keys[quality];
}

/**
 * Preserves the API's rational value as a fraction. BigInt avoids accidental
 * rounding of official-sized volumes in the browser; this MVP does no client
 * arithmetic on dashboard values.
 */
export function formatExactRational(
  value: { numerator: string; denominator: string },
  locale: Locale = 'en',
): string {
  const numerator = BigInt(value.numerator);
  const denominator = BigInt(value.denominator);
  const absolute = numerator < 0n ? -numerator : numerator;
  const greatestCommonDivisor = (left: bigint, right: bigint): bigint => {
    let a = left;
    let b = right;
    while (b !== 0n) [a, b] = [b, a % b];
    return a;
  };
  const divisor = greatestCommonDivisor(absolute, denominator);
  const reducedNumerator = absolute / divisor;
  const reducedDenominator = denominator / divisor;
  let terminatingFactor = reducedDenominator;
  while (terminatingFactor % 2n === 0n) terminatingFactor /= 2n;
  while (terminatingFactor % 5n === 0n) terminatingFactor /= 5n;
  if (terminatingFactor !== 1n)
    return `${formatDecimal(locale, numerator)} / ${formatDecimal(locale, denominator)}`;

  const whole = reducedNumerator / reducedDenominator;
  let remainder = reducedNumerator % reducedDenominator;
  let fraction = '';
  while (remainder !== 0n) {
    remainder *= 10n;
    fraction += (remainder / reducedDenominator).toString();
    remainder %= reducedDenominator;
  }
  const sign = numerator < 0n ? '-' : '';
  const formattedWhole = formatDecimal(locale, whole);
  const decimal =
    formatDecimal(locale, '1.1')
      .replace(/\d/g, '')
      .replace(/[^.,،٫]/g, '') || '.';
  return `${sign}${formattedWhole}${fraction ? `${decimal}${fraction}` : ''}`;
}

/**
 * Format the server's integer duration without ever converting it to Number.
 * Dashboard intervals can be longer than JavaScript's safe integer range.
 */
export function formatExactDurationMicroseconds(value: string, locale: Locale = 'en'): string {
  const exact = BigInt(value).toString();
  return formatDecimal(locale, exact);
}

export function subtractExactRationals(
  left: { numerator: string; denominator: string },
  right: { numerator: string; denominator: string },
): { numerator: string; denominator: string } {
  const leftNumerator = BigInt(left.numerator);
  const leftDenominator = BigInt(left.denominator);
  const rightNumerator = BigInt(right.numerator);
  const rightDenominator = BigInt(right.denominator);
  return {
    numerator: (leftNumerator * rightDenominator - rightNumerator * leftDenominator).toString(),
    denominator: (leftDenominator * rightDenominator).toString(),
  };
}

/** A bounded, exact relative magnitude for a decorative variance bar. */
export function rationalRelativePercent(
  value: { numerator: string; denominator: string },
  maximum: { numerator: string; denominator: string },
): number {
  const numerator = BigInt(value.numerator);
  const denominator = BigInt(value.denominator);
  const maxNumerator = BigInt(maximum.numerator);
  const maxDenominator = BigInt(maximum.denominator);
  if (numerator === 0n || maxNumerator === 0n) return 0;
  const percent =
    ((numerator < 0n ? -numerator : numerator) *
      (maxDenominator < 0n ? -maxDenominator : maxDenominator) *
      10000n) /
    ((denominator < 0n ? -denominator : denominator) *
      (maxNumerator < 0n ? -maxNumerator : maxNumerator));
  return Math.min(100, Number(percent) / 100);
}

export function formatDashboardTimestamp(value: string, locale: Locale = 'en'): string {
  return formatPresentationTimestamp(locale, value);
}

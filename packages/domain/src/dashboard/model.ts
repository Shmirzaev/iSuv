import { parseExactDecimal, sub, utcMicros, type Rational } from '../quantity-derivation/model.js';

export type DashboardPeriod = 'today' | 'week' | 'month' | 'season' | 'year';
export type DashboardDataState = 'reported' | 'no_data' | 'unreliable' | 'unconfigured';

const microsPerSecond = 1_000_000n;
const microsPerMinute = 60n * microsPerSecond;
const microsPerHour = 60n * microsPerMinute;
const microsPerDay = 24n * microsPerHour;
const tashkentOffsetMicros = 5n * microsPerHour;

function leap(year: bigint) {
  return year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n);
}
function formatUtcMicros(value: bigint): string {
  let days = value / microsPerDay;
  let remainder = value % microsPerDay;
  if (remainder < 0n) {
    days -= 1n;
    remainder += microsPerDay;
  }
  let year = 1970n;
  while (days < 0n) {
    year -= 1n;
    days += leap(year) ? 366n : 365n;
  }
  while (days >= (leap(year) ? 366n : 365n)) {
    days -= leap(year) ? 366n : 365n;
    year += 1n;
  }
  const monthLengths = [31n, 28n, 31n, 30n, 31n, 30n, 31n, 31n, 30n, 31n, 30n, 31n];
  let month = 1;
  for (const base of monthLengths) {
    const length = base + (month === 2 && leap(year) ? 1n : 0n);
    if (days < length) break;
    days -= length;
    month += 1;
  }
  const hour = remainder / microsPerHour;
  remainder %= microsPerHour;
  const minute = remainder / microsPerMinute;
  remainder %= microsPerMinute;
  const second = remainder / microsPerSecond;
  const fraction = remainder % microsPerSecond;
  return `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${(days + 1n).toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}.${fraction.toString().padStart(6, '0')}Z`;
}

/** A calendar start in Asia/Tashkent, rendered back in canonical UTC. */
function localStartUtcMicros(year: bigint, month: number, day: number): bigint {
  return (
    utcMicros(
      `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00.000000Z`,
    ) - tashkentOffsetMicros
  );
}

export interface DashboardWindow {
  start: string;
  end: string;
}

/**
 * The selected window ends at the scenario's disclosed cutoff. Its previous
 * comparator is exactly the same elapsed duration, not a guessed calendar
 * period. Tashkent has no DST transition, so its fixed +05:00 boundary is
 * explicit and fully microsecond preserving.
 */
export function dashboardWindows(
  period: DashboardPeriod,
  referenceAt: string,
): {
  selected: DashboardWindow;
  prior: DashboardWindow;
} {
  const endMicros = utcMicros(referenceAt);
  const local = formatUtcMicros(endMicros + tashkentOffsetMicros);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(local);
  if (!match) throw new Error('invalid dashboard reference timestamp');
  const year = BigInt(match[1]!);
  const month = Number(match[2]!);
  const day = Number(match[3]!);
  const startMicros =
    period === 'today'
      ? localStartUtcMicros(year, month, day)
      : period === 'week'
        ? endMicros -
          BigInt((new Date(`${local.slice(0, 10)}T00:00:00Z`).getUTCDay() + 6) % 7) * microsPerDay -
          ((endMicros + tashkentOffsetMicros) % microsPerDay)
        : period === 'month'
          ? localStartUtcMicros(year, month, 1)
          : period === 'year'
            ? localStartUtcMicros(year, 1, 1)
            : localStartUtcMicros(year - (month < 4 ? 1n : 0n), 4, 1);
  if (endMicros <= startMicros)
    throw new Error('dashboard reference must be after selected period start');
  const duration = endMicros - startMicros;
  return {
    selected: { start: formatUtcMicros(startMicros), end: formatUtcMicros(endMicros) },
    prior: { start: formatUtcMicros(startMicros - duration), end: formatUtcMicros(startMicros) },
  };
}

export function classifyDashboardDataState(
  state: DashboardDataState,
): 'assessable' | 'no_data' | 'unreliable' | 'unconfigured' {
  if (state === 'reported') return 'assessable';
  return state;
}

export function exactDashboardDeviation(
  plannedM3: string,
  actualM3: string,
): {
  signed: Rational;
  absolute: Rational;
} {
  const signed = sub(parseExactDecimal(actualM3), parseExactDecimal(plannedM3));
  return {
    signed,
    absolute: {
      numerator: signed.numerator < 0n ? -signed.numerator : signed.numerator,
      denominator: signed.denominator,
    },
  };
}

import type { Locale } from '@isuv/i18n';

export const presentationTimeZone = 'Asia/Tashkent';

function separators(locale: Locale): { decimal: string; group: string } {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1000.1);
  return {
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
  };
}

/**
 * Formats decimal strings without converting them through a JavaScript number.
 * This keeps volume/accounting quantities exact even when they exceed safe integer range.
 */
export function formatDecimal(locale: Locale, value: string | number | bigint): string {
  const raw = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return raw;

  const sign = match[1] ?? '';
  const integer = match[2]!;
  const fraction = match[3];
  const { decimal, group } = separators(locale);
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${sign === '-' ? '-' : ''}${grouped}${fraction ? `${decimal}${fraction}` : ''}`;
}

export type MeasurementUnit = 'm' | 'm3/s' | 'm3';

/** Formats measurements without converting potentially large accounting values to Number. */
export function formatMeasurementValue(
  locale: Locale,
  value: string | number | bigint,
  unit: MeasurementUnit,
): string {
  return formatDecimal(locale, roundDecimalString(String(value), unit === 'm3' ? 0 : 2));
}

function roundDecimalString(value: string, fractionDigits: number): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return value;

  const sign = match[1] === '-' ? '-' : '';
  const whole = match[2]!;
  const fraction = match[3] ?? '';
  if (fraction.length <= fractionDigits) {
    return fractionDigits === 0
      ? `${sign}${whole}`
      : `${sign}${whole}.${fraction.padEnd(fractionDigits, '0')}`;
  }

  const kept = `${whole}${fraction.slice(0, fractionDigits)}`;
  const rounded = BigInt(kept || '0') + (fraction[fractionDigits]! >= '5' ? 1n : 0n);
  const digits = rounded.toString().padStart(fractionDigits + 1, '0');
  if (fractionDigits === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -fractionDigits)}.${digits.slice(-fractionDigits)}`;
}

export function formatNumber(
  locale: Locale,
  value: number,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatPresentationTimestamp(
  locale: Locale,
  value: string | Date,
  timeZone = presentationTimeZone,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export interface PresentationTimestamp {
  dateTime: string;
  title: string;
  value: string;
}

export function presentationTimestamp(locale: Locale, value: string): PresentationTimestamp {
  const parsed = new Date(value);
  return {
    dateTime: Number.isNaN(parsed.getTime()) ? value : parsed.toISOString(),
    title: value,
    value: formatPresentationTimestamp(locale, value),
  };
}

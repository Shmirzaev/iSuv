import type { ObservationMeasurementKind } from '../observations/model.js';

export type CoverageState = 'unconfigured' | 'no_data' | 'incomplete' | 'complete';
export type ValidationOutcome = 'valid' | 'suspect' | 'invalid';

export interface ValidationRules {
  /** A received fact older than this evaluation-clock age is stale. */
  staleAfterSeconds?: number;
  /** Arrival delay is distinct from stale presentation and is evidence only. */
  lateAfterSeconds?: number;
  /** Maximum absolute rate of change for stage (m/s), discharge (m3/s2), or counters (m3/s). */
  maximumRatePerSecond?: string;
  /** Equal consecutive values at distinct timestamps become suspect at this count. */
  frozenAfterCount?: number;
  /** Reported reset/rollover is suspect unless this explicit acceptance is present. */
  acceptReportedCounterTransitions?: true;
  minimumValue?: string;
  maximumValue?: string;
  /** Explicit bounded bootstrap when no governed-valid predecessor exists. */
  allowBootstrapWithoutPrior?: true;
}

export interface ValidationCandidate {
  measurementKind: ObservationMeasurementKind;
  value: string;
  observedAt: string;
  ingestedAt: string;
  rawQualityState: 'unknown' | 'suspect' | 'invalid';
  totalizerTransition: 'normal' | 'reset_reported' | 'rollover_reported' | 'unknown' | null;
}

export interface ValidationContext {
  candidate: ValidationCandidate;
  /** Previous values in measurement-time order, nearest first; no inferred zeros. */
  preceding: readonly Pick<ValidationCandidate, 'value' | 'observedAt'>[];
  /** A later measurement-time event had already arrived before this one. */
  arrivedOutOfOrder: boolean;
  evaluationAt: string;
}

export interface ValidationResult {
  deferred: boolean;
  qualityState: ValidationOutcome;
  qualityReason: string | null;
  evidence: readonly string[];
}

function epochMicroseconds(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i.exec(
    value,
  );
  if (!match) throw new Error('Validation timestamps must be offset-aware UTC timestamps.');
  const whole = Date.parse(`${match[1]}Z`);
  if (Number.isNaN(whole)) throw new Error('Validation timestamp is invalid.');
  const offsetMinutes =
    match[3] === 'Z'
      ? 0
      : (Number(match[3]!.slice(1, 3)) * 60 + Number(match[3]!.slice(4, 6))) *
        (match[3]!.startsWith('+') ? 1 : -1);
  return BigInt(whole - offsetMinutes * 60_000) * 1000n + BigInt((match[2] ?? '').padEnd(6, '0'));
}
function decimal(value: string): { coefficient: bigint; scale: number } {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error('Validation values must be finite decimal strings.');
  return {
    coefficient: (match[1] === '-' ? -1n : 1n) * BigInt(`${match[2]}${match[3] ?? ''}`),
    scale: (match[3] ?? '').length,
  };
}
function rateExceeds(
  current: string,
  prior: string,
  elapsedMicroseconds: bigint,
  limit: string,
): boolean {
  const left = decimal(current);
  const right = decimal(prior);
  const cap = decimal(limit);
  if (cap.coefficient < 0n) throw new Error('Validation rate cap cannot be negative.');
  const scale = Math.max(left.scale, right.scale);
  const delta =
    left.coefficient * 10n ** BigInt(scale - left.scale) -
    right.coefficient * 10n ** BigInt(scale - right.scale);
  // |delta| / 10^scale / (elapsedµs / 1e6) > cap / 10^capScale
  return (
    (delta < 0n ? -delta : delta) * 1_000_000n * 10n ** BigInt(cap.scale) >
    cap.coefficient * elapsedMicroseconds * 10n ** BigInt(scale)
  );
}
function lessThan(leftValue: string, rightValue: string): boolean {
  const left = decimal(leftValue);
  const right = decimal(rightValue);
  const scale = Math.max(left.scale, right.scale);
  return (
    left.coefficient * 10n ** BigInt(scale - left.scale) <
    right.coefficient * 10n ** BigInt(scale - right.scale)
  );
}
function greaterThan(leftValue: string, rightValue: string): boolean {
  return lessThan(rightValue, leftValue);
}
function displaySeconds(microseconds: bigint): string {
  const sign = microseconds < 0n ? '-' : '';
  const absolute = microseconds < 0n ? -microseconds : microseconds;
  return `${sign}${absolute / 1_000_000n}.${(absolute % 1_000_000n).toString().padStart(6, '0')}`;
}

/**
 * Pure, deterministic rule evaluator. It deliberately has no allocation,
 * rating-curve, balance, travel-time, alarm, incident, or device-health logic.
 */
export function evaluateObservationValidation(
  rules: ValidationRules,
  context: ValidationContext,
): ValidationResult {
  const evidence: string[] = [];
  const requiresRateContext = rules.maximumRatePerSecond !== undefined;
  const requiresFrozenContext = rules.frozenAfterCount !== undefined;
  const requiresCounterContext =
    context.candidate.measurementKind === 'accumulated_volume' &&
    context.candidate.totalizerTransition === 'normal';
  const minimumPreceding = Math.max(
    requiresRateContext || requiresCounterContext ? 1 : 0,
    requiresFrozenContext ? rules.frozenAfterCount! - 1 : 0,
  );
  const hasBounds = rules.minimumValue !== undefined || rules.maximumValue !== undefined;
  let quality: ValidationOutcome =
    context.candidate.rawQualityState === 'invalid'
      ? 'invalid'
      : context.candidate.rawQualityState === 'suspect'
        ? 'suspect'
        : 'valid';
  const mark = (next: ValidationOutcome, item: string): void => {
    evidence.push(item);
    if (next === 'invalid' || (next === 'suspect' && quality === 'valid')) quality = next;
  };
  if (rules.minimumValue !== undefined && lessThan(context.candidate.value, rules.minimumValue))
    mark('invalid', 'below_configured_minimum');
  if (rules.maximumValue !== undefined && greaterThan(context.candidate.value, rules.maximumValue))
    mark('invalid', 'above_configured_maximum');
  const age =
    epochMicroseconds(context.evaluationAt) - epochMicroseconds(context.candidate.observedAt);
  if (rules.staleAfterSeconds !== undefined && age > BigInt(rules.staleAfterSeconds) * 1_000_000n)
    mark('suspect', `stale:${displaySeconds(age)}s>${rules.staleAfterSeconds}s`);
  const arrivalDelay =
    epochMicroseconds(context.candidate.ingestedAt) -
    epochMicroseconds(context.candidate.observedAt);
  if (
    rules.lateAfterSeconds !== undefined &&
    arrivalDelay > BigInt(rules.lateAfterSeconds) * 1_000_000n
  )
    mark('suspect', `late:${displaySeconds(arrivalDelay)}s>${rules.lateAfterSeconds}s`);
  if (context.arrivedOutOfOrder) mark('suspect', 'out_of_order_arrival');

  const prior = context.preceding[0];
  if (prior) {
    const elapsed =
      epochMicroseconds(context.candidate.observedAt) - epochMicroseconds(prior.observedAt);
    if (
      elapsed > 0n &&
      rules.maximumRatePerSecond !== undefined &&
      rateExceeds(context.candidate.value, prior.value, elapsed, rules.maximumRatePerSecond)
    )
      mark('invalid', `rate_exceeds:${rules.maximumRatePerSecond}/s`);
    if (
      context.candidate.measurementKind === 'accumulated_volume' &&
      lessThan(context.candidate.value, prior.value) &&
      context.candidate.totalizerTransition !== 'reset_reported' &&
      context.candidate.totalizerTransition !== 'rollover_reported'
    )
      mark('suspect', 'counter_decrease_without_reported_reset_or_rollover');
  }
  if (
    context.candidate.measurementKind === 'accumulated_volume' &&
    (context.candidate.totalizerTransition === 'reset_reported' ||
      context.candidate.totalizerTransition === 'rollover_reported') &&
    rules.acceptReportedCounterTransitions !== true
  )
    mark('suspect', 'reported_counter_transition_requires_explicit_acceptance');
  if (rules.frozenAfterCount !== undefined && rules.frozenAfterCount > 1) {
    const equalRun = [
      context.candidate.value,
      ...context.preceding.map((item) => item.value),
    ].findIndex((value) => value !== context.candidate.value);
    const count = equalRun === -1 ? context.preceding.length + 1 : equalRun;
    if (count >= rules.frozenAfterCount) mark('suspect', `frozen:${count}_consecutive_values`);
  }
  if (context.candidate.rawQualityState === 'suspect') evidence.unshift('raw_suspect');
  if (context.candidate.rawQualityState === 'invalid') evidence.unshift('raw_invalid');
  const reportedTransitionAccepted =
    context.candidate.measurementKind === 'accumulated_volume' &&
    (context.candidate.totalizerTransition === 'reset_reported' ||
      context.candidate.totalizerTransition === 'rollover_reported') &&
    rules.acceptReportedCounterTransitions === true;
  const missingContext = minimumPreceding > 0 && context.preceding.length < minimumPreceding;
  const bootstrapAllowed =
    missingContext &&
    !requiresCounterContext &&
    rules.allowBootstrapWithoutPrior === true &&
    hasBounds;
  if (bootstrapAllowed) evidence.push('bootstrap_without_prior');
  const substantiveRuleWasEvaluated =
    hasBounds ||
    (minimumPreceding > 0 && context.preceding.length >= minimumPreceding) ||
    reportedTransitionAccepted ||
    bootstrapAllowed;
  // A temporal-only profile may prove a bad fact suspect, but cannot prove a
  // fresh unknown numeric fact valid. Raw suspect/invalid remains unreliable.
  if (
    context.candidate.rawQualityState === 'unknown' &&
    quality === 'valid' &&
    (!substantiveRuleWasEvaluated || (missingContext && !bootstrapAllowed))
  )
    return {
      deferred: true,
      qualityState: 'suspect',
      qualityReason: null,
      evidence: [
        ...evidence,
        `insufficient_context:${context.preceding.length}/${minimumPreceding}`,
      ],
    };
  return {
    deferred: false,
    qualityState: quality,
    qualityReason: evidence.length ? evidence.join('; ') : null,
    evidence,
  };
}

/** Missing coverage is a status, never a fabricated numeric observation. */
export function coverageState(input: {
  configured: boolean;
  expectedCount: number;
  observedCount: number;
}): CoverageState {
  if (!input.configured) return 'unconfigured';
  if (input.observedCount === 0) return 'no_data';
  return input.observedCount < input.expectedCount ? 'incomplete' : 'complete';
}

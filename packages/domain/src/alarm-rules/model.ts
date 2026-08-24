import {
  add,
  compare,
  div,
  parseExactDecimal,
  rational,
  sub,
  utcMicros,
  type Rational,
} from '../quantity-derivation/model.js';

export type ConditionState =
  'inactive' | 'pending_activation' | 'active' | 'pending_clear' | 'deferred';
export type EvaluationReason =
  | 'unconfigured_rule'
  | 'missing_fact'
  | 'invalid_fact'
  | 'untrusted_fact'
  | 'incomplete_fact'
  | 'estimated_fact'
  | 'unknown_uncertainty'
  | 'uncertainty_exceeds_bound'
  | 'missing_provenance'
  | 'wrong_subject'
  | 'wrong_quantity_or_unit'
  | 'duplicate_or_nonmonotonic'
  | 'gap_exceeded'
  | 'rate_gate_not_met'
  | 'allocation_unassessable';

export interface ObservationThresholdCondition {
  kind: 'observation_threshold';
  sensorId: string;
  quantity: 'stage' | 'discharge';
  unit: 'm' | 'm3/s';
  direction: 'high' | 'low';
  /** Exact engineering threshold, expressed in the condition unit. */
  enter: string;
  /** Exact hysteresis threshold, expressed in the condition unit. */
  clear: string;
  enterPersistenceMicroseconds: bigint;
  clearPersistenceMicroseconds: bigint;
  maxGapMicroseconds: bigint;
  /** Maximum admitted fact uncertainty in the condition unit. */
  uncertaintyBound: string;
  rateGate?: {
    direction: 'rise' | 'fall';
    unit: 'm/s' | 'm3/s2';
    enter: string;
    clear: string;
  } | null;
}
export interface AllocationDeviationCondition {
  kind: 'allocation_deviation';
  planId: string;
  direction: 'over' | 'under';
  enterPersistenceMicroseconds: bigint;
  clearPersistenceMicroseconds: bigint;
  maxGapMicroseconds: bigint;
}
export type AlarmCondition = ObservationThresholdCondition | AllocationDeviationCondition;

export interface FactLineage {
  sourceIds: readonly string[];
  revisionIds: readonly string[];
  policyIds: readonly string[];
  provenance: string;
  dataClassification: 'synthetic';
  officialComplianceEligible: false;
}
export interface BaseConditionFact extends FactLineage {
  /** Inclusive event interval and its exact event instant. */
  eventStart: string;
  eventEnd: string;
  observedAt: string;
  /** Bitemporal visibility time. */
  knownAt: string;
  trusted: boolean;
  complete: boolean;
  estimated: boolean;
}
export interface ObservationConditionFact extends BaseConditionFact {
  kind: 'observation';
  sensorId: string;
  quantity: 'stage' | 'discharge';
  unit: 'm' | 'm3/s';
  value: Rational | null;
  uncertainty: Rational | null;
  /** Exact rate in m/s for stage or m3/s2 for discharge, if provided by the source. */
  ratePerSecond: Rational | null;
}
export interface AllocationConditionFact extends BaseConditionFact {
  kind: 'allocation';
  planId: string;
  outcome: 'computed' | 'unassessable';
  condition: 'under' | 'within' | 'over' | 'unassessable';
  /** Retained for evidence; P3-003 already governs the classification. */
  value: Rational | null;
  uncertainty: Rational | null;
}
export type ConditionFact = ObservationConditionFact | AllocationConditionFact;

export interface ConditionEvidence {
  facts: readonly ConditionFact[];
  qualifyingStart: string | null;
  qualifyingEnd: string | null;
  qualifyingDurationMicroseconds: bigint;
  qualifyingFactCount: number;
  ratePerSecond: Rational | null;
  gapBroken: boolean;
}
export interface ConditionEvaluation {
  state: ConditionState;
  reason: EvaluationReason | null;
  evidence: ConditionEvidence;
}

interface Candidate {
  start: string;
  facts: ConditionFact[];
  rate: Rational | null;
}

function emptyEvidence(facts: readonly ConditionFact[], gapBroken = false): ConditionEvidence {
  return {
    facts: [],
    qualifyingStart: null,
    qualifyingEnd: null,
    qualifyingDurationMicroseconds: 0n,
    qualifyingFactCount: 0,
    ratePerSecond: null,
    gapBroken,
  };
}
function evidence(candidate: Candidate | null, gapBroken: boolean): ConditionEvidence {
  if (!candidate?.facts.length) return emptyEvidence([], gapBroken);
  const end = candidate.facts.at(-1)!;
  return {
    facts: candidate.facts,
    qualifyingStart: candidate.start,
    qualifyingEnd: end.observedAt,
    qualifyingDurationMicroseconds: utcMicros(end.observedAt) - utcMicros(candidate.start),
    qualifyingFactCount: candidate.facts.length,
    ratePerSecond: candidate.rate,
    gapBroken,
  };
}
function deferred(reason: EvaluationReason, facts: readonly ConditionFact[]): ConditionEvaluation {
  return { state: 'deferred', reason, evidence: emptyEvidence(facts) };
}
function nonnegative(value: Rational) {
  return compare(value, rational(0n)) >= 0;
}
function temporalFactIsValid(fact: ConditionFact): boolean {
  try {
    const start = utcMicros(fact.eventStart);
    const end = utcMicros(fact.eventEnd);
    const observed = utcMicros(fact.observedAt);
    utcMicros(fact.knownAt);
    return start <= end && start <= observed && observed <= end;
  } catch {
    return false;
  }
}
function lineageReason(fact: ConditionFact): EvaluationReason | null {
  if (!temporalFactIsValid(fact)) return 'invalid_fact';
  if (!fact.trusted) return 'untrusted_fact';
  if (!fact.complete) return 'incomplete_fact';
  if (fact.estimated) return 'estimated_fact';
  if (
    !fact.sourceIds.length ||
    !fact.revisionIds.length ||
    !fact.policyIds.length ||
    !fact.provenance.trim() ||
    fact.dataClassification !== 'synthetic' ||
    fact.officialComplianceEligible !== false
  )
    return 'missing_provenance';
  return null;
}
function conditionIsWellFormed(condition: AlarmCondition): boolean {
  if (
    condition.enterPersistenceMicroseconds <= 0n ||
    condition.clearPersistenceMicroseconds <= 0n ||
    condition.maxGapMicroseconds <= 0n
  )
    return false;
  if (condition.kind === 'allocation_deviation') return true;
  try {
    const enter = parseExactDecimal(condition.enter);
    const clear = parseExactDecimal(condition.clear);
    const bound = parseExactDecimal(condition.uncertaintyBound);
    if (!nonnegative(bound)) return false;
    if (
      (condition.direction === 'high' && compare(clear, enter) >= 0) ||
      (condition.direction === 'low' && compare(clear, enter) <= 0)
    )
      return false;
    if (!condition.rateGate) return true;
    const rateEnter = parseExactDecimal(condition.rateGate.enter);
    const rateClear = parseExactDecimal(condition.rateGate.clear);
    return nonnegative(rateEnter) && nonnegative(rateClear) && compare(rateClear, rateEnter) < 0;
  } catch {
    return false;
  }
}
function factReason(condition: AlarmCondition, fact: ConditionFact): EvaluationReason | null {
  const lineage = lineageReason(fact);
  if (lineage) return lineage;
  if (condition.kind === 'observation_threshold') {
    if (fact.kind !== 'observation' || fact.sensorId !== condition.sensorId) return 'wrong_subject';
    if (fact.quantity !== condition.quantity || fact.unit !== condition.unit)
      return 'wrong_quantity_or_unit';
    if (!fact.value || !fact.uncertainty || !nonnegative(fact.uncertainty))
      return 'unknown_uncertainty';
    try {
      if (compare(fact.uncertainty, parseExactDecimal(condition.uncertaintyBound)) > 0)
        return 'uncertainty_exceeds_bound';
    } catch {
      return 'invalid_fact';
    }
    return null;
  }
  if (fact.kind !== 'allocation' || fact.planId !== condition.planId) return 'wrong_subject';
  if (fact.outcome !== 'computed' || fact.condition === 'unassessable')
    return 'allocation_unassessable';
  if (fact.uncertainty && !nonnegative(fact.uncertainty)) return 'invalid_fact';
  return null;
}
function transformedRate(rate: Rational, direction: 'rise' | 'fall') {
  return direction === 'rise' ? rate : rational(-rate.numerator, rate.denominator);
}
function rateQualifies(
  condition: ObservationThresholdCondition,
  fact: ObservationConditionFact,
  clearing: boolean,
): { qualifies: boolean; rate: Rational | null } {
  if (!condition.rateGate) return { qualifies: true, rate: fact.ratePerSecond };
  if (!fact.ratePerSecond) return { qualifies: false, rate: null };
  const rate = transformedRate(fact.ratePerSecond, condition.rateGate.direction);
  const threshold = parseExactDecimal(
    clearing ? condition.rateGate.clear : condition.rateGate.enter,
  );
  return {
    qualifies: clearing ? compare(rate, threshold) <= 0 : compare(rate, threshold) > 0,
    rate,
  };
}
function observationQualifies(
  condition: ObservationThresholdCondition,
  fact: ObservationConditionFact,
  clearing: boolean,
): { qualifies: boolean; rate: Rational | null; rateGateMiss: boolean } {
  const value = fact.value!;
  const uncertainty = fact.uncertainty!;
  const threshold = parseExactDecimal(clearing ? condition.clear : condition.enter);
  const valueQualifies = clearing
    ? condition.direction === 'high'
      ? compare(add(value, uncertainty), threshold) <= 0
      : compare(sub(value, uncertainty), threshold) >= 0
    : condition.direction === 'high'
      ? compare(sub(value, uncertainty), threshold) > 0
      : compare(add(value, uncertainty), threshold) < 0;
  const rate = rateQualifies(condition, fact, clearing);
  return {
    qualifies: valueQualifies && rate.qualifies,
    rate: rate.rate,
    rateGateMiss: valueQualifies && !rate.qualifies,
  };
}
function allocationQualifies(
  condition: AllocationDeviationCondition,
  fact: AllocationConditionFact,
  clearing: boolean,
) {
  return clearing ? fact.condition === 'within' : fact.condition === condition.direction;
}
function candidateReached(candidate: Candidate, persistence: bigint): boolean {
  const end = candidate.facts.at(-1)!;
  return (
    candidate.facts.length >= 2 &&
    utcMicros(end.observedAt) - utcMicros(candidate.start) >= persistence
  );
}

/**
 * Exact, side-effect-free condition state machine. The caller persists state/evidence;
 * this function never creates alarms, incidents, notifications, or OT commands.
 */
export function evaluateAlarmCondition(
  condition: AlarmCondition,
  facts: readonly ConditionFact[],
  priorState: ConditionState = 'inactive',
): ConditionEvaluation {
  if (!conditionIsWellFormed(condition)) return deferred('invalid_fact', facts);
  if (!facts.length) return deferred('missing_fact', facts);
  let previous: bigint | null = null;
  for (const fact of facts) {
    let current: bigint;
    try {
      current = utcMicros(fact.observedAt);
    } catch {
      return deferred('invalid_fact', facts);
    }
    if (previous !== null && current <= previous)
      return deferred('duplicate_or_nonmonotonic', facts);
    previous = current;
    const reason = factReason(condition, fact);
    if (reason) return deferred(reason, facts);
  }

  let active = priorState === 'active' || priorState === 'pending_clear';
  let candidate: Candidate | null = null;
  let lastEvidence: ConditionEvidence = emptyEvidence(facts);
  let gapBroken = false;
  let lastRateGateMiss = false;
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index]!;
    if (
      index > 0 &&
      utcMicros(fact.observedAt) - utcMicros(facts[index - 1]!.observedAt) >
        condition.maxGapMicroseconds
    ) {
      candidate = null;
      gapBroken = true;
    }
    const result =
      condition.kind === 'observation_threshold'
        ? observationQualifies(condition, fact as ObservationConditionFact, active)
        : {
            qualifies: allocationQualifies(condition, fact as AllocationConditionFact, active),
            rate: null,
            rateGateMiss: false,
          };
    lastRateGateMiss = result.rateGateMiss;
    if (!result.qualifies) {
      candidate = null;
      continue;
    }
    if (candidate)
      candidate = {
        start: candidate.start,
        facts: [...candidate.facts, fact],
        rate: result.rate,
      };
    else candidate = { start: fact.observedAt, facts: [fact], rate: result.rate };
    const persistence = active
      ? condition.clearPersistenceMicroseconds
      : condition.enterPersistenceMicroseconds;
    if (candidateReached(candidate, persistence)) {
      lastEvidence = evidence(candidate, gapBroken);
      active = !active;
      candidate = null;
    }
  }
  const pendingEvidence = evidence(candidate, gapBroken);
  if (candidate) {
    return {
      state: active ? 'pending_clear' : 'pending_activation',
      reason: lastRateGateMiss ? 'rate_gate_not_met' : null,
      evidence: pendingEvidence,
    };
  }
  if (lastEvidence.qualifyingFactCount)
    return { state: active ? 'active' : 'inactive', reason: null, evidence: lastEvidence };
  return {
    state: active ? 'active' : 'inactive',
    reason: gapBroken ? 'gap_exceeded' : lastRateGateMiss ? 'rate_gate_not_met' : null,
    evidence: emptyEvidence(facts, gapBroken),
  };
}

/** Backward-compatible observation-only alias for callers that do not evaluate allocation conditions. */
export function evaluateThreshold(
  condition: ObservationThresholdCondition,
  facts: readonly ObservationConditionFact[],
  priorState: ConditionState = 'inactive',
) {
  return evaluateAlarmCondition(condition, facts, priorState);
}

export { rational, div };

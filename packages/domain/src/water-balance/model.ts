import { add, rational, sub, type Rational, utcMicros } from '../quantity-derivation/model.js';

export type BalanceComponentRole = 'incoming' | 'outgoing';
export type BalanceReferencePlane = 'upstream' | 'downstream';

export interface BalanceComponentInput {
  waterSectionId: string;
  role: BalanceComponentRole;
  referencePlane: BalanceReferencePlane;
  travelTimeMicroseconds: bigint;
  volume: Rational | null;
}

export interface BalanceAssumptionInput {
  intervalStart: string;
  intervalEnd: string;
  storageChangeM3: Rational;
  knownAdditionM3: Rational;
  knownRemovalM3: Rational;
}

export function shiftedBalanceInterval(
  intervalStart: string,
  intervalEnd: string,
  role: BalanceComponentRole,
  referencePlane: BalanceReferencePlane,
  travelTimeMicroseconds: bigint,
) {
  if (travelTimeMicroseconds < 0n) throw new Error('travel time must be nonnegative');
  // At a canonical junction, upstream incoming flow is observed before the
  // requested interval and downstream outgoing flow after it.  The two planes
  // adjacent to the junction require zero lag; the remaining two may be remote.
  const shift =
    (role === 'incoming' && referencePlane === 'upstream') ||
    (role === 'outgoing' && referencePlane === 'downstream')
      ? role === 'incoming'
        ? -travelTimeMicroseconds
        : travelTimeMicroseconds
      : 0n;
  return {
    startMicros: utcMicros(intervalStart) + shift,
    endMicros: utcMicros(intervalEnd) + shift,
  };
}

export function calculateWaterBalance(
  components: readonly BalanceComponentInput[],
  assumption: BalanceAssumptionInput,
):
  | { outcome: 'computed'; incomingM3: Rational; outgoingM3: Rational; residualM3: Rational }
  | { outcome: 'deferred'; reason: 'component_not_eligible' } {
  if (components.some((component) => component.volume === null))
    return { outcome: 'deferred', reason: 'component_not_eligible' };
  let incoming = rational(0n);
  let outgoing = rational(0n);
  for (const component of components) {
    if (component.role === 'incoming') incoming = add(incoming, component.volume!);
    else outgoing = add(outgoing, component.volume!);
  }
  // Positive residual is unaccounted excess; negative is an accounting deficit.
  return {
    outcome: 'computed',
    incomingM3: incoming,
    outgoingM3: outgoing,
    residualM3: sub(
      add(incoming, assumption.knownAdditionM3),
      add(add(outgoing, assumption.knownRemovalM3), assumption.storageChangeM3),
    ),
  };
}

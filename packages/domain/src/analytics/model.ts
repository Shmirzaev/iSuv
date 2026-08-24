import { add, rational, sub, type Rational } from '../quantity-derivation/model.js';

export type AnalyticsCondition = 'over' | 'within' | 'under' | 'unassessable';
export interface AnalyticsMember {
  condition: AnalyticsCondition;
  planned?: Rational | null;
  actual?: Rational | null;
}
export function analyticsExact(value: Rational) {
  return {
    numerator: value.numerator.toString(),
    denominator: value.denominator.toString(),
    unit: 'm3' as const,
  };
}
export function absolute(value: Rational): Rational {
  return {
    numerator: value.numerator < 0n ? -value.numerator : value.numerator,
    denominator: value.denominator,
  };
}
/** Only complete, directly measured P3 deviation members may enter volume totals. */
export function reconcileAnalyticsMembers(members: readonly AnalyticsMember[]) {
  let planned = rational(0n),
    actual = rational(0n),
    absoluteVariance = rational(0n);
  const counts = {
    total: members.length,
    assessed: 0,
    over: 0,
    within: 0,
    under: 0,
    unassessable: 0,
  };
  for (const member of members) {
    if (member.condition === 'unassessable' || !member.planned || !member.actual) {
      counts.unassessable++;
      continue;
    }
    counts.assessed++;
    if (member.condition === 'over') counts.over++;
    else if (member.condition === 'within') counts.within++;
    else counts.under++;
    planned = add(planned, member.planned);
    actual = add(actual, member.actual);
    absoluteVariance = add(absoluteVariance, absolute(sub(member.actual, member.planned)));
  }
  return { counts, planned, actual, signedVariance: sub(actual, planned), absoluteVariance };
}

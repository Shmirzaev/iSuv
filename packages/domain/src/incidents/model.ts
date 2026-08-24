export type IncidentStatus = 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'closed';
export type IncidentTransition = 'acknowledge' | 'investigate' | 'resolve' | 'close';
export function canTransitionIncident(
  status: IncidentStatus,
  transition: IncidentTransition,
  allAlarmsCleared: boolean,
): boolean {
  if (transition === 'acknowledge') return status === 'open';
  if (transition === 'investigate') return status === 'acknowledged';
  if (transition === 'resolve') return status === 'investigating' && allAlarmsCleared;
  return status === 'resolved' && allAlarmsCleared;
}
export type IncidentMetricState =
  | 'unconfigured'
  | 'acknowledgement_pending'
  | 'acknowledgement_overdue'
  | 'acknowledgement_met'
  | 'resolution_pending'
  | 'resolution_overdue'
  | 'resolution_met';
export function incidentTimestampMicroseconds(value: string): bigint {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!match)
    throw new RangeError('A UTC timestamp with at most microsecond precision is required.');
  const milliseconds = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(milliseconds)) throw new RangeError('The timestamp is invalid.');
  return BigInt(milliseconds) * 1000n + BigInt((match[2] ?? '').padEnd(6, '0'));
}
export function incidentMetric(
  kind: 'acknowledgement' | 'resolution',
  openedAtMicros: bigint,
  completedAtMicros: bigint | null,
  evaluatedAtMicros: bigint,
  targetMicros: bigint | null,
): { state: IncidentMetricState; elapsedMicroseconds: bigint } {
  const elapsed = (completedAtMicros ?? evaluatedAtMicros) - openedAtMicros;
  if (elapsed < 0n) throw new RangeError('Metric cutoff cannot precede incident creation.');
  if (targetMicros === null) return { state: 'unconfigured', elapsedMicroseconds: elapsed };
  if (completedAtMicros !== null)
    return {
      state:
        elapsed <= targetMicros
          ? (`${kind}_met` as IncidentMetricState)
          : (`${kind}_overdue` as IncidentMetricState),
      elapsedMicroseconds: elapsed,
    };
  return {
    state:
      elapsed > targetMicros
        ? (`${kind}_overdue` as IncidentMetricState)
        : (`${kind}_pending` as IncidentMetricState),
    elapsedMicroseconds: elapsed,
  };
}

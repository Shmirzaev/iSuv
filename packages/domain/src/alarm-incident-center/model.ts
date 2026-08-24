/** Presentation guard: an automatic clear never clears a human case or bad evidence. */
export function alarmIncidentAttention(item: {
  automaticState: 'active' | 'cleared';
  incidentStatus: 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'closed' | null;
  evidence: { assessment: 'assessable' | 'unassessable' | 'missing' | 'pending' | 'deferred' };
}): 'active' | 'human_open' | 'unassessable' | 'cleared' {
  if (item.evidence.assessment !== 'assessable') return 'unassessable';
  if (item.incidentStatus && item.incidentStatus !== 'closed') return 'human_open';
  return item.automaticState === 'active' ? 'active' : 'cleared';
}

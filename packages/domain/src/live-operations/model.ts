export type LiveAttention = 'attention' | 'unreliable' | 'no_data' | 'reported';
export function liveAttention(input: {
  dataState: 'reported' | 'unreliable' | 'no_data';
  connection: 'communicating' | 'offline' | 'unknown';
  fault: 'reported' | 'none' | 'unknown';
}): LiveAttention {
  if (input.fault === 'reported' || input.connection === 'offline') return 'attention';
  if (input.dataState === 'no_data') return 'no_data';
  if (
    input.dataState === 'unreliable' ||
    input.connection === 'unknown' ||
    input.fault === 'unknown'
  )
    return 'unreliable';
  return 'reported';
}
export function attentionPresentation(state: LiveAttention) {
  return (
    {
      attention: { label: 'Attention', icon: 'warning', value: 'Action required' },
      unreliable: { label: 'Unreliable', icon: 'warning', value: 'Data or health uncertain' },
      no_data: { label: 'No data', icon: 'minus-circle', value: 'No observation reported' },
      reported: { label: 'Reported', icon: 'check-circle', value: 'Synthetic scenario' },
    } as const
  )[state];
}

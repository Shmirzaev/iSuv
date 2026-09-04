import type { ReactNode } from 'react';

export type StatusChipTone = 'neutral' | 'information' | 'attention' | 'critical' | 'positive';

export function StatusChip({
  detail,
  icon,
  label,
  tone = 'neutral',
}: {
  detail?: string;
  icon?: ReactNode;
  label: string;
  tone?: StatusChipTone;
}) {
  return (
    <span
      aria-label={detail ? `${label}: ${detail}` : label}
      className={`status-chip status-chip--${tone}`}
      title={detail}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <span>{label}</span>
    </span>
  );
}

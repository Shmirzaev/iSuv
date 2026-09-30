import type { ReactNode } from 'react';
import { GlyphIcon } from './icons.js';

export type StatusChipTone = 'neutral' | 'information' | 'attention' | 'critical' | 'positive';

export function StatusChip({
  detail,
  icon,
  label,
  tone = 'neutral',
  hatch = false,
}: {
  detail?: string;
  icon?: ReactNode;
  label: string;
  tone?: StatusChipTone;
  hatch?: boolean;
}) {
  return (
    <span
      aria-label={detail ? `${label}: ${detail}` : label}
      className={`status-chip status-chip--${tone}`}
      title={detail}
      data-hatched={hatch || undefined}
    >
      <span aria-hidden="true">
        <GlyphIcon
          glyph={
            icon ??
            (tone === 'positive' ? '✓' : tone === 'attention' || tone === 'critical' ? '!' : '•')
          }
        />
      </span>
      <span>{label}</span>
    </span>
  );
}

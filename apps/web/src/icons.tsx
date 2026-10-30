import type { ReactNode } from 'react';

const paths = {
  dashboard: 'M2 2h5v5H2z M9 2h5v5H9z M2 9h5v5H2z M9 9h5v5H9z',
  operations: 'M1 8h3l2-5 3 10 2-5h4',
  map: 'M2 3l4-1 4 2 4-1v10l-4 1-4-2-4 1z M6 2v10 M10 4v10',
  alarms: 'M2 13L8 2l6 11z M8 6v3 M8 11v.1',
  analytics: 'M2 2v12h12 M5 10V7 M9 10V4 M13 10V2',
  reports: 'M3 2h7l3 3v9H3z M10 2v3h3 M5 8h6 M5 11h6',
  audit: 'M3 2h10v12H3z M5 5h6 M5 8h3 M5 11h6',
  project: 'M3 14V2h10l-2 3 2 3H3',
  roadmap: 'M2 11h4v3H2z M10 2h4v3h-4z M4 11V7h8V5',
  reported: 'M3 8l3 3 7-7',
  valid: 'M3 8l3 3 7-7',
  no_data: 'M2 2h12v12H2z M5 8h6',
  unreliable: 'M2 2h12v12H2z M8 5v4 M8 11v.1',
  fault: 'M2 2h12v12H2z M5 5l6 6 M11 5l-6 6',
  stale: 'M8 1.5a6.5 6.5 0 1 0 6.5 6.5 M8 4v4l3 2 M11 2h3v3',
  not_configured: 'M3 8h10',
  over: 'M8 13V3 M4 7l4-4 4 4',
  under: 'M8 3v10 M4 9l4 4 4-4',
  on_plan: 'M2 12h12 M3 6l3 3 6-6',
  communicating: 'M2 5h11 M10 2l3 3-3 3 M14 11H3 M6 8l-3 3 3 3',
  direction: 'M2 8h11 M10 4l4 4-4 4',
  information: 'M8 7v5 M8 4v.1 M2 2h12v12H2z',
  menu: 'M2 3h12 M2 8h12 M2 13h12',
  close: 'M3 3l10 10 M13 3L3 13',
  identity: 'M5 5a3 3 0 1 0 6 0 3 3 0 1 0-6 0 M2 14v-2l3-2h6l3 2v2',
  theme: 'M8 2a6 6 0 1 0 0 12V2 M8 2a6 6 0 0 1 0 12',
  fit_area: 'M2 6V2h4 M10 2h4v4 M14 10v4h-4 M6 14H2v-4 M5 8h6 M8 5v6',
  layers: 'M2 5l6-3 6 3-6 3z M2 8l6 3 6-3 M2 11l6 3 6-3',
  search: 'M10 10l4 4 M11 6a5 5 0 1 0-10 0 5 5 0 0 0 10 0',
  clear: 'M3 3l10 10 M13 3L3 13',
  synthetic: 'M8 2l6 6-6 6-6-6z M8 5v4 M8 11v.1',
} as const;

export type IconName = keyof typeof paths;

/** A single pen weight for navigation and status; meaning always lives in adjacent text. */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`register-icon${className ? ` ${className}` : ''}`}
      data-icon={name}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}

const glyphs: Record<string, IconName> = {
  '→': 'direction',
  ℹ: 'information',
  '‼': 'alarms',
  '⌁': 'map',
  '○': 'information',
  '⌕': 'audit',
  '■': 'reported',
  '↷': 'stale',
  '✓': 'reported',
  '✔': 'reported',
  '↔': 'communicating',
  '↑': 'over',
  '↓': 'under',
  '—': 'no_data',
  '⊘': 'no_data',
  '∅': 'no_data',
  '!': 'unreliable',
  '⚠': 'unreliable',
  '◷': 'stale',
  '◴': 'stale',
  '◌': 'stale',
  '⚙': 'not_configured',
  '?': 'not_configured',
  '−': 'not_configured',
  '-': 'not_configured',
  '•': 'information',
  '●': 'information',
  '◆': 'synthetic',
  '≈': 'operations',
  '◉': 'identity',
  '☰': 'menu',
  '×': 'close',
  '◐': 'theme',
  '☼': 'theme',
};

export function GlyphIcon({ glyph }: { glyph: ReactNode }) {
  return typeof glyph === 'string' ? <Icon name={glyphs[glyph] ?? 'information'} /> : <>{glyph}</>;
}

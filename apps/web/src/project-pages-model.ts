import type { ProjectPageWord } from '@isuv/i18n';

export type MeteringTier = 'A' | 'B' | 'C';
export interface MeteringPoint {
  id: string;
  kind: 'head' | 'outlet' | 'tail';
  number?: number;
  tier: MeteringTier;
}

export const meteringPoints: readonly MeteringPoint[] = [
  { id: 'head', kind: 'head', tier: 'A' },
  ...Array.from({ length: 17 }, (_, index): MeteringPoint => ({
    id: `outlet-${index + 1}`,
    kind: 'outlet',
    number: index + 1,
    tier: index < 6 ? 'B' : 'C',
  })),
  { id: 'tail', kind: 'tail', tier: 'B' },
];

export const projectFigures: readonly {
  value: number;
  unit?: ProjectPageWord;
  label: ProjectPageWord;
  note?: ProjectPageWord;
}[] = [
  { value: 11.1, unit: 'lengthUnit', label: 'lengthLabel', note: 'lengthChainage' },
  { value: 10, unit: 'capacityUnit', label: 'capacityLabel' },
  { value: 1980, unit: 'areaUnit', label: 'areaLabel' },
  { value: 25, label: 'farmsLabel' },
  { value: 17, label: 'outletsLabel' },
];

export const projectMilestones: readonly {
  date: ProjectPageWord;
  title: ProjectPageWord;
  status: ProjectPageWord;
  bullets: readonly ProjectPageWord[];
}[] = [
  {
    date: 'foundationDate',
    title: 'foundationTitle',
    status: 'statusDone',
    bullets: ['foundationBullet1', 'foundationBullet2', 'foundationBullet3', 'foundationBullet4'],
  },
  {
    date: 'installationDate',
    title: 'installationTitle',
    status: 'statusProgress',
    bullets: [
      'installationBullet1',
      'installationBullet2',
      'installationBullet3',
      'installationBullet4',
    ],
  },
  {
    date: 'testingDate',
    title: 'testingTitle',
    status: 'statusNext',
    bullets: ['testingBullet1', 'testingBullet2'],
  },
  {
    date: 'rolloutDate',
    title: 'rolloutTitle',
    status: 'statusPlanned',
    bullets: ['rolloutBullet1', 'rolloutBullet2'],
  },
];

export const pilotGates = [
  'gateCompleteness',
  'gateBalance',
  'gateAccuracy',
  'gateAlarms',
  'gateReport',
] as const;
export const workflowSteps = [
  'stepMeasure',
  'stepTransmit',
  'stepValidate',
  'stepCompare',
  'stepReport',
] as const;

import type { DashboardPeriod, ReportKind, ReportSnapshot, ReportSummary } from '@isuv/contracts';
import type { TranslationKey } from '@isuv/i18n';
import { formatPresentationTimestamp } from './format.js';

export const reportKinds: readonly ReportKind[] = [
  'daily_situation',
  'allocation_compliance',
  'water_balance',
  'device_availability',
  'incident',
  'executive_summary',
];

export const reportPeriods: readonly DashboardPeriod[] = [
  'today',
  'week',
  'month',
  'season',
  'year',
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ReportFilters {
  kind: ReportKind;
  period: DashboardPeriod;
  incidentId: string;
}

export const defaultReportFilters: ReportFilters = {
  kind: 'daily_situation',
  period: 'today',
  incidentId: '',
};

/** Only an immutable report id is shareable in the URL; generation filters stay explicit native controls. */
export function reportIdFromHash(hash: string): string | null {
  const [area, raw] = hash.replace(/^#/, '').split('?', 2);
  if (area !== 'reports') return null;
  const reportId = new URLSearchParams(raw ?? '').get('reportId');
  return reportId && uuid.test(reportId) ? reportId : null;
}

export function reportsHash(reportId: string | null): string {
  return reportId && uuid.test(reportId)
    ? `#reports?reportId=${encodeURIComponent(reportId)}`
    : '#reports';
}

export function reportsListPath(kind: ReportKind | null = null): string {
  const query = new URLSearchParams();
  if (kind) query.set('kind', kind);
  const text = query.toString();
  return `/api/v1/reports${text ? `?${text}` : ''}`;
}

export function reportPath(reportId: string): string {
  return `/api/v1/reports/${encodeURIComponent(reportId)}`;
}

export function reportExportPath(reportId: string): string {
  return `${reportPath(reportId)}/export`;
}

export function reportKindKey(kind: ReportKind): TranslationKey {
  return (
    {
      daily_situation: 'reportKindDailySituation',
      allocation_compliance: 'reportKindAllocationCompliance',
      water_balance: 'reportKindWaterBalance',
      device_availability: 'reportKindDeviceAvailability',
      incident: 'reportKindIncident',
      executive_summary: 'reportKindExecutiveSummary',
    } as const
  )[kind];
}

export function reportPeriodKey(period: DashboardPeriod): TranslationKey {
  return (
    {
      today: 'periodToday',
      week: 'periodWeek',
      month: 'periodMonth',
      season: 'periodSeason',
      year: 'periodYear',
    } as const
  )[period];
}

export function reportQualityKey(value: ReportSummary['qualityState']): TranslationKey {
  return (
    {
      assessed: 'reportQualityAssessed',
      unassessable: 'reportQualityUnassessable',
      deferred: 'reportQualityDeferred',
      unconfigured: 'reportQualityUnconfigured',
    } as const
  )[value];
}

export function reportQualityIcon(value: ReportSummary['qualityState']): string {
  return value === 'assessed'
    ? '✓'
    : value === 'deferred'
      ? '↷'
      : value === 'unconfigured'
        ? '⚙'
        : '⊘';
}

export function reportTimestamp(
  value: string,
  locale: string = 'en',
  timeZone: string = 'Asia/Tashkent',
): string {
  return formatPresentationTimestamp(locale as 'uz' | 'ru' | 'en', value, timeZone);
}

export function reportTemplateDescriptionKey(kind: ReportKind): TranslationKey {
  return (
    {
      daily_situation: 'reportsTemplateDailySituationDescription',
      allocation_compliance: 'reportsTemplateAllocationComplianceDescription',
      water_balance: 'reportsTemplateWaterBalanceDescription',
      device_availability: 'reportsTemplateDeviceAvailabilityDescription',
      incident: 'reportsTemplateIncidentDescription',
      executive_summary: 'reportsTemplateExecutiveSummaryDescription',
    } as const
  )[kind];
}

export function reportFileName(
  report: Pick<ReportSnapshot, 'kind' | 'version' | 'id'>,
  extension: string,
): string {
  return `isuv-${report.kind}-v${report.version}-${report.id}.${extension}`;
}

export interface ReportPrintTarget {
  readonly closed: boolean;
  readonly location: { assign(url: string): void };
}

/** Navigate an already-open preview, or the current tab when a popup blocker returned null. */
export function navigateReportPrint(
  preview: ReportPrintTarget | null,
  current: ReportPrintTarget,
  url: string,
): 'preview' | 'same-tab' {
  if (preview && !preview.closed) {
    preview.location.assign(url);
    return 'preview';
  }
  current.location.assign(url);
  return 'same-tab';
}

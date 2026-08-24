import type {
  AnalyticsFacet,
  AnalyticsQuery,
  AnalyticsResponse,
  DashboardPeriod,
} from '@isuv/contracts';
import type { TranslationKey } from '@isuv/i18n';

export const analyticsPeriods: readonly DashboardPeriod[] = [
  'today',
  'week',
  'month',
  'season',
  'year',
];
export type AnalyticsFilters = Pick<AnalyticsQuery, 'period' | 'facet' | 'facetId'>;
export const emptyAnalyticsFilters: AnalyticsFilters = { period: 'today' };

const facets = ['region', 'basin', 'waterway', 'section'] as const;
function isFacet(value: string | null): value is AnalyticsFacet {
  return value !== null && (facets as readonly string[]).includes(value);
}

/** Hash is the shareable UI state; server validation remains authoritative. */
export function analyticsFiltersFromHash(hash: string): AnalyticsFilters {
  const [area, raw] = hash.replace(/^#/, '').split('?', 2);
  if (area !== 'analytics') return emptyAnalyticsFilters;
  const query = new URLSearchParams(raw ?? '');
  const period = query.get('period');
  const facet = query.get('facet');
  const facetId = query.get('facetId');
  return {
    period: analyticsPeriods.includes(period as DashboardPeriod)
      ? (period as DashboardPeriod)
      : 'today',
    ...(isFacet(facet) && facetId ? { facet, facetId } : {}),
  };
}

export function analyticsHash(filters: AnalyticsFilters): string {
  const query = new URLSearchParams({ period: filters.period });
  if (filters.facet && filters.facetId) {
    query.set('facet', filters.facet);
    query.set('facetId', filters.facetId);
  }
  return `#analytics?${query.toString()}`;
}

export function analyticsPath(filters: AnalyticsFilters): string {
  const query = new URLSearchParams({ period: filters.period });
  if (filters.facet && filters.facetId) {
    query.set('facet', filters.facet);
    query.set('facetId', filters.facetId);
  }
  return `/api/v1/analytics?${query.toString()}`;
}

export function analyticsPeriodKey(period: DashboardPeriod): TranslationKey {
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

export function analyticsFacetKey(facet: AnalyticsFacet): TranslationKey {
  return (
    {
      region: 'analyticsFacetRegion',
      basin: 'analyticsFacetBasin',
      waterway: 'analyticsFacetWaterway',
      section: 'analyticsFacetSection',
    } as const
  )[facet];
}

export function analyticsConditionPresentation(
  value: AnalyticsResponse['delivery']['groups'][number]['condition'],
): { icon: string; label: TranslationKey } {
  return (
    {
      over: { icon: '↑', label: 'analyticsOver' },
      within: { icon: '✓', label: 'analyticsWithin' },
      under: { icon: '↓', label: 'analyticsUnder' },
      unassessable: { icon: '⊘', label: 'analyticsUnassessable' },
    } as const
  )[value];
}

export function analyticsMethodKey(
  value: AnalyticsResponse['delivery']['groups'][number]['method'],
): TranslationKey {
  return value === 'direct_discharge'
    ? 'analyticsDirectDischarge'
    : value === 'stage_rating_curve'
      ? 'analyticsStageRating'
      : value === 'accumulated_volume_delta'
        ? 'analyticsCounterDelta'
        : 'analyticsNotConfigured';
}

export function formatAnalyticsTimestamp(value: string): string {
  return value.replace('T', ' ').replace('Z', ' UTC');
}
export function formatMicros(value: string): string {
  return `${value} µs`;
}

export function analyticsBalanceDeferKey(
  value: AnalyticsResponse['balance']['deferReason'],
): TranslationKey | null {
  return value === 'no_approved_water_balance_model'
    ? 'analyticsDeferNoModel'
    : value === 'missing_exact_assumption'
      ? 'analyticsDeferMissingAssumption'
      : value === 'component_not_eligible'
        ? 'analyticsDeferIneligibleComponent'
        : null;
}

export function analyticsBalanceRoleKey(
  value: AnalyticsResponse['balance']['components'][number]['role'],
): TranslationKey {
  return value === 'incoming' ? 'analyticsIncoming' : 'analyticsOutgoing';
}

export function analyticsAvailabilityReasonKey(
  value: AnalyticsResponse['availability']['reason'],
): TranslationKey {
  return value === 'cadence_unconfigured'
    ? 'analyticsCadenceUnconfigured'
    : 'analyticsUnassessable';
}

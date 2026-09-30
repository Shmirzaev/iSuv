import { useEffect, useRef, useState } from 'react';
import { analyticsResponseSchema, type AnalyticsResponse } from '@isuv/contracts';
import { translate, type Locale, type TranslationKey } from '@isuv/i18n';
import { formatRationalFixed } from './dashboard-model.js';
import { GroupedBarChart, SignedBarChart, StackedBarChart, type ChartDatum } from './charts.js';
import {
  analyticsConditionPresentation,
  analyticsBalanceDeferKey,
  analyticsBalanceRoleKey,
  analyticsAvailabilityReasonKey,
  analyticsFacetKey,
  analyticsFiltersFromHash,
  analyticsHash,
  analyticsMethodKey,
  analyticsPath,
  analyticsPeriodKey,
  analyticsPeriods,
  formatAnalyticsTimestamp,
  formatMicros,
  type AnalyticsFilters,
} from './analytics-model.js';
import { StatusChip } from './status-chip.js';
import { formatNumber, presentationTimeZone } from './format.js';
import { GlyphIcon } from './icons.js';

type WorkspaceState =
  'loading' | 'ready' | 'empty' | 'unauthenticated' | 'forbidden' | 'unavailable' | 'degraded';
const t = (locale: Locale, key: TranslationKey) => translate(locale, key);

function utcOffset(at: string): string {
  const offset = new Intl.DateTimeFormat('en', {
    timeZone: presentationTimeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(new Date(at))
    .find((part) => part.type === 'timeZoneName')?.value;
  return (offset ?? 'UTC').replace('GMT', 'UTC');
}

function SelectedWindow({ locale, response }: { locale: Locale; response: AnalyticsResponse }) {
  const { start, end } = response.windows.selected;
  return (
    <p className="analytics-chart-context">
      <strong>{t(locale, 'analyticsWindow')}:</strong> {formatAnalyticsTimestamp(start, locale)} —{' '}
      {formatAnalyticsTimestamp(end, locale)}; {response.presentationTimeZone} {utcOffset(end)}
    </p>
  );
}

function M3({
  locale,
  value,
}: {
  locale: Locale;
  value: { numerator: string; denominator: string } | null;
}) {
  return value ? (
    <data
      aria-label={`${value.numerator}/${value.denominator} m³`}
      title={`${value.numerator}/${value.denominator} m³`}
      value={`${value.numerator}/${value.denominator}`}
    >
      {formatRationalFixed(value, 0, locale)} m³
    </data>
  ) : (
    <span className="metric-unavailable analytics-unavailable" title={t(locale, 'notAvailable')}>
      <GlyphIcon glyph="-" /> {t(locale, 'notAvailable')}
    </span>
  );
}

function chartNumber(value: { numerator: string; denominator: string } | null): number | null {
  if (!value) return null;
  const numeric = Number(value.numerator) / Number(value.denominator);
  return Number.isFinite(numeric) ? numeric : null;
}

function volumeChartDatum(
  id: string,
  label: string,
  values: readonly {
    id: string;
    label: string;
    value: { numerator: string; denominator: string } | null;
  }[],
  locale: Locale,
): ChartDatum {
  return {
    id,
    label,
    series: values.map((series) => ({
      id: series.id,
      label: series.label,
      value: chartNumber(series.value),
      valueText: <M3 locale={locale} value={series.value} />,
    })),
  };
}

function Notice({
  locale,
  state,
  retry,
}: {
  locale: Locale;
  state: Exclude<WorkspaceState, 'ready' | 'empty'>;
  retry: () => void;
}) {
  const values: Record<
    Exclude<WorkspaceState, 'ready' | 'empty'>,
    [string, TranslationKey, TranslationKey, string]
  > = {
    loading: ['◌', 'analyticsLoading', 'analyticsLoadingDetail', 'information'],
    unauthenticated: ['⊘', 'analyticsSignIn', 'analyticsSignInDetail', 'warning'],
    forbidden: ['⊘', 'analyticsSignIn', 'analyticsSignInDetail', 'warning'],
    unavailable: ['!', 'analyticsUnavailable', 'analyticsUnavailableDetail', 'unavailable'],
    degraded: ['!', 'analyticsDegraded', 'analyticsDegradedDetail', 'warning'],
  };
  const [icon, title, detail, tone] = values[state];
  return (
    <section className={`status-notice status-notice--${tone}`} aria-live="polite">
      <span className="status-notice__icon" aria-hidden="true">
        <GlyphIcon glyph={icon} />
      </span>
      <div>
        <h2>{t(locale, title)}</h2>
        <p>{t(locale, detail)}</p>
        {state === 'unavailable' || state === 'degraded' ? (
          <button className="action-button" type="button" onClick={retry}>
            {t(locale, 'analyticsRetry')}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Status({ locale, icon, label }: { locale: Locale; icon: string; label: TranslationKey }) {
  const tone =
    label === 'analyticsAssessed' ||
    label === 'analyticsWithin' ||
    label === 'analyticsBalanceComputed'
      ? 'positive'
      : label === 'analyticsOver' ||
          label === 'analyticsUnder' ||
          label === 'analyticsUnassessable' ||
          label === 'analyticsNotConfigured' ||
          label === 'analyticsBalanceDeferred' ||
          label === 'analyticsCadenceUnconfigured'
        ? 'attention'
        : 'neutral';
  return (
    <StatusChip
      hatch={label === 'analyticsUnassessable'}
      icon={<GlyphIcon glyph={icon} />}
      label={t(locale, label)}
      tone={tone}
    />
  );
}

function Filters({
  locale,
  filters,
  response,
  onChange,
}: {
  locale: Locale;
  filters: AnalyticsFilters;
  response: AnalyticsResponse;
  onChange: (next: AnalyticsFilters) => void;
}) {
  return (
    <form className="analytics-filters" onSubmit={(event) => event.preventDefault()}>
      <fieldset>
        <legend>{t(locale, 'analyticsFilters')}</legend>
        <div className="analytics-filters__grid">
          <label htmlFor="analytics-period">
            {t(locale, 'period')}
            <select
              id="analytics-period"
              value={filters.period}
              onChange={(e) => onChange({ period: e.target.value as AnalyticsFilters['period'] })}
            >
              {analyticsPeriods.map((period) => (
                <option key={period} value={period}>
                  {t(locale, analyticsPeriodKey(period))}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="analytics-facet">
            {t(locale, 'analyticsFacet')}
            <select
              id="analytics-facet"
              value={filters.facet && filters.facetId ? `${filters.facet}:${filters.facetId}` : ''}
              onChange={(e) => {
                const matched = response.scope.allowedFacets.find(
                  (item) => `${item.kind}:${item.id}` === e.target.value,
                );
                onChange(
                  matched
                    ? { ...filters, facet: matched.kind, facetId: matched.id }
                    : { period: filters.period },
                );
              }}
            >
              <option value="">{t(locale, 'analyticsAllFacets')}</option>
              {response.scope.allowedFacets.map((item) => (
                <option
                  key={`${item.kind}:${item.id}`}
                  value={`${item.kind}:${item.id}`}
                >{`${t(locale, analyticsFacetKey(item.kind))}: ${item.label}`}</option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>
    </form>
  );
}

function Metadata({ locale, response }: { locale: Locale; response: AnalyticsResponse }) {
  return (
    <>
      <header className="analytics-intro analytics-title-block">
        <div>
          <h1 id="analytics-heading">{t(locale, 'analyticsHeading')}</h1>
          <p>{t(locale, 'analyticsDetail')}</p>
          <p>
            <strong>{t(locale, 'analyticsNoForecast')}</strong>
          </p>
          <p>
            <strong>{t(locale, 'analyticsOfficialIneligible')}</strong>
          </p>
        </div>
        <details className="workspace-provenance">
          <summary>{t(locale, 'analyticsProvenanceDetails')}</summary>
          <dl>
            <div>
              <dt>{t(locale, 'referenceAt')}</dt>
              <dd>
                <time dateTime={response.referenceAt} title={response.referenceAt}>
                  {formatAnalyticsTimestamp(response.referenceAt, locale)}
                </time>
              </dd>
            </div>
            <div>
              <dt>{t(locale, 'knownAt')}</dt>
              <dd>
                <time dateTime={response.knownAt} title={response.knownAt}>
                  {formatAnalyticsTimestamp(response.knownAt, locale)}
                </time>
              </dd>
            </div>
            <div>
              <dt>{t(locale, 'presentationTimeZone')}</dt>
              <dd>{response.presentationTimeZone}</dd>
            </div>
            <div>
              <dt>{t(locale, 'scenarioVersion')}</dt>
              <dd>{response.scenario.version}</dd>
            </div>
            <div>
              <dt>{t(locale, 'analyticsMethodVersion')}</dt>
              <dd>{response.scenario.method}</dd>
            </div>
            <div className="analytics-intro__wide">
              <dt>{t(locale, 'provenance')}</dt>
              <dd>{response.scenario.provenance}</dd>
            </div>
          </dl>
          <dl className="analytics-windows">
            <div>
              <dt>{t(locale, 'analyticsWindow')}</dt>
              <dd>
                {`${formatAnalyticsTimestamp(response.windows.selected.start, locale)} — ${formatAnalyticsTimestamp(response.windows.selected.end, locale)}`}
              </dd>
            </div>
            <div>
              <dt>{t(locale, 'analyticsPriorWindow')}</dt>
              <dd>
                {`${formatAnalyticsTimestamp(response.windows.prior.start, locale)} — ${formatAnalyticsTimestamp(response.windows.prior.end, locale)}`}
              </dd>
            </div>
          </dl>
        </details>
      </header>
      <dl aria-hidden="true" className="analytics-windows" hidden>
        <div>
          <dt>{t(locale, 'analyticsWindow')}</dt>
          <dd>{`${formatAnalyticsTimestamp(response.windows.selected.start, locale)} — ${formatAnalyticsTimestamp(response.windows.selected.end, locale)}`}</dd>
        </div>
        <div>
          <dt>{t(locale, 'analyticsPriorWindow')}</dt>
          <dd>{`${formatAnalyticsTimestamp(response.windows.prior.start, locale)} — ${formatAnalyticsTimestamp(response.windows.prior.end, locale)}`}</dd>
        </div>
      </dl>
    </>
  );
}

function Delivery({ locale, response }: { locale: Locale; response: AnalyticsResponse }) {
  const d = response.delivery;
  const chartData = d.groups.map((group) =>
    volumeChartDatum(
      group.sectionId,
      group.sectionName,
      [
        { id: 'planned', label: t(locale, 'analyticsChartLegendPlanned'), value: group.plannedM3 },
        { id: 'actual', label: t(locale, 'analyticsChartLegendActual'), value: group.actualM3 },
      ],
      locale,
    ),
  );
  const state =
    d.state === 'assessed'
      ? { icon: '✓', label: 'analyticsAssessed' as const }
      : d.state === 'unconfigured'
        ? { icon: '⚙', label: 'analyticsNotConfigured' as const }
        : { icon: '⊘', label: 'analyticsUnassessable' as const };
  return (
    <section className="analytics-section" aria-labelledby="analytics-delivery">
      <h2 id="analytics-delivery">{t(locale, 'analyticsDelivery')}</h2>
      <p>{t(locale, 'analyticsDeliveryDetail')}</p>
      <Status locale={locale} {...state} />
      <p className="supporting-text">{d.exclusionNote}</p>
      <dl className="analytics-measures">
        <div>
          <dt>{t(locale, 'analyticsPlanned')}</dt>
          <dd>
            <M3 locale={locale} value={d.plannedM3} />
          </dd>
        </div>
        <div>
          <dt>{t(locale, 'analyticsActual')}</dt>
          <dd>
            <M3 locale={locale} value={d.actualM3} />
          </dd>
        </div>
        <div>
          <dt>{t(locale, 'analyticsSignedVariance')}</dt>
          <dd>
            <M3 locale={locale} value={d.signedVarianceM3} />
          </dd>
        </div>
        <div>
          <dt>{t(locale, 'analyticsAbsoluteVariance')}</dt>
          <dd>
            <M3 locale={locale} value={d.absoluteVarianceM3} />
          </dd>
        </div>
      </dl>
      {chartData.length ? (
        <div className="analytics-chart-panel">
          <SelectedWindow locale={locale} response={response} />
          <GroupedBarChart
            ariaLabel={`${t(locale, 'analyticsChartsSummary')}: ${t(locale, 'analyticsChartPlannedActual')}`}
            axisUnit="m³"
            caption={t(locale, 'analyticsChartPlannedActual')}
            data={chartData}
            unavailableLabel={t(locale, 'analyticsUnassessable')}
          />
        </div>
      ) : null}
      <p>{`${t(locale, 'analyticsAssessed')}: ${formatNumber(locale, d.memberCounts.assessed)}/${formatNumber(locale, d.memberCounts.total)}; ${t(locale, 'analyticsUnassessable')}: ${formatNumber(locale, d.memberCounts.unassessable)}; ${t(locale, 'analyticsOver')}: ${formatNumber(locale, d.memberCounts.over)}; ${t(locale, 'analyticsWithin')}: ${formatNumber(locale, d.memberCounts.within)}; ${t(locale, 'analyticsUnder')}: ${formatNumber(locale, d.memberCounts.under)}`}</p>
      <p>
        {`${t(locale, 'analyticsGroups')}: ${formatNumber(locale, d.population.returned)}/${formatNumber(locale, d.population.defined)}. `}
        {!d.population.complete ? `⊘ ${t(locale, 'analyticsUnassessable')}` : null}
      </p>
      {d.groups.length ? (
        <div className="table-scroll analytics-register-scroll">
          <table className="analytics-register">
            <caption>{t(locale, 'analyticsGroups')}</caption>
            <thead>
              <tr>
                <th scope="col">{t(locale, 'analyticsSection')}</th>
                <th scope="col">{t(locale, 'analyticsCondition')}</th>
                <th scope="col">{t(locale, 'analyticsPlanned')}</th>
                <th scope="col">{t(locale, 'analyticsActual')}</th>
                <th scope="col">{t(locale, 'analyticsSignedVariance')}</th>
                <th scope="col">{t(locale, 'analyticsMethod')}</th>
                <th scope="col">{t(locale, 'openMap')}</th>
                <th scope="col">{t(locale, 'openLiveOperations')}</th>
              </tr>
            </thead>
            <tbody>
              {d.groups.map((group) => {
                const present = analyticsConditionPresentation(group.condition);
                return (
                  <tr key={group.sectionId}>
                    <th scope="row">{group.sectionName}</th>
                    <td data-label={t(locale, 'analyticsCondition')}>
                      <Status locale={locale} {...present} />
                      {group.reason ? <small>{group.reason}</small> : null}
                    </td>
                    <td
                      className="analytics-register__number"
                      data-label={t(locale, 'analyticsPlanned')}
                    >
                      <M3 locale={locale} value={group.plannedM3} />
                    </td>
                    <td
                      className="analytics-register__number"
                      data-label={t(locale, 'analyticsActual')}
                    >
                      <M3 locale={locale} value={group.actualM3} />
                    </td>
                    <td
                      className="analytics-register__number"
                      data-label={t(locale, 'analyticsSignedVariance')}
                    >
                      <M3 locale={locale} value={group.signedVarianceM3} />
                    </td>
                    <td data-label={t(locale, 'analyticsMethod')}>
                      {t(locale, analyticsMethodKey(group.method))}
                    </td>
                    <td data-label={t(locale, 'openMap')}>
                      {group.mapTarget ? <a href={group.mapTarget}>{t(locale, 'openMap')}</a> : '—'}
                    </td>
                    <td data-label={t(locale, 'openLiveOperations')}>
                      {group.liveTarget ? (
                        <a href={group.liveTarget}>{t(locale, 'openLiveOperations')}</a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="metric-unavailable">{t(locale, 'analyticsNoGroups')}</p>
      )}
    </section>
  );
}

function Matrix({ locale, response }: { locale: Locale; response: AnalyticsResponse }) {
  const rows = [
    ['over', 'analyticsOver'],
    ['within', 'analyticsWithin'],
    ['under', 'analyticsUnder'],
  ] as const;
  const chartData = response.delivery.groups.map((group) =>
    volumeChartDatum(
      group.sectionId,
      group.sectionName,
      [
        {
          id: 'signed-variance',
          label: t(locale, 'analyticsSignedVariance'),
          value: group.signedVarianceM3,
        },
      ],
      locale,
    ),
  );
  const allVariancesZero =
    chartData.length > 0 &&
    chartData.every((datum) =>
      datum.series.every((series) => series.value !== null && series.value === 0),
    );
  return (
    <section className="analytics-section" aria-labelledby="analytics-matrix">
      <h2 id="analytics-matrix">{t(locale, 'analyticsMatrix')}</h2>
      <p>{t(locale, 'analyticsMatrixDetail')}</p>
      {chartData.length && allVariancesZero ? (
        <p className="analytics-zero-variance" role="note">
          {t(locale, 'analyticsAllVariancesZero')}
        </p>
      ) : chartData.length ? (
        <section aria-labelledby="analytics-variance-chart" className="analytics-chart-panel">
          <h3 id="analytics-variance-chart">{t(locale, 'analyticsChartSignedVariance')}</h3>
          <SelectedWindow locale={locale} response={response} />
          <SignedBarChart
            ariaLabel={`${t(locale, 'analyticsChartsSummary')}: ${t(locale, 'analyticsChartSignedVariance')}`}
            axisUnit="m³"
            caption={t(locale, 'analyticsChartSignedVariance')}
            data={chartData}
            unavailableLabel={t(locale, 'analyticsUnassessable')}
          />
        </section>
      ) : null}
      <div className="table-scroll analytics-register-scroll">
        <table className="analytics-register">
          <caption>{t(locale, 'analyticsMatrix')}</caption>
          <thead>
            <tr>
              <th scope="col">{t(locale, 'analyticsCondition')}</th>
              <th scope="col">{t(locale, 'analyticsCount')}</th>
              <th scope="col">{t(locale, 'analyticsPlanned')}</th>
              <th scope="col">{t(locale, 'analyticsActual')}</th>
              <th scope="col">{t(locale, 'analyticsAbsoluteVariance')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([kind, label]) => {
              const row = response.deviationMatrix[kind];
              return (
                <tr key={kind}>
                  <th scope="row">
                    <Status
                      locale={locale}
                      icon={analyticsConditionPresentation(kind).icon}
                      label={label}
                    />
                  </th>
                  <td
                    className="analytics-register__number"
                    data-label={t(locale, 'analyticsCount')}
                  >
                    {formatNumber(locale, row.count)}
                  </td>
                  <td
                    className="analytics-register__number"
                    data-label={t(locale, 'analyticsPlanned')}
                  >
                    <M3 locale={locale} value={row.plannedM3} />
                  </td>
                  <td
                    className="analytics-register__number"
                    data-label={t(locale, 'analyticsActual')}
                  >
                    <M3 locale={locale} value={row.actualM3} />
                  </td>
                  <td
                    className="analytics-register__number"
                    data-label={t(locale, 'analyticsAbsoluteVariance')}
                  >
                    <M3 locale={locale} value={row.absoluteVarianceM3} />
                  </td>
                </tr>
              );
            })}
            <tr>
              <th scope="row">
                <Status locale={locale} {...analyticsConditionPresentation('unassessable')} />
              </th>
              <td colSpan={4} data-label={t(locale, 'analyticsCount')}>
                {formatNumber(locale, response.deviationMatrix.unassessable.count)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Balance({ locale, response }: { locale: Locale; response: AnalyticsResponse }) {
  const b = response.balance;
  const computed = b.outcome === 'computed';
  const rows: readonly [TranslationKey, typeof b.incomingM3][] = [
    ['analyticsIncoming', b.incomingM3],
    ['analyticsAddition', b.knownAdditionM3],
    ['analyticsOutgoing', b.outgoingM3],
    ['analyticsRemoval', b.knownRemovalM3],
    ['analyticsStorage', b.storageChangeM3],
    ['analyticsResidual', b.residualM3],
  ];
  return (
    <section className="analytics-section" aria-labelledby="analytics-balance">
      <h2 id="analytics-balance">{t(locale, 'analyticsBalance')}</h2>
      <p>{t(locale, 'analyticsBalanceDetail')}</p>
      <Status
        locale={locale}
        icon={computed ? '✓' : '↷'}
        label={computed ? 'analyticsBalanceComputed' : 'analyticsBalanceDeferred'}
      />
      {b.deferReason ? (
        <p className="metric-card__reason">
          {t(locale, analyticsBalanceDeferKey(b.deferReason) ?? 'analyticsUnassessable')}
        </p>
      ) : null}
      <dl className="analytics-measures analytics-balance-terms">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{t(locale, label)}</dt>
            <dd>
              <M3 locale={locale} value={value} />
            </dd>
          </div>
        ))}
      </dl>
      <p>
        <strong>{t(locale, 'provenance')}:</strong> {b.provenance}
      </p>
      <p>
        <strong>{t(locale, 'analyticsMethodVersion')}:</strong>{' '}
        {b.versionId ?? t(locale, 'analyticsNotConfigured')}
      </p>
      {b.components.length ? (
        <div className="table-scroll analytics-register-scroll">
          <table className="analytics-register">
            <caption>{t(locale, 'analyticsSourceIntervals')}</caption>
            <thead>
              <tr>
                <th scope="col">{t(locale, 'analyticsSection')}</th>
                <th scope="col">{t(locale, 'analyticsMethod')}</th>
                <th scope="col">{t(locale, 'analyticsTravelTime')}</th>
                <th scope="col">{t(locale, 'analyticsSourceIntervals')}</th>
              </tr>
            </thead>
            <tbody>
              {b.components.map((component) => (
                <tr key={`${component.stationId}:${component.role}`}>
                  <th scope="row">{t(locale, analyticsBalanceRoleKey(component.role))}</th>
                  <td data-label={t(locale, 'analyticsMethod')}>
                    {t(locale, analyticsMethodKey(component.method))}
                  </td>
                  <td
                    className="analytics-register__number"
                    data-label={t(locale, 'analyticsTravelTime')}
                  >
                    {formatMicros(component.travelTimeMicroseconds, locale)}
                  </td>
                  <td>{`${formatAnalyticsTimestamp(component.sourceInterval.start, locale)} — ${formatAnalyticsTimestamp(component.sourceInterval.end, locale)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function Coverage({ locale, response }: { locale: Locale; response: AnalyticsResponse }) {
  const q = response.qualityCoverage;
  const a = response.availability;
  const availabilityRows = [
    {
      label: t(locale, 'analyticsCommunicating'),
      count: a.communicating,
      glyph: '✓',
      abnormal: false,
    },
    { label: t(locale, 'analyticsOffline'), count: a.offline, glyph: '!', abnormal: true },
    {
      label: t(locale, 'analyticsUnknownAvailability'),
      count: a.unknown,
      glyph: '⊘',
      abnormal: true,
    },
  ];
  const qualityChartData: readonly ChartDatum[] = [
    {
      id: 'quality-coverage',
      label: t(locale, 'analyticsQuality'),
      series: [
        {
          id: 'valid',
          label: t(locale, 'analyticsCompleteValid'),
          value: q.completeValid,
          valueText: formatNumber(locale, q.completeValid),
        },
        {
          id: 'estimated',
          label: t(locale, 'analyticsEstimatedExcluded'),
          value: q.estimatedExcluded,
          valueText: formatNumber(locale, q.estimatedExcluded),
        },
        {
          id: 'unreliable',
          label: t(locale, 'analyticsUnreliable'),
          value: q.unreliable,
          valueText: formatNumber(locale, q.unreliable),
        },
        {
          id: 'no-data',
          label: t(locale, 'analyticsNoData'),
          value: q.noData,
          valueText: formatNumber(locale, q.noData),
        },
        {
          id: 'unconfigured',
          label: t(locale, 'analyticsNotConfigured'),
          value: q.unconfigured,
          valueText: formatNumber(locale, q.unconfigured),
        },
      ],
    },
  ];
  return (
    <section className="analytics-coverage" aria-label={t(locale, 'analyticsQuality')}>
      <article className="analytics-section">
        <h2>{t(locale, 'analyticsQuality')}</h2>
        <p>{t(locale, 'analyticsQualityDetail')}</p>
        <div className="analytics-chart-panel">
          <SelectedWindow locale={locale} response={response} />
          <StackedBarChart
            ariaLabel={`${t(locale, 'analyticsChartsSummary')}: ${t(locale, 'analyticsChartQualityCoverage')}`}
            axisUnit={t(locale, 'analyticsCount')}
            caption={t(locale, 'analyticsChartQualityCoverage')}
            data={qualityChartData}
          />
        </div>
        <div className="table-scroll analytics-register-scroll">
          <table className="analytics-register">
            <caption>{t(locale, 'analyticsChartQualityCoverage')}</caption>
            <thead>
              <tr>
                <th scope="col">{t(locale, 'analyticsCondition')}</th>
                <th scope="col">{t(locale, 'analyticsCount')}</th>
              </tr>
            </thead>
            <tbody>
              {qualityChartData[0]!.series.map((series) => (
                <tr
                  className={
                    series.id === 'unreliable' || series.id === 'no-data'
                      ? 'analytics-register__abnormal'
                      : undefined
                  }
                  key={series.id}
                >
                  <th scope="row">
                    <GlyphIcon
                      glyph={series.id === 'valid' ? '✓' : series.id === 'no-data' ? '⊘' : '!'}
                    />{' '}
                    {series.label}
                  </th>
                  <td
                    className="analytics-register__number"
                    data-label={t(locale, 'analyticsCount')}
                  >
                    {series.valueText}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>{`${t(locale, 'analyticsCount')}: ${formatNumber(locale, q.denominator)}; ${t(locale, 'analyticsCompleteValid')}: ${formatNumber(locale, q.completeValid)}; ${t(locale, 'analyticsEstimatedExcluded')}: ${formatNumber(locale, q.estimatedExcluded)}; ${t(locale, 'analyticsUnreliable')}: ${formatNumber(locale, q.unreliable)}; ${t(locale, 'analyticsNoData')}: ${formatNumber(locale, q.noData)}; ${t(locale, 'analyticsNotConfigured')}: ${formatNumber(locale, q.unconfigured)}`}</p>
        <Status
          locale={locale}
          icon={q.state === 'assessed' ? '✓' : '⊘'}
          label={
            q.state === 'assessed'
              ? 'analyticsAssessed'
              : q.state === 'unconfigured'
                ? 'analyticsNotConfigured'
                : 'analyticsUnassessable'
          }
        />
        <p>
          <strong>{t(locale, 'provenance')}:</strong> {q.provenance.label}
        </p>
      </article>
      <article className="analytics-section">
        <h2>{t(locale, 'analyticsAvailability')}</h2>
        <p>{t(locale, 'analyticsAvailabilityDetail')}</p>
        <p>{`${t(locale, 'analyticsCount')}: ${formatNumber(locale, a.denominator)}; ${t(locale, 'analyticsCommunicating')}: ${formatNumber(locale, a.communicating)}; ${t(locale, 'analyticsOffline')}: ${formatNumber(locale, a.offline)}; ${t(locale, 'analyticsUnknownAvailability')}: ${formatNumber(locale, a.unknown)}`}</p>
        <div className="table-scroll analytics-register-scroll">
          <table className="analytics-register">
            <caption>{t(locale, 'analyticsAvailability')}</caption>
            <thead>
              <tr>
                <th scope="col">{t(locale, 'analyticsCondition')}</th>
                <th scope="col">{t(locale, 'analyticsCount')}</th>
              </tr>
            </thead>
            <tbody>
              {availabilityRows.map((row) => (
                <tr
                  className={row.abnormal ? 'analytics-register__abnormal' : undefined}
                  key={row.label}
                >
                  <th scope="row">
                    <GlyphIcon glyph={row.glyph} /> {row.label}
                  </th>
                  <td
                    className="analytics-register__number"
                    data-label={t(locale, 'analyticsCount')}
                  >
                    {formatNumber(locale, row.count)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Status locale={locale} icon="⚙" label="analyticsCadenceUnconfigured" />
        <p className="metric-card__reason">{t(locale, analyticsAvailabilityReasonKey(a.reason))}</p>
        <p>
          <strong>{t(locale, 'provenance')}:</strong> {a.provenance.label}
        </p>
      </article>
    </section>
  );
}

export function AnalyticsWorkspace({
  locale,
  access,
}: {
  locale: Locale;
  access: 'loading' | 'ready' | 'unauthenticated' | 'unavailable';
}) {
  const [filters, setFilters] = useState<AnalyticsFilters>(() =>
    analyticsFiltersFromHash(typeof window === 'undefined' ? '' : window.location.hash),
  );
  const [response, setResponse] = useState<AnalyticsResponse | null>(null);
  const [state, setState] = useState<WorkspaceState>('loading');
  const [retry, setRetry] = useState(0);
  const returnFocus = useRef<string | null>(null);
  useEffect(() => {
    const onHash = () => setFilters(analyticsFiltersFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (access === 'loading') {
      setState('loading');
      return;
    }
    if (access !== 'ready') {
      setState(access === 'unauthenticated' ? 'unauthenticated' : 'unavailable');
      return;
    }
    const controller = new AbortController();
    setState('loading');
    void fetch(analyticsPath(filters), { signal: controller.signal })
      .then(async (result) => {
        const body: unknown = await result.json().catch(() => null);
        if (result.ok) {
          const parsed = analyticsResponseSchema.safeParse(body);
          if (parsed.success) {
            setResponse(parsed.data);
            setState(parsed.data.delivery.groups.length ? 'ready' : 'empty');
          } else setState('degraded');
        } else
          setState(
            result.status === 401
              ? 'unauthenticated'
              : result.status === 403 || result.status === 404
                ? 'forbidden'
                : 'unavailable',
          );
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setState('unavailable');
      });
    return () => controller.abort();
  }, [access, filters, retry]);
  useEffect(() => {
    if ((state !== 'ready' && state !== 'empty') || !returnFocus.current) return;
    const target = returnFocus.current;
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(target);
      if (element) element.focus();
      returnFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [state]);
  const change = (next: AnalyticsFilters) => {
    const active = typeof document === 'undefined' ? null : document.activeElement;
    returnFocus.current = active instanceof HTMLElement && active.id ? active.id : null;
    if (typeof window !== 'undefined') window.location.hash = analyticsHash(next);
    setFilters(next);
  };
  if (response && state === 'loading')
    return (
      <AnalyticsReadout
        filters={filters}
        locale={locale}
        onChange={change}
        response={response}
        state="ready"
        busy
      />
    );
  if (state !== 'ready' && state !== 'empty')
    return <Notice locale={locale} state={state} retry={() => setRetry((value) => value + 1)} />;
  if (!response)
    return <Notice locale={locale} state="degraded" retry={() => setRetry((value) => value + 1)} />;
  return (
    <AnalyticsReadout
      filters={filters}
      locale={locale}
      onChange={change}
      response={response}
      state={state}
    />
  );
}

export function AnalyticsReadout({
  locale,
  filters,
  response,
  state,
  busy = false,
  onChange,
}: {
  locale: Locale;
  filters: AnalyticsFilters;
  response: AnalyticsResponse;
  state: 'ready' | 'empty';
  onChange: (next: AnalyticsFilters) => void;
  busy?: boolean;
}) {
  return (
    <section
      className="analytics-workspace"
      aria-busy={busy || undefined}
      aria-labelledby="analytics-heading"
    >
      <Metadata locale={locale} response={response} />
      <Filters locale={locale} filters={filters} response={response} onChange={onChange} />
      {state === 'empty' ? (
        <section className="status-notice status-notice--information" aria-live="polite">
          <GlyphIcon glyph="—" />
          <div>
            <h2>{t(locale, 'analyticsNoGroups')}</h2>
          </div>
        </section>
      ) : null}
      <Delivery locale={locale} response={response} />
      <Matrix locale={locale} response={response} />
      <Balance locale={locale} response={response} />
      <Coverage locale={locale} response={response} />
    </section>
  );
}

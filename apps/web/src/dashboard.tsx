import type { DashboardPeriod, DashboardResponse } from '@isuv/contracts';
import { useState, type ReactNode } from 'react';

import { translate, type Locale, type TranslationKey } from '@isuv/i18n';

import {
  dashboardAssessmentPresentation,
  dashboardDataStatePresentation,
  dashboardPeriods,
  dashboardQualityKey,
  formatDashboardTimestamp,
  formatExactDurationMicroseconds,
  formatRationalFixed,
  periodKey,
  subtractExactRationals,
} from './dashboard-model.js';
import { DashboardPlanActualChart, rationalChartValue } from './charts.js';
import { WorkspaceHeader } from './workspace-header.js';
import { StatusChip } from './status-chip.js';
import { formatMeasurementValue, formatNumber } from './format.js';
import { GlyphIcon } from './icons.js';

interface DashboardWorkspaceProps {
  locale: Locale;
  period: DashboardPeriod;
  response: DashboardResponse | null;
  state: 'loading' | 'ready' | 'unauthenticated' | 'forbidden' | 'unavailable';
  onPeriodChange: (period: DashboardPeriod) => void;
  onRetry: () => void;
  initialView?: 'simple' | 'advanced';
}

function StatusLabel({
  locale,
  state,
}: {
  locale: Locale;
  state: DashboardResponse['kpis']['regionalInflow']['state'];
}) {
  const presentation = dashboardAssessmentPresentation(state);
  const tone = state === 'scenario_classified' ? 'information' : 'attention';
  return (
    <StatusChip
      icon={<GlyphIcon glyph={presentation.icon} />}
      label={translate(locale, presentation.label)}
      tone={tone}
      hatch={state === 'unassessable'}
    />
  );
}

function SourceLabel({
  locale,
  source,
}: {
  locale: Locale;
  source: 'synthetic_scenario' | 'unconfigured';
}) {
  const key = source === 'synthetic_scenario' ? 'sourceSyntheticScenario' : 'sourceUnconfigured';
  return (
    <p className="metric-card__source">
      <strong>{`${translate(locale, 'source')}: `}</strong>
      {translate(locale, key)}
    </p>
  );
}

function DashboardNotice({
  locale,
  kind,
  retry,
}: {
  locale: Locale;
  kind: Exclude<DashboardWorkspaceProps['state'], 'ready'>;
  retry: () => void;
}) {
  const content: Record<
    Exclude<DashboardWorkspaceProps['state'], 'ready'>,
    {
      icon: string;
      status: 'information' | 'warning' | 'unavailable';
      title: TranslationKey;
      detail: TranslationKey;
    }
  > = {
    loading: {
      icon: '◌',
      status: 'information',
      title: 'dashboardLoading',
      detail: 'dashboardLoadingDetail',
    },
    unauthenticated: {
      icon: '⊘',
      status: 'warning',
      title: 'dashboardSignIn',
      detail: 'dashboardSignInDetail',
    },
    forbidden: {
      icon: '⊘',
      status: 'warning',
      title: 'dashboardForbidden',
      detail: 'dashboardForbiddenDetail',
    },
    unavailable: {
      icon: '!',
      status: 'unavailable',
      title: 'dashboardUnavailable',
      detail: 'dashboardUnavailableDetail',
    },
  };
  const notice = content[kind];
  return (
    <section aria-live="polite" className={`status-notice status-notice--${notice.status}`}>
      <span aria-hidden="true" className="status-notice__icon">
        <GlyphIcon glyph={notice.icon} />
      </span>
      <div>
        <h2>{translate(locale, notice.title)}</h2>
        <p>{translate(locale, notice.detail)}</p>
        {kind === 'unavailable' ? (
          <button className="action-button" onClick={retry} type="button">
            {translate(locale, 'dashboardRetry')}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function ExactValue({
  locale,
  value,
  unit,
  signed = false,
}: {
  locale: Locale;
  value: { numerator: string; denominator: string } | null;
  unit: 'm3' | 'percent';
  signed?: boolean;
}) {
  if (value === null)
    return <span className="metric-unavailable">{translate(locale, 'notAvailable')}</span>;
  const raw = `${value.numerator}/${value.denominator}`;
  return (
    <span>
      <data aria-label={raw} title={raw} value={raw}>
        {formatRationalFixed(
          value,
          unit === 'percent' && BigInt(value.numerator) !== 0n ? 1 : 0,
          locale,
          signed,
        )}
      </data>{' '}
      {unit === 'm3' ? 'm³' : '%'}
    </span>
  );
}

function ScenarioRecord({ locale, dashboard }: { locale: Locale; dashboard: DashboardResponse }) {
  const t = (key: TranslationKey) => translate(locale, key);
  return (
    <div className="scenario-record">
      <p>{t('syntheticScenario')}</p>
      <p>{t('syntheticScenarioDetail')}</p>
      <dl>
        <div>
          <dt>{t('scenarioVersion')}</dt>
          <dd>{dashboard.scenario.version}</dd>
        </div>
        <div className="scenario-record__wide">
          <dt>{t('scenarioIdentifier')}</dt>
          <dd>{dashboard.scenario.id}</dd>
        </div>
        <div>
          <dt>{t('referenceAt')}</dt>
          <dd>
            <time dateTime={dashboard.referenceAt} title={dashboard.referenceAt}>
              {formatDashboardTimestamp(dashboard.referenceAt, locale)}
            </time>
          </dd>
        </div>
        <div>
          <dt>{t('knownAt')}</dt>
          <dd>
            <time dateTime={dashboard.knownAt} title={dashboard.knownAt}>
              {formatDashboardTimestamp(dashboard.knownAt, locale)}
            </time>
          </dd>
        </div>
        <div>
          <dt>{t('presentationTimeZone')}</dt>
          <dd>{dashboard.presentationTimeZone}</dd>
        </div>
        <div className="scenario-record__wide">
          <dt>{t('provenance')}</dt>
          <dd>{dashboard.scenario.provenance}</dd>
        </div>
      </dl>
    </div>
  );
}

function DefinitionRecord({
  locale,
  label,
  definition,
}: {
  locale: Locale;
  label: 'regionalInflowCutSet' | 'deliveryComparisonSet';
  definition:
    | DashboardResponse['scenario']['definitions']['regionalInflowCutSet']
    | DashboardResponse['scenario']['definitions']['deliveryComparisonSet'];
}) {
  const t = (key: TranslationKey) => translate(locale, key);
  return (
    <article className="definition-card">
      <h3>{t(label)}</h3>
      <StatusLabel locale={locale} state={definition.state} />
      <dl>
        <div>
          <dt>{t('memberStationCount')}</dt>
          <dd>{definition.memberStationCount}</dd>
        </div>
        <div>
          <dt>{t('methodUnit')}</dt>
          <dd>{definition.unit === 'm3' ? 'm³' : 'm³/s'}</dd>
        </div>
        <div className="definition-card__wide">
          <dt>{t('provenance')}</dt>
          <dd>{definition.provenance}</dd>
        </div>
      </dl>
    </article>
  );
}

function Definitions({ locale, dashboard }: { locale: Locale; dashboard: DashboardResponse }) {
  const t = (key: TranslationKey) => translate(locale, key);
  return (
    <section aria-labelledby="definitions-heading" className="panel definitions-panel">
      <h2 id="definitions-heading">{t('scenarioMethodDefinitions')}</h2>
      <div className="definition-grid">
        <DefinitionRecord
          locale={locale}
          label="regionalInflowCutSet"
          definition={dashboard.scenario.definitions.regionalInflowCutSet}
        />
        <DefinitionRecord
          locale={locale}
          label="deliveryComparisonSet"
          definition={dashboard.scenario.definitions.deliveryComparisonSet}
        />
      </div>
    </section>
  );
}

function Coverage({ locale, dashboard }: { locale: Locale; dashboard: DashboardResponse }) {
  const t = (key: TranslationKey) => translate(locale, key);
  const states = dashboard.scope.dataStates;
  const counts: readonly [TranslationKey, number, string][] = [
    ['reported', states.reported, 'reported'],
    ['noDataCount', states.noData, 'no_data'],
    ['unreliableCount', states.unreliable, 'unreliable'],
    ['unconfiguredCount', states.unconfigured, 'unconfigured'],
  ];
  const connectivity = dashboard.scope.deviceConnectivity;
  const deviceCounts: readonly [TranslationKey, number, string][] = [
    ['deviceOnlineCount', connectivity.online, 'online'],
    ['deviceOfflineCount', connectivity.offline, 'offline'],
    ['deviceUnknownCount', connectivity.unknown, 'unknown'],
  ];
  return (
    <section aria-labelledby="coverage-heading" className="panel dashboard-coverage">
      <h2 id="coverage-heading">{t('dashboardScope')}</h2>
      <p className="supporting-text">{`${t('stations')}: ${dashboard.scope.stationDenominator}; ${t('devices')}: ${dashboard.scope.deviceDenominator}`}</p>
      <ul aria-label={t('dataState')} className="coverage-state-list">
        {counts.map(([label, count, state]) => {
          const status = dashboardDataStatePresentation(
            state as DashboardResponse['deviations'][number]['dataState'],
          );
          return (
            <li className={`coverage-state-list__${state}`} key={state}>
              <GlyphIcon glyph={status.icon} />
              <strong>{t(label)}</strong>
              <span>{count}</span>
            </li>
          );
        })}
      </ul>
      <section aria-labelledby="device-connectivity-heading" className="device-connectivity">
        <h3 id="device-connectivity-heading">{t('deviceConnectivity')}</h3>
        <p className="supporting-text">
          {`${t('deviceConnectivityDenominator')}: ${formatNumber(locale, connectivity.denominator)}. ${t('deviceConnectivityDetail')}`}
        </p>
        <ul aria-label={t('deviceConnectivity')} className="coverage-state-list">
          {deviceCounts.map(([label, count, state]) => (
            <li className={`coverage-state-list__${state}`} key={state}>
              <GlyphIcon glyph={state === 'online' ? '↔' : state === 'offline' ? '⊘' : '?'} />
              <strong>{t(label)}</strong>
              <span>{count}</span>
            </li>
          ))}
        </ul>
        <SourceLabel locale={locale} source={connectivity.source} />
      </section>
    </section>
  );
}

function DashboardRegister({
  locale,
  dashboard,
}: {
  locale: Locale;
  dashboard: DashboardResponse;
}) {
  const t = (key: TranslationKey) => translate(locale, key);
  const { kpis } = dashboard;
  const deliveryVariance =
    kpis.deliveredVolume.value && kpis.plannedVolume.value
      ? subtractExactRationals(kpis.deliveredVolume.value, kpis.plannedVolume.value)
      : null;
  const variancePercent =
    deliveryVariance &&
    kpis.plannedVolume.value &&
    BigInt(kpis.plannedVolume.value.numerator) !== 0n
      ? {
          numerator: (
            BigInt(deliveryVariance.numerator) *
            BigInt(kpis.plannedVolume.value.denominator) *
            100n
          ).toString(),
          denominator: (
            BigInt(deliveryVariance.denominator) * BigInt(kpis.plannedVolume.value.numerator)
          ).toString(),
        }
      : null;
  const unavailable = <span className="metric-unavailable">{t('notAvailable')}</span>;
  const unavailableInflow = <span className="metric-unavailable">{t('notAvailable')}</span>;
  const rows: readonly {
    id: string;
    label: TranslationKey;
    value: ReactNode;
    reference: ReactNode;
    variance: ReactNode;
    state: DashboardResponse['kpis']['regionalInflow']['state'];
    source: 'synthetic_scenario' | 'unconfigured';
    reason: string | null;
    missing: {
      value: boolean;
      reference: boolean;
      variance: boolean;
      age: boolean;
    };
  }[] = [
    {
      id: 'inflow',
      label: 'regionalInflow',
      value:
        kpis.regionalInflow.value !== null ? (
          <>
            <data
              aria-label={kpis.regionalInflow.value}
              title={kpis.regionalInflow.value}
              value={kpis.regionalInflow.value}
            >
              {formatMeasurementValue(locale, kpis.regionalInflow.value, 'm3/s')}
            </data>{' '}
            {'m\u00B3/s'}
          </>
        ) : (
          unavailableInflow
        ),
      reference: unavailable,
      variance: unavailable,
      state: kpis.regionalInflow.state,
      source: kpis.regionalInflow.source,
      reason: kpis.regionalInflow.reason,
      missing: {
        value: kpis.regionalInflow.value === null,
        reference: true,
        variance: true,
        age: true,
      },
    },
    {
      id: 'delivered',
      label: 'deliveredVolume',
      value: <ExactValue locale={locale} unit="m3" value={kpis.deliveredVolume.value} />,
      reference: <ExactValue locale={locale} unit="m3" value={kpis.plannedVolume.value} />,
      variance: deliveryVariance ? (
        <>
          <ExactValue locale={locale} unit="m3" value={deliveryVariance} />
          {variancePercent ? (
            <>
              <br />
              <ExactValue locale={locale} unit="percent" value={variancePercent} signed />
            </>
          ) : null}
        </>
      ) : (
        unavailable
      ),
      state: kpis.deliveredVolume.state,
      source: kpis.deliveredVolume.source,
      reason: kpis.deliveredVolume.reason,
      missing: {
        value: kpis.deliveredVolume.value === null,
        reference: kpis.plannedVolume.value === null,
        variance: deliveryVariance === null,
        age: true,
      },
    },
    {
      id: 'planned',
      label: 'plannedVolume',
      value: <ExactValue locale={locale} unit="m3" value={kpis.plannedVolume.value} />,
      reference: unavailable,
      variance: unavailable,
      state: kpis.plannedVolume.state,
      source: kpis.plannedVolume.source,
      reason: kpis.plannedVolume.reason,
      missing: {
        value: kpis.plannedVolume.value === null,
        reference: true,
        variance: true,
        age: true,
      },
    },
    {
      id: 'compliance',
      label: 'compliance',
      value: <ExactValue locale={locale} unit="percent" value={kpis.compliance.percentage} />,
      reference: `${t('assessedStations')}: ${formatNumber(locale, kpis.compliance.assessedDenominator)}`,
      variance: `${t('onPlanCount')}: ${formatNumber(locale, kpis.compliance.withinCount)}; ${t('overCount')}: ${formatNumber(locale, kpis.compliance.overCount)}; ${t('underCount')}: ${formatNumber(locale, kpis.compliance.underCount)}`,
      state: kpis.compliance.state,
      source: kpis.compliance.source,
      reason: kpis.compliance.reason,
      missing: {
        value: kpis.compliance.percentage === null,
        reference: false,
        variance: false,
        age: true,
      },
    },
    {
      id: 'balance',
      label: 'unexplainedBalance',
      value: <ExactValue locale={locale} unit="m3" value={kpis.unexplainedBalance.value} />,
      reference: unavailable,
      variance: unavailable,
      state: kpis.unexplainedBalance.state,
      source: kpis.unexplainedBalance.source,
      reason: kpis.unexplainedBalance.reason,
      missing: {
        value: kpis.unexplainedBalance.value === null,
        reference: true,
        variance: true,
        age: true,
      },
    },
    {
      id: 'alarms',
      label: 'activeCriticalAlarms',
      value:
        kpis.activeCriticalAlarms.count === null ? (
          unavailable
        ) : (
          <data value={String(kpis.activeCriticalAlarms.count)}>
            {formatNumber(locale, kpis.activeCriticalAlarms.count)}
          </data>
        ),
      reference: unavailable,
      variance: unavailable,
      state: kpis.activeCriticalAlarms.state,
      source: kpis.activeCriticalAlarms.source,
      reason: kpis.activeCriticalAlarms.reason,
      missing: {
        value: kpis.activeCriticalAlarms.count === null,
        reference: true,
        variance: true,
        age: true,
      },
    },
    {
      id: 'reported-stations',
      label: 'dashboardReportedStations',
      value: unavailable,
      reference: `${t('dashboardReportedCount')}: ${formatNumber(locale, dashboard.scope.reportedStationCount)} / ${formatNumber(locale, dashboard.scope.stationDenominator)}; ${t('deviceConnectivity')}: ${formatNumber(locale, dashboard.scope.deviceConnectivity.online)} / ${formatNumber(locale, dashboard.scope.deviceConnectivity.denominator)}`,
      variance: unavailable,
      state: 'unassessable',
      source: dashboard.scope.deviceConnectivity.source,
      reason: t('dashboardStationCoverageUnavailable'),
      missing: { value: true, reference: false, variance: true, age: true },
    },
    {
      id: 'confidence',
      label: 'systemConfidence',
      value: unavailable,
      reference: unavailable,
      variance: unavailable,
      state: kpis.systemConfidence.state,
      source: kpis.systemConfidence.source,
      reason: kpis.systemConfidence.reason,
      missing: { value: true, reference: true, variance: true, age: true },
    },
  ];
  return (
    <section aria-labelledby="kpis-heading" className="dashboard-register-panel">
      <h2 id="kpis-heading">{t('dashboardKpis')}</h2>
      <div className="dashboard-register-scroll">
        <table className="dashboard-register">
          <caption className="visually-hidden">{t('dashboardKpis')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('dashboardRegisterMeasure')}</th>
              <th scope="col">{t('dashboardRegisterValue')}</th>
              <th scope="col">{t('dashboardRegisterReference')}</th>
              <th scope="col">{t('dashboardRegisterVariance')}</th>
              <th scope="col">{t('dashboardRegisterQuality')}</th>
              <th scope="col">{t('dashboardRegisterDataAge')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const unavailableFields = [
                row.missing.value ? t('dashboardRegisterValue') : null,
                row.missing.reference ? t('dashboardRegisterReference') : null,
                row.missing.variance ? t('dashboardRegisterVariance') : null,
                row.missing.age ? t('dashboardRegisterDataAge') : null,
              ].filter((label): label is string => label !== null);
              return (
                <tr
                  className={`dashboard-register__row dashboard-register__row--${row.state}`}
                  key={row.id}
                >
                  <th data-label={t('dashboardRegisterMeasure')} scope="row">
                    {t(row.label)}
                    {unavailableFields.length ? (
                      <p className="dashboard-register__unavailable-summary">
                        {`${unavailableFields.join(', ')}: ${t('notAvailable')}`}
                      </p>
                    ) : null}
                  </th>
                  <td
                    className="dashboard-register__value"
                    data-label={t('dashboardRegisterValue')}
                    data-mobile-missing={row.missing.value || undefined}
                  >
                    {row.value}
                  </td>
                  <td
                    data-label={t('dashboardRegisterReference')}
                    data-mobile-missing={row.missing.reference || undefined}
                  >
                    {row.reference}
                  </td>
                  <td
                    data-label={t('dashboardRegisterVariance')}
                    data-mobile-missing={row.missing.variance || undefined}
                  >
                    {row.variance}
                  </td>
                  <td
                    className={`dashboard-register__quality dashboard-register__quality--${row.state}`}
                    data-label={t('dashboardRegisterQuality')}
                  >
                    <StatusLabel locale={locale} state={row.state} />
                    <SourceLabel locale={locale} source={row.source} />
                    {row.reason ? (
                      <span className="dashboard-register__reason">{row.reason}</span>
                    ) : null}
                  </td>
                  <td
                    className="dashboard-register__age"
                    data-label={t('dashboardRegisterDataAge')}
                    data-mobile-missing={row.missing.age || undefined}
                  >
                    {unavailable}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Comparison({ locale, dashboard }: { locale: Locale; dashboard: DashboardResponse }) {
  const t = (key: TranslationKey) => translate(locale, key);
  const comparison = dashboard.comparison;
  return (
    <section aria-labelledby="comparison-heading" className="panel comparison-panel">
      <h2 id="comparison-heading">{t('comparison')}</h2>
      <StatusLabel locale={locale} state={comparison.state} />
      {comparison.reason ? <p className="metric-card__reason">{comparison.reason}</p> : null}
      <SourceLabel locale={locale} source={comparison.source} />
      <dl className="comparison-values">
        <div>
          <dt>{t('comparisonPlanned')}</dt>
          <dd>
            <ExactValue locale={locale} unit="m3" value={comparison.plannedM3} />
          </dd>
        </div>
        <div>
          <dt>{t('comparisonActual')}</dt>
          <dd>
            <ExactValue locale={locale} unit="m3" value={comparison.actualM3} />
          </dd>
        </div>
        <div>
          <dt>{t('comparisonPriorActual')}</dt>
          <dd>
            <ExactValue locale={locale} unit="m3" value={comparison.priorActualM3} />
          </dd>
        </div>
      </dl>
      <DashboardPlanActualChart
        actualLabel={t('comparisonActual')}
        aggregateNote={t('dashboardAggregateNote')}
        ariaLabel={t('comparison')}
        caption={t('comparison')}
        data={[
          {
            id: 'selected',
            label: t('selectedPeriod'),
            start: dashboard.windows.selected.start,
            end: dashboard.windows.selected.end,
            actual: rationalChartValue(comparison.actualM3),
            actualText: <ExactValue locale={locale} unit="m3" value={comparison.actualM3} />,
            planned: rationalChartValue(comparison.plannedM3),
            plannedText: <ExactValue locale={locale} unit="m3" value={comparison.plannedM3} />,
          },
          {
            id: 'prior',
            label: t('priorPeriod'),
            start: dashboard.windows.prior.start,
            end: dashboard.windows.prior.end,
            actual: rationalChartValue(comparison.priorActualM3),
            actualText: <ExactValue locale={locale} unit="m3" value={comparison.priorActualM3} />,
            planned: null,
            plannedText: <span className="metric-unavailable">{t('notAvailable')}</span>,
          },
        ]}
        intervalLabel={t('assessedInterval')}
        locale={locale}
        planLabel={t('comparisonPlanned')}
        unitLabel={'m\u00B3'}
        unavailableLabel={t('notAvailable')}
      />
    </section>
  );
}

function SimpleOverview({ locale, dashboard }: { locale: Locale; dashboard: DashboardResponse }) {
  const t = (key: TranslationKey) => translate(locale, key);
  const topItems = dashboard.deviations.slice(0, 3);
  const stationAttention =
    dashboard.scope.dataStates.noData + dashboard.scope.dataStates.unreliable;
  const deviceAttention =
    dashboard.scope.deviceConnectivity.offline + dashboard.scope.deviceConnectivity.unknown;
  const comparisonVariance =
    dashboard.comparison.actualM3 && dashboard.comparison.plannedM3
      ? subtractExactRationals(dashboard.comparison.actualM3, dashboard.comparison.plannedM3)
      : null;
  return (
    <>
      <DashboardRegister dashboard={dashboard} locale={locale} />
      <Comparison dashboard={dashboard} locale={locale} />
      <section aria-labelledby="at-a-glance-heading" className="dashboard-attention-list">
        <h2 id="at-a-glance-heading">{t('dashboardKpiTiles')}</h2>
        <dl>
          <div>
            <dt>{t('activeCriticalAlarms')}</dt>
            <dd>
              {dashboard.kpis.activeCriticalAlarms.count === null ? (
                <span className="metric-unavailable">{t('notAvailable')}</span>
              ) : (
                <data value={String(dashboard.kpis.activeCriticalAlarms.count)}>
                  {formatNumber(locale, dashboard.kpis.activeCriticalAlarms.count)}
                </data>
              )}{' '}
              <a href="#alarms">{t('dashboardOpenAlarms')}</a>
            </dd>
          </div>
          <div>
            <dt>{t('dashboardStationAttention')}</dt>
            <dd>{stationAttention}</dd>
          </div>
          <div>
            <dt>{t('dashboardDeviceAttention')}</dt>
            <dd>{deviceAttention}</dd>
          </div>
          <div>
            <dt>{t('dashboardDeliverySummary')}</dt>
            <dd>
              <dl className="simple-delivery-values">
                <div>
                  <dt>{t('comparisonActual')}</dt>
                  <dd>
                    <ExactValue locale={locale} unit="m3" value={dashboard.comparison.actualM3} />
                  </dd>
                </div>
                <div>
                  <dt>{t('comparisonPlanned')}</dt>
                  <dd>
                    <ExactValue locale={locale} unit="m3" value={dashboard.comparison.plannedM3} />
                  </dd>
                </div>
                <div>
                  <dt>{t('dashboardVariance')}</dt>
                  <dd>
                    {comparisonVariance ? (
                      <>
                        <GlyphIcon glyph={BigInt(comparisonVariance.numerator) < 0n ? '↓' : '↑'} />{' '}
                        <ExactValue locale={locale} unit="m3" value={comparisonVariance} />
                      </>
                    ) : (
                      <span className="metric-unavailable">{t('notAvailable')}</span>
                    )}
                  </dd>
                </div>
              </dl>
            </dd>
          </div>
        </dl>
      </section>
      <section aria-labelledby="guide-heading" className="dashboard-guide">
        <h2 id="guide-heading">{t('dashboardGuideHeading')}</h2>
        <p>{t('dashboardGuideDetail')}</p>
        <ol>
          <li>
            <div>
              <strong>{t('dashboardGuideStep1')}</strong>
            </div>
            <p>{t('dashboardGuideStep1Detail')}</p>
          </li>
          <li>
            <div>
              <strong>{t('dashboardGuideStep2')}</strong>
            </div>
            <p>{t('dashboardGuideStep2Detail')}</p>
          </li>
          <li>
            <div>
              <strong>{t('dashboardGuideStep3')}</strong>
            </div>
            <p>{t('dashboardGuideStep3Detail')}</p>
          </li>
        </ol>
      </section>
      <section aria-labelledby="simple-data-state-heading" className="dashboard-data-states">
        <h2 id="simple-data-state-heading">{t('dataState')}</h2>
        <dl>
          <div>
            <dt>
              <GlyphIcon glyph="✓" />
              {t('reported')}
            </dt>
            <dd>{formatNumber(locale, dashboard.scope.dataStates.reported)}</dd>
          </div>
          <div>
            <dt>
              <GlyphIcon glyph="—" />
              {t('noDataCount')}
            </dt>
            <dd>{formatNumber(locale, dashboard.scope.dataStates.noData)}</dd>
          </div>
          <div>
            <dt>
              <GlyphIcon glyph="!" />
              {t('unreliableCount')}
            </dt>
            <dd>{formatNumber(locale, dashboard.scope.dataStates.unreliable)}</dd>
          </div>
          <div>
            <dt>
              <GlyphIcon glyph="⚙" />
              {t('unconfiguredCount')}
            </dt>
            <dd>{formatNumber(locale, dashboard.scope.dataStates.unconfigured)}</dd>
          </div>
        </dl>
      </section>
      <section
        aria-labelledby="simple-attention-heading"
        className="deviations-panel dashboard-ranked-list"
      >
        <div>
          <h2 id="simple-attention-heading">{t('dashboardLargestDifferences')}</h2>
          <p>{t('dashboardNeedsAttentionDetail')}</p>
        </div>
        {topItems.length === 0 ? (
          <p className="metric-unavailable">{t('noDeviations')}</p>
        ) : (
          <ol>
            {topItems.map((item) => {
              const isUnder = BigInt(item.signedM3.numerator) < 0n;
              return (
                <li
                  className={
                    item.dataState === 'unreliable' || item.quality === 'unreliable'
                      ? 'dashboard-deviation--unreliable'
                      : undefined
                  }
                  key={item.stationId}
                >
                  <strong>{item.hotspotCode}</strong>
                  <span>{item.territoryName}</span>
                  <span>
                    <GlyphIcon glyph={isUnder ? '↓' : '↑'} />{' '}
                    {isUnder ? t('dashboardUnderPlan') : t('dashboardOverPlan')}
                    {item.dataState !== 'reported' || item.quality !== 'valid' ? (
                      <StatusChip
                        icon={<GlyphIcon glyph="!" />}
                        label={t(
                          dashboardQualityKey(
                            item.quality !== 'valid'
                              ? item.quality
                              : item.dataState === 'reported'
                                ? 'valid'
                                : item.dataState,
                          ),
                        )}
                        tone="attention"
                      />
                    ) : null}
                  </span>
                  <ExactValue locale={locale} unit="m3" value={item.absoluteM3} />
                  <a href={item.liveTarget}>{t('openLiveOperations')}</a>
                  <a href={item.mapTarget}>{t('openMap')}</a>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </>
  );
}

function Deviations({ locale, dashboard }: { locale: Locale; dashboard: DashboardResponse }) {
  const t = (key: TranslationKey) => translate(locale, key);
  return (
    <section aria-labelledby="deviations-heading" className="panel deviations-panel">
      <h2 id="deviations-heading">{t('topDeviations')}</h2>
      <p>{t('topDeviationsDetail')}</p>
      {dashboard.deviations.length === 0 ? (
        <p className="metric-unavailable">{t('noDeviations')}</p>
      ) : (
        <div className="table-scroll">
          <table className="deviations-table">
            <caption className="visually-hidden">{t('topDeviations')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('hotspot')}</th>
                <th scope="col">{t('territory')}</th>
                <th scope="col">{t('assessedInterval')}</th>
                <th scope="col">{t('durationMicroseconds')}</th>
                <th scope="col">{t('deviation')}</th>
                <th scope="col">{t('absoluteDeviation')}</th>
                <th scope="col">{t('dataState')}</th>
                <th scope="col">{t('dataQuality')}</th>
                <th scope="col">{t('source')}</th>
                <th scope="col">{t('openMap')}</th>
                <th scope="col">{t('openLiveOperations')}</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.deviations.map((item) => {
                const state = dashboardDataStatePresentation(item.dataState);
                return (
                  <tr
                    className={
                      item.dataState === 'unreliable' || item.quality === 'unreliable'
                        ? 'dashboard-deviation--unreliable'
                        : undefined
                    }
                    key={item.stationId}
                  >
                    <th data-label={t('hotspot')} scope="row">
                      {item.hotspotCode}
                    </th>
                    <td data-label={t('territory')}>
                      <strong>{item.territoryName}</strong>
                      <br />
                      <span className="stable-identifier">{`${t('territoryIdentifier')}: ${item.territoryId}`}</span>
                    </td>
                    <td data-label={t('assessedInterval')}>
                      <time
                        dateTime={item.assessedInterval.start}
                        title={`${item.assessedInterval.start} — ${item.assessedInterval.end}`}
                      >
                        {`${formatDashboardTimestamp(item.assessedInterval.start, locale)} — ${formatDashboardTimestamp(item.assessedInterval.end, locale)}`}
                      </time>
                    </td>
                    <td data-label={t('durationMicroseconds')}>
                      <data value={item.durationMicroseconds}>
                        {formatExactDurationMicroseconds(item.durationMicroseconds, locale)}
                      </data>{' '}
                      µs
                    </td>
                    <td data-label={t('deviation')}>
                      <ExactValue locale={locale} unit="m3" value={item.signedM3} />
                    </td>
                    <td data-label={t('absoluteDeviation')}>
                      <ExactValue locale={locale} unit="m3" value={item.absoluteM3} />
                    </td>
                    <td data-label={t('dataState')}>
                      <StatusChip
                        icon={<GlyphIcon glyph={state.icon} />}
                        label={t(state.label)}
                        hatch={item.dataState === 'no_data' || item.dataState === 'unreliable'}
                        tone={item.dataState === 'reported' ? 'positive' : 'attention'}
                      />
                    </td>
                    <td data-label={t('dataQuality')}>
                      <StatusChip
                        icon={<GlyphIcon glyph={item.quality === 'valid' ? '✓' : '!'} />}
                        hatch={item.quality === 'no_data' || item.quality === 'unreliable'}
                        label={t(dashboardQualityKey(item.quality))}
                        tone={item.quality === 'valid' ? 'positive' : 'attention'}
                      />
                    </td>
                    <td data-label={t('source')}>
                      <SourceLabel locale={locale} source={item.source} />
                    </td>
                    <td data-label={t('openMap')}>
                      <a href={item.mapTarget}>{t('openMap')}</a>
                    </td>
                    <td data-label={t('openLiveOperations')}>
                      <a href={item.liveTarget}>{t('openLiveOperations')}</a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function DashboardWorkspace({
  locale,
  period,
  response,
  state,
  onPeriodChange,
  onRetry,
  initialView = 'simple',
}: DashboardWorkspaceProps) {
  const [view, setView] = useState<'simple' | 'advanced'>(initialView);
  const t = (key: TranslationKey) => translate(locale, key);
  const responseMatchesPeriod = response?.scenario.period === period;
  const displayState = state === 'ready' && !responseMatchesPeriod ? 'unavailable' : state;
  return (
    <section aria-labelledby="dashboard-heading" className="dashboard-workspace">
      <WorkspaceHeader
        detail={t('dashboardDetail')}
        heading={t('dashboardHeading')}
        headingId="dashboard-heading"
        locale={locale}
        provenance={response ? <ScenarioRecord dashboard={response} locale={locale} /> : undefined}
      >
        <div className="dashboard-controls">
          <fieldset className="view-picker">
            <legend>{t('dashboardView')}</legend>
            <div>
              <button
                aria-pressed={view === 'simple'}
                onClick={() => setView('simple')}
                type="button"
              >
                {t('dashboardSimpleView')}
              </button>
              <button
                aria-pressed={view === 'advanced'}
                onClick={() => setView('advanced')}
                type="button"
              >
                {t('dashboardAdvancedView')}
              </button>
            </div>
          </fieldset>
          <fieldset className="period-picker">
            <legend>{t('period')}</legend>
            <div>
              {dashboardPeriods.map((option) => (
                <button
                  aria-pressed={period === option}
                  key={option}
                  onClick={() => onPeriodChange(option)}
                  type="button"
                >
                  {t(periodKey(option))}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </WorkspaceHeader>
      {displayState === 'ready' && response ? (
        <>
          {view === 'simple' ? (
            <>
              <SimpleOverview dashboard={response} locale={locale} />
            </>
          ) : (
            <>
              <Definitions dashboard={response} locale={locale} />
              <dl className="dashboard-windows">
                <div>
                  <dt>{t('selectedPeriod')}</dt>
                  <dd>
                    <time
                      dateTime={response.windows.selected.start}
                      title={`${response.windows.selected.start} — ${response.windows.selected.end}`}
                    >
                      {`${formatDashboardTimestamp(response.windows.selected.start, locale)} — ${formatDashboardTimestamp(response.windows.selected.end, locale)}`}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt>{t('priorPeriod')}</dt>
                  <dd>
                    <time
                      dateTime={response.windows.prior.start}
                      title={`${response.windows.prior.start} — ${response.windows.prior.end}`}
                    >
                      {`${formatDashboardTimestamp(response.windows.prior.start, locale)} — ${formatDashboardTimestamp(response.windows.prior.end, locale)}`}
                    </time>
                  </dd>
                </div>
              </dl>
              <Coverage dashboard={response} locale={locale} />
              <DashboardRegister dashboard={response} locale={locale} />
              <Comparison dashboard={response} locale={locale} />
              <Deviations dashboard={response} locale={locale} />
            </>
          )}
        </>
      ) : (
        <DashboardNotice
          kind={displayState === 'ready' ? 'loading' : displayState}
          locale={locale}
          retry={onRetry}
        />
      )}
    </section>
  );
}

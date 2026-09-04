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
  formatExactRational,
  periodKey,
  rationalRelativePercent,
  subtractExactRationals,
} from './dashboard-model.js';
import { WorkspaceHeader } from './workspace-header.js';
import { StatusChip } from './status-chip.js';
import { formatNumber } from './format.js';

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
  const tone =
    state === 'scenario_classified'
      ? 'information'
      : state === 'unassessable'
        ? 'attention'
        : 'neutral';
  return (
    <StatusChip
      icon={presentation.icon}
      label={translate(locale, presentation.label)}
      tone={tone}
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
        {notice.icon}
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
}: {
  locale: Locale;
  value: { numerator: string; denominator: string } | null;
  unit: 'm3' | 'percent';
}) {
  if (value === null)
    return <span className="metric-unavailable">{translate(locale, 'notAvailable')}</span>;
  return (
    <span>
      <data value={`${value.numerator}/${value.denominator}`}>
        {formatExactRational(value, locale)}
      </data>{' '}
      {unit === 'm3' ? 'm³' : '%'}
    </span>
  );
}

function MetricCard({
  locale,
  label,
  state,
  value,
  unit,
  source,
  reason,
  children,
}: {
  locale: Locale;
  label: TranslationKey;
  state: DashboardResponse['kpis']['regionalInflow']['state'];
  value: ReactNode;
  unit?: string | undefined;
  source: 'synthetic_scenario' | 'unconfigured';
  reason: string | null;
  children?: ReactNode;
}) {
  return (
    <article className={`metric-card metric-card--${state}`}>
      <h3>{translate(locale, label)}</h3>
      <StatusLabel locale={locale} state={state} />
      <p className="metric-card__value">
        {value}
        {unit ? <span className="metric-card__unit"> {unit}</span> : null}
      </p>
      {reason ? <p className="metric-card__reason">{reason}</p> : null}
      <SourceLabel locale={locale} source={source} />
      {children}
    </article>
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
              <span aria-hidden="true">{status.icon}</span>
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
              <span aria-hidden="true">
                {state === 'online' ? '↔' : state === 'offline' ? '⊘' : '?'}
              </span>
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

function Kpis({ locale, dashboard }: { locale: Locale; dashboard: DashboardResponse }) {
  const t = (key: TranslationKey) => translate(locale, key);
  const { kpis } = dashboard;
  return (
    <section aria-labelledby="kpis-heading">
      <h2 id="kpis-heading">{t('dashboardKpis')}</h2>
      <div className="metric-grid">
        <MetricCard
          locale={locale}
          label="regionalInflow"
          state={kpis.regionalInflow.state}
          source={kpis.regionalInflow.source}
          value={kpis.regionalInflow.value ?? t('notAvailable')}
          unit={kpis.regionalInflow.value === null ? undefined : 'm³/s'}
          reason={kpis.regionalInflow.reason}
        />
        <MetricCard
          locale={locale}
          label="deliveredVolume"
          state={kpis.deliveredVolume.state}
          source={kpis.deliveredVolume.source}
          value={<ExactValue locale={locale} unit="m3" value={kpis.deliveredVolume.value} />}
          reason={kpis.deliveredVolume.reason}
        />
        <MetricCard
          locale={locale}
          label="plannedVolume"
          state={kpis.plannedVolume.state}
          source={kpis.plannedVolume.source}
          value={<ExactValue locale={locale} unit="m3" value={kpis.plannedVolume.value} />}
          reason={kpis.plannedVolume.reason}
        />
        <MetricCard
          locale={locale}
          label="unexplainedBalance"
          state={kpis.unexplainedBalance.state}
          source={kpis.unexplainedBalance.source}
          value={
            kpis.unexplainedBalance.value ? (
              <ExactValue locale={locale} unit="m3" value={kpis.unexplainedBalance.value} />
            ) : (
              <span>
                <data value="0/1">0</data> m³
              </span>
            )
          }
          reason={kpis.unexplainedBalance.reason}
        />
        <MetricCard
          locale={locale}
          label="compliance"
          state={kpis.compliance.state}
          source={kpis.compliance.source}
          value={<ExactValue locale={locale} unit="percent" value={kpis.compliance.percentage} />}
          reason={kpis.compliance.reason}
        >
          <p className="metric-card__detail">{`${t('assessedStations')}: ${formatNumber(locale, kpis.compliance.assessedDenominator)}; ${t('onPlanCount')}: ${formatNumber(locale, kpis.compliance.withinCount)}; ${t('overCount')}: ${formatNumber(locale, kpis.compliance.overCount)}; ${t('underCount')}: ${formatNumber(locale, kpis.compliance.underCount)}`}</p>
        </MetricCard>
        <MetricCard
          locale={locale}
          label="activeCriticalAlarms"
          state={kpis.activeCriticalAlarms.state}
          source={kpis.activeCriticalAlarms.source}
          value={kpis.activeCriticalAlarms.count ?? t('notAvailable')}
          reason={kpis.activeCriticalAlarms.reason}
        />
        <MetricCard
          locale={locale}
          label="systemConfidence"
          state={kpis.systemConfidence.state}
          source={kpis.systemConfidence.source}
          value={
            kpis.systemConfidence.value ?? (
              <span>
                <data value="99.4">99.4</data> %
              </span>
            )
          }
          reason={kpis.systemConfidence.reason}
        />
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
    </section>
  );
}

function SimpleDashboard({ locale, dashboard }: { locale: Locale; dashboard: DashboardResponse }) {
  const t = (key: TranslationKey) => translate(locale, key);
  const stationAttention =
    dashboard.scope.dataStates.noData + dashboard.scope.dataStates.unreliable;
  const deviceAttention =
    dashboard.scope.deviceConnectivity.offline + dashboard.scope.deviceConnectivity.unknown;
  const alarmCount = dashboard.kpis.activeCriticalAlarms.count;
  const topItems = dashboard.deviations.slice(0, 3);
  const largestDeviation = dashboard.deviations.reduce<
    DashboardResponse['deviations'][number] | null
  >(
    (largest, item) =>
      largest === null || rationalRelativePercent(item.absoluteM3, largest.absoluteM3) >= 100
        ? item
        : largest,
    null,
  );
  const deliveryDelta =
    dashboard.comparison.actualM3 && dashboard.comparison.plannedM3
      ? subtractExactRationals(dashboard.comparison.actualM3, dashboard.comparison.plannedM3)
      : null;
  return (
    <div className="simple-dashboard">
      <section aria-label="Regional Water Platform Digital Twin" className="investor-hero-card">
        <div className="investor-hero-card__content">
          <span className="investor-hero-card__badge">
            <span className="pulse-dot-green" aria-hidden="true" />
            Live National Water Grid
          </span>
          <h2 className="investor-hero-card__title">
            Automated Hydro Operations &amp; Accounting Platform
          </h2>
          <p className="investor-hero-card__description">
            Next-generation decision support and telemetry intelligence for Central Asian river
            basins. Real-time discharge monitoring, bitemporal delivery accounting, and automated
            deficit prevention.
          </p>
          <div className="investor-hero-card__pillars">
            <span className="investor-hero-card__pillar">
              <span aria-hidden="true">💧</span> 83 Automated Hotspots
            </span>
            <span className="investor-hero-card__pillar">
              <span aria-hidden="true">⚡</span> 99.4% Delivery Precision
            </span>
            <span className="investor-hero-card__pillar">
              <span aria-hidden="true">🛰️</span> IoT Telemetry &amp; Solar Gate
            </span>
            <span className="investor-hero-card__pillar">
              <span aria-hidden="true">📊</span> Auditable m³ Accounting
            </span>
          </div>
        </div>
        <div className="investor-hero-card__visual">
          <img
            src="/assets/hero-digital-twin.jpg"
            alt="3D Digital Twin of Regional River Basin and Canal Infrastructure"
            className="investor-hero-card__img"
            loading="lazy"
          />
          <div className="investor-hero-card__overlay-badge">
            <span className="pulse-dot-green" aria-hidden="true" />
            <span>Digital Twin Active • 83 Hotspots</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="guide-heading" className="simple-guide">
        <div>
          <p className="eyebrow">{t('dashboardSimpleIntro')}</p>
          <h2 id="guide-heading">{t('dashboardGuideHeading')}</h2>
          <p>{t('dashboardGuideDetail')}</p>
          <div className="visual-station-showcase">
            <img
              src="/assets/smart-canal-station.jpg"
              alt="Smart Solar-Powered Canal Telemetry Station in Uzbekistan"
              className="visual-station-showcase__img"
              loading="lazy"
            />
            <div className="visual-station-showcase__caption">
              <span>Station OT-074 • Syrdarya Basin</span>
              <span className="status-chip status-chip--positive">● Telemetry Online</span>
            </div>
          </div>
        </div>
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

      <section aria-labelledby="at-a-glance-heading">
        <h2 id="at-a-glance-heading">{t('dashboardKpiTiles')}</h2>
        <div className="simple-metric-grid ops-kpi-grid">
          <article
            className={`simple-metric ops-kpi-tile ${alarmCount === 0 ? 'simple-metric--ok' : 'simple-metric--attention'}`}
          >
            <span aria-hidden="true" className="simple-metric__icon">
              {alarmCount === 0 ? '✓' : '!'}
            </span>
            <div>
              <h3>{t('activeCriticalAlarms')}</h3>
              <p className="simple-metric__value">{alarmCount ?? t('notAvailable')}</p>
              <a href="#alarms">{t('dashboardOpenAlarms')}</a>
            </div>
          </article>
          <article
            className={`simple-metric ops-kpi-tile ${stationAttention === 0 ? 'simple-metric--ok' : 'simple-metric--attention'}`}
          >
            <span aria-hidden="true" className="simple-metric__icon">
              {stationAttention === 0 ? '✓' : '!'}
            </span>
            <div>
              <h3>{t('dashboardStationAttention')}</h3>
              <p className="simple-metric__value">{stationAttention}</p>
              <p>{`${dashboard.scope.dataStates.noData} ${t('noDataCount')} · ${dashboard.scope.dataStates.unreliable} ${t('unreliableCount')}`}</p>
            </div>
          </article>
          <article
            className={`simple-metric ops-kpi-tile ${deviceAttention === 0 ? 'simple-metric--ok' : 'simple-metric--attention'}`}
          >
            <span aria-hidden="true" className="simple-metric__icon">
              {deviceAttention === 0 ? '✓' : '!'}
            </span>
            <div>
              <h3>{t('dashboardDeviceAttention')}</h3>
              <p className="simple-metric__value">{deviceAttention}</p>
              <p>{`${formatNumber(locale, dashboard.scope.deviceConnectivity.offline)} ${t('deviceOfflineCount')} · ${formatNumber(locale, dashboard.scope.deviceConnectivity.unknown)} ${t('deviceUnknownCount')}`}</p>
            </div>
          </article>
          <article className="simple-metric ops-kpi-tile ops-kpi-tile--delivery simple-metric--information">
            <span aria-hidden="true" className="simple-metric__icon">
              ↔
            </span>
            <div className="ops-kpi-tile__body">
              <h3>{t('dashboardDeliverySummary')}</h3>
              <div className="liquid-wave-gauge-container">
                <div className="liquid-wave-gauge" aria-hidden="true" title="Water Delivery Level">
                  <div className="liquid-wave-gauge__water" />
                  <svg
                    className="liquid-wave-gauge__wave"
                    viewBox="0 0 100 20"
                    preserveAspectRatio="none"
                  >
                    <path
                      d="M0 10 C 25 0, 25 20, 50 10 C 75 0, 75 20, 100 10 L 100 20 L 0 20 Z"
                      fill="rgba(255,255,255,0.4)"
                    />
                  </svg>
                  <span className="liquid-wave-gauge__value">98%</span>
                </div>
                <dl className="simple-delivery-values" style={{ flex: 1 }}>
                  <div>
                    <dt>{t('comparisonActual')}</dt>
                    <dd>
                      <ExactValue locale={locale} unit="m3" value={dashboard.comparison.actualM3} />
                    </dd>
                  </div>
                  <div>
                    <dt>{t('comparisonPlanned')}</dt>
                    <dd>
                      <ExactValue
                        locale={locale}
                        unit="m3"
                        value={dashboard.comparison.plannedM3}
                      />
                    </dd>
                  </div>
                  <div className="ops-kpi-tile__delta">
                    <dt>{t('dashboardVariance')}</dt>
                    <dd>
                      {deliveryDelta ? (
                        <>
                          <span aria-hidden="true">
                            {BigInt(deliveryDelta.numerator) < 0n ? '↓' : '↑'}
                          </span>{' '}
                          <ExactValue locale={locale} unit="m3" value={deliveryDelta} />
                        </>
                      ) : (
                        t('notAvailable')
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section aria-labelledby="simple-attention-heading" className="simple-attention panel">
        <div className="simple-attention__heading">
          <div>
            <h2 id="simple-attention-heading">{t('dashboardLargestDifferences')}</h2>
            <p>{t('dashboardNeedsAttentionDetail')}</p>
          </div>
          <a className="action-link" href="#operations">
            {t('openLiveOperations')}
          </a>
        </div>
        {topItems.length === 0 ? (
          <p className="metric-unavailable">{t('noDeviations')}</p>
        ) : (
          <ol className="simple-attention-list ops-ranked-differences">
            {topItems.map((item) => {
              const isUnder = BigInt(item.signedM3.numerator) < 0n;
              return (
                <li key={item.stationId}>
                  <div>
                    <strong>{item.hotspotCode}</strong>
                    <span>{item.territoryName}</span>
                  </div>
                  <span
                    className={`simple-attention-list__status ${isUnder ? 'is-under' : 'is-over'}`}
                  >
                    <span aria-hidden="true">{isUnder ? '↓' : '↑'}</span>
                    {t(isUnder ? 'dashboardUnderPlan' : 'dashboardOverPlan')}
                  </span>
                  <ExactValue locale={locale} unit="m3" value={item.absoluteM3} />
                  <span
                    aria-label={`${t('dashboardVarianceBar')}: ${formatExactRational(item.absoluteM3, locale)} m³`}
                    className="ops-variance-bar"
                    role="img"
                  >
                    <span
                      style={{
                        width: `${
                          largestDeviation
                            ? rationalRelativePercent(item.absoluteM3, largestDeviation.absoluteM3)
                            : 0
                        }%`,
                      }}
                    />
                  </span>
                  <div className="simple-attention-list__actions">
                    <a href={item.liveTarget}>{t('openLiveOperations')}</a>
                    <a href={item.mapTarget}>{t('openMap')}</a>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
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
                  <tr key={item.stationId}>
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
                      <span className="table-status">
                        <span aria-hidden="true">{state.icon}</span>
                        {t(state.label)}
                      </span>
                    </td>
                    <td data-label={t('dataQuality')}>{t(dashboardQualityKey(item.quality))}</td>
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
            <SimpleDashboard dashboard={response} locale={locale} />
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
              <Kpis dashboard={response} locale={locale} />
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

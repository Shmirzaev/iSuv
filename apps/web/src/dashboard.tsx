import type { DashboardPeriod, DashboardResponse } from '@isuv/contracts';
import type { ReactNode } from 'react';

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
} from './dashboard-model.js';

interface DashboardWorkspaceProps {
  locale: Locale;
  period: DashboardPeriod;
  response: DashboardResponse | null;
  state: 'loading' | 'ready' | 'unauthenticated' | 'forbidden' | 'unavailable';
  onPeriodChange: (period: DashboardPeriod) => void;
  onRetry: () => void;
}

function StatusLabel({
  locale,
  state,
}: {
  locale: Locale;
  state: DashboardResponse['kpis']['regionalInflow']['state'];
}) {
  const presentation = dashboardAssessmentPresentation(state);
  return (
    <span className={`dashboard-status dashboard-status--${state}`}>
      <span aria-hidden="true">{presentation.icon}</span>
      <span>{translate(locale, presentation.label)}</span>
    </span>
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
      <data value={`${value.numerator}/${value.denominator}`}>{formatExactRational(value)}</data>{' '}
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
    <section aria-labelledby="scenario-heading" className="scenario-record">
      <div>
        <p className="eyebrow">{t('syntheticScenario')}</p>
        <h2 id="scenario-heading">{t('dashboardHeading')}</h2>
        <p>{t('syntheticScenarioDetail')}</p>
      </div>
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
            <time dateTime={dashboard.referenceAt}>
              {formatDashboardTimestamp(dashboard.referenceAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>{t('knownAt')}</dt>
          <dd>
            <time dateTime={dashboard.knownAt}>{formatDashboardTimestamp(dashboard.knownAt)}</time>
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
    </section>
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
          {`${t('deviceConnectivityDenominator')}: ${connectivity.denominator}. ${t('deviceConnectivityDetail')}`}
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
          value={<ExactValue locale={locale} unit="m3" value={kpis.unexplainedBalance.value} />}
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
          <p className="metric-card__detail">{`${t('assessedStations')}: ${kpis.compliance.assessedDenominator}; ${t('onPlanCount')}: ${kpis.compliance.withinCount}; ${t('overCount')}: ${kpis.compliance.overCount}; ${t('underCount')}: ${kpis.compliance.underCount}`}</p>
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
          value={t('notAvailable')}
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
                      {`${formatDashboardTimestamp(item.assessedInterval.start)} — ${formatDashboardTimestamp(item.assessedInterval.end)}`}
                    </td>
                    <td data-label={t('durationMicroseconds')}>
                      <data value={item.durationMicroseconds}>
                        {formatExactDurationMicroseconds(item.durationMicroseconds)}
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
}: DashboardWorkspaceProps) {
  const t = (key: TranslationKey) => translate(locale, key);
  const responseMatchesPeriod = response?.scenario.period === period;
  const displayState = state === 'ready' && !responseMatchesPeriod ? 'unavailable' : state;
  return (
    <section aria-labelledby="dashboard-heading" className="dashboard-workspace">
      <div className="dashboard-workspace__intro">
        <div>
          <p className="eyebrow">{t('currentArea')}</p>
          <h2 id="dashboard-heading">{t('dashboardHeading')}</h2>
          <p>{t('dashboardDetail')}</p>
        </div>
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
      {displayState === 'ready' && response ? (
        <>
          <ScenarioRecord dashboard={response} locale={locale} />
          <Definitions dashboard={response} locale={locale} />
          <dl className="dashboard-windows">
            <div>
              <dt>{t('selectedPeriod')}</dt>
              <dd>{`${formatDashboardTimestamp(response.windows.selected.start)} — ${formatDashboardTimestamp(response.windows.selected.end)}`}</dd>
            </div>
            <div>
              <dt>{t('priorPeriod')}</dt>
              <dd>{`${formatDashboardTimestamp(response.windows.prior.start)} — ${formatDashboardTimestamp(response.windows.prior.end)}`}</dd>
            </div>
          </dl>
          <Coverage dashboard={response} locale={locale} />
          <Kpis dashboard={response} locale={locale} />
          <Comparison dashboard={response} locale={locale} />
          <Deviations dashboard={response} locale={locale} />
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

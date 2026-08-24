import { useEffect, useRef, useState } from 'react';
import { analyticsResponseSchema, type AnalyticsResponse } from '@isuv/contracts';
import { translate, type Locale, type TranslationKey } from '@isuv/i18n';
import { formatExactRational } from './dashboard-model.js';
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

type WorkspaceState =
  'loading' | 'ready' | 'empty' | 'unauthenticated' | 'forbidden' | 'unavailable' | 'degraded';
const t = (locale: Locale, key: TranslationKey) => translate(locale, key);

function M3({ value }: { value: { numerator: string; denominator: string } | null }) {
  return value ? (
    <data value={`${value.numerator}/${value.denominator}`}>{formatExactRational(value)} m³</data>
  ) : (
    <span className="metric-unavailable">—</span>
  );
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
        {icon}
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
  return (
    <span className="analytics-status">
      <span aria-hidden="true">{icon}</span>
      <span>{t(locale, label)}</span>
    </span>
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
      <header className="panel analytics-intro">
        <div>
          <p className="eyebrow">{t(locale, 'syntheticScenario')}</p>
          <h2 id="analytics-heading">{t(locale, 'analyticsHeading')}</h2>
          <p>{t(locale, 'analyticsDetail')}</p>
          <p>
            <strong>{t(locale, 'analyticsNoForecast')}</strong>
          </p>
          <p>
            <strong>{t(locale, 'analyticsOfficialIneligible')}</strong>
          </p>
        </div>
        <dl>
          <div>
            <dt>{t(locale, 'referenceAt')}</dt>
            <dd>{formatAnalyticsTimestamp(response.referenceAt)}</dd>
          </div>
          <div>
            <dt>{t(locale, 'knownAt')}</dt>
            <dd>{formatAnalyticsTimestamp(response.knownAt)}</dd>
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
      </header>
      <dl className="analytics-windows">
        <div>
          <dt>{t(locale, 'analyticsWindow')}</dt>
          <dd>{`${formatAnalyticsTimestamp(response.windows.selected.start)} — ${formatAnalyticsTimestamp(response.windows.selected.end)}`}</dd>
        </div>
        <div>
          <dt>{t(locale, 'analyticsPriorWindow')}</dt>
          <dd>{`${formatAnalyticsTimestamp(response.windows.prior.start)} — ${formatAnalyticsTimestamp(response.windows.prior.end)}`}</dd>
        </div>
      </dl>
    </>
  );
}

function Delivery({ locale, response }: { locale: Locale; response: AnalyticsResponse }) {
  const d = response.delivery;
  const state =
    d.state === 'assessed'
      ? { icon: '✓', label: 'analyticsAssessed' as const }
      : d.state === 'unconfigured'
        ? { icon: '⚙', label: 'analyticsNotConfigured' as const }
        : { icon: '⊘', label: 'analyticsUnassessable' as const };
  return (
    <section className="panel analytics-section" aria-labelledby="analytics-delivery">
      <h2 id="analytics-delivery">{t(locale, 'analyticsDelivery')}</h2>
      <p>{t(locale, 'analyticsDeliveryDetail')}</p>
      <Status locale={locale} {...state} />
      <p className="supporting-text">{d.exclusionNote}</p>
      <div className="metric-grid">
        <article className="metric-card">
          <h3>{t(locale, 'analyticsPlanned')}</h3>
          <M3 value={d.plannedM3} />
        </article>
        <article className="metric-card">
          <h3>{t(locale, 'analyticsActual')}</h3>
          <M3 value={d.actualM3} />
        </article>
        <article className="metric-card">
          <h3>{t(locale, 'analyticsSignedVariance')}</h3>
          <M3 value={d.signedVarianceM3} />
        </article>
        <article className="metric-card">
          <h3>{t(locale, 'analyticsAbsoluteVariance')}</h3>
          <M3 value={d.absoluteVarianceM3} />
        </article>
      </div>
      <p>{`${t(locale, 'analyticsAssessed')}: ${d.memberCounts.assessed}/${d.memberCounts.total}; ${t(locale, 'analyticsUnassessable')}: ${d.memberCounts.unassessable}; ${t(locale, 'analyticsOver')}: ${d.memberCounts.over}; ${t(locale, 'analyticsWithin')}: ${d.memberCounts.within}; ${t(locale, 'analyticsUnder')}: ${d.memberCounts.under}`}</p>
      <p>
        {`${t(locale, 'analyticsGroups')}: ${d.population.returned}/${d.population.defined}. `}
        {!d.population.complete ? `⊘ ${t(locale, 'analyticsUnassessable')}` : null}
      </p>
      {d.groups.length ? (
        <div className="table-scroll">
          <table>
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
                    <td>
                      <Status locale={locale} {...present} />
                      {group.reason ? <small>{group.reason}</small> : null}
                    </td>
                    <td>
                      <M3 value={group.plannedM3} />
                    </td>
                    <td>
                      <M3 value={group.actualM3} />
                    </td>
                    <td>
                      <M3 value={group.signedVarianceM3} />
                    </td>
                    <td>{t(locale, analyticsMethodKey(group.method))}</td>
                    <td>
                      {group.mapTarget ? <a href={group.mapTarget}>{t(locale, 'openMap')}</a> : '—'}
                    </td>
                    <td>
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
  return (
    <section className="panel analytics-section" aria-labelledby="analytics-matrix">
      <h2 id="analytics-matrix">{t(locale, 'analyticsMatrix')}</h2>
      <p>{t(locale, 'analyticsMatrixDetail')}</p>
      <div className="table-scroll">
        <table>
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
                  <td>{row.count}</td>
                  <td>
                    <M3 value={row.plannedM3} />
                  </td>
                  <td>
                    <M3 value={row.actualM3} />
                  </td>
                  <td>
                    <M3 value={row.absoluteVarianceM3} />
                  </td>
                </tr>
              );
            })}
            <tr>
              <th scope="row">
                <Status locale={locale} {...analyticsConditionPresentation('unassessable')} />
              </th>
              <td colSpan={4}>{response.deviationMatrix.unassessable.count}</td>
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
    <section className="panel analytics-section" aria-labelledby="analytics-balance">
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
      <dl className="analytics-balance-terms">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{t(locale, label)}</dt>
            <dd>
              <M3 value={value} />
            </dd>
          </div>
        ))}
      </dl>
      <p>
        <strong>{t(locale, 'provenance')}:</strong> {b.provenance};{' '}
        <strong>{t(locale, 'analyticsMethodVersion')}:</strong>{' '}
        {b.versionId ?? t(locale, 'analyticsNotConfigured')}
      </p>
      {b.components.length ? (
        <div className="table-scroll">
          <table>
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
                  <td>{t(locale, analyticsMethodKey(component.method))}</td>
                  <td>{formatMicros(component.travelTimeMicroseconds)}</td>
                  <td>{`${formatAnalyticsTimestamp(component.sourceInterval.start)} — ${formatAnalyticsTimestamp(component.sourceInterval.end)}`}</td>
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
  return (
    <section className="analytics-coverage" aria-label={t(locale, 'analyticsQuality')}>
      <article className="panel">
        <h2>{t(locale, 'analyticsQuality')}</h2>
        <p>{t(locale, 'analyticsQualityDetail')}</p>
        <p>{`${t(locale, 'analyticsCount')}: ${q.denominator}; ${t(locale, 'analyticsCompleteValid')}: ${q.completeValid}; ${t(locale, 'analyticsEstimatedExcluded')}: ${q.estimatedExcluded}; ${t(locale, 'analyticsUnreliable')}: ${q.unreliable}; ${t(locale, 'analyticsNoData')}: ${q.noData}; ${t(locale, 'analyticsNotConfigured')}: ${q.unconfigured}`}</p>
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
      <article className="panel">
        <h2>{t(locale, 'analyticsAvailability')}</h2>
        <p>{t(locale, 'analyticsAvailabilityDetail')}</p>
        <p>{`${t(locale, 'analyticsCount')}: ${a.denominator}; ${t(locale, 'analyticsCommunicating')}: ${a.communicating}; ${t(locale, 'analyticsOffline')}: ${a.offline}; ${t(locale, 'analyticsUnknownAvailability')}: ${a.unknown}`}</p>
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
          <span aria-hidden="true">—</span>
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

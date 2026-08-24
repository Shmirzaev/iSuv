import { useEffect, useRef, useState } from 'react';
import {
  reportListResponseSchema,
  reportResponseSchema,
  type DashboardPeriod,
  type ReportKind,
  type ReportSnapshot,
  type ReportSummary,
} from '@isuv/contracts';
import { translate, type Locale, type TranslationKey } from '@isuv/i18n';
import {
  defaultReportFilters,
  navigateReportPrint,
  reportExportPath,
  reportFileName,
  reportIdFromHash,
  reportKindKey,
  reportKinds,
  reportPath,
  reportPeriodKey,
  reportPeriods,
  reportQualityIcon,
  reportQualityKey,
  reportsHash,
  reportsListPath,
  reportTimestamp,
  type ReportFilters,
} from './reports-model.js';

type WorkspaceState =
  'loading' | 'ready' | 'empty' | 'unauthenticated' | 'forbidden' | 'unavailable' | 'degraded';
type ExportState = 'idle' | 'csv' | 'html' | 'failed';
const t = (locale: Locale, key: TranslationKey) => translate(locale, key);

function StateNotice({
  locale,
  state,
  retry,
}: {
  locale: Locale;
  state: Exclude<WorkspaceState, 'ready' | 'empty'>;
  retry: () => void;
}) {
  const detail: Record<
    Exclude<WorkspaceState, 'ready' | 'empty'>,
    [string, TranslationKey, TranslationKey, 'information' | 'warning' | 'unavailable']
  > = {
    loading: ['◌', 'reportsLoading', 'reportsLoadingDetail', 'information'],
    unauthenticated: ['⊘', 'reportsSignIn', 'reportsSignInDetail', 'warning'],
    forbidden: ['⊘', 'reportsSignIn', 'reportsSignInDetail', 'warning'],
    unavailable: ['!', 'reportsUnavailable', 'reportsUnavailableDetail', 'unavailable'],
    degraded: ['!', 'reportsDegraded', 'reportsDegradedDetail', 'warning'],
  };
  const [icon, title, body, tone] = detail[state];
  return (
    <section className={`status-notice status-notice--${tone}`} role="status">
      <span aria-hidden="true" className="status-notice__icon">
        {icon}
      </span>
      <div>
        <h2>{t(locale, title)}</h2>
        <p>{t(locale, body)}</p>
        {state !== 'loading' && state !== 'unauthenticated' && state !== 'forbidden' ? (
          <button className="action-button" onClick={retry} type="button">
            {t(locale, 'reportsRetry')}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function valueText(value: unknown): string {
  if (value === null) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return JSON.stringify(value);
}

function frozenPayloadRows(value: Record<string, unknown>): readonly [string, string][] {
  const rows: [string, string][] = [];
  const visit = (key: string, item: unknown) => {
    if (item === null || typeof item !== 'object') {
      rows.push([key, valueText(item)]);
      return;
    }
    if (Array.isArray(item)) {
      if (item.length === 0) rows.push([key, '[]']);
      else item.forEach((entry, index) => visit(`${key}[${index}]`, entry));
      return;
    }
    const entries = Object.entries(item as Record<string, unknown>);
    if (entries.length === 0) rows.push([key, '{}']);
    else
      entries.forEach(([childKey, child]) => visit(key ? `${key}.${childKey}` : childKey, child));
  };
  Object.entries(value).forEach(([key, item]) => visit(key, item));
  return rows;
}

type FrozenQuantity = { path: string; value: string };
function frozenQuantities(
  value: Record<string, unknown>,
): ReadonlyMap<string, readonly FrozenQuantity[]> {
  const groups = new Map<string, FrozenQuantity[]>();
  const visit = (path: string, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      if (Array.isArray(item)) item.forEach((entry, index) => visit(`${path}[${index}]`, entry));
      return;
    }
    const record = item as Record<string, unknown>;
    const unit = typeof record.unit === 'string' ? record.unit : null;
    if (unit && (typeof record.value === 'string' || typeof record.value === 'number')) {
      groups.set(unit, [...(groups.get(unit) ?? []), { path, value: String(record.value) }]);
      return;
    }
    if (unit && typeof record.numerator === 'string' && typeof record.denominator === 'string') {
      groups.set(unit, [
        ...(groups.get(unit) ?? []),
        { path, value: `${record.numerator}/${record.denominator}` },
      ]);
      return;
    }
    Object.entries(record).forEach(([key, child]) => visit(path ? `${path}.${key}` : key, child));
  };
  Object.entries(value).forEach(([key, item]) => visit(key, item));
  return groups;
}

function displayUnit(value: string): string {
  return value === 'm3' ? 'm³' : value === 'm3/s' ? 'm³/s' : value;
}

export function ReportTemplateForm({
  locale,
  filters,
  busy,
  onChange,
  onGenerate,
}: {
  locale: Locale;
  filters: ReportFilters;
  busy: boolean;
  onChange: (filters: ReportFilters) => void;
  onGenerate: () => void;
}) {
  const incident = filters.kind === 'incident';
  return (
    <form
      className="reports-template-form"
      onSubmit={(event) => {
        event.preventDefault();
        onGenerate();
      }}
    >
      <fieldset disabled={busy}>
        <legend>{t(locale, 'reportsTemplates')}</legend>
        <p>{t(locale, 'reportsTemplatesDetail')}</p>
        <div className="reports-template-form__grid">
          <label htmlFor="reports-kind">
            {t(locale, 'reportsKind')}
            <select
              id="reports-kind"
              onChange={(event) =>
                onChange({
                  ...filters,
                  kind: event.target.value as ReportKind,
                  incidentId: event.target.value === 'incident' ? filters.incidentId : '',
                })
              }
              value={filters.kind}
            >
              {reportKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {t(locale, reportKindKey(kind))}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="reports-period">
            {t(locale, 'reportsPeriod')}
            <select
              id="reports-period"
              onChange={(event) =>
                onChange({ ...filters, period: event.target.value as DashboardPeriod })
              }
              value={filters.period}
            >
              {reportPeriods.map((period) => (
                <option key={period} value={period}>
                  {t(locale, reportPeriodKey(period))}
                </option>
              ))}
            </select>
          </label>
          {incident ? (
            <label htmlFor="reports-incident-id">
              {t(locale, 'reportsIncidentId')}
              <input
                aria-describedby="reports-incident-help"
                id="reports-incident-id"
                onChange={(event) =>
                  onChange({ ...filters, incidentId: event.target.value.trim() })
                }
                required
                type="text"
                value={filters.incidentId}
              />
              <small id="reports-incident-help">{t(locale, 'reportsIncidentRequired')}</small>
            </label>
          ) : (
            <p className="reports-template-form__note">{t(locale, 'reportsIncidentNotUsed')}</p>
          )}
        </div>
        <button
          className="action-button"
          disabled={busy || (incident && !filters.incidentId)}
          id="reports-generate"
          type="submit"
        >
          {busy ? t(locale, 'reportsGenerating') : t(locale, 'reportsGenerate')}
        </button>
      </fieldset>
    </form>
  );
}

function SnapshotList({
  locale,
  reports,
  selectedId,
  onSelect,
}: {
  locale: Locale;
  reports: readonly ReportSummary[];
  selectedId: string | null;
  onSelect: (report: ReportSummary, focusId: string) => void;
}) {
  return (
    <section className="panel reports-list" aria-labelledby="reports-list-heading">
      <h2 id="reports-list-heading">{t(locale, 'reportsList')}</h2>
      <div className="reports-table-scroll">
        <table>
          <caption className="visually-hidden">{t(locale, 'reportsList')}</caption>
          <thead>
            <tr>
              <th scope="col">{t(locale, 'reportsKind')}</th>
              <th scope="col">{t(locale, 'reportsVersion')}</th>
              <th scope="col">{t(locale, 'reportsPeriod')}</th>
              <th scope="col">{t(locale, 'reportsQuality')}</th>
              <th scope="col">{t(locale, 'reportsGeneratedAt')}</th>
              <th scope="col">{t(locale, 'reportsSelect')}</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => {
              const focusId = `report-row-${report.id}`;
              return (
                <tr aria-current={selectedId === report.id ? 'true' : undefined} key={report.id}>
                  <td data-label={t(locale, 'reportsKind')}>
                    {t(locale, reportKindKey(report.kind))}
                  </td>
                  <td data-label={t(locale, 'reportsVersion')}>{report.version}</td>
                  <td data-label={t(locale, 'reportsPeriod')}>
                    {t(locale, reportPeriodKey(report.period))}
                  </td>
                  <td data-label={t(locale, 'reportsQuality')}>
                    <span className="reports-status">
                      <span aria-hidden="true">{reportQualityIcon(report.qualityState)}</span>
                      {t(locale, reportQualityKey(report.qualityState))}
                    </span>
                  </td>
                  <td data-label={t(locale, 'reportsGeneratedAt')}>
                    {reportTimestamp(report.generatedAt)}
                  </td>
                  <td data-label={t(locale, 'reportsSelect')}>
                    <button id={focusId} onClick={() => onSelect(report, focusId)} type="button">
                      {t(locale, 'reportsSelect')}
                    </button>
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

function SnapshotMetadata({ locale, report }: { locale: Locale; report: ReportSnapshot }) {
  const fields: readonly [TranslationKey, string | number][] = [
    ['reportsVersion', report.version],
    ['reportsTerritory', report.territoryId],
    ['reportsPeriod', t(locale, reportPeriodKey(report.period))],
    ['reportsReferenceAt', reportTimestamp(report.referenceAt)],
    ['reportsKnownAt', reportTimestamp(report.knownAt)],
    ['reportsGeneratedAt', reportTimestamp(report.generatedAt)],
    ['reportsGenerator', report.generatedByUserId],
    ['reportsApproval', t(locale, 'reportsApprovalGeneratedNotApproved')],
    ['reportsMethod', `${report.method.id} v${report.method.version}`],
    ['reportsFingerprint', report.fingerprint],
  ];
  return (
    <>
      <dl className="reports-metadata">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{t(locale, label)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div>
          <dt>{t(locale, 'reportsQuality')}</dt>
          <dd className="reports-status">
            <span aria-hidden="true">{reportQualityIcon(report.qualityState)}</span>
            {t(locale, reportQualityKey(report.qualityState))}
          </dd>
        </div>
      </dl>
      <section className="reports-source" aria-labelledby="reports-source-heading">
        <h3 id="reports-source-heading">{t(locale, 'reportsSourceSnapshot')}</h3>
        <dl className="reports-metadata">
          <div>
            <dt>{t(locale, 'reportsScenario')}</dt>
            <dd>{report.sourceSnapshot.analyticsScenarioId}</dd>
          </div>
          <div>
            <dt>{t(locale, 'reportsScenarioVersion')}</dt>
            <dd>{report.sourceSnapshot.analyticsScenarioVersion}</dd>
          </div>
          <div>
            <dt>{t(locale, 'reportsSourceRevisionPolicy')}</dt>
            <dd>{report.sourceSnapshot.sourceRevisionPolicy}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}

function FrozenPayload({ locale, report }: { locale: Locale; report: ReportSnapshot }) {
  const quantities = frozenQuantities(report.payload);
  const quantityPaths = new Set([...quantities.values()].flat().map((quantity) => quantity.path));
  const rows = frozenPayloadRows(report.payload).filter(
    ([field]) => ![...quantityPaths].some((path) => field === path || field.startsWith(`${path}.`)),
  );
  return (
    <section className="reports-payload" aria-labelledby="reports-payload-heading">
      <h3 id="reports-payload-heading">{t(locale, 'reportsPayload')}</h3>
      <p>{t(locale, 'reportsPayloadDetail')}</p>
      <div className="reports-table-scroll">
        <table>
          <caption>{t(locale, 'reportsPayload')}</caption>
          <thead>
            <tr>
              <th scope="col">{t(locale, 'reportsField')}</th>
              <th scope="col">{t(locale, 'reportsValue')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([field, value], index) => (
              <tr key={`${field}-${index}`}>
                <th scope="row">{field}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {[...quantities.entries()].map(([unit, values]) => (
        <section
          className="reports-quantity-table"
          aria-label={`${t(locale, 'reportsPayload')} (${displayUnit(unit)})`}
          key={unit}
        >
          <h4>{`${t(locale, 'reportsPayload')} — ${displayUnit(unit)}`}</h4>
          <div className="reports-table-scroll">
            <table>
              <caption>{`${t(locale, 'reportsPayload')} — ${displayUnit(unit)}`}</caption>
              <thead>
                <tr>
                  <th scope="col">{t(locale, 'reportsField')}</th>
                  <th scope="col">{displayUnit(unit)}</th>
                </tr>
              </thead>
              <tbody>
                {values.map((quantity) => (
                  <tr key={quantity.path}>
                    <th scope="row">{quantity.path}</th>
                    <td>{quantity.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </section>
  );
}

export function ReportSnapshotDetail({
  locale,
  report,
  exportState,
  exportMessage,
  onClose,
  onExport,
}: {
  locale: Locale;
  report: ReportSnapshot;
  exportState: ExportState;
  exportMessage: string | null;
  onClose: () => void;
  onExport: (format: 'csv' | 'html') => void;
}) {
  const exporting = exportState === 'csv' || exportState === 'html';
  return (
    <article className="panel reports-detail" aria-labelledby="reports-detail-heading">
      <p className="eyebrow">{t(locale, 'syntheticScenario')}</p>
      <h2 id="reports-detail-heading">{t(locale, 'reportsDetailHeading')}</h2>
      <p>
        <strong>{t(locale, 'reportsKind')}:</strong> {t(locale, reportKindKey(report.kind))}
      </p>
      <p className="reports-authority">⚠ {t(locale, 'reportsSyntheticNonOfficial')}</p>
      <p>{t(locale, 'reportsUncertaintyUnavailable')}</p>
      <p>{t(locale, 'reportsResidualCaveat')}</p>
      <p>{t(locale, 'reportsAvailabilityCaveat')}</p>
      <p>{t(locale, 'reportsNoForecast')}</p>
      <section aria-labelledby="reports-measurement-boundary-heading">
        <h3 id="reports-measurement-boundary-heading">{t(locale, 'measurementBoundary')}</h3>
        <dl className="reports-metadata">
          <div>
            <dt>{t(locale, 'stage')}</dt>
            <dd>{t(locale, 'stageUnit')}</dd>
          </div>
          <div>
            <dt>{t(locale, 'discharge')}</dt>
            <dd>{t(locale, 'dischargeUnit')}</dd>
          </div>
          <div>
            <dt>{t(locale, 'volume')}</dt>
            <dd>{t(locale, 'volumeUnit')}</dd>
          </div>
        </dl>
      </section>
      <SnapshotMetadata locale={locale} report={report} />
      <section aria-labelledby="reports-provenance-heading">
        <h3 id="reports-provenance-heading">{t(locale, 'reportsProvenance')}</h3>
        <p>{report.provenance.label}</p>
      </section>
      <section aria-labelledby="reports-caveats-heading">
        <h3 id="reports-caveats-heading">{t(locale, 'reportsCaveats')}</h3>
        <ul>
          {report.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </section>
      <FrozenPayload locale={locale} report={report} />
      <div className="reports-actions">
        <a href={reportsHash(report.id)}>{t(locale, 'reportsStableLink')}</a>
        <button disabled={exporting} onClick={() => onExport('csv')} type="button">
          {exportState === 'csv' ? t(locale, 'reportsExporting') : t(locale, 'reportsCsv')}
        </button>
        <button disabled={exporting} onClick={() => onExport('html')} type="button">
          {exportState === 'html' ? t(locale, 'reportsExporting') : t(locale, 'reportsPrint')}
        </button>
        <button onClick={onClose} type="button">
          {t(locale, 'reportsClose')}
        </button>
      </div>
      {exportMessage ? <p role="status">{exportMessage}</p> : null}
    </article>
  );
}

export function ReportsWorkspace({
  locale,
  access,
}: {
  locale: Locale;
  access: 'loading' | 'ready' | 'unauthenticated' | 'unavailable';
}) {
  const [filters, setFilters] = useState<ReportFilters>(defaultReportFilters);
  const [reports, setReports] = useState<readonly ReportSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    reportIdFromHash(typeof window === 'undefined' ? '' : window.location.hash),
  );
  const [selected, setSelected] = useState<ReportSnapshot | null>(null);
  const [state, setState] = useState<WorkspaceState>('loading');
  const [retry, setRetry] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generationMessage, setGenerationMessage] = useState<string | null>(null);
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const returnFocus = useRef<string | null>(null);

  useEffect(() => {
    const onHash = () => setSelectedId(reportIdFromHash(window.location.hash));
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
    void fetch(reportsListPath(), { signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (response.ok) {
          const parsed = reportListResponseSchema.safeParse(body);
          if (parsed.success) {
            setReports(parsed.data.reports);
            setState(parsed.data.reports.length ? 'ready' : 'empty');
          } else setState('degraded');
        } else
          setState(
            response.status === 401
              ? 'unauthenticated'
              : response.status === 403 || response.status === 404
                ? 'forbidden'
                : 'unavailable',
          );
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setState('unavailable');
      });
    return () => controller.abort();
  }, [access, retry]);

  useEffect(() => {
    if (!selectedId || access !== 'ready') {
      setSelected(null);
      return;
    }
    const controller = new AbortController();
    void fetch(reportPath(selectedId), { signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          setSelected(null);
          return;
        }
        const parsed = reportResponseSchema.safeParse(body);
        setSelected(parsed.success ? parsed.data.report : null);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setSelected(null);
      });
    return () => controller.abort();
  }, [access, selectedId]);

  useEffect(() => {
    if (selectedId || !returnFocus.current) return;
    const focusId = returnFocus.current;
    const frame = requestAnimationFrame(() => document.getElementById(focusId)?.focus());
    returnFocus.current = null;
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);

  const setSelection = (reportId: string | null) => {
    if (typeof window !== 'undefined') window.location.hash = reportsHash(reportId);
    setSelectedId(reportId);
  };
  const select = (report: ReportSummary, focusId: string) => {
    returnFocus.current = focusId;
    setSelection(report.id);
  };
  const generate = async () => {
    returnFocus.current = 'reports-generate';
    setGenerating(true);
    setGenerationMessage(null);
    try {
      const body = {
        kind: filters.kind,
        period: filters.period,
        ...(filters.kind === 'incident' ? { incidentId: filters.incidentId } : {}),
      };
      const response = await fetch('/api/v1/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json().catch(() => null);
      const parsed = response.ok ? reportResponseSchema.safeParse(payload) : null;
      if (!parsed?.success) {
        setGenerationMessage(t(locale, 'reportsGenerationFailed'));
        return;
      }
      const report = parsed.data.report;
      setReports((current) => [report, ...current.filter((item) => item.id !== report.id)]);
      setState('ready');
      setSelected(report);
      setSelection(report.id);
    } catch {
      setGenerationMessage(t(locale, 'reportsGenerationFailed'));
    } finally {
      setGenerating(false);
    }
  };
  const exportFrozen = async (format: 'csv' | 'html') => {
    if (!selected) return;
    // Reserve a browsing context while the click still has transient user activation.
    // If a popup policy denies it, the audited HTML replaces this tab instead.
    const printPreview = format === 'html' ? window.open('about:blank', 'isuv-report-print') : null;
    if (printPreview) printPreview.opener = null;
    setExportState(format);
    setExportMessage(null);
    try {
      const response = await fetch(reportExportPath(selected.id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format }),
      });
      if (!response.ok) throw new Error('Export rejected');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (format === 'csv') {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = reportFileName(selected, 'csv');
        anchor.hidden = true;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setExportMessage(t(locale, 'reportsExportDownloaded'));
      } else {
        navigateReportPrint(printPreview, window, url);
        setExportMessage(t(locale, 'reportsPrintOpened'));
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch {
      printPreview?.close();
      setExportState('failed');
      setExportMessage(t(locale, 'reportsExportFailed'));
      return;
    }
    setExportState('idle');
  };

  if (state !== 'ready' && state !== 'empty')
    return (
      <StateNotice locale={locale} retry={() => setRetry((value) => value + 1)} state={state} />
    );
  return (
    <section
      className="reports-workspace"
      aria-busy={generating || undefined}
      aria-labelledby="reports-heading"
    >
      <header className="panel reports-intro">
        <p className="eyebrow">{t(locale, 'syntheticScenario')}</p>
        <h2 id="reports-heading">{t(locale, 'reportsHeading')}</h2>
        <p>{t(locale, 'reportsDetail')}</p>
        <p className="reports-authority">⚠ {t(locale, 'reportsSyntheticNonOfficial')}</p>
      </header>
      <ReportTemplateForm
        busy={generating}
        filters={filters}
        locale={locale}
        onChange={setFilters}
        onGenerate={() => void generate()}
      />
      {generationMessage ? <p role="status">{generationMessage}</p> : null}
      {state === 'empty' ? (
        <section className="status-notice status-notice--information" aria-live="polite">
          <span aria-hidden="true" className="status-notice__icon">
            —
          </span>
          <div>
            <h2>{t(locale, 'reportsNoReports')}</h2>
            <p>{t(locale, 'reportsNoReportsDetail')}</p>
          </div>
        </section>
      ) : (
        <SnapshotList locale={locale} onSelect={select} reports={reports} selectedId={selectedId} />
      )}
      {selected ? (
        <ReportSnapshotDetail
          exportMessage={exportMessage}
          exportState={exportState}
          locale={locale}
          onClose={() => setSelection(null)}
          onExport={(format) => void exportFrozen(format)}
          report={selected}
        />
      ) : selectedId ? (
        <section className="status-notice status-notice--warning" role="status">
          <span aria-hidden="true" className="status-notice__icon">
            ⊘
          </span>
          <div>
            <h2>{t(locale, 'reportsNoSelection')}</h2>
          </div>
        </section>
      ) : null}
    </section>
  );
}

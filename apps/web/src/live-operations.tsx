import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  liveOperationsInspectorSchema,
  liveOperationsResponseSchema,
  type LiveOperationsInspector,
  type LiveOperationsResponse,
} from '@isuv/contracts';

import { translate, type Locale, type TranslationKey } from '@isuv/i18n';

import {
  formatLiveAge,
  inspectorHeadingId,
  inspectorTrendRows,
  liveAttentionPresentation,
  liveDataStatePresentation,
  liveEventsPath,
  liveInspectorPath,
  liveOperationsPath,
  livePaginationRange,
  qualityKey,
  rowLabel,
  streamFailureState,
  streamPresentation,
  type LiveFilters,
  type StreamState,
} from './live-operations-model.js';
import {
  formatDecimal,
  formatFixedDecimal,
  formatMeasurementValue,
  measurementUnitLabel,
  presentationTimestamp,
} from './format.js';
import { FilterPanel } from './filter-panel.js';
import { LiveTrendChart } from './live-trend-chart.js';
import { StatusChip } from './status-chip.js';
import { WorkspaceHeader } from './workspace-header.js';
import { joinProvenance } from './provenance-text.js';

type WorkspaceState =
  'loading' | 'ready' | 'empty' | 'unauthenticated' | 'forbidden' | 'unavailable';

interface LiveOperationsWorkspaceProps {
  locale: Locale;
  access: 'loading' | 'ready' | 'unauthenticated' | 'unavailable';
  selectedDeviceId: string | null;
  onDeviceChange: (deviceId: string | null) => void;
}

const emptyFilters: LiveFilters = {};

function t(locale: Locale, key: TranslationKey): string {
  return translate(locale, key);
}

function PresentationTime({ locale, value }: { locale: Locale; value: string | null }) {
  if (!value) return <>—</>;
  const presentation = presentationTimestamp(locale, value);
  return (
    <time dateTime={presentation.dateTime} title={presentation.title}>
      {presentation.value}
    </time>
  );
}

function StateNotice({
  locale,
  state,
  retry,
}: {
  locale: Locale;
  state: Exclude<WorkspaceState, 'ready'>;
  retry: () => void;
}) {
  const content: Record<
    Exclude<WorkspaceState, 'ready' | 'empty'>,
    [string, TranslationKey, TranslationKey]
  > = {
    loading: ['◌', 'liveLoading', 'liveLoadingDetail'],
    unauthenticated: ['⊘', 'liveSignIn', 'liveSignInDetail'],
    forbidden: ['⊘', 'liveForbidden', 'liveForbiddenDetail'],
    unavailable: ['!', 'liveUnavailable', 'liveUnavailableDetail'],
  };
  if (state === 'empty')
    return (
      <section aria-live="polite" className="status-notice status-notice--information">
        <span aria-hidden="true" className="status-notice__icon">
          —
        </span>
        <div>
          <h2>{t(locale, 'liveEmpty')}</h2>
          <p>{t(locale, 'liveEmptyDetail')}</p>
        </div>
      </section>
    );
  const [icon, heading, detail] = content[state];
  return (
    <section
      aria-live="polite"
      className={`status-notice status-notice--${state === 'unavailable' ? 'unavailable' : 'warning'}`}
    >
      <span aria-hidden="true" className="status-notice__icon">
        {icon}
      </span>
      <div>
        <h2>{t(locale, heading)}</h2>
        <p>{t(locale, detail)}</p>
        {state === 'unavailable' ? (
          <button className="action-button" type="button" onClick={retry}>
            {t(locale, 'liveRetry')}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Quantity({
  locale,
  quantity,
}: {
  locale: Locale;
  quantity: LiveOperationsResponse['rows'][number]['quantities']['stage'];
}) {
  const presentation = liveDataStatePresentation(quantity.dataState);
  const detail = joinProvenance([
    t(locale, qualityKey(quantity.quality)),
    quantity.qualityReason,
    quantity.source.label,
    t(locale, quantity.source.official ? 'liveOfficialSource' : 'liveNonOfficialSource'),
  ]);
  const unit = measurementUnitLabel(quantity.unit);
  return (
    <div className={`live-quantity live-quantity--${quantity.dataState}`}>
      <strong
        title={
          quantity.value === null ? undefined : `${t(locale, 'liveRaw')}: ${quantity.value} ${unit}`
        }
      >
        {quantity.value === null
          ? '—'
          : formatMeasurementValue(locale, quantity.value, quantity.unit)}
        {quantity.value === null ? '' : ` ${unit}`}
      </strong>
      <StatusChip
        detail={detail}
        icon={presentation.icon}
        label={t(locale, presentation.label)}
        tone={quantity.dataState === 'reported' ? 'positive' : 'attention'}
        hatch={quantity.dataState !== 'reported'}
      />
      <span className="visually-hidden">
        <span aria-hidden="true">{presentation.icon}</span>
        {t(locale, presentation.label)}
      </span>
      <small className="visually-hidden">{t(locale, qualityKey(quantity.quality))}</small>
      {quantity.qualityReason ? (
        <small className="visually-hidden">{quantity.qualityReason}</small>
      ) : null}
      <small className="visually-hidden">
        {joinProvenance([
          quantity.source.label,
          t(locale, quantity.source.official ? 'liveOfficialSource' : 'liveNonOfficialSource'),
        ])}
      </small>
    </div>
  );
}

function GovernedPlaceholder({ locale, reason }: { locale: Locale; reason: string }) {
  return (
    <div className="live-placeholder">
      <StatusChip
        icon="⚙"
        label={t(locale, 'liveNotConfigured')}
        detail={reason}
        tone="attention"
      />
      <span className="visually-hidden">{reason}</span>
    </div>
  );
}

type TrendPoint = LiveOperationsInspector['trend'][number];

function TrendReading({
  locale,
  point,
}: {
  locale: Locale;
  point: readonly TrendPoint[] | undefined;
}) {
  if (!point?.length)
    return <span className="live-trend-reading live-trend-reading--absent">—</span>;
  return (
    <>
      {point.map((entry, index) => (
        <TrendReadingItem key={`${entry.at}-${index}`} locale={locale} point={entry} />
      ))}
    </>
  );
}

function TrendReadingItem({ locale, point }: { locale: Locale; point: TrendPoint }) {
  const unit = measurementUnitLabel(point.unit);
  const display = (kind: 'raw' | 'validated') => {
    const raw = point[kind];
    return raw === null ? '—' : `${formatMeasurementValue(locale, raw, point.unit)} ${unit}`;
  };
  return (
    <span className={`live-trend-reading${point.gap ? ' live-trend-reading--gap' : ''}`}>
      <span title={point.raw === null ? undefined : `${point.raw} ${unit}`}>
        <small>{t(locale, 'liveRaw')}</small> {display('raw')}
      </span>
      <span title={point.validated === null ? undefined : `${point.validated} ${unit}`}>
        <small>{t(locale, 'liveValidated')}</small> {display('validated')}
      </span>
    </span>
  );
}

function pivotTrend(points: readonly TrendPoint[]) {
  const rows = new Map<string, Partial<Record<TrendPoint['kind'], TrendPoint[]>>>();
  for (const point of points) {
    const row = rows.get(point.at) ?? {};
    row[point.kind] = [...(row[point.kind] ?? []), point];
    rows.set(point.at, row);
  }
  return [...rows.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function RevisionLedger({
  locale,
  revisions,
}: {
  locale: Locale;
  revisions: LiveOperationsInspector['revisions'];
}) {
  const groups = new Map<string, LiveOperationsInspector['revisions'][number][]>();
  for (const revision of revisions) {
    const key = revision.lineageId ?? `${revision.unit}-${revision.observedAt}`;
    groups.set(key, [...(groups.get(key) ?? []), revision]);
  }
  if (!revisions.length) return <p className="metric-unavailable">—</p>;
  return (
    <div className="live-revision-ledger">
      {[...groups.entries()].map(([lineage, entries]) => {
        const ordered = [...entries].sort((a, b) => a.revision - b.revision);
        const original = ordered[0]!;
        const corrected = ordered.at(-1)!;
        const unit = measurementUnitLabel(corrected.unit);
        return (
          <article key={`${lineage}-${corrected.revision}`}>
            <div className="live-revision-ledger__values">
              {ordered.length > 1 ? (
                <p>
                  <strong>{t(locale, 'liveOriginal')}</strong>{' '}
                  <del
                    title={`${t(locale, 'liveRaw')}: ${original.value} ${measurementUnitLabel(original.unit)}`}
                  >
                    {formatMeasurementValue(locale, original.value, original.unit)}{' '}
                    {measurementUnitLabel(original.unit)}
                  </del>
                </p>
              ) : null}
              <p className="live-revision-ledger__corrected">
                <strong>
                  {ordered.length > 1 ? t(locale, 'liveCorrected') : t(locale, 'liveRevision')}
                </strong>{' '}
                <ins title={`${t(locale, 'liveRaw')}: ${corrected.value} ${unit}`}>
                  {formatMeasurementValue(locale, corrected.value, corrected.unit)} {unit}
                </ins>
              </p>
            </div>
            <dl>
              <div>
                <dt>{t(locale, 'liveWorkflow')}</dt>
                <dd>{corrected.workflow}</dd>
              </div>
              <div>
                <dt>{t(locale, 'dataQuality')}</dt>
                <dd>{t(locale, qualityKey(corrected.quality))}</dd>
              </div>
              <div>
                <dt>{t(locale, 'liveReason')}</dt>
                <dd>{corrected.reason ?? original.reason ?? '—'}</dd>
              </div>
              <div>
                <dt>{t(locale, 'liveActor')}</dt>
                <dd>{t(locale, 'notAvailable')}</dd>
              </div>
              <div>
                <dt>{t(locale, 'source')}</dt>
                <dd>
                  {joinProvenance([
                    corrected.source.label,
                    t(
                      locale,
                      corrected.source.official ? 'liveOfficialSource' : 'liveNonOfficialSource',
                    ),
                  ])}
                </dd>
              </div>
              <div>
                <dt>{t(locale, 'liveTrendAt')}</dt>
                <dd>
                  <PresentationTime locale={locale} value={corrected.observedAt} />
                </dd>
              </div>
              <div>
                <dt>{t(locale, 'liveIngestedAt')}</dt>
                <dd>
                  <PresentationTime locale={locale} value={corrected.ingestedAt} />
                </dd>
              </div>
            </dl>
            <ol className="live-revision-ledger__history">
              {ordered.map((revision) => (
                <li key={`${revision.observationId ?? 'synthetic'}-${revision.revision}`}>
                  <strong>
                    {t(locale, 'liveRevision')} {revision.revision}
                  </strong>{' '}
                  <span
                    title={`${t(locale, 'liveRaw')}: ${revision.value} ${measurementUnitLabel(revision.unit)}`}
                  >
                    {formatMeasurementValue(locale, revision.value, revision.unit)}{' '}
                    {measurementUnitLabel(revision.unit)}
                  </span>
                  <dl>
                    <div>
                      <dt>{t(locale, 'liveWorkflow')}</dt>
                      <dd>{revision.workflow}</dd>
                    </div>
                    <div>
                      <dt>{t(locale, 'dataQuality')}</dt>
                      <dd>{t(locale, qualityKey(revision.quality))}</dd>
                    </div>
                    <div>
                      <dt>{t(locale, 'liveReason')}</dt>
                      <dd>{revision.reason ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>{t(locale, 'source')}</dt>
                      <dd>
                        {joinProvenance([
                          revision.source.label,
                          revision.source.provenance,
                          t(
                            locale,
                            revision.source.official
                              ? 'liveOfficialSource'
                              : 'liveNonOfficialSource',
                          ),
                        ])}
                      </dd>
                    </div>
                    <div>
                      <dt>{t(locale, 'liveTrendAt')}</dt>
                      <dd>
                        <PresentationTime locale={locale} value={revision.observedAt} />
                      </dd>
                    </div>
                    <div>
                      <dt>{t(locale, 'liveIngestedAt')}</dt>
                      <dd>
                        <PresentationTime locale={locale} value={revision.ingestedAt} />
                      </dd>
                    </div>
                    <div>
                      <dt>Observation ID</dt>
                      <dd>
                        <code>{revision.observationId ?? '—'}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Lineage ID</dt>
                      <dd>
                        <code>{revision.lineageId ?? '—'}</code>
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>
          </article>
        );
      })}
    </div>
  );
}

function maintenanceTypeKey(
  type: Extract<
    LiveOperationsInspector['maintenance'],
    { state: 'synthetic_history' }
  >['records'][number]['type'],
): TranslationKey {
  const keys = {
    inspection: 'maintenanceInspection',
    preventive: 'maintenancePreventive',
    corrective: 'maintenanceCorrective',
    calibration: 'maintenanceCalibration',
  } as const satisfies Record<typeof type, TranslationKey>;
  return keys[type];
}

function maintenanceStatusKey(
  status: Extract<
    LiveOperationsInspector['maintenance'],
    { state: 'synthetic_history' }
  >['records'][number]['status'],
): TranslationKey {
  const keys = {
    planned: 'maintenancePlanned',
    scheduled: 'maintenanceScheduledStatus',
    in_progress: 'maintenanceInProgress',
    completed: 'maintenanceCompleted',
    cancelled: 'maintenanceCancelled',
  } as const satisfies Record<typeof status, TranslationKey>;
  return keys[status];
}

function MaintenanceHistory({
  locale,
  maintenance,
}: {
  locale: Locale;
  maintenance: LiveOperationsInspector['maintenance'];
}) {
  if (maintenance.state === 'unconfigured')
    return (
      <section aria-labelledby="live-maintenance-heading">
        <h3 id="live-maintenance-heading">{t(locale, 'liveMaintenanceHistory')}</h3>
        <GovernedPlaceholder locale={locale} reason={maintenance.reason} />
      </section>
    );
  return (
    <section aria-labelledby="live-maintenance-heading">
      <h3 id="live-maintenance-heading">{t(locale, 'liveMaintenanceHistory')}</h3>
      <p className="supporting-text">{t(locale, 'maintenanceNonOfficial')}</p>
      {maintenance.records.length === 0 ? (
        <p className="metric-unavailable">{t(locale, 'liveMaintenanceNoRecords')}</p>
      ) : (
        <ol className="maintenance-record-list">
          {maintenance.records.map((record) => (
            <li key={record.id}>
              <article>
                <h4>
                  {t(locale, maintenanceTypeKey(record.type))} —{' '}
                  {t(locale, maintenanceStatusKey(record.status))}
                </h4>
                <dl className="live-inspector__details">
                  <div>
                    <dt>{t(locale, 'maintenanceType')}</dt>
                    <dd>{t(locale, maintenanceTypeKey(record.type))}</dd>
                  </div>
                  <div>
                    <dt>{t(locale, 'maintenanceStatus')}</dt>
                    <dd>{t(locale, maintenanceStatusKey(record.status))}</dd>
                  </div>
                  <div>
                    <dt>{t(locale, 'maintenanceScheduled')}</dt>
                    <dd>
                      <PresentationTime locale={locale} value={record.scheduledInterval.start} /> —{' '}
                      <PresentationTime locale={locale} value={record.scheduledInterval.end} />
                    </dd>
                  </div>
                  <div>
                    <dt>{t(locale, 'maintenanceActual')}</dt>
                    <dd>
                      <PresentationTime locale={locale} value={record.startedAt} /> /{' '}
                      <PresentationTime locale={locale} value={record.completedAt} />
                    </dd>
                  </div>
                  <div>
                    <dt>{t(locale, 'maintenanceRecordedAt')}</dt>
                    <dd>
                      <PresentationTime locale={locale} value={record.recordedAt} />
                    </dd>
                  </div>
                  <div>
                    <dt>{t(locale, 'maintenanceAuditEvidence')}</dt>
                    <dd className="stable-identifier">{record.auditEventId}</dd>
                  </div>
                  <div>
                    <dt>{t(locale, 'maintenanceProvenance')}</dt>
                    <dd>{record.provenance}</dd>
                  </div>
                  <div>
                    <dt>{t(locale, 'source')}</dt>
                    <dd>{t(locale, 'maintenanceNonOfficial')}</dd>
                  </div>
                </dl>
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function DeviceHealthStatus({
  locale,
  health,
}: {
  locale: Locale;
  health: LiveOperationsResponse['rows'][number]['health'];
}) {
  const connection =
    health.connection === 'communicating'
      ? 'liveCommunicating'
      : health.connection === 'offline'
        ? 'liveOffline'
        : 'liveUnknown';
  const fault =
    health.fault === 'reported'
      ? 'deviceFault'
      : health.fault === 'none'
        ? 'liveNoFault'
        : 'liveUnknown';
  const condition =
    health.dataCondition === 'current'
      ? 'liveDataCurrent'
      : health.dataCondition === 'stale'
        ? 'liveDataStale'
        : health.dataCondition === 'unreliable'
          ? 'statusUnreliable'
          : health.dataCondition === 'no_data'
            ? 'noData'
            : health.dataCondition === 'unconfigured'
              ? 'statusUnconfigured'
              : 'liveUnknown';
  const detail = `${t(locale, 'liveConnection')}: ${t(locale, connection)}; ${t(locale, 'liveFault')}: ${t(locale, fault)}${health.faultCode ? ` (${health.faultCode})` : ''}; ${t(locale, 'dataState')}: ${t(locale, condition)}`;
  return (
    <section aria-label={t(locale, 'liveDeviceHealth')} className="live-health-status">
      <p>{detail}</p>
    </section>
  );
}

function LiveStatusCompact({
  locale,
  row,
}: {
  locale: Locale;
  row: LiveOperationsResponse['rows'][number];
}) {
  const health = row.health;
  const attention = liveAttentionPresentation(row.attention.state);
  const connectionLabel: TranslationKey =
    health.connection === 'communicating'
      ? 'liveCommunicating'
      : health.connection === 'offline'
        ? 'liveOffline'
        : 'liveUnknown';
  const faultLabel: TranslationKey =
    health.fault === 'reported'
      ? 'deviceFault'
      : health.fault === 'none'
        ? 'liveNoFault'
        : 'liveUnknown';
  const conditionLabel: TranslationKey =
    health.dataCondition === 'current'
      ? 'liveDataCurrent'
      : health.dataCondition === 'stale'
        ? 'liveDataStale'
        : health.dataCondition === 'unreliable'
          ? 'statusUnreliable'
          : health.dataCondition === 'no_data'
            ? 'noData'
            : health.dataCondition === 'unconfigured'
              ? 'statusUnconfigured'
              : 'liveUnknown';
  const connectionIcon =
    health.connection === 'communicating' ? '↔' : health.connection === 'offline' ? '⊘' : '?';
  const conditionIcon =
    health.dataCondition === 'current'
      ? '✓'
      : health.dataCondition === 'stale'
        ? '◷'
        : health.dataCondition === 'unreliable'
          ? '!'
          : health.dataCondition === 'no_data'
            ? '—'
            : health.dataCondition === 'unconfigured'
              ? '⚙'
              : '?';
  const summary = `${t(locale, 'liveWaterStatus')}: ${t(locale, attention.label)}; ${t(locale, 'liveDeviceHealth')}: ${t(locale, connectionLabel)} · ${t(locale, faultLabel)}${health.faultCode ? ` (${health.faultCode})` : ''} · ${t(locale, conditionLabel)}; ${t(locale, 'liveNotConfigured')}: ${row.governed.waterStatus.reason}`;

  return (
    <div className="live-status-compact">
      <div className="live-status-compact__line">
        <span>{t(locale, 'liveWaterLabel')}:</span>
        <StatusChip
          detail={summary}
          icon={attention.icon}
          label={t(locale, attention.label)}
          tone={row.attention.state === 'reported' ? 'positive' : 'attention'}
          hatch={row.attention.state === 'no_data' || row.attention.state === 'unreliable'}
        />
      </div>
      <div className="live-status-compact__line">
        <span>{t(locale, 'liveDevice')}:</span>
        {health.fault === 'reported' ? (
          <StatusChip icon="!" label={t(locale, 'deviceFault')} tone="critical" hatch />
        ) : health.dataCondition !== 'current' ? (
          <StatusChip
            icon={conditionIcon}
            label={t(locale, conditionLabel)}
            tone="attention"
            hatch={
              health.dataCondition === 'stale' ||
              health.dataCondition === 'unreliable' ||
              health.dataCondition === 'no_data'
            }
          />
        ) : (
          <StatusChip
            icon={connectionIcon}
            label={t(locale, connectionLabel)}
            tone={health.connection === 'communicating' ? 'positive' : 'attention'}
          />
        )}
      </div>
      <span className="visually-hidden">{summary}</span>
    </div>
  );
}

function MobileStationSummary({
  locale,
  row,
  onSelect,
}: {
  locale: Locale;
  row: LiveOperationsResponse['rows'][number];
  onSelect: (deviceId: string) => void;
}) {
  const attention = liveAttentionPresentation(row.attention.state);
  const deviceAbnormal =
    row.health.fault === 'reported'
      ? { icon: '!', label: 'deviceFault' as TranslationKey, hatch: true }
      : row.health.dataCondition === 'stale'
        ? { icon: '◷', label: 'liveDataStale' as TranslationKey, hatch: true }
        : row.health.dataCondition === 'unreliable'
          ? { icon: '!', label: 'statusUnreliable' as TranslationKey, hatch: true }
          : row.health.dataCondition === 'no_data'
            ? { icon: '—', label: 'noData' as TranslationKey, hatch: true }
            : null;
  const quantities = [
    row.quantities.stage,
    row.quantities.discharge,
    row.quantities.accumulatedCounter,
  ].filter((quantity) => quantity.value !== null);
  const unavailable = [
    row.governed.plan.state === 'unconfigured' ? t(locale, 'livePlan') : null,
    row.governed.intervalVariance.state === 'unconfigured' ? t(locale, 'liveVariance') : null,
    row.health.ageMicroseconds === null ? t(locale, 'liveDataAge') : null,
  ].filter((value): value is string => value !== null);
  return (
    <div className="live-mobile-summary">
      <div className="live-mobile-summary__station">
        <a
          id={`live-device-mobile-${row.deviceId}`}
          href={`#operations?deviceId=${row.deviceId}`}
          onClick={() => onSelect(row.deviceId)}
          aria-label={`${t(locale, 'liveSelectDevice')}: ${row.station.name}`}
        >
          <strong>{row.station.code}</strong>
        </a>
        <StatusChip
          icon={deviceAbnormal?.icon ?? attention.icon}
          label={t(locale, deviceAbnormal?.label ?? attention.label)}
          tone={deviceAbnormal || row.attention.state !== 'reported' ? 'attention' : 'positive'}
          hatch={
            deviceAbnormal?.hatch ??
            (row.attention.state === 'no_data' || row.attention.state === 'unreliable')
          }
        />
      </div>
      {quantities.length ? (
        <p className="live-mobile-summary__values">
          {quantities.map((quantity) => (
            <span
              key={quantity.kind}
              className={`live-mobile-summary__value live-mobile-summary__value--${quantity.dataState}`}
            >
              {formatMeasurementValue(locale, quantity.value!, quantity.unit)}{' '}
              {measurementUnitLabel(quantity.unit)}
            </span>
          ))}
        </p>
      ) : null}
      <p className="live-mobile-summary__unavailable">
        {unavailable.length ? (
          <>
            {unavailable.join(', ')}: {t(locale, 'notAvailable')}
          </>
        ) : null}
        {unavailable.length && row.health.ageMicroseconds !== null ? ' · ' : null}
        {row.health.ageMicroseconds !== null ? (
          <>
            {t(locale, 'liveDataAge')}: {formatLiveAge(row.health.ageMicroseconds, locale)}
          </>
        ) : null}
      </p>
    </div>
  );
}

function FilterSelect({
  locale,
  label,
  value,
  options,
  onChange,
}: {
  locale: Locale;
  label: TranslationKey;
  value: string | undefined;
  options: readonly { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
}) {
  const id = `live-filter-${label}`;
  return (
    <label htmlFor={id}>
      {t(locale, label)}
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">{t(locale, 'liveAll')}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterForm({
  locale,
  response,
  filters,
  onChange,
  onClear,
  trailingControls,
}: {
  locale: Locale;
  response: LiveOperationsResponse;
  filters: LiveFilters;
  onChange: (filters: LiveFilters) => void;
  onClear: () => void;
  trailingControls?: ReactNode;
}) {
  const [stationQuery, setStationQuery] = useState('');
  const [stationActiveIndex, setStationActiveIndex] = useState(-1);
  const stationListId = useId();
  const set = (key: keyof LiveFilters, value: string | undefined) =>
    onChange({ ...filters, [key]: value });
  const activeFilters = Object.entries(filters).filter(([, value]) => Boolean(value)) as [
    keyof LiveFilters,
    string,
  ][];
  const filterLabels: Record<keyof LiveFilters, TranslationKey> = {
    territoryId: 'liveTerritory',
    waterwayId: 'liveWaterwaySection',
    sectionId: 'liveSection',
    stationId: 'liveStation',
    deviceId: 'liveDevice',
    measurementKind: 'liveMeasurement',
    connection: 'liveConnection',
    fault: 'liveFault',
    dataState: 'dataState',
    quality: 'dataQuality',
    attention: 'liveAttentionFilter',
  };
  const stationOptions = response.facets.stations
    .map((item) => ({ value: item.id, label: `${item.code} — ${item.name}` }))
    .filter((item) => item.label.toLocaleLowerCase().includes(stationQuery.toLocaleLowerCase()));
  const selectStation = (value: string) => {
    set('stationId', value);
    setStationQuery('');
    setStationActiveIndex(-1);
  };
  const connectionOptions = response.facets.connections.map((value) => ({
    value,
    label: t(
      locale,
      value === 'communicating'
        ? 'liveCommunicating'
        : value === 'offline'
          ? 'liveOffline'
          : 'liveUnknown',
    ),
  }));
  const faultOptions = response.facets.faults.map((value) => ({
    value,
    label: t(
      locale,
      value === 'reported' ? 'deviceFault' : value === 'none' ? 'liveNoFault' : 'liveUnknown',
    ),
  }));
  const dataOptions = response.facets.dataStates.map((value) => ({
    value,
    label: t(locale, liveDataStatePresentation(value).label),
  }));
  const qualityOptions = response.facets.qualities.map((value) => ({
    value,
    label: t(locale, qualityKey(value)),
  }));
  const attentionOptions = response.facets.attentions.map((value) => ({
    value,
    label: t(locale, liveAttentionPresentation(value).label),
  }));
  return (
    <form
      className="live-filters"
      onSubmit={(event) => event.preventDefault()}
      aria-label={t(locale, 'liveFilters')}
    >
      <FilterPanel
        trailingControls={trailingControls}
        filtersLabel={t(locale, 'liveFilters')}
        clearLabel={t(locale, 'liveClearFilters')}
        onClear={onClear}
        activeFilters={activeFilters.map(([key, value]) => ({
          id: key,
          label: `${t(locale, filterLabels[key])}: ${value}`,
          onRemove: () => set(key, undefined),
        }))}
        search={
          <>
            <label htmlFor={`live-station-search-${stationListId}`}>
              <span>{t(locale, 'liveStation')}</span>
              <input
                id={`live-station-search-${stationListId}`}
                role="combobox"
                placeholder={t(locale, 'filtersSearchStations')}
                aria-autocomplete="list"
                aria-controls={stationListId}
                aria-expanded={Boolean(stationQuery)}
                aria-activedescendant={
                  stationActiveIndex >= 0
                    ? `${stationListId}-option-${stationActiveIndex}`
                    : undefined
                }
                value={stationQuery}
                onChange={(event) => {
                  setStationQuery(event.target.value);
                  setStationActiveIndex(-1);
                }}
                onKeyDown={(event) => {
                  if (!stationOptions.length) return;
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setStationActiveIndex((index) =>
                      Math.min(index + 1, stationOptions.length - 1),
                    );
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setStationActiveIndex((index) => Math.max(index - 1, 0));
                  } else if (event.key === 'Enter' && stationActiveIndex >= 0) {
                    event.preventDefault();
                    selectStation(stationOptions[stationActiveIndex]!.value);
                  } else if (event.key === 'Escape') {
                    setStationQuery('');
                    setStationActiveIndex(-1);
                  }
                }}
              />
            </label>
            {stationQuery ? (
              <ul id={stationListId} className="filter-panel__combobox" role="listbox">
                {stationOptions.map((option, index) => (
                  <li
                    id={`${stationListId}-option-${index}`}
                    key={option.value}
                    role="option"
                    aria-selected={filters.stationId === option.value}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectStation(option.value)}
                  >
                    {option.label}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        }
      >
        <fieldset>
          <legend>{t(locale, 'liveFilters')}</legend>
          <div className="live-filters__grid">
            <FilterSelect
              locale={locale}
              label="liveTerritory"
              value={filters.territoryId}
              onChange={(value) => set('territoryId', value)}
              options={response.facets.territories.map((item) => ({
                value: item.id,
                label: `${'— '.repeat(item.depth)}${item.name} (${item.code})`,
              }))}
            />
            <FilterSelect
              locale={locale}
              label="liveWaterwaySection"
              value={filters.waterwayId}
              onChange={(value) => set('waterwayId', value)}
              options={response.facets.waterways
                .filter((item) => item.id !== null)
                .map((item) => ({ value: item.id!, label: item.name ?? item.code ?? item.id! }))}
            />
            <FilterSelect
              locale={locale}
              label="liveSection"
              value={filters.sectionId}
              onChange={(value) => set('sectionId', value)}
              options={response.facets.sections.map((item) => ({
                value: item.id,
                label: item.name ?? item.code ?? item.id,
              }))}
            />
            <FilterSelect
              locale={locale}
              label="liveMeasurement"
              value={filters.measurementKind}
              onChange={(value) => set('measurementKind', value)}
              options={response.facets.measurementKinds.map((value) => ({
                value,
                label:
                  value === 'stage'
                    ? t(locale, 'stage')
                    : value === 'discharge'
                      ? t(locale, 'discharge')
                      : t(locale, 'liveCounter'),
              }))}
            />
            <FilterSelect
              locale={locale}
              label="liveConnection"
              value={filters.connection}
              onChange={(value) => set('connection', value)}
              options={connectionOptions}
            />
            <FilterSelect
              locale={locale}
              label="liveFault"
              value={filters.fault}
              onChange={(value) => set('fault', value)}
              options={faultOptions}
            />
            <FilterSelect
              locale={locale}
              label="dataState"
              value={filters.dataState}
              onChange={(value) => set('dataState', value)}
              options={dataOptions}
            />
            <FilterSelect
              locale={locale}
              label="dataQuality"
              value={filters.quality}
              onChange={(value) => set('quality', value)}
              options={qualityOptions}
            />
            <FilterSelect
              locale={locale}
              label="liveAttentionFilter"
              value={filters.attention}
              onChange={(value) => set('attention', value)}
              options={attentionOptions}
            />
            <FilterSelect
              locale={locale}
              label="liveDevice"
              value={filters.deviceId}
              onChange={(value) => set('deviceId', value)}
              options={response.facets.devices.map((item) => ({
                value: item.id,
                label: `${item.name} (${item.code})`,
              }))}
            />
          </div>
        </fieldset>
      </FilterPanel>
    </form>
  );
}

function LiveTable({
  locale,
  response,
  onSelect,
  toolbarTarget,
}: {
  locale: Locale;
  response: LiveOperationsResponse;
  onSelect: (deviceId: string) => void;
  toolbarTarget?: HTMLElement | null;
}) {
  type ColumnKey =
    | 'station'
    | 'device'
    | 'waterway'
    | 'stage'
    | 'discharge'
    | 'counter'
    | 'plan'
    | 'variance'
    | 'quality'
    | 'status'
    | 'lastUpdate'
    | 'dataAge'
    | 'powerSignal'
    | 'calibration'
    | 'alarm';
  const columns: readonly { key: ColumnKey; label: TranslationKey }[] = [
    { key: 'station', label: 'liveStation' },
    { key: 'device', label: 'liveDevice' },
    { key: 'waterway', label: 'liveWaterwaySection' },
    { key: 'stage', label: 'stage' },
    { key: 'discharge', label: 'discharge' },
    { key: 'counter', label: 'volume' },
    { key: 'plan', label: 'livePlan' },
    { key: 'variance', label: 'liveVariance' },
    { key: 'quality', label: 'dataQuality' },
    { key: 'status', label: 'liveWaterStatus' },
    { key: 'lastUpdate', label: 'liveLastUpdate' },
    { key: 'dataAge', label: 'liveDataAge' },
    { key: 'powerSignal', label: 'livePowerSignal' },
    { key: 'calibration', label: 'liveCalibration' },
    { key: 'alarm', label: 'liveAlarm' },
  ];
  const essential: readonly ColumnKey[] = [
    'station',
    'stage',
    'discharge',
    'counter',
    'plan',
    'variance',
    'status',
  ];
  const [visible, setVisible] = useState<ReadonlySet<ColumnKey>>(() => new Set(essential));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const toggleColumn = (key: ColumnKey) =>
    setVisible((current) => {
      if (key === 'status') return current;
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const shown = (key: ColumnKey) => visible.has(key);
  const toolbar = (
    <div className="live-table-panel__toolbar">
      <div
        className="live-columns-menu"
        onKeyDown={(event) => event.key === 'Escape' && setColumnsOpen(false)}
      >
        <button
          className="action-button"
          type="button"
          aria-expanded={columnsOpen}
          onClick={() => setColumnsOpen((value) => !value)}
        >
          {t(locale, 'columns')}
        </button>
        {columnsOpen ? (
          <div className="live-columns-menu__panel" role="group" aria-label={t(locale, 'columns')}>
            {columns.map((column) => (
              <label key={column.key}>
                <input
                  type="checkbox"
                  checked={shown(column.key)}
                  disabled={column.key === 'status'}
                  onChange={() => toggleColumn(column.key)}
                />
                {t(locale, column.label)}
              </label>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
  return (
    <section className="live-table-panel" aria-label={t(locale, 'liveRows')}>
      {toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbar}
      <div className="table-scroll live-table-scroll" tabIndex={0}>
        <table className="live-table">
          <caption>
            {`${t(locale, 'liveRows')}: ${response.rows.length} / ${response.scope.deviceDenominator}`}
            <span className="live-table-scroll__hint">{t(locale, 'liveScrollColumns')}</span>
          </caption>
          <colgroup>
            {columns
              .filter((column) => shown(column.key))
              .map((column) => (
                <col
                  key={column.key}
                  className={`live-table-column live-table-column--${column.key}`}
                />
              ))}
          </colgroup>
          <thead>
            <tr>
              {columns
                .filter((column) => shown(column.key))
                .map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`${['stage', 'discharge', 'counter'].includes(column.key) ? 'live-table__measurement ' : ''}live-table__column--${column.key}`}
                  >
                    {t(locale, column.label)}
                    {column.key === 'stage'
                      ? ' (m)'
                      : column.key === 'discharge'
                        ? ' (m³/s)'
                        : column.key === 'counter'
                          ? ' (m³)'
                          : ''}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {response.rows.map((row) => (
              <tr
                key={row.deviceId}
                data-unreliable={
                  row.health.fault === 'reported' ||
                  row.health.dataCondition === 'unreliable' ||
                  row.attention.state === 'unreliable' ||
                  undefined
                }
              >
                {shown('station') ? (
                  <td data-label={t(locale, 'liveStation')} className="live-table__station">
                    <a
                      id={`live-device-${row.deviceId}`}
                      className="live-table__device-link"
                      href={`#operations?deviceId=${row.deviceId}`}
                      onClick={() => onSelect(row.deviceId)}
                      aria-label={`${t(locale, 'liveSelectDevice')}: ${row.device.name} (${row.device.code}), ${row.station.name}`}
                      title={`${row.device.name} (${row.device.code}); ${row.territory.name}`}
                    >
                      <strong className="live-table__station-code" title={row.station.code}>
                        {row.station.code}
                      </strong>
                      <span className="live-table__station-name" title={row.station.name}>
                        {row.station.name}
                      </span>
                      <span className="live-table__device-code">{row.device.code}</span>
                    </a>
                    <MobileStationSummary locale={locale} row={row} onSelect={onSelect} />
                  </td>
                ) : null}
                {shown('device') ? (
                  <td data-label={t(locale, 'liveDevice')}>
                    <a
                      id={shown('station') ? undefined : `live-device-${row.deviceId}`}
                      href={`#operations?deviceId=${row.deviceId}`}
                      onClick={() => onSelect(row.deviceId)}
                    >
                      {t(locale, 'liveSelectDevice')}: {row.device.name}
                    </a>
                    <small>{row.device.code}</small>
                  </td>
                ) : null}
                {shown('waterway') ? (
                  <td data-label={t(locale, 'liveWaterwaySection')}>
                    {row.waterway.name ?? '—'}
                    <small>{row.waterway.sectionName ?? '—'}</small>
                  </td>
                ) : null}
                {shown('stage') ? (
                  <td data-label={`${t(locale, 'stage')} (m)`} className="live-table__measurement">
                    <Quantity locale={locale} quantity={row.quantities.stage} />
                  </td>
                ) : null}
                {shown('discharge') ? (
                  <td
                    data-label={`${t(locale, 'discharge')} (m³/s)`}
                    className="live-table__measurement"
                  >
                    <Quantity locale={locale} quantity={row.quantities.discharge} />
                  </td>
                ) : null}
                {shown('counter') ? (
                  <td
                    data-label={`${t(locale, 'volume')} (m³)`}
                    className="live-table__measurement"
                  >
                    <Quantity locale={locale} quantity={row.quantities.accumulatedCounter} />
                  </td>
                ) : null}
                {shown('plan') ? (
                  <td data-label={t(locale, 'livePlan')} className="live-table__column--plan">
                    <GovernedPlaceholder locale={locale} reason={row.governed.plan.reason} />
                  </td>
                ) : null}
                {shown('variance') ? (
                  <td
                    data-label={t(locale, 'liveVariance')}
                    className="live-table__column--variance"
                  >
                    <GovernedPlaceholder
                      locale={locale}
                      reason={row.governed.intervalVariance.reason}
                    />
                  </td>
                ) : null}
                {shown('quality') ? (
                  <td data-label={t(locale, 'dataQuality')}>
                    <StatusChip
                      icon={
                        { valid: '✓', invalid: '×', suspect: '!', estimated: '≈', unknown: '?' }[
                          row.quantities.discharge.quality
                        ]
                      }
                      label={t(locale, qualityKey(row.quantities.discharge.quality))}
                      tone={row.quantities.discharge.quality === 'valid' ? 'positive' : 'attention'}
                    />
                  </td>
                ) : null}
                {shown('status') ? (
                  <td
                    data-label={t(locale, 'liveWaterStatus')}
                    className="live-table__column--status"
                  >
                    <LiveStatusCompact locale={locale} row={row} />
                  </td>
                ) : null}
                {shown('lastUpdate') ? (
                  <td data-label={t(locale, 'liveLastUpdate')}>
                    <time
                      dateTime={row.health.lastSeenReceivedAt ?? undefined}
                      title={row.health.lastSeenReceivedAt ?? undefined}
                    >
                      {row.health.lastSeenReceivedAt
                        ? presentationTimestamp(locale, row.health.lastSeenReceivedAt).value
                        : '—'}
                    </time>
                    <small>
                      {row.health.lastObservedAt
                        ? presentationTimestamp(locale, row.health.lastObservedAt).value
                        : '—'}
                    </small>
                  </td>
                ) : null}
                {shown('dataAge') ? (
                  <td data-label={t(locale, 'liveDataAge')}>
                    {formatLiveAge(row.health.ageMicroseconds, locale)}
                    <small>
                      {row.health.freshness === 'unconfigured'
                        ? t(locale, 'liveNotConfigured')
                        : row.health.freshness}
                    </small>
                  </td>
                ) : null}
                {shown('powerSignal') ? (
                  <td data-label={t(locale, 'livePowerSignal')}>
                    <span
                      title={
                        row.health.power.state === 'measured'
                          ? `${row.health.power.value} V`
                          : undefined
                      }
                    >
                      {row.health.power.state === 'measured'
                        ? `${formatFixedDecimal(locale, row.health.power.value, 1)} V`
                        : '—'}
                    </span>
                    <small
                      title={
                        row.health.signal.state === 'measured'
                          ? `${row.health.signal.value} dBm`
                          : undefined
                      }
                    >
                      {row.health.signal.state === 'measured'
                        ? `${formatFixedDecimal(locale, row.health.signal.value, 1)} dBm`
                        : '—'}
                    </small>
                  </td>
                ) : null}
                {shown('calibration') ? (
                  <td data-label={t(locale, 'liveCalibration')}>
                    <GovernedPlaceholder
                      locale={locale}
                      reason={row.governed.calibrationDue.reason}
                    />
                  </td>
                ) : null}
                {shown('alarm') ? (
                  <td data-label={t(locale, 'liveAlarm')}>
                    <GovernedPlaceholder locale={locale} reason={row.governed.alarm.reason} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function LiveOperationsInspector({
  locale,
  inspector,
  onClose,
}: {
  locale: Locale;
  inspector: LiveOperationsInspector;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [inspector.current.deviceId]);
  const row = inspector.current;
  return (
    <aside className="live-inspector panel" aria-labelledby={inspectorHeadingId(row.deviceId)}>
      <button className="action-button" type="button" onClick={onClose}>
        {t(locale, 'liveCloseInspector')}
      </button>
      <h2 id={inspectorHeadingId(row.deviceId)} ref={headingRef} tabIndex={-1}>
        {t(locale, 'liveInspector')}: {rowLabel(row)}
      </h2>
      <p className="live-provenance-stamp">{t(locale, 'liveSyntheticSource')}</p>
      <p>
        {t(locale, 'provenance')}: {row.provenance}
      </p>
      <section aria-labelledby="live-metadata-heading">
        <h3 id="live-metadata-heading">{t(locale, 'liveMetadata')}</h3>
        <dl className="live-inspector__details">
          <div>
            <dt>{t(locale, 'liveWaterwaySection')}</dt>
            <dd>
              {row.waterway.name ?? '—'} / {row.waterway.sectionName ?? '—'}
            </dd>
          </div>
          <div>
            <dt>{t(locale, 'liveInstallation')}</dt>
            <dd className="stable-identifier">{row.device.installationId}</dd>
          </div>
          <div>
            <dt>{t(locale, 'liveProtocol')}</dt>
            <dd>{row.device.protocol}</dd>
          </div>
          <div>
            <dt>{t(locale, 'referenceAt')}</dt>
            <dd>
              <PresentationTime locale={locale} value={inspector.referenceAt} />
            </dd>
          </div>
          <div>
            <dt>{t(locale, 'knownAt')}</dt>
            <dd>
              <PresentationTime locale={locale} value={inspector.knownAt} />
            </dd>
          </div>
        </dl>
      </section>
      <section aria-labelledby="live-current-heading">
        <h3 id="live-current-heading">{t(locale, 'liveCurrent')}</h3>
        <div className="metric-grid">
          <article className="metric-card">
            <h4>{t(locale, 'stage')}</h4>
            <Quantity locale={locale} quantity={row.quantities.stage} />
          </article>
          <article className="metric-card">
            <h4>{t(locale, 'discharge')}</h4>
            <Quantity locale={locale} quantity={row.quantities.discharge} />
          </article>
          <article className="metric-card">
            <h4>{t(locale, 'liveCounter')}</h4>
            <Quantity locale={locale} quantity={row.quantities.accumulatedCounter} />
          </article>
        </div>
        <dl className="live-inspector__details">
          <div>
            <dt>{t(locale, 'liveLastUpdate')}</dt>
            <dd>
              <PresentationTime locale={locale} value={row.health.lastSeenReceivedAt} /> /{' '}
              <PresentationTime locale={locale} value={row.health.lastObservedAt} />
            </dd>
          </div>
          <div>
            <dt>{t(locale, 'liveDataAge')}</dt>
            <dd>
              {formatLiveAge(row.health.ageMicroseconds, locale)}; {t(locale, 'liveNotConfigured')}
            </dd>
          </div>
          <div>
            <dt>{t(locale, 'livePowerSignal')}</dt>
            <dd>
              <span
                title={
                  row.health.power.state === 'measured' ? `${row.health.power.value} V` : undefined
                }
              >
                {row.health.power.state === 'measured'
                  ? `${formatFixedDecimal(locale, row.health.power.value, 1)} V`
                  : '—'}
              </span>{' '}
              /{' '}
              <span
                title={
                  row.health.signal.state === 'measured'
                    ? `${row.health.signal.value} dBm`
                    : undefined
                }
              >
                {row.health.signal.state === 'measured'
                  ? `${formatFixedDecimal(locale, row.health.signal.value, 1)} dBm`
                  : '—'}
              </span>
            </dd>
          </div>
          <div>
            <dt>{t(locale, 'source')}</dt>
            <dd>{joinProvenance([row.health.source.label, row.health.source.provenance])}</dd>
          </div>
        </dl>
        <DeviceHealthStatus locale={locale} health={row.health} />
        <h4>{t(locale, 'liveMeasurementMetadata')}</h4>
        <dl className="live-inspector__details">
          {[row.quantities.stage, row.quantities.discharge, row.quantities.accumulatedCounter].map(
            (quantity) => (
              <div key={quantity.kind}>
                <dt>{quantity.kind}</dt>
                <dd>
                  {joinProvenance([
                    `${t(locale, 'source')}: ${quantity.source.label}`,
                    t(
                      locale,
                      quantity.source.official ? 'liveOfficialSource' : 'liveNonOfficialSource',
                    ),
                    `${t(locale, 'liveMethod')}: ${quantity.measurementMethod ?? '—'}`,
                    `${t(locale, 'liveCalibrationReference')}: ${quantity.calibrationRef ?? t(locale, 'liveNotConfigured')}`,
                    `${t(locale, 'liveRatingReference')}: ${quantity.ratingCurveRef ?? t(locale, 'liveNotConfigured')}`,
                    `${t(locale, 'liveUncertainty')}: ${quantity.uncertainty ?? '—'}`,
                  ])}
                </dd>
              </div>
            ),
          )}
        </dl>
      </section>
      <section aria-labelledby="live-trend-heading">
        <h3 id="live-trend-heading">{t(locale, 'liveTrend')}</h3>
        <p>{t(locale, 'liveTrendDetail')}</p>
        <LiveTrendChart
          locale={locale}
          referenceAt={inspector.referenceAt}
          trend={inspectorTrendRows(inspector)}
          ariaLabel={t(locale, 'liveTrendDetail')}
          dataCondition={row.health.dataCondition}
          current={row.quantities}
        />
        <div className="table-scroll">
          <table className="live-trend-ledger">
            <caption>
              <span>{t(locale, 'liveTrendDetail')}</span>
              <span>
                {t(locale, 'liveRaw')} / {t(locale, 'liveValidated')}
              </span>
            </caption>
            <thead>
              <tr>
                <th>{t(locale, 'liveTrendAt')}</th>
                <th>{t(locale, 'stage')} (m)</th>
                <th>{t(locale, 'discharge')} (mÂ³/s)</th>
                <th>{t(locale, 'volume')} (mÂ³)</th>
                <th>{t(locale, 'liveGap')}</th>
              </tr>
            </thead>
            <tbody>
              {pivotTrend(inspectorTrendRows(inspector)).map(([at, points]) => (
                <tr
                  key={at}
                  className={
                    Object.values(points).some((entries) => entries?.some((point) => point.gap))
                      ? 'live-trend-ledger__gap'
                      : undefined
                  }
                >
                  <td>
                    <PresentationTime locale={locale} value={at} />
                  </td>
                  <td>
                    <TrendReading locale={locale} point={points.stage} />
                  </td>
                  <td>
                    <TrendReading locale={locale} point={points.discharge} />
                  </td>
                  <td>
                    <TrendReading locale={locale} point={points.accumulated_volume} />
                  </td>
                  <td>
                    {Object.values(points).some((entries) => entries?.some((point) => point.gap))
                      ? t(locale, 'liveGap')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="live-revisions-heading">
        <h3 id="live-revisions-heading">{t(locale, 'liveRevision')}</h3>
        <RevisionLedger locale={locale} revisions={inspector.revisions} />
      </section>
      <section aria-labelledby="live-placeholders-heading">
        <h3 id="live-placeholders-heading">{t(locale, 'liveHealthHistory')}</h3>
        <GovernedPlaceholder locale={locale} reason={inspector.healthHistory.reason} />
        <h3>{t(locale, 'liveCalibration')}</h3>
        <GovernedPlaceholder locale={locale} reason={row.governed.calibrationDue.reason} />
        <h3>{t(locale, 'liveAlarm')}</h3>
        <GovernedPlaceholder locale={locale} reason={row.governed.alarm.reason} />
      </section>
      <MaintenanceHistory locale={locale} maintenance={inspector.maintenance} />
    </aside>
  );
}

export function LiveOperationsContent({
  locale,
  response,
  filters,
  onFiltersChange,
  onClearFilters,
  onSelect,
  connectionIndicator,
  inspector,
  onCloseInspector,
}: {
  locale: Locale;
  response: LiveOperationsResponse;
  filters: LiveFilters;
  onFiltersChange: (filters: LiveFilters) => void;
  onClearFilters: () => void;
  onSelect: (deviceId: string) => void;
  connectionIndicator?: ReactNode;
  inspector?: LiveOperationsInspector | null;
  onCloseInspector?: () => void;
}) {
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <WorkspaceHeader
        heading={t(locale, 'liveOperationsHeading')}
        headingId="live-operations-heading"
        locale={locale}
        detail={t(locale, 'liveOperationsDetail')}
        provenance={
          <>
            <p>{t(locale, 'liveSyntheticSource')}</p>
            <p>
              <strong>{t(locale, 'referenceAt')}:</strong>{' '}
              <PresentationTime locale={locale} value={response.referenceAt} />;{' '}
              <strong>{t(locale, 'knownAt')}:</strong>{' '}
              <PresentationTime locale={locale} value={response.knownAt} />
            </p>
            <p>
              <strong>{t(locale, 'provenance')}:</strong> {response.scenario.provenance}
            </p>
          </>
        }
      >
        {connectionIndicator}
      </WorkspaceHeader>
      <FilterForm
        locale={locale}
        response={response}
        filters={filters}
        onChange={onFiltersChange}
        onClear={onClearFilters}
        trailingControls={<div className="live-columns-slot" ref={setToolbarTarget} />}
      />
      <div
        className={
          inspector
            ? 'live-operations__register live-operations__register--selected'
            : 'live-operations__register'
        }
      >
        <LiveTable
          locale={locale}
          response={response}
          onSelect={onSelect}
          toolbarTarget={toolbarTarget}
        />
        {inspector && onCloseInspector ? (
          <LiveOperationsInspector
            locale={locale}
            inspector={inspector}
            onClose={onCloseInspector}
          />
        ) : null}
      </div>
    </>
  );
}

export function LiveOperationsWorkspace({
  locale,
  access,
  selectedDeviceId,
  onDeviceChange,
}: LiveOperationsWorkspaceProps) {
  const [filters, setFilters] = useState<LiveFilters>(emptyFilters);
  const [cursor, setCursor] = useState<string | null>(null);
  const [priorCursors, setPriorCursors] = useState<readonly string[]>([]);
  const [result, setResult] = useState<LiveOperationsResponse | null>(null);
  const [state, setState] = useState<WorkspaceState>('loading');
  const [inspector, setInspector] = useState<LiveOperationsInspector | null>(null);
  const [stream, setStream] = useState<StreamState>('connecting');
  const [refresh, setRefresh] = useState(0);
  const [streamRetry, setStreamRetry] = useState(0);
  const [streamReset, setStreamReset] = useState(false);
  const returnFocus = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedDeviceId && returnFocus.current) {
      const desktopLink = document.getElementById(returnFocus.current);
      const mobileLink = document.getElementById(
        returnFocus.current.replace('live-device-', 'live-device-mobile-'),
      );
      (desktopLink?.getClientRects().length ? desktopLink : mobileLink)?.focus();
      returnFocus.current = null;
    }
  }, [selectedDeviceId]);
  useEffect(() => {
    setCursor(null);
    setPriorCursors([]);
  }, [filters]);
  useEffect(() => {
    if (access === 'loading') {
      setState('loading');
      return;
    }
    if (access !== 'ready') {
      setState(access);
      return;
    }
    const controller = new AbortController();
    setState('loading');
    void fetch(liveOperationsPath(filters, cursor), { signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (response.ok) {
          const parsed = liveOperationsResponseSchema.safeParse(body);
          if (parsed.success) {
            setResult(parsed.data);
            setState(parsed.data.rows.length ? 'ready' : 'empty');
            return;
          }
        }
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
  }, [access, filters, cursor, refresh]);
  useEffect(() => {
    if (access !== 'ready' || !selectedDeviceId) {
      setInspector(null);
      return;
    }
    const controller = new AbortController();
    void fetch(liveInspectorPath(selectedDeviceId, filters.territoryId), {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (response.ok) {
          const parsed = liveOperationsInspectorSchema.safeParse(body);
          setInspector(parsed.success ? parsed.data : null);
        } else setInspector(null);
      })
      .catch(() => setInspector(null));
    return () => controller.abort();
  }, [access, selectedDeviceId, filters.territoryId, refresh]);
  useEffect(() => {
    if (access !== 'ready' || typeof EventSource === 'undefined') return;
    setStream((current) =>
      current === 'unavailable' || current === 'reconnecting' ? 'reconnecting' : current,
    );
    const source = new EventSource(liveEventsPath(filters));
    let opened = false;
    let boundedCompletion = false;
    source.onopen = () => {
      opened = true;
      boundedCompletion = false;
      setStream('connected');
      setStreamReset(false);
    };
    const invalidate = () => setRefresh((value) => value + 1);
    source.addEventListener('invalidate', invalidate);
    source.addEventListener('reset', () => {
      boundedCompletion = true;
      setStream('connected');
      setStreamReset(true);
      invalidate();
    });
    source.addEventListener('complete', () => {
      boundedCompletion = true;
      setStream('connected');
    });
    source.onerror = () => {
      setStream(streamFailureState(opened, boundedCompletion));
      // Keep this EventSource alive: its native retry carries Last-Event-ID.
      // Recreating it here would replay every bounded batch from the beginning.
      boundedCompletion = false;
    };
    return () => source.close();
  }, [access, filters, streamRetry]);
  const presentation = streamPresentation(stream);
  const range = result
    ? livePaginationRange(priorCursors.length, result.rows.length, result.scope.deviceDenominator)
    : null;
  const select = (deviceId: string) => {
    returnFocus.current = `live-device-${deviceId}`;
    onDeviceChange(deviceId);
  };
  const changeFilters = (next: LiveFilters) => setFilters(next);
  const connectionIndicator = (
    <div className={`live-stream-status live-stream-status--${stream}`} role="status">
      <StatusChip
        detail={t(locale, presentation.value)}
        icon={presentation.icon}
        label={t(locale, presentation.label)}
        tone={
          stream === 'connected' ? 'positive' : stream === 'unavailable' ? 'critical' : 'attention'
        }
      />
      {stream === 'unavailable' ? (
        <button
          className="action-button"
          type="button"
          onClick={() => setStreamRetry((value) => value + 1)}
        >
          {t(locale, 'liveReconnect')}
        </button>
      ) : null}
    </div>
  );
  return (
    <section className="live-operations" aria-label={t(locale, 'liveOperationsHeading')}>
      {state === 'ready' || state === 'empty' ? (
        result ? (
          <>
            <LiveOperationsContent
              locale={locale}
              response={result}
              filters={filters}
              onFiltersChange={changeFilters}
              onClearFilters={() => setFilters(emptyFilters)}
              onSelect={select}
              connectionIndicator={connectionIndicator}
              inspector={inspector && selectedDeviceId ? inspector : null}
              onCloseInspector={() => onDeviceChange(null)}
            />
            {streamReset ? (
              <p className="supporting-text" role="status">
                {t(locale, 'liveReset')}
              </p>
            ) : null}
            {state === 'empty' ? (
              <StateNotice
                locale={locale}
                state="empty"
                retry={() => setRefresh((value) => value + 1)}
              />
            ) : (
              <>
                <nav className="live-pagination" aria-label={t(locale, 'liveRows')}>
                  <span className="live-pagination__range" aria-live="polite">
                    <span className="visually-hidden">{`${t(locale, 'liveRows')}: `}</span>
                    {range
                      ? `${formatDecimal(locale, range.start)}–${formatDecimal(locale, range.end)} ${t(locale, 'livePaginationOf')} ${formatDecimal(locale, range.total)}`
                      : '—'}
                  </span>
                  <button
                    className="action-button"
                    type="button"
                    disabled={!priorCursors.length}
                    onClick={() => {
                      const next = priorCursors.at(-1) ?? null;
                      setPriorCursors((items) => items.slice(0, -1));
                      setCursor(next);
                    }}
                  >
                    {t(locale, 'livePreviousPage')}
                  </button>
                  <button
                    className="action-button action-button--primary"
                    type="button"
                    disabled={!result.nextCursor}
                    onClick={() => {
                      setPriorCursors((items) => [...items, cursor ?? '']);
                      setCursor(result.nextCursor);
                    }}
                  >
                    {t(locale, 'liveNextPage')}
                  </button>
                </nav>
              </>
            )}
          </>
        ) : (
          <StateNotice
            locale={locale}
            state="loading"
            retry={() => setRefresh((value) => value + 1)}
          />
        )
      ) : (
        <StateNotice locale={locale} state={state} retry={() => setRefresh((value) => value + 1)} />
      )}
    </section>
  );
}

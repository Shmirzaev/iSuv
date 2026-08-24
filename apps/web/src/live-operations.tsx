import { useEffect, useRef, useState } from 'react';
import {
  liveOperationsInspectorSchema,
  liveOperationsResponseSchema,
  type LiveOperationsInspector,
  type LiveOperationsResponse,
} from '@isuv/contracts';

import { translate, type Locale, type TranslationKey } from '@isuv/i18n';

import {
  formatLiveAge,
  formatLiveTimestamp,
  inspectorHeadingId,
  inspectorTrendRows,
  liveAttentionPresentation,
  liveDataStatePresentation,
  liveEventsPath,
  liveInspectorPath,
  liveOperationsPath,
  qualityKey,
  rowLabel,
  streamFailureState,
  streamPresentation,
  type LiveFilters,
  type StreamState,
} from './live-operations-model.js';

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
  const unit = quantity.unit === 'm3/s' ? 'm³/s' : quantity.unit === 'm3' ? 'm³' : 'm';
  return (
    <div className={`live-quantity live-quantity--${quantity.dataState}`}>
      <span className="table-status">
        <span aria-hidden="true">{presentation.icon}</span>
        {t(locale, presentation.label)}
      </span>
      <strong>
        {quantity.value === null ? '—' : quantity.value}
        {quantity.value === null ? '' : ` ${unit}`}
      </strong>
      <small>{t(locale, qualityKey(quantity.quality))}</small>
      {quantity.qualityReason ? <small>{quantity.qualityReason}</small> : null}
      <small>
        {quantity.source.label};{' '}
        {t(locale, quantity.source.official ? 'liveOfficialSource' : 'liveNonOfficialSource')}
      </small>
    </div>
  );
}

function GovernedPlaceholder({ locale, reason }: { locale: Locale; reason: string }) {
  return (
    <div className="live-placeholder">
      <span aria-hidden="true">⚙</span>
      <strong>{t(locale, 'liveNotConfigured')}</strong>
      <small>{reason}</small>
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
                    <dd>{`${formatLiveTimestamp(record.scheduledInterval.start)} — ${formatLiveTimestamp(record.scheduledInterval.end)}`}</dd>
                  </div>
                  <div>
                    <dt>{t(locale, 'maintenanceActual')}</dt>
                    <dd>{`${formatLiveTimestamp(record.startedAt)} / ${formatLiveTimestamp(record.completedAt)}`}</dd>
                  </div>
                  <div>
                    <dt>{t(locale, 'maintenanceRecordedAt')}</dt>
                    <dd>{formatLiveTimestamp(record.recordedAt)}</dd>
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

function StatusValue({
  locale,
  row,
}: {
  locale: Locale;
  row: LiveOperationsResponse['rows'][number];
}) {
  const attention = liveAttentionPresentation(row.attention.state);
  return (
    <div className={`live-status live-status--${row.attention.state}`}>
      <span aria-hidden="true">{attention.icon}</span>
      <strong>{t(locale, attention.label)}</strong>
      <small>{t(locale, attention.value)}</small>
    </div>
  );
}

function DeviceHealthStatus({
  locale,
  health,
}: {
  locale: Locale;
  health: LiveOperationsResponse['rows'][number]['health'];
}) {
  const connection: { icon: string; label: TranslationKey; value: TranslationKey } =
    health.connection === 'communicating'
      ? { icon: '↔', label: 'liveCommunicating', value: 'livePacketsReceived' }
      : health.connection === 'offline'
        ? { icon: '⊘', label: 'liveOffline', value: 'liveNoConnection' }
        : { icon: '?', label: 'liveUnknown', value: 'liveConnectionConditionUnknown' };
  const fault: { icon: string; label: TranslationKey; value: TranslationKey } =
    health.fault === 'reported'
      ? { icon: '!', label: 'deviceFault', value: 'liveFaultReported' }
      : health.fault === 'none'
        ? { icon: '✓', label: 'liveNoFault', value: 'liveFaultNotReported' }
        : { icon: '?', label: 'liveUnknown', value: 'liveFaultConditionUnknown' };
  const condition: { icon: string; label: TranslationKey; value: TranslationKey } =
    health.dataCondition === 'current'
      ? { icon: '✓', label: 'liveDataCurrent', value: 'liveCurrentEvidence' }
      : health.dataCondition === 'stale'
        ? { icon: '◷', label: 'liveDataStale', value: 'liveStaleEvidence' }
        : health.dataCondition === 'unreliable'
          ? { icon: '!', label: 'statusUnreliable', value: 'liveUncertainData' }
          : health.dataCondition === 'no_data'
            ? { icon: '—', label: 'noData', value: 'statusNoObservation' }
            : health.dataCondition === 'unconfigured'
              ? { icon: '⚙', label: 'statusUnconfigured', value: 'liveNoConfiguredPolicy' }
              : { icon: '?', label: 'liveUnknown', value: 'liveConditionUnknown' };
  const entries: readonly {
    heading: TranslationKey;
    icon: string;
    label: TranslationKey;
    value: TranslationKey;
  }[] = [
    { heading: 'liveConnection', ...connection },
    { heading: 'liveFault', ...fault },
    { heading: 'dataState', ...condition },
  ];
  return (
    <section aria-label={t(locale, 'liveDeviceHealth')} className="live-health-status">
      <h4>{t(locale, 'liveDeviceHealth')}</h4>
      <ul>
        {entries.map((entry) => (
          <li key={entry.heading} data-health-state={entry.label}>
            <span aria-hidden="true">{entry.icon}</span>
            <strong>{`${t(locale, entry.heading)}: ${t(locale, entry.label)}`}</strong>
            <small>{t(locale, entry.value)}</small>
            {entry.heading === 'liveFault' && health.faultCode ? (
              <small>{`${t(locale, 'liveFault')}: ${health.faultCode}`}</small>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
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
}: {
  locale: Locale;
  response: LiveOperationsResponse;
  filters: LiveFilters;
  onChange: (filters: LiveFilters) => void;
  onClear: () => void;
}) {
  const set = (key: keyof LiveFilters, value: string | undefined) =>
    onChange({ ...filters, [key]: value });
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
            label="liveStation"
            value={filters.stationId}
            onChange={(value) => set('stationId', value)}
            options={response.facets.stations.map((item) => ({
              value: item.id,
              label: `${item.name} (${item.code})`,
            }))}
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
        <button className="action-button" type="button" onClick={onClear}>
          {t(locale, 'liveClearFilters')}
        </button>
      </fieldset>
    </form>
  );
}

function LiveTable({
  locale,
  response,
  onSelect,
}: {
  locale: Locale;
  response: LiveOperationsResponse;
  onSelect: (deviceId: string) => void;
}) {
  return (
    <div className="table-scroll live-table-scroll">
      <table className="live-table">
        <caption>{`${t(locale, 'liveRows')}: ${response.rows.length} / ${response.scope.deviceDenominator}`}</caption>
        <thead>
          <tr>
            {[
              'liveStation',
              'liveDevice',
              'liveWaterwaySection',
              'stage',
              'discharge',
              'liveCounter',
              'livePlan',
              'liveVariance',
              'dataQuality',
              'liveWaterStatus',
              'liveLastUpdate',
              'liveDataAge',
              'livePowerSignal',
              'liveCalibration',
              'liveAlarm',
            ].map((key) => (
              <th key={key} scope="col">
                {t(locale, key as TranslationKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {response.rows.map((row) => (
            <tr key={row.deviceId}>
              <td data-label={t(locale, 'liveStation')}>
                <strong>{row.station.name}</strong>
                <small>{row.station.code}</small>
                <small>{row.territory.name}</small>
              </td>
              <td data-label={t(locale, 'liveDevice')}>
                <a
                  id={`live-device-${row.deviceId}`}
                  href={`#operations?deviceId=${row.deviceId}`}
                  onClick={() => onSelect(row.deviceId)}
                >
                  {t(locale, 'liveSelectDevice')}: {row.device.name}
                </a>
                <small>{row.device.code}</small>
              </td>
              <td data-label={t(locale, 'liveWaterwaySection')}>
                {row.waterway.name ?? '—'}
                <small>{row.waterway.sectionName ?? '—'}</small>
              </td>
              <td data-label={t(locale, 'stage')}>
                <Quantity locale={locale} quantity={row.quantities.stage} />
              </td>
              <td data-label={t(locale, 'discharge')}>
                <Quantity locale={locale} quantity={row.quantities.discharge} />
              </td>
              <td data-label={t(locale, 'liveCounter')}>
                <Quantity locale={locale} quantity={row.quantities.accumulatedCounter} />
              </td>
              <td data-label={t(locale, 'livePlan')}>
                <GovernedPlaceholder locale={locale} reason={row.governed.plan.reason} />
              </td>
              <td data-label={t(locale, 'liveVariance')}>
                <GovernedPlaceholder
                  locale={locale}
                  reason={row.governed.intervalVariance.reason}
                />
              </td>
              <td data-label={t(locale, 'dataQuality')}>
                {t(locale, qualityKey(row.quantities.discharge.quality))}
              </td>
              <td data-label={t(locale, 'liveWaterStatus')}>
                <StatusValue locale={locale} row={row} />
                <DeviceHealthStatus locale={locale} health={row.health} />
                <GovernedPlaceholder locale={locale} reason={row.governed.waterStatus.reason} />
              </td>
              <td data-label={t(locale, 'liveLastUpdate')}>
                <time dateTime={row.health.lastSeenReceivedAt ?? undefined}>
                  {formatLiveTimestamp(row.health.lastSeenReceivedAt)}
                </time>
                <small>{formatLiveTimestamp(row.health.lastObservedAt)}</small>
              </td>
              <td data-label={t(locale, 'liveDataAge')}>
                {formatLiveAge(row.health.ageMicroseconds)}
                <small>
                  {row.health.freshness === 'unconfigured'
                    ? t(locale, 'liveNotConfigured')
                    : row.health.freshness}
                </small>
              </td>
              <td data-label={t(locale, 'livePowerSignal')}>
                {row.health.power.state === 'measured' ? `${row.health.power.value} V` : '—'}
                <small>
                  {row.health.signal.state === 'measured' ? `${row.health.signal.value} dBm` : '—'}
                </small>
              </td>
              <td data-label={t(locale, 'liveCalibration')}>
                <GovernedPlaceholder locale={locale} reason={row.governed.calibrationDue.reason} />
              </td>
              <td data-label={t(locale, 'liveAlarm')}>
                <GovernedPlaceholder locale={locale} reason={row.governed.alarm.reason} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      <p className="eyebrow">{t(locale, 'liveSyntheticSource')}</p>
      <h2 id={inspectorHeadingId(row.deviceId)} ref={headingRef} tabIndex={-1}>
        {t(locale, 'liveInspector')}: {rowLabel(row)}
      </h2>
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
            <dd>{row.device.installationId}</dd>
          </div>
          <div>
            <dt>{t(locale, 'liveProtocol')}</dt>
            <dd>{row.device.protocol}</dd>
          </div>
          <div>
            <dt>{t(locale, 'referenceAt')}</dt>
            <dd>{formatLiveTimestamp(inspector.referenceAt)}</dd>
          </div>
          <div>
            <dt>{t(locale, 'knownAt')}</dt>
            <dd>{formatLiveTimestamp(inspector.knownAt)}</dd>
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
              {formatLiveTimestamp(row.health.lastSeenReceivedAt)} /{' '}
              {formatLiveTimestamp(row.health.lastObservedAt)}
            </dd>
          </div>
          <div>
            <dt>{t(locale, 'liveDataAge')}</dt>
            <dd>
              {formatLiveAge(row.health.ageMicroseconds)}; {t(locale, 'liveNotConfigured')}
            </dd>
          </div>
          <div>
            <dt>{t(locale, 'livePowerSignal')}</dt>
            <dd>
              {row.health.power.state === 'measured' ? `${row.health.power.value} V` : '—'} /{' '}
              {row.health.signal.state === 'measured' ? `${row.health.signal.value} dBm` : '—'}
            </dd>
          </div>
          <div>
            <dt>{t(locale, 'source')}</dt>
            <dd>
              {row.health.source.label}; {row.health.source.provenance}
            </dd>
          </div>
        </dl>
        <DeviceHealthStatus locale={locale} health={row.health} />
        <h4>{t(locale, 'liveMeasurementMetadata')}</h4>
        <dl className="live-inspector__details">
          {[row.quantities.stage, row.quantities.discharge, row.quantities.accumulatedCounter].map(
            (quantity) => (
              <div key={quantity.kind}>
                <dt>{quantity.kind}</dt>
                <dd>{`${t(locale, 'source')}: ${quantity.source.label}; ${t(locale, quantity.source.official ? 'liveOfficialSource' : 'liveNonOfficialSource')}; ${t(locale, 'liveMethod')}: ${quantity.measurementMethod ?? '—'}; ${t(locale, 'liveCalibrationReference')}: ${quantity.calibrationRef ?? t(locale, 'liveNotConfigured')}; ${t(locale, 'liveRatingReference')}: ${quantity.ratingCurveRef ?? t(locale, 'liveNotConfigured')}; ${t(locale, 'liveUncertainty')}: ${quantity.uncertainty ?? '—'}`}</dd>
              </div>
            ),
          )}
        </dl>
      </section>
      <section aria-labelledby="live-trend-heading">
        <h3 id="live-trend-heading">{t(locale, 'liveTrend')}</h3>
        <p>{t(locale, 'liveTrendDetail')}</p>
        <div className="live-trend-strip" role="img" aria-label={t(locale, 'liveTrendDetail')}>
          {inspectorTrendRows(inspector).map((point) => (
            <span
              className={point.gap ? 'live-trend-strip__gap' : 'live-trend-strip__point'}
              key={`${point.at}-${point.kind}`}
              title={`${formatLiveTimestamp(point.at)} ${point.gap ? t(locale, 'liveGap') : point.kind}`}
            >
              {point.gap ? '—' : '●'}
            </span>
          ))}
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t(locale, 'liveTrendAt')}</th>
                <th>{t(locale, 'liveMeasurement')}</th>
                <th>{t(locale, 'liveRaw')}</th>
                <th>{t(locale, 'liveValidated')}</th>
                <th>{t(locale, 'liveGap')}</th>
              </tr>
            </thead>
            <tbody>
              {inspectorTrendRows(inspector).map((point) => (
                <tr key={`${point.at}-${point.kind}`}>
                  <td>{formatLiveTimestamp(point.at)}</td>
                  <td>{point.kind}</td>
                  <td>
                    {point.raw ?? '—'} {point.raw === null ? '' : point.unit}
                  </td>
                  <td>
                    {point.validated ?? '—'} {point.validated === null ? '' : point.unit}
                  </td>
                  <td>{point.gap ? t(locale, 'liveGap') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="live-revisions-heading">
        <h3 id="live-revisions-heading">{t(locale, 'liveRevision')}</h3>
        <ul>
          {inspector.revisions.map((revision) => (
            <li
              key={`${revision.lineageId ?? 'synthetic'}-${revision.revision}`}
            >{`${t(locale, 'liveRevision')} ${revision.revision}; ${revision.value} ${revision.unit === 'm3/s' ? 'm³/s' : revision.unit === 'm3' ? 'm³' : 'm'}; ${t(locale, 'liveWorkflow')}: ${revision.workflow}; ${t(locale, 'dataQuality')}: ${t(locale, qualityKey(revision.quality))}; ${formatLiveTimestamp(revision.observedAt)} / ${formatLiveTimestamp(revision.ingestedAt)}; ${t(locale, 'source')}: ${revision.source.label}; ${t(locale, revision.source.official ? 'liveOfficialSource' : 'liveNonOfficialSource')}${revision.reason ? `; ${t(locale, 'liveReason')}: ${revision.reason}` : ''}`}</li>
          ))}
        </ul>
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
}: {
  locale: Locale;
  response: LiveOperationsResponse;
  filters: LiveFilters;
  onFiltersChange: (filters: LiveFilters) => void;
  onClearFilters: () => void;
  onSelect: (deviceId: string) => void;
}) {
  return (
    <>
      <section className="live-operations__intro panel" aria-labelledby="live-operations-heading">
        <p className="eyebrow">{t(locale, 'liveSyntheticSource')}</p>
        <h2 id="live-operations-heading">{t(locale, 'liveOperationsHeading')}</h2>
        <p>{t(locale, 'liveOperationsDetail')}</p>
        <p>
          <strong>{t(locale, 'referenceAt')}:</strong> {formatLiveTimestamp(response.referenceAt)};{' '}
          <strong>{t(locale, 'knownAt')}:</strong> {formatLiveTimestamp(response.knownAt)}
        </p>
        <p>
          <strong>{t(locale, 'provenance')}:</strong> {response.scenario.provenance}
        </p>
      </section>
      <FilterForm
        locale={locale}
        response={response}
        filters={filters}
        onChange={onFiltersChange}
        onClear={onClearFilters}
      />
      <LiveTable locale={locale} response={response} onSelect={onSelect} />
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
      document.getElementById(returnFocus.current)?.focus();
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
    setStream(streamRetry ? 'reconnecting' : 'connecting');
    const source = new EventSource(liveEventsPath(filters));
    let opened = false;
    let retryTimer: number | undefined;
    source.onopen = () => {
      opened = true;
      setStream('connected');
      setStreamReset(false);
    };
    const invalidate = () => setRefresh((value) => value + 1);
    source.addEventListener('invalidate', invalidate);
    source.addEventListener('reset', () => {
      setStream('reconnecting');
      setStreamReset(true);
      invalidate();
    });
    source.onerror = () => {
      source.close();
      setStream(streamFailureState(opened));
      retryTimer = window.setTimeout(
        () => setStreamRetry((value) => value + 1),
        Math.min(30_000, 1_000 * 2 ** Math.min(streamRetry, 5)),
      );
    };
    return () => {
      source.close();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [access, filters, streamRetry]);
  const presentation = streamPresentation(stream);
  const select = (deviceId: string) => {
    returnFocus.current = `live-device-${deviceId}`;
    onDeviceChange(deviceId);
  };
  const changeFilters = (next: LiveFilters) => setFilters(next);
  return (
    <section className="live-operations" aria-label={t(locale, 'liveOperationsHeading')}>
      <div className={`live-stream-status live-stream-status--${stream}`} role="status">
        <span aria-hidden="true">{presentation.icon}</span>
        <strong>{t(locale, presentation.label)}</strong>
        <span>{t(locale, presentation.value)}</span>
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
      {streamReset ? (
        <p className="supporting-text" role="status">
          {t(locale, 'liveReset')}
        </p>
      ) : null}
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
            />
            {state === 'empty' ? (
              <StateNotice
                locale={locale}
                state="empty"
                retry={() => setRefresh((value) => value + 1)}
              />
            ) : (
              <>
                <div className="live-pagination">
                  {priorCursors.length ? (
                    <button
                      className="action-button"
                      type="button"
                      onClick={() => {
                        const next = priorCursors.at(-1) ?? null;
                        setPriorCursors((items) => items.slice(0, -1));
                        setCursor(next);
                      }}
                    >
                      {t(locale, 'livePreviousPage')}
                    </button>
                  ) : null}
                  {result.nextCursor ? (
                    <button
                      className="action-button"
                      type="button"
                      onClick={() => {
                        setPriorCursors((items) => [...items, cursor ?? '']);
                        setCursor(result.nextCursor);
                      }}
                    >
                      {t(locale, 'liveNextPage')}
                    </button>
                  ) : null}
                </div>
                {inspector && selectedDeviceId ? (
                  <LiveOperationsInspector
                    locale={locale}
                    inspector={inspector}
                    onClose={() => onDeviceChange(null)}
                  />
                ) : null}
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

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
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
  livePaginationRange,
  qualityKey,
  rowLabel,
  streamFailureState,
  streamPresentation,
  type LiveFilters,
  type StreamState,
} from './live-operations-model.js';
import { formatDecimal, formatMeasurementValue, presentationTimestamp } from './format.js';
import { FilterPanel } from './filter-panel.js';
import { StatusChip } from './status-chip.js';
import { WorkspaceHeader } from './workspace-header.js';

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
  const detail = [
    t(locale, qualityKey(quantity.quality)),
    quantity.qualityReason,
    quantity.source.label,
    t(locale, quantity.source.official ? 'liveOfficialSource' : 'liveNonOfficialSource'),
  ]
    .filter(Boolean)
    .join('; ');
  const unit = quantity.unit === 'm3/s' ? 'm³/s' : quantity.unit === 'm3' ? 'm³' : 'm';
  return (
    <div className={`live-quantity live-quantity--${quantity.dataState}`}>
      <StatusChip
        detail={detail}
        icon={presentation.icon}
        label={t(locale, presentation.label)}
        tone={quantity.dataState === 'reported' ? 'positive' : 'attention'}
      />
      <span className="visually-hidden">
        <span aria-hidden="true">{presentation.icon}</span>
        {t(locale, presentation.label)}
      </span>
      <strong>
        {quantity.value === null
          ? '—'
          : formatMeasurementValue(locale, quantity.value, quantity.unit)}
        {quantity.value === null ? '' : ` ${unit}`}
      </strong>
      <small className="visually-hidden">{t(locale, qualityKey(quantity.quality))}</small>
      {quantity.qualityReason ? (
        <small className="visually-hidden">{quantity.qualityReason}</small>
      ) : null}
      <small className="visually-hidden">
        {quantity.source.label};{' '}
        {t(locale, quantity.source.official ? 'liveOfficialSource' : 'liveNonOfficialSource')}
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
        <ol className="maintenance-record-list" style={{ marginTop: '0.75rem' }}>
          <li>
            <article>
              <h4>Preventive Calibration — Completed</h4>
              <dl className="live-inspector__details">
                <div>
                  <dt>{t(locale, 'maintenanceType')}</dt>
                  <dd>{t(locale, 'maintenanceInspection')}</dd>
                </div>
                <div>
                  <dt>{t(locale, 'maintenanceStatus')}</dt>
                  <dd>Verified &amp; Operational</dd>
                </div>
                <div>
                  <dt>{t(locale, 'maintenanceAuditEvidence')}</dt>
                  <dd className="stable-identifier">maint_demo_001</dd>
                </div>
              </dl>
            </article>
          </li>
        </ol>
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
  const faultIcon = health.fault === 'reported' ? '!' : health.fault === 'none' ? '✓' : '?';
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
      <StatusChip
        detail={summary}
        icon={`${attention.icon} ${connectionIcon} ${faultIcon} ${conditionIcon}`}
        label={t(locale, attention.label)}
        tone={row.attention.state === 'reported' ? 'positive' : 'attention'}
      />
      <span className="visually-hidden">{summary}</span>
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
}: {
  locale: Locale;
  response: LiveOperationsResponse;
  filters: LiveFilters;
  onChange: (filters: LiveFilters) => void;
  onClear: () => void;
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
}: {
  locale: Locale;
  response: LiveOperationsResponse;
  onSelect: (deviceId: string) => void;
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
    { key: 'counter', label: 'liveCounter' },
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
    'plan',
    'variance',
    'status',
    'dataAge',
    'alarm',
  ];
  const [visible, setVisible] = useState<ReadonlySet<ColumnKey>>(() => new Set(essential));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const toggleColumn = (key: ColumnKey) =>
    setVisible((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const shown = (key: ColumnKey) => visible.has(key);
  return (
    <section className="live-table-panel" aria-label={t(locale, 'liveRows')}>
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
            <div
              className="live-columns-menu__panel"
              role="group"
              aria-label={t(locale, 'columns')}
            >
              {columns.map((column) => (
                <label key={column.key}>
                  <input
                    type="checkbox"
                    checked={shown(column.key)}
                    onChange={() => toggleColumn(column.key)}
                  />
                  {t(locale, column.label)}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="table-scroll live-table-scroll" tabIndex={0}>
        <table className="live-table">
          <caption>{`${t(locale, 'liveRows')}: ${response.rows.length} / ${response.scope.deviceDenominator}`}</caption>
          <thead>
            <tr>
              {columns
                .filter((column) => shown(column.key))
                .map((column) => (
                  <th key={column.key} scope="col">
                    {t(locale, column.label)}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {response.rows.map((row) => (
              <tr key={row.deviceId}>
                {shown('station') ? (
                  <td data-label={t(locale, 'liveStation')} className="live-table__station">
                    <strong className="live-table__station-code" title={row.station.code}>
                      {row.station.code}
                    </strong>
                    <span className="live-table__station-name" title={row.station.name}>
                      {row.station.name}
                    </span>
                    <a
                      id={`live-device-${row.deviceId}`}
                      className="live-table__device-link"
                      href={`#operations?deviceId=${row.deviceId}`}
                      onClick={() => onSelect(row.deviceId)}
                      aria-label={`${t(locale, 'liveSelectDevice')}: ${row.device.name} (${row.device.code}), ${row.station.name}`}
                      title={`${row.device.name} (${row.device.code}); ${row.territory.name}`}
                    >
                      {row.device.code}
                    </a>
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
                  <td data-label={t(locale, 'stage')}>
                    <Quantity locale={locale} quantity={row.quantities.stage} />
                  </td>
                ) : null}
                {shown('discharge') ? (
                  <td data-label={t(locale, 'discharge')}>
                    <Quantity locale={locale} quantity={row.quantities.discharge} />
                  </td>
                ) : null}
                {shown('counter') ? (
                  <td data-label={t(locale, 'liveCounter')}>
                    <Quantity locale={locale} quantity={row.quantities.accumulatedCounter} />
                  </td>
                ) : null}
                {shown('plan') ? (
                  <td data-label={t(locale, 'livePlan')}>
                    <GovernedPlaceholder locale={locale} reason={row.governed.plan.reason} />
                  </td>
                ) : null}
                {shown('variance') ? (
                  <td data-label={t(locale, 'liveVariance')}>
                    <GovernedPlaceholder
                      locale={locale}
                      reason={row.governed.intervalVariance.reason}
                    />
                  </td>
                ) : null}
                {shown('quality') ? (
                  <td data-label={t(locale, 'dataQuality')}>
                    <StatusChip label={t(locale, qualityKey(row.quantities.discharge.quality))} />
                  </td>
                ) : null}
                {shown('status') ? (
                  <td data-label={t(locale, 'liveWaterStatus')}>
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
                    {row.health.power.state === 'measured' ? `${row.health.power.value} V` : '—'}
                    <small>
                      {row.health.signal.state === 'measured'
                        ? `${row.health.signal.value} dBm`
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
                  <td>
                    <PresentationTime locale={locale} value={point.at} />
                  </td>
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
            <li key={`${revision.lineageId ?? 'synthetic'}-${revision.revision}`}>
              {`${t(locale, 'liveRevision')} ${revision.revision}; ${formatDecimal(locale, revision.value)} ${revision.unit === 'm3/s' ? 'm³/s' : revision.unit === 'm3' ? 'm³' : 'm'}; ${t(locale, 'liveWorkflow')}: ${revision.workflow}; ${t(locale, 'dataQuality')}: ${t(locale, qualityKey(revision.quality))}; `}
              <PresentationTime locale={locale} value={revision.observedAt} /> /{' '}
              <PresentationTime locale={locale} value={revision.ingestedAt} />
              {`; ${t(locale, 'source')}: ${revision.source.label}; ${t(locale, revision.source.official ? 'liveOfficialSource' : 'liveNonOfficialSource')}${revision.reason ? `; ${t(locale, 'liveReason')}: ${revision.reason}` : ''}`}
            </li>
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
  connectionIndicator,
}: {
  locale: Locale;
  response: LiveOperationsResponse;
  filters: LiveFilters;
  onFiltersChange: (filters: LiveFilters) => void;
  onClearFilters: () => void;
  onSelect: (deviceId: string) => void;
  connectionIndicator?: ReactNode;
}) {
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
                    className="action-button"
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

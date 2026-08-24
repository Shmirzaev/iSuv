import type {
  LiveOperationsInspector,
  LiveOperationsQuery,
  LiveOperationsResponse,
} from '@isuv/contracts';

import type { TranslationKey } from '@isuv/i18n';

export type LiveFilters = Pick<
  LiveOperationsQuery,
  | 'territoryId'
  | 'waterwayId'
  | 'sectionId'
  | 'stationId'
  | 'deviceId'
  | 'measurementKind'
  | 'connection'
  | 'fault'
  | 'dataState'
  | 'quality'
  | 'attention'
>;

const filterKeys = [
  'territoryId',
  'waterwayId',
  'sectionId',
  'stationId',
  'deviceId',
  'measurementKind',
  'connection',
  'fault',
  'dataState',
  'quality',
  'attention',
] as const satisfies readonly (keyof LiveFilters)[];

export function liveOperationsPath(filters: LiveFilters, cursor?: string | null): string {
  const search = new URLSearchParams();
  for (const key of filterKeys) {
    const value = filters[key];
    if (value) search.set(key, value);
  }
  if (cursor) search.set('cursor', cursor);
  search.set('limit', '25');
  return `/api/v1/live-operations?${search.toString()}`;
}

export function liveInspectorPath(deviceId: string, territoryId?: string): string {
  const query = territoryId ? `?territoryId=${encodeURIComponent(territoryId)}` : '';
  return `/api/v1/live-operations/${encodeURIComponent(deviceId)}${query}`;
}

/** The stream supplies invalidations only; every displayed value comes from a typed re-fetch. */
export function liveEventsPath(filters: LiveFilters): string {
  return filters.territoryId
    ? `/api/v1/live-operations/live?territoryId=${encodeURIComponent(filters.territoryId)}`
    : '/api/v1/live-operations/live';
}

export function selectedDeviceFromHash(hash: string): string | null {
  const [area, query] = hash.replace(/^#/, '').split('?', 2);
  if (area !== 'operations') return null;
  const deviceId = new URLSearchParams(query ?? '').get('deviceId');
  return deviceId && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(deviceId) ? deviceId : null;
}

export function operationsHash(deviceId: string | null): string {
  return deviceId ? `#operations?deviceId=${encodeURIComponent(deviceId)}` : '#operations';
}

export function liveAttentionPresentation(
  state: LiveOperationsResponse['rows'][number]['attention']['state'],
): { icon: string; label: TranslationKey; value: TranslationKey } {
  const values: Record<
    LiveOperationsResponse['rows'][number]['attention']['state'],
    { icon: string; label: TranslationKey; value: TranslationKey }
  > = {
    attention: { icon: '!', label: 'liveAttention', value: 'liveActionRequired' },
    unreliable: { icon: '!', label: 'statusUnreliable', value: 'liveUncertainData' },
    no_data: { icon: '—', label: 'noData', value: 'statusNoObservation' },
    reported: { icon: '✓', label: 'statusReported', value: 'liveSyntheticValue' },
  };
  return values[state];
}

export function liveDataStatePresentation(
  state: LiveOperationsResponse['rows'][number]['quantities']['stage']['dataState'],
): { icon: string; label: TranslationKey; value: TranslationKey } {
  const values: Record<
    LiveOperationsResponse['rows'][number]['quantities']['stage']['dataState'],
    { icon: string; label: TranslationKey; value: TranslationKey }
  > = {
    reported: { icon: '✓', label: 'statusReported', value: 'liveSyntheticValue' },
    unreliable: { icon: '!', label: 'statusUnreliable', value: 'statusUnreliableValue' },
    no_data: { icon: '—', label: 'noData', value: 'statusNoObservation' },
  };
  return values[state];
}

export function formatLiveTimestamp(value: string | null): string {
  return value ? value.replace('T', ' ').replace('Z', ' UTC') : '—';
}

/** Does not infer a freshness threshold: this is an exact elapsed-age display only. */
export function formatLiveAge(value: string | null): string {
  if (value === null) return '—';
  const micros = BigInt(value);
  if (micros >= 3_600_000_000n) return `${micros / 3_600_000_000n} h`;
  if (micros >= 60_000_000n) return `${micros / 60_000_000n} min`;
  if (micros >= 1_000_000n) return `${micros / 1_000_000n} s`;
  return `${micros} µs`;
}

export function qualityKey(
  quality: LiveOperationsResponse['rows'][number]['quantities']['stage']['quality'],
): TranslationKey {
  const keys: Record<
    LiveOperationsResponse['rows'][number]['quantities']['stage']['quality'],
    TranslationKey
  > = {
    valid: 'qualityValid',
    suspect: 'liveQualitySuspect',
    invalid: 'liveQualityInvalid',
    estimated: 'liveQualityEstimated',
    unknown: 'liveQualityUnknown',
  };
  return keys[quality];
}

export function inspectorHeadingId(deviceId: string): string {
  return `live-inspector-${deviceId}`;
}

export function rowLabel(row: LiveOperationsResponse['rows'][number]): string {
  return `${row.station.code} — ${row.device.code}`;
}

export type StreamState = 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

/** A completed bounded SSE poll is a reconnect, while a connection that never opened is unavailable. */
export function streamFailureState(opened: boolean): StreamState {
  return opened ? 'reconnecting' : 'unavailable';
}

export function streamPresentation(state: StreamState): {
  icon: string;
  label: TranslationKey;
  value: TranslationKey;
} {
  const values: Record<
    StreamState,
    { icon: string; label: TranslationKey; value: TranslationKey }
  > = {
    connecting: { icon: '◌', label: 'liveConnecting', value: 'liveAwaitingUpdates' },
    connected: { icon: '✓', label: 'liveConnected', value: 'liveRefreshOnChange' },
    reconnecting: { icon: '↻', label: 'liveReconnecting', value: 'liveRetryingConnection' },
    unavailable: { icon: '⊘', label: 'liveUpdatesUnavailable', value: 'liveManualRefreshRequired' },
  };
  return values[state];
}

export function inspectorTrendRows(inspector: LiveOperationsInspector) {
  return inspector.trend;
}

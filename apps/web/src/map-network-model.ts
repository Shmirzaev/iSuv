import type {
  MapNetworkQuery,
  MapNetworkResponse,
  PlaybackResponse,
  TraceResponse,
} from '@isuv/contracts';
import type { TranslationKey } from '@isuv/i18n';

export type MapDetail = MapNetworkQuery['detail'];
export type MapSelection = { stationId: string | null; deviceId: string | null };

export function initialMapDetail(selection: MapSelection): MapDetail {
  return selection.stationId ? 'network' : 'overview';
}

const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
export function mapSelectionFromHash(hash: string): MapSelection {
  const [area, query] = hash.replace(/^#/, '').split('?', 2);
  if (area !== 'map') return { stationId: null, deviceId: null };
  const params = new URLSearchParams(query ?? '');
  const stationId = params.get('stationId');
  const deviceId = params.get('deviceId');
  return {
    stationId: stationId && uuid.test(stationId) ? stationId : null,
    deviceId: deviceId && uuid.test(deviceId) ? deviceId : null,
  };
}
export function mapHash(selection: MapSelection): string {
  const key = selection.stationId ? 'stationId' : 'deviceId';
  const value = selection.stationId ?? selection.deviceId;
  return value ? `#map?${key}=${encodeURIComponent(value)}` : '#map';
}
export function mapNetworkPath(
  detail: MapDetail,
  selection: MapSelection,
  territoryId?: string,
): string {
  const q = new URLSearchParams({ detail });
  if (territoryId) q.set('territoryId', territoryId);
  if (selection.stationId) q.set('stationId', selection.stationId);
  return `/api/v1/map-network?${q}`;
}
export function tracePath(
  stationId: string,
  direction: TraceResponse['direction'],
  territoryId?: string,
): string {
  const q = new URLSearchParams({ stationId, direction });
  if (territoryId) q.set('territoryId', territoryId);
  return `/api/v1/map-network/trace?${q}`;
}
export function playbackPath(stationId: string, territoryId?: string): string {
  const q = new URLSearchParams({ stationId });
  if (territoryId) q.set('territoryId', territoryId);
  return `/api/v1/map-network/playback?${q}`;
}
export function mapStatePresentation(
  state: NonNullable<MapNetworkResponse['panel']>['stage']['state'] | 'over' | 'on_plan' | 'under',
): { icon: string; label: TranslationKey; value: TranslationKey } {
  const values: Record<
    'reported' | 'unreliable' | 'no_data' | 'over' | 'on_plan' | 'under',
    { icon: string; label: TranslationKey; value: TranslationKey }
  > = {
    reported: { icon: '✓', label: 'statusReported', value: 'mapEvidenceReported' },
    unreliable: { icon: '!', label: 'statusUnreliable', value: 'statusUnreliableValue' },
    no_data: { icon: '—', label: 'noData', value: 'statusNoObservation' },
    over: { icon: '↑', label: 'statusOver', value: 'mapComplianceUnconfigured' },
    on_plan: { icon: '✓', label: 'statusOnPlan', value: 'mapComplianceUnconfigured' },
    under: { icon: '↓', label: 'statusUnder', value: 'mapComplianceUnconfigured' },
  };
  return values[state];
}
export function markerState(
  panel: NonNullable<MapNetworkResponse['panel']>,
): NonNullable<MapNetworkResponse['panel']>['stage']['state'] {
  if (
    panel.health.fault === 'reported' ||
    panel.stage.state === 'unreliable' ||
    panel.discharge.state === 'unreliable'
  )
    return 'unreliable';
  if (panel.stage.state === 'no_data' || panel.discharge.state === 'no_data') return 'no_data';
  return 'reported';
}
export function playbackFrame(playback: PlaybackResponse | null, index: number) {
  return playback?.frames[Math.max(0, Math.min(23, index))] ?? null;
}

export interface DeviceHealthProjectionEvent {
  id: string;
  organizationId: string;
  territoryId: string;
  deviceId: string;
  deviceInstallationId: string;
  receivedAt: string;
  connectionStatus: 'communicating' | 'offline' | 'unknown';
  deviceFault: 'reported' | 'none' | 'unknown';
  faultCode: string | null;
  power: { state: 'unknown' } | { state: 'measured'; value: string; unit: 'V' };
  signal: { state: 'unknown' } | { state: 'measured'; value: string; unit: 'dBm' };
  provenance: string;
  dataClassification: 'synthetic' | 'official';
  dataCondition: 'current' | 'stale' | 'unreliable' | 'unknown' | 'no_data' | 'unconfigured';
}
export interface DeviceHealthProjection {
  deviceId: string;
  organizationId: string;
  territoryId: string;
  deviceInstallationId: string;
  connectionStatus: 'communicating' | 'offline' | 'unknown';
  deviceFault: 'reported' | 'none' | 'unknown';
  lastSeenReceivedAt: string;
  lastObservedAt: string | null;
  dataCondition: 'current' | 'stale' | 'unreliable' | 'unknown' | 'no_data' | 'unconfigured';
  faultCode: string | null;
  power: DeviceHealthProjectionEvent['power'];
  signal: DeviceHealthProjectionEvent['signal'];
  provenance: string;
  dataClassification: 'synthetic' | 'official';
  synthetic: boolean;
  latestEventId: string;
  latestLiveEventId: string;
  freshness: 'unconfigured';
}

/** Pure projection rule: receipt time is operational liveness, source time is provenance. */
export function projectDeviceHealth(
  event: DeviceHealthProjectionEvent,
  latestLiveEventId: string,
): DeviceHealthProjection {
  return {
    deviceId: event.deviceId,
    organizationId: event.organizationId,
    territoryId: event.territoryId,
    deviceInstallationId: event.deviceInstallationId,
    connectionStatus: event.connectionStatus,
    deviceFault: event.deviceFault,
    lastSeenReceivedAt: event.receivedAt,
    lastObservedAt: null,
    dataCondition: event.dataCondition,
    freshness: 'unconfigured',
    faultCode: event.faultCode,
    power: event.power,
    signal: event.signal,
    provenance: event.provenance,
    dataClassification: event.dataClassification,
    synthetic: event.dataClassification === 'synthetic',
    latestEventId: event.id,
    latestLiveEventId,
  };
}

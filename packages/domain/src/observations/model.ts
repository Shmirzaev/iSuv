/** A raw accumulated-volume reading is a counter, never an interval volume. */
export const observationUnits = {
  stage: 'm',
  discharge: 'm3/s',
  accumulated_volume: 'm3',
} as const;
export type ObservationMeasurementKind = keyof typeof observationUnits;
export type ObservationUsability = 'no_data' | 'usable' | 'unreliable';

/** No-data is represented by an absent observation/coverage interval, not a zero or null reading. */
export function observationUsability(
  workflow:
    | 'raw'
    | 'automatically_validated'
    | 'expert_validated'
    | 'corrected'
    | 'estimated'
    | 'rejected'
    | null
    | undefined,
  quality: 'unknown' | 'valid' | 'suspect' | 'invalid' | 'estimated' | null | undefined,
): ObservationUsability {
  if (workflow === null || workflow === undefined || quality === null || quality === undefined)
    return 'no_data';
  return quality === 'valid' &&
    ['automatically_validated', 'expert_validated', 'corrected'].includes(workflow)
    ? 'usable'
    : 'unreliable';
}

export function requiredUnitForMeasurement(
  kind: ObservationMeasurementKind,
): (typeof observationUnits)[ObservationMeasurementKind] {
  return observationUnits[kind];
}

/** Vendor-neutral ingestion boundary for MQTT, OPC UA, Modbus, SCADA, or file adapters. */
export interface ObservationIngestionPort<TRequest, TResult> {
  ingest(request: TRequest): Promise<TResult>;
}

import type {
  IngestObservationRequest,
  IngestObservationResponse,
  TelemetryBatchResult,
} from '@isuv/contracts';
import {
  simulateTelemetryEnvelope,
  type SyntheticTelemetryPoint,
  type TelemetryScenario,
} from '@isuv/domain';

/** Vendor-neutral boundary for MQTT, OPC UA, Modbus, SCADA, and file adapters. */
export interface TelemetryIngestionPort {
  ingest(
    request: IngestObservationRequest,
    expectedTerritoryId?: string,
  ): Promise<IngestObservationResponse>;
}

export interface ReplayQueueEntry {
  point: SyntheticTelemetryPoint;
  sequence: number;
}

/** Bounded edge store-and-forward boundary; it is not a control surface. */
export class BoundedTelemetryReplayQueue {
  private readonly entries: ReplayQueueEntry[] = [];
  private nextSequence = 1;

  public constructor(private readonly capacity = 300) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10_000)
      throw new Error('Replay queue capacity must be a bounded positive integer.');
  }

  public append(point: SyntheticTelemetryPoint): {
    accepted: boolean;
    overflowed: boolean;
    sequence?: number;
  } {
    if (this.entries.some((entry) => entry.point.sourceEventId === point.sourceEventId))
      return { accepted: false, overflowed: false };
    if (this.entries.length >= this.capacity) return { accepted: false, overflowed: true };
    const entry = { point, sequence: this.nextSequence++ };
    this.entries.push(entry);
    return { accepted: true, overflowed: false, sequence: entry.sequence };
  }

  /** Removes only an acknowledged prefix. Out-of-order timestamps remain visible. */
  public acknowledge(sequence: number): void {
    if (!Number.isInteger(sequence) || sequence < 0)
      throw new Error('Replay acknowledgement is invalid.');
    while (this.entries[0] && this.entries[0].sequence <= sequence) this.entries.shift();
  }

  public replay(): readonly ReplayQueueEntry[] {
    return this.entries.slice();
  }

  public get size(): number {
    return this.entries.length;
  }
}

export function toIngestRequest(point: SyntheticTelemetryPoint): IngestObservationRequest {
  return {
    sensorId: point.sensorId,
    deviceId: point.deviceId,
    measurementKind: point.kind,
    sourceSystem: 'synthetic-simulator-v1',
    sourceEventId: point.sourceEventId,
    observedAt: point.observedAt,
    unit: point.unit,
    value: point.value,
    uncertainty: null,
    qualityState: point.qualityState,
    qualityReason: point.qualityReason,
    totalizerTransition: point.totalizerTransition,
    provenance: `synthetic:telemetry-simulator-v1;scenario=${point.scenario}`,
    measurementMethod: 'unconfigured',
  };
}

export async function ingestSyntheticBatch(
  port: TelemetryIngestionPort,
  seed: string,
  at: string,
  step: number,
  scenario: TelemetryScenario,
  expectedTerritories: ReadonlyMap<string, string> = new Map(),
  queue = new BoundedTelemetryReplayQueue(300),
): Promise<TelemetryBatchResult> {
  const envelope = simulateTelemetryEnvelope(seed, at, step, scenario);
  let accepted = 0;
  let idempotent = 0;
  let failures = 0;
  let overflowed = 0;
  let replayed = 0;
  for (const point of envelope.points) {
    const appended = queue.append(point);
    if (appended.overflowed) overflowed += 1;
  }
  for (const entry of queue.replay()) {
    try {
      const result = await port.ingest(
        toIngestRequest(entry.point),
        expectedTerritories.get(entry.point.sourceEventId),
      );
      replayed += 1;
      if (result.idempotent) idempotent += 1;
      else accepted += 1;
      queue.acknowledge(entry.sequence);
    } catch {
      // Preserve the failed event for an explicit later replay; do not claim success.
      failures += 1;
      break;
    }
  }
  return {
    accepted,
    idempotent,
    gaps: envelope.statuses.length,
    failures,
    replayed,
    overflowed,
    statusEvents: envelope.statuses,
  };
}

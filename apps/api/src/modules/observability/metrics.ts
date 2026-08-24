import { withDatabase } from '../../db/client.js';
import type { ProcessMetricsSnapshot } from './registry.js';

const deviceConnectionStates = ['communicating', 'offline', 'unknown', 'unconfigured'] as const;
const deviceFaultStates = ['reported', 'none', 'unknown', 'unconfigured'] as const;
const deviceDataConditions = [
  'current',
  'stale',
  'unreliable',
  'unknown',
  'no_data',
  'unconfigured',
] as const;
const alarmEvaluationOutcomeStates = [
  'inactive',
  'pending_activation',
  'active',
  'pending_clear',
] as const;

type DeviceConnectionState = (typeof deviceConnectionStates)[number];
type DeviceDataCondition = (typeof deviceDataConditions)[number];
type AlarmEvaluationOutcomeState = (typeof alarmEvaluationOutcomeStates)[number];

export interface OperationalMetricsSnapshot {
  databaseUp: boolean;
  scrapedAtEpochSeconds: number | null;
  telemetry: {
    acceptedLineagesTotal: number;
    rejectedRevisionsTotal: number;
    latestReceivedAtEpochSeconds: number | null;
    latestObservedAtEpochSeconds: number | null;
  };
  deviceHealth: {
    connectionCounts: Record<DeviceConnectionState, number>;
    faultCounts: Record<(typeof deviceFaultStates)[number], number>;
    dataConditionCounts: Record<DeviceDataCondition, number>;
  };
  alarmRules: {
    evaluationCounts: Record<AlarmEvaluationOutcomeState, number>;
    deferredTotal: number;
  };
}

export interface MetricsQueryClient {
  query<T extends Record<string, string | null>>(sql: string): Promise<{ rows: T[] }>;
}

export interface OperationalMetricsRepository {
  snapshot(): Promise<OperationalMetricsSnapshot>;
}

function zeroCounts<T extends readonly string[]>(states: T): Record<T[number], number> {
  return Object.fromEntries(states.map((state) => [state, 0])) as Record<T[number], number>;
}

function parseCount(value: string | null | undefined, name: string): number {
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) throw new Error(`Invalid ${name} metric count.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Unsafe ${name} metric count.`);
  return parsed;
}

function parseEpoch(value: string | null | undefined, name: string): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${name} metric timestamp.`);
  return parsed;
}

function metricLine(name: string, value: number, labels?: Record<string, string>): string {
  const renderedLabels = labels
    ? `{${Object.entries(labels)
        .map(([key, label]) => `${key}="${label}"`)
        .join(',')}}`
    : '';
  return `${name}${renderedLabels} ${value}`;
}

function metricsHeader(name: string, help: string, type = 'gauge'): string[] {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`];
}

/**
 * Read-only, low-cardinality operational metrics. Device, sensor, territory,
 * user, and request identifiers are intentionally never emitted as labels.
 */
export class PostgresOperationalMetricsRepository implements OperationalMetricsRepository {
  public constructor(
    private readonly databaseUrl: string | undefined,
    private readonly queryClient?: MetricsQueryClient,
  ) {}

  public async snapshot(): Promise<OperationalMetricsSnapshot> {
    if (this.queryClient) return this.snapshotFrom(this.queryClient);
    return withDatabase(this.databaseUrl, (pool) => this.snapshotFrom(pool));
  }

  private async snapshotFrom(client: MetricsQueryClient): Promise<OperationalMetricsSnapshot> {
    // Keep these reads sequential so a caller-provided transaction-scoped client
    // is never asked to execute concurrent queries.
    const telemetryResult = await client.query<{
      accepted_lineages_total: string;
      rejected_revisions_total: string;
      scraped_at_epoch_seconds: string;
      latest_received_at_epoch_seconds: string | null;
      latest_observed_at_epoch_seconds: string | null;
    }>(
      `SELECT
           (SELECT count(*)::text FROM observation_lineages) accepted_lineages_total,
           (SELECT count(*)::text FROM observation_revisions WHERE state='rejected') rejected_revisions_total,
           extract(epoch FROM clock_timestamp())::text scraped_at_epoch_seconds,
           (SELECT extract(epoch FROM max(revision.ingested_at))::text FROM observation_revisions revision WHERE revision.revision=1) latest_received_at_epoch_seconds,
           (SELECT extract(epoch FROM max(lineage.observed_at))::text FROM observation_lineages lineage) latest_observed_at_epoch_seconds`,
    );
    const healthResult = await client.query<{
      connection_status: DeviceConnectionState;
      device_fault: (typeof deviceFaultStates)[number];
      data_condition: DeviceDataCondition;
      count: string;
    }>(
      `WITH active_devices AS (
           SELECT installation.device_id
           FROM telemetry_device_installations installation
           JOIN telemetry_devices device
             ON device.id=installation.device_id AND device.organization_id=installation.organization_id
           WHERE installation.effective_from <= clock_timestamp()
             AND (installation.effective_until IS NULL OR installation.effective_until > clock_timestamp())
         )
         SELECT COALESCE(current_health.connection_status::text,'unconfigured') connection_status,
                COALESCE(current_health.device_fault,'unconfigured') device_fault,
                COALESCE(current_health.data_condition,'unconfigured') data_condition,
                count(*)::text count
         FROM active_devices device
         LEFT JOIN device_health_current current_health ON current_health.device_id=device.device_id
         GROUP BY COALESCE(current_health.connection_status::text,'unconfigured'),
                  COALESCE(current_health.device_fault,'unconfigured'),
                  COALESCE(current_health.data_condition,'unconfigured')`,
    );
    const ruleResult = await client.query<{ state: string; count: string }>(
      `SELECT state,count(*)::text count
         FROM alarm_rule_evaluation_runs
         GROUP BY state`,
    );

    const telemetry = telemetryResult.rows[0];
    if (!telemetry) throw new Error('Operational metrics query did not return telemetry data.');
    const connectionCounts = zeroCounts(deviceConnectionStates);
    const faultCounts = zeroCounts(deviceFaultStates);
    const dataConditionCounts = zeroCounts(deviceDataConditions);
    for (const row of healthResult.rows) {
      if (!deviceConnectionStates.includes(row.connection_status))
        throw new Error('Invalid device-health connection metric state.');
      if (!deviceDataConditions.includes(row.data_condition))
        throw new Error('Invalid device-health data-condition metric state.');
      const count = parseCount(row.count, 'device-health');
      connectionCounts[row.connection_status] += count;
      if (!deviceFaultStates.includes(row.device_fault))
        throw new Error('Invalid device-health fault metric state.');
      faultCounts[row.device_fault] += count;
      dataConditionCounts[row.data_condition] += count;
    }
    const evaluationCounts = zeroCounts(alarmEvaluationOutcomeStates);
    let deferredTotal = 0;
    for (const row of ruleResult.rows) {
      const count = parseCount(row.count, 'alarm-rule evaluation');
      if (row.state === 'deferred') {
        deferredTotal += count;
        continue;
      }
      if (!alarmEvaluationOutcomeStates.includes(row.state as AlarmEvaluationOutcomeState))
        throw new Error('Invalid alarm-rule evaluation metric state.');
      evaluationCounts[row.state as AlarmEvaluationOutcomeState] += count;
    }

    return {
      databaseUp: true,
      scrapedAtEpochSeconds: parseEpoch(telemetry.scraped_at_epoch_seconds, 'scrape'),
      telemetry: {
        acceptedLineagesTotal: parseCount(telemetry.accepted_lineages_total, 'accepted lineage'),
        rejectedRevisionsTotal: parseCount(telemetry.rejected_revisions_total, 'rejected revision'),
        latestReceivedAtEpochSeconds: parseEpoch(
          telemetry.latest_received_at_epoch_seconds,
          'latest receipt',
        ),
        latestObservedAtEpochSeconds: parseEpoch(
          telemetry.latest_observed_at_epoch_seconds,
          'latest source',
        ),
      },
      deviceHealth: { connectionCounts, faultCounts, dataConditionCounts },
      alarmRules: { evaluationCounts, deferredTotal },
    };
  }
}

/** Renders Prometheus text exposition without inventing a freshness value for absent data. */
export function renderOperationalMetrics(
  snapshot: OperationalMetricsSnapshot,
  processMetrics: ProcessMetricsSnapshot,
): string {
  const lines = [
    ...metricsHeader('isuv_api_up', 'API process liveness.'),
    metricLine('isuv_api_up', 1),
    ...metricsHeader('isuv_database_ready', 'Database metrics dependency availability.'),
    metricLine('isuv_database_ready', snapshot.databaseUp ? 1 : 0),
    ...metricsHeader(
      'isuv_telemetry_observation_data_available',
      'Whether at least one durable observation receipt exists.',
    ),
    metricLine(
      'isuv_telemetry_observation_data_available',
      snapshot.telemetry.latestReceivedAtEpochSeconds === null ? 0 : 1,
    ),
    ...metricsHeader(
      'isuv_telemetry_accepted_lineages_total',
      'Durable unique telemetry source events accepted into observation lineages.',
      'counter',
    ),
    metricLine('isuv_telemetry_accepted_lineages_total', snapshot.telemetry.acceptedLineagesTotal),
    ...metricsHeader(
      'isuv_telemetry_rejected_revisions_total',
      'Durable rejected observation revisions; transport failures are never presented as accepted data.',
      'counter',
    ),
    metricLine(
      'isuv_telemetry_rejected_revisions_total',
      snapshot.telemetry.rejectedRevisionsTotal,
    ),
  ];

  if (
    snapshot.scrapedAtEpochSeconds !== null &&
    snapshot.telemetry.latestReceivedAtEpochSeconds !== null
  ) {
    lines.push(
      ...metricsHeader(
        'isuv_telemetry_latest_receipt_lag_seconds',
        'Seconds since the latest durable telemetry receipt; omitted when no receipt exists.',
      ),
      metricLine(
        'isuv_telemetry_latest_receipt_lag_seconds',
        snapshot.scrapedAtEpochSeconds - snapshot.telemetry.latestReceivedAtEpochSeconds,
      ),
    );
  }
  if (
    snapshot.scrapedAtEpochSeconds !== null &&
    snapshot.telemetry.latestObservedAtEpochSeconds !== null
  ) {
    lines.push(
      ...metricsHeader(
        'isuv_telemetry_latest_source_lag_seconds',
        'Seconds since the latest source observation timestamp; a negative value exposes source clock skew.',
      ),
      metricLine(
        'isuv_telemetry_latest_source_lag_seconds',
        snapshot.scrapedAtEpochSeconds - snapshot.telemetry.latestObservedAtEpochSeconds,
      ),
    );
  }

  lines.push(
    ...metricsHeader(
      'isuv_device_health_current_devices',
      'Active devices by current connection state; communication and data condition are separate.',
    ),
  );
  for (const state of deviceConnectionStates)
    lines.push(
      metricLine(
        'isuv_device_health_current_devices',
        snapshot.deviceHealth.connectionCounts[state],
        {
          connection_state: state,
        },
      ),
    );
  lines.push(
    ...metricsHeader('isuv_device_health_fault_devices', 'Active devices by current fault state.'),
  );
  for (const fault of deviceFaultStates)
    lines.push(
      metricLine('isuv_device_health_fault_devices', snapshot.deviceHealth.faultCounts[fault], {
        device_fault: fault,
      }),
    );
  lines.push(
    ...metricsHeader(
      'isuv_device_health_data_condition_devices',
      'Active devices by device-health condition; absent projections are unconfigured and no_data remains distinct.',
    ),
  );
  for (const condition of deviceDataConditions)
    lines.push(
      metricLine(
        'isuv_device_health_data_condition_devices',
        snapshot.deviceHealth.dataConditionCounts[condition],
        { data_condition: condition },
      ),
    );
  lines.push(
    ...metricsHeader(
      'isuv_alarm_rule_evaluation_runs_total',
      'Durable terminal alarm-rule evaluation outcomes, excluding deferred evidence outcomes.',
      'counter',
    ),
  );
  for (const state of alarmEvaluationOutcomeStates)
    lines.push(
      metricLine(
        'isuv_alarm_rule_evaluation_runs_total',
        snapshot.alarmRules.evaluationCounts[state],
        {
          outcome: state,
        },
      ),
    );
  lines.push(
    ...metricsHeader(
      'isuv_alarm_rule_evaluation_deferred_total',
      'Durable alarm-rule evaluations deferred for insufficient or unreliable evidence.',
      'counter',
    ),
    metricLine('isuv_alarm_rule_evaluation_deferred_total', snapshot.alarmRules.deferredTotal),
  );

  lines.push(
    ...metricsHeader(
      'isuv_api_errors_total',
      'Process-local API errors by bounded route template, status class, and API error code.',
      'counter',
    ),
  );
  for (const error of processMetrics.apiErrors)
    lines.push(
      metricLine('isuv_api_errors_total', error.count, {
        route: error.route,
        status_class: error.statusClass,
        code: error.code,
      }),
    );
  lines.push(
    ...metricsHeader(
      'isuv_observation_ingestion_outcomes_total',
      'Process-local observation ingestion HTTP outcomes.',
      'counter',
    ),
  );
  for (const outcome of ['accepted', 'idempotent'] as const)
    lines.push(
      metricLine(
        'isuv_observation_ingestion_outcomes_total',
        processMetrics.observationIngestion[outcome],
        { outcome },
      ),
    );
  lines.push(
    ...metricsHeader(
      'isuv_validation_execution_outcomes_total',
      'Process-local validation HTTP outcomes.',
      'counter',
    ),
  );
  for (const outcome of ['applied', 'deferred'] as const)
    lines.push(
      metricLine('isuv_validation_execution_outcomes_total', processMetrics.validation[outcome], {
        outcome,
      }),
    );

  return `${lines.join('\n')}\n`;
}

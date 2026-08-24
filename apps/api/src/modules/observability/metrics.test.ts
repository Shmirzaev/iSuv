import assert from 'node:assert/strict';
import test from 'node:test';
import { renderOperationalMetrics, type OperationalMetricsSnapshot } from './metrics.js';
import type { ProcessMetricsSnapshot } from './registry.js';

const processMetrics: ProcessMetricsSnapshot = {
  apiErrors: [
    {
      route: '/api/v1/observations/:lineageId',
      statusClass: '4xx',
      code: 'NOT_FOUND',
      count: 2,
    },
  ],
  observationIngestion: { accepted: 7, idempotent: 3 },
  validation: { applied: 4, deferred: 2 },
};

function snapshot(): OperationalMetricsSnapshot {
  return {
    databaseUp: true,
    scrapedAtEpochSeconds: 1_800,
    telemetry: {
      acceptedLineagesTotal: 12,
      rejectedRevisionsTotal: 2,
      latestReceivedAtEpochSeconds: 1_700,
      latestObservedAtEpochSeconds: 1_650,
    },
    deviceHealth: {
      connectionCounts: { communicating: 3, offline: 2, unknown: 1, unconfigured: 0 },
      faultCounts: { reported: 1, none: 3, unknown: 2, unconfigured: 0 },
      dataConditionCounts: {
        current: 2,
        stale: 1,
        unreliable: 1,
        unknown: 0,
        no_data: 1,
        unconfigured: 1,
      },
    },
    alarmRules: {
      evaluationCounts: {
        inactive: 1,
        pending_activation: 2,
        active: 3,
        pending_clear: 4,
      },
      deferredTotal: 5,
    },
  };
}

test('operational metrics render Prometheus text with bounded labels and explicit stale/deferred states', () => {
  const rendered = renderOperationalMetrics(snapshot(), processMetrics);

  assert.match(rendered, /^# HELP isuv_api_up /m);
  assert.match(rendered, /^# TYPE isuv_telemetry_accepted_lineages_total counter$/m);
  assert.match(rendered, /^isuv_telemetry_latest_receipt_lag_seconds 100$/m);
  assert.match(rendered, /^isuv_telemetry_latest_source_lag_seconds 150$/m);
  assert.match(rendered, /isuv_device_health_data_condition_devices\{data_condition="stale"\} 1/);
  assert.match(rendered, /isuv_device_health_data_condition_devices\{data_condition="no_data"\} 1/);
  assert.match(rendered, /^isuv_alarm_rule_evaluation_deferred_total 5$/m);
  assert.match(rendered, /isuv_device_health_fault_devices\{device_fault="reported"\} 1/);
  assert.match(rendered, /isuv_observation_ingestion_outcomes_total\{outcome="idempotent"\} 3/);
  assert.doesNotMatch(rendered, /device_id|sensor_id|territory_id|user_id/i);
});

test('empty telemetry never fabricates a normal freshness value and keeps unconfigured distinct from no_data', () => {
  const empty = snapshot();
  empty.telemetry.latestReceivedAtEpochSeconds = null;
  empty.telemetry.latestObservedAtEpochSeconds = null;
  empty.telemetry.acceptedLineagesTotal = 0;
  empty.deviceHealth.dataConditionCounts = {
    current: 0,
    stale: 0,
    unreliable: 0,
    unknown: 0,
    no_data: 0,
    unconfigured: 6,
  };
  const rendered = renderOperationalMetrics(empty, processMetrics);

  assert.match(rendered, /^isuv_api_up 1$/m);
  assert.match(rendered, /^isuv_database_ready 1$/m);
  assert.match(rendered, /^isuv_telemetry_observation_data_available 0$/m);
  assert.match(rendered, /data_condition="no_data"\} 0/);
  assert.match(rendered, /data_condition="unconfigured"\} 6/);
  assert.doesNotMatch(rendered, /isuv_telemetry_latest_(receipt|source)_lag_seconds/);
});

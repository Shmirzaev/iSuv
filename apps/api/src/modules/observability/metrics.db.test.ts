import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { simulateTelemetry } from '@isuv/domain';
import { PostgresObservationService } from '../observations/service.js';
import { ingestSyntheticBatch, toIngestRequest } from '../telemetry/adapter.js';
import { PostgresOperationalMetricsRepository } from './metrics.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for operational metrics tests');
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
after(async () => pool.end());

test(
  'operational metrics use durable revision-1 receipts, explicit health conditions, and a rollback-safe 83-device load smoke',
  { concurrency: false },
  async (t) => {
    const sourceCount = `SELECT count(*)::text lineages,count(*) FILTER (WHERE revision=1)::text raw_revisions
      FROM observation_lineages lineage LEFT JOIN observation_revisions revision ON revision.lineage_id=lineage.id
      WHERE lineage.source_system='synthetic-simulator-v1' AND lineage.source_event_id LIKE 'synthetic:p7-observability-%'`;
    const baseline = await pool.query<{ lineages: string; raw_revisions: string }>(sourceCount);
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const observations = new PostgresObservationService(databaseUrl, client);
      const seed = `p7-observability-${randomUUID()}`;
      const started = performance.now();
      const first = await ingestSyntheticBatch(
        observations,
        seed,
        '2026-08-23T00:00:00.000Z',
        71,
        'normal',
      );
      const elapsedMilliseconds = performance.now() - started;
      const throughputPerSecond = (first.accepted * 1_000) / Math.max(elapsedMilliseconds, 1);

      assert.deepEqual(
        {
          accepted: first.accepted,
          idempotent: first.idempotent,
          failures: first.failures,
          overflowed: first.overflowed,
          gaps: first.gaps,
          replayed: first.replayed,
        },
        { accepted: 249, idempotent: 0, failures: 0, overflowed: 0, gaps: 0, replayed: 249 },
      );
      // This is an intentionally generous smoke ceiling, not a production SLO.
      assert.ok(
        elapsedMilliseconds < 60_000,
        `83-device synthetic batch took ${elapsedMilliseconds}ms`,
      );
      assert.ok(throughputPerSecond > 0);
      t.diagnostic(
        JSON.stringify({
          event: 'synthetic_83_device_ingestion_load_smoke',
          classification: 'synthetic',
          devices: 83,
          sensors: 249,
          accepted: first.accepted,
          elapsedMilliseconds: Math.round(elapsedMilliseconds * 100) / 100,
          throughputPerSecond: Math.round(throughputPerSecond * 100) / 100,
          failures: first.failures,
        }),
      );

      const replay = await ingestSyntheticBatch(
        observations,
        seed,
        '2026-08-23T00:00:00.000Z',
        71,
        'normal',
      );
      assert.deepEqual(
        {
          accepted: replay.accepted,
          idempotent: replay.idempotent,
          failures: replay.failures,
          overflowed: replay.overflowed,
          gaps: replay.gaps,
          replayed: replay.replayed,
        },
        { accepted: 0, idempotent: 249, failures: 0, overflowed: 0, gaps: 0, replayed: 249 },
      );
      const durableBatch = await client.query<{ lineages: string; revisions: string }>(
        `SELECT count(*)::text lineages,
                (SELECT count(*)::text FROM observation_revisions revision
                 JOIN observation_lineages lineage ON lineage.id=revision.lineage_id
                 WHERE lineage.source_system='synthetic-simulator-v1' AND lineage.source_event_id LIKE $1) revisions
         FROM observation_lineages
         WHERE source_system='synthetic-simulator-v1' AND source_event_id LIKE $1`,
        [`synthetic:${seed}:%`],
      );
      assert.deepEqual(durableBatch.rows[0], { lineages: '249', revisions: '249' });

      // A later source fact marked stale projects a distinct stale health
      // condition; it does not change communication status or create no_data.
      const stalePoint = simulateTelemetry(
        `${seed}-stale`,
        '2030-08-24T00:00:00.000Z',
        72,
        'stale',
      )[0]!;
      await observations.ingest({
        ...toIngestRequest(stalePoint),
        qualityReason: 'synthetic stale telemetry retained for observability test',
      });

      const metrics = await new PostgresOperationalMetricsRepository(
        databaseUrl,
        client,
      ).snapshot();
      const direct = await client.query<{
        lineages: string;
        rejected: string;
        revision_one_received: string | null;
        latest_source: string | null;
      }>(
        `SELECT
           (SELECT count(*)::text FROM observation_lineages) lineages,
           (SELECT count(*)::text FROM observation_revisions WHERE state='rejected') rejected,
           (SELECT extract(epoch FROM max(ingested_at))::text FROM observation_revisions WHERE revision=1) revision_one_received,
           (SELECT extract(epoch FROM max(observed_at))::text FROM observation_lineages) latest_source`,
      );
      assert.equal(metrics.telemetry.acceptedLineagesTotal, Number(direct.rows[0]?.lineages));
      assert.equal(metrics.telemetry.rejectedRevisionsTotal, Number(direct.rows[0]?.rejected));
      assert.equal(
        metrics.telemetry.latestReceivedAtEpochSeconds,
        Number(direct.rows[0]?.revision_one_received),
      );
      assert.equal(
        metrics.telemetry.latestObservedAtEpochSeconds,
        Number(direct.rows[0]?.latest_source),
      );

      const directHealth = await client.query<{
        connection_status: string;
        device_fault: string;
        data_condition: string;
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
      assert.equal(
        Object.values(metrics.deviceHealth.connectionCounts).reduce(
          (total, count) => total + count,
          0,
        ),
        directHealth.rows.reduce((total, row) => total + Number(row.count), 0),
      );
      assert.equal(
        Object.values(metrics.deviceHealth.dataConditionCounts).reduce(
          (total, count) => total + count,
          0,
        ),
        directHealth.rows.reduce((total, row) => total + Number(row.count), 0),
      );
      assert.equal(
        Object.values(metrics.deviceHealth.faultCounts).reduce((total, count) => total + count, 0),
        directHealth.rows.reduce((total, row) => total + Number(row.count), 0),
      );
      assert.ok(metrics.deviceHealth.dataConditionCounts.stale >= 1);
      assert.ok(metrics.deviceHealth.dataConditionCounts.unconfigured >= 0);
      assert.ok(metrics.deviceHealth.dataConditionCounts.no_data >= 0);
      assert.ok(metrics.alarmRules.deferredTotal >= 0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    const afterRollback = await pool.query<{ lineages: string; raw_revisions: string }>(
      sourceCount,
    );
    assert.deepEqual(
      afterRollback.rows,
      baseline.rows,
      'load-smoke writes must be fully rolled back',
    );
  },
);

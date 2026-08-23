import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { simulateTelemetry } from '@isuv/domain';
import { BoundedTelemetryReplayQueue, ingestSyntheticBatch, toIngestRequest } from './adapter.js';
import { PostgresObservationService } from '../observations/service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests');
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
after(async () => pool.end());

test(
  'all 83 synthetic devices / 249 sensors ingest raw facts idempotently and reject source-payload conflicts',
  { concurrency: false },
  async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const service = new PostgresObservationService(databaseUrl, client);
      const seed = `db-telemetry-${randomUUID()}`;
      const at = '2026-08-23T00:00:00.000Z';
      const first = await ingestSyntheticBatch(service, seed, at, 7, 'normal');
      assert.deepEqual(first, {
        accepted: 249,
        idempotent: 0,
        gaps: 0,
        failures: 0,
        replayed: 249,
        overflowed: 0,
        statusEvents: [],
      });
      const replay = await ingestSyntheticBatch(service, seed, at, 7, 'normal');
      assert.deepEqual(replay, {
        accepted: 0,
        idempotent: 249,
        gaps: 0,
        failures: 0,
        replayed: 249,
        overflowed: 0,
        statusEvents: [],
      });
      const persisted = await client.query<{
        devices: string;
        sensors: string;
        raw_count: string;
        classifications: string[];
        workflows: string[];
      }>(
        `SELECT count(DISTINCT lineage.device_id)::text devices, count(DISTINCT lineage.sensor_id)::text sensors,
              count(*)::text raw_count, array_agg(DISTINCT revision.data_classification::text) classifications,
              array_agg(DISTINCT revision.state::text) workflows
       FROM observation_lineages lineage JOIN observation_revisions revision ON revision.lineage_id = lineage.id
       WHERE lineage.source_system = 'synthetic-simulator-v1' AND lineage.source_event_id LIKE $1`,
        [`synthetic:${seed}:%`],
      );
      assert.deepEqual(persisted.rows[0], {
        devices: '83',
        sensors: '249',
        raw_count: '249',
        classifications: ['synthetic'],
        workflows: ['raw'],
      });
      const point = simulateTelemetry(seed, at, 7, 'normal')[0]!;
      await assert.rejects(
        service.ingest({ ...toIngestRequest(point), value: '99.9999' }),
        /reused/,
      );

      const spike = await ingestSyntheticBatch(service, `${seed}-spike`, at, 8, 'spike');
      const fault = await ingestSyntheticBatch(service, `${seed}-fault`, at, 9, 'device_fault');
      assert.equal(spike.accepted, 249);
      assert.equal(fault.accepted, 249);
      const qualities = await client.query<{ quality_state: string; count: string }>(
        `SELECT revision.quality_state::text, count(*)::text
       FROM observation_lineages lineage JOIN observation_revisions revision ON revision.lineage_id = lineage.id
       WHERE lineage.source_system = 'synthetic-simulator-v1'
         AND (lineage.source_event_id LIKE $1 OR lineage.source_event_id LIKE $2 OR lineage.source_event_id LIKE $3)
       GROUP BY revision.quality_state::text ORDER BY revision.quality_state::text`,
        [`synthetic:${seed}:%`, `synthetic:${seed}-spike:%`, `synthetic:${seed}-fault:%`],
      );
      assert.deepEqual(qualities.rows, [
        { quality_state: 'invalid', count: '249' },
        { quality_state: 'suspect', count: '249' },
        { quality_state: 'unknown', count: '249' },
      ]);

      const offline = await ingestSyntheticBatch(service, `${seed}-offline`, at, 10, 'offline');
      assert.equal(offline.accepted, 0);
      assert.equal(offline.gaps, 83);
      assert.equal(offline.statusEvents.length, 83);
      const offlineRows = await client.query<{ count: string }>(
        `SELECT count(*)::text count FROM observation_lineages
       WHERE source_system = 'synthetic-simulator-v1' AND source_event_id LIKE $1`,
        [`synthetic:${seed}-offline:%`],
      );
      assert.equal(offlineRows.rows[0]?.count, '0');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  },
);

test('bounded edge queue makes overflow explicit before it can look like delivered telemetry', async () => {
  const service = {
    async ingest() {
      throw new Error('not reached');
    },
  } as unknown as PostgresObservationService;
  const result = await ingestSyntheticBatch(
    service,
    `overflow-${randomUUID()}`,
    '2026-08-23T00:00:00.000Z',
    1,
    'normal',
    new Map(),
    new BoundedTelemetryReplayQueue(1),
  );
  assert.equal(result.overflowed, 248);
  assert.equal(result.failures, 1);
  assert.equal(result.accepted, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresObservationService } from '../observations/service.js';
import { PostgresReportService } from './service.js';
const db = process.env.DATABASE_URL;
const territory = 'a2000000-0000-4000-8000-000000000001',
  actor = 'a3000000-0000-4000-8000-000000000002';
test(
  'frozen report snapshots are idempotent, append-only, and exports audit frozen bytes',
  { skip: !db },
  async () => {
    const service = new PostgresReportService(db);
    const first = await service.generate(
      { kind: 'daily_situation', period: 'week' },
      territory,
      actor,
      'p6-report-db-generate',
    );
    const second = await service.generate(
      { kind: 'daily_situation', period: 'week' },
      territory,
      actor,
      'p6-report-db-retry',
    );
    assert.equal(first.id, second.id);
    const summaries = await service.list(territory);
    assert.equal(
      summaries.some((summary) => summary.id === first.id),
      true,
    );
    assert.equal('payload' in summaries[0]!, false);
    assert.equal(
      first.payload.limitations.measurementUncertainty,
      'measurement_uncertainty_unavailable',
    );
    const csv = await service.export(first.id, 'csv', actor, 'p6-report-db-csv');
    const csvRetry = await service.export(first.id, 'csv', actor, 'p6-report-db-csv');
    assert.equal(csv.body, csvRetry.body);
    assert.match(csv.body, /cadence_unconfigured/);
    const html = await service.export(first.id, 'html', actor, 'p6-report-db-html');
    assert.match(html.body, /@page/);
    assert.match(html.body, /measurement_uncertainty_unavailable/);
    const pool = new Pool({ connectionString: db });
    try {
      const frozenBeforeCorrection = await pool.query<{
        payload_canonical: string;
        fingerprint: string;
      }>('SELECT payload_canonical,fingerprint FROM report_snapshots WHERE id=$1', [first.id]);
      const source = await pool.query<{ lineage_id: string }>(
        `SELECT lineage.id lineage_id
           FROM allocation_plan_entry_measurement_bindings binding
           JOIN observation_lineages lineage ON lineage.sensor_id=binding.sensor_id
          WHERE lineage.measurement_kind='discharge'
          ORDER BY lineage.observed_at,lineage.id
          LIMIT 1`,
      );
      assert.ok(source.rows[0], 'a governed report source lineage is available');
      const observations = new PostgresObservationService(db);
      const sourceBefore = await observations.find(source.rows[0]!.lineage_id);
      assert.ok(sourceBefore, 'the governed report source has a current revision');
      const laterCorrection = await observations.correct(
        source.rows[0]!.lineage_id,
        {
          workflowState: 'corrected',
          value: sourceBefore.value,
          uncertainty: sourceBefore.uncertainty,
          uncertaintyMethod: sourceBefore.uncertaintyMethod ?? undefined,
          uncertaintyConfidence: sourceBefore.uncertaintyConfidence ?? undefined,
          qualityState: 'valid',
          qualityReason: null,
          totalizerTransition: sourceBefore.totalizerTransition,
          provenance: 'synthetic later correction for frozen-report regression',
          correctionReason: 'later source revision must not rewrite a frozen report',
          measurementMethod: sourceBefore.measurementMethod ?? undefined,
          calibrationRef: sourceBefore.calibrationRef ?? undefined,
          ratingCurveRef: sourceBefore.ratingCurveRef ?? undefined,
        },
        actor,
        'p6-report-later-source-correction',
      );
      assert.ok(laterCorrection.ingestedAt > first.knownAt);
      const frozenAfterCorrection = await pool.query<{
        payload_canonical: string;
        fingerprint: string;
      }>('SELECT payload_canonical,fingerprint FROM report_snapshots WHERE id=$1', [first.id]);
      assert.deepEqual(frozenAfterCorrection.rows[0], frozenBeforeCorrection.rows[0]);
      const reread = await service.get(first.id);
      assert.deepEqual(reread?.payload, first.payload);
      assert.equal(reread?.fingerprint, first.fingerprint);

      const incident = await pool.query<{ id: string; territory_id: string }>(
        'SELECT id,territory_id FROM incidents ORDER BY created_at,id LIMIT 1',
      );
      const section = await pool.query<{ id: string }>(
        `SELECT section.id FROM water_sections section
         JOIN allocation_plans plan ON plan.water_section_id=section.id
         WHERE plan.creation_reason='seed P6 governed analytics scenario' LIMIT 1`,
      );
      assert.ok(incident.rows[0], 'seeded P5 incident is available for report coverage');
      assert.ok(section.rows[0], 'seeded P6 governed section is available for report coverage');
      const generated = new Map();
      for (const kind of [
        'allocation_compliance',
        'water_balance',
        'device_availability',
        'executive_summary',
      ] as const)
        generated.set(
          kind,
          await service.generate(
            { kind, period: 'today', facet: 'section', facetId: section.rows[0]!.id },
            territory,
            actor,
            `p6-${kind}`,
          ),
        );
      const allocationCsv = await service.export(
        generated.get('allocation_compliance')!.id,
        'csv',
        actor,
        'p6-allocation-export',
      );
      assert.match(allocationCsv.body, /plannedM3/);
      assert.match(allocationCsv.body, /"m3"/);
      const balanceHtml = await service.export(
        generated.get('water_balance')!.id,
        'html',
        actor,
        'p6-balance-export',
      );
      assert.match(balanceHtml.body, /sourceInterval/);
      assert.match(balanceHtml.body, /referencePlane/);
      const incidentReport = await service.generate(
        { kind: 'incident', period: 'today', incidentId: incident.rows[0]!.id },
        incident.rows[0]!.territory_id,
        actor,
        'p6-incident',
      );
      const timelineAfterCutoff = await pool.query<{ count: string }>(
        `SELECT count(*)::text count FROM incident_timeline WHERE incident_id=$1 AND occurred_at>$2`,
        [incident.rows[0]!.id, incidentReport.knownAt],
      );
      assert.equal(timelineAfterCutoff.rows[0]!.count, '0');
      const incidentCsv = await service.export(
        incidentReport.id,
        'csv',
        actor,
        'p6-incident-export',
      );
      assert.match(incidentCsv.body, /timeline/);
      await assert.rejects(
        pool.query('UPDATE report_snapshots SET provenance=$1 WHERE id=$2', ['forged', first.id]),
      );
      const audit = await pool.query<{ count: string }>(
        `SELECT count(*)::text count FROM audit_events WHERE resource='report' AND resource_id=$1`,
        [first.id],
      );
      assert.ok(Number(audit.rows[0]!.count) >= 3);
    } finally {
      await pool.end();
    }
  },
);

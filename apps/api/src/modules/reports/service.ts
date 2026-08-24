import {
  reportSummarySchema,
  type GenerateReportRequest,
  type ReportSnapshot,
  type ReportSummary,
} from '@isuv/contracts';
import { reportFingerprint, canonicalJson, csvCell, escapeHtml } from '@isuv/domain';
import type { PoolClient } from 'pg';
import { withDatabase } from '../../db/client.js';
import { PostgresAnalyticsService } from '../analytics/service.js';
import { PostgresIncidentService } from '../incidents/service.js';

const ts = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
type Client = PoolClient;
type Row = {
  id: string;
  organization_id: string;
  territory_id: string;
  kind: ReportSnapshot['kind'];
  version: number;
  period: ReportSnapshot['period'];
  facet: ReportSnapshot['facet'];
  facet_id: string | null;
  incident_id: string | null;
  reference_at: string;
  known_at: string;
  presentation_time_zone: 'Asia/Tashkent';
  method_id: 'governed_report_snapshot_v1';
  method_version: 1;
  quality_state: ReportSnapshot['qualityState'];
  approval_status: 'generated_not_approved';
  analytics_scenario_id: string;
  analytics_scenario_version: number;
  source_revision_policy: 'known_at_frozen';
  payload: ReportSnapshot['payload'];
  caveats: string[];
  fingerprint: string;
  provenance: string;
  generated_by_user_id: string;
  generated_at: string;
};
function toSnapshot(row: Row): ReportSnapshot {
  return {
    id: row.id,
    organizationId: row.organization_id,
    territoryId: row.territory_id,
    kind: row.kind,
    version: row.version,
    period: row.period,
    facet: row.facet,
    facetId: row.facet_id,
    incidentId: row.incident_id,
    referenceAt: row.reference_at,
    knownAt: row.known_at,
    presentationTimeZone: row.presentation_time_zone,
    method: { id: row.method_id, version: row.method_version },
    qualityState: row.quality_state,
    approvalStatus: row.approval_status,
    generatedByUserId: row.generated_by_user_id,
    generatedAt: row.generated_at,
    provenance: {
      dataClassification: 'synthetic',
      officialComplianceEligible: false,
      label: row.provenance,
    },
    caveats: row.caveats,
    sourceSnapshot: {
      analyticsScenarioId: row.analytics_scenario_id,
      analyticsScenarioVersion: row.analytics_scenario_version,
      sourceRevisionPolicy: row.source_revision_policy,
    },
    fingerprint: row.fingerprint,
    payload: row.payload,
  };
}
const columns = `id,organization_id,territory_id,kind,version,period,facet,facet_id,incident_id,${ts('reference_at')} reference_at,${ts('known_at')} known_at,presentation_time_zone,method_id,method_version,quality_state,approval_status,analytics_scenario_id,analytics_scenario_version,source_revision_policy,payload,caveats,fingerprint,provenance,generated_by_user_id,${ts('generated_at')} generated_at`;

export class ReportError extends Error {
  constructor(
    readonly kind: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR',
    message: string,
  ) {
    super(message);
  }
}
export class PostgresReportService {
  public constructor(
    private readonly databaseUrl?: string,
    private readonly transactionClient?: PoolClient,
  ) {}
  private async read<T>(fn: (client: Client) => Promise<T>) {
    if (this.transactionClient) return fn(this.transactionClient);
    return withDatabase(this.databaseUrl, async (pool) => {
      const c = await pool.connect();
      try {
        return await fn(c);
      } finally {
        c.release();
      }
    });
  }
  private async tx<T>(fn: (client: Client) => Promise<T>) {
    if (this.transactionClient) return fn(this.transactionClient);
    return withDatabase(this.databaseUrl, async (pool) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const value = await fn(c);
        await c.query('COMMIT');
        return value;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    });
  }
  async findDefaultTerritory(userId: string, organizationId: string, at: Date) {
    return new PostgresAnalyticsService(
      this.databaseUrl,
      this.transactionClient,
    ).findDefaultTerritory(userId, organizationId, at);
  }
  async findScope(id: string) {
    return this.read(
      async (c) =>
        (
          await c.query<{ territory_id: string }>(
            'SELECT territory_id FROM report_snapshots WHERE id=$1',
            [id],
          )
        ).rows[0] ?? null,
    );
  }
  async findIncidentScope(id: string) {
    return this.read(
      async (c) =>
        (
          await c.query<{ territory_id: string }>(
            'SELECT territory_id FROM incidents WHERE id=$1',
            [id],
          )
        ).rows[0] ?? null,
    );
  }
  async list(
    territoryId: string,
    kind?: ReportSnapshot['kind'],
    limit = 50,
  ): Promise<ReportSummary[]> {
    return this.read(async (c) =>
      (
        await c.query<Row>(
          `SELECT ${columns} FROM report_snapshots WHERE territory_id=$1 ${kind ? 'AND kind=$2' : ''} ORDER BY generated_at DESC,id DESC LIMIT $${kind ? '3' : '2'}`,
          kind ? [territoryId, kind, limit] : [territoryId, limit],
        )
      ).rows.map((x) => reportSummarySchema.parse(toSnapshot(x))),
    );
  }
  async get(id: string): Promise<ReportSnapshot | null> {
    return this.read(async (c) => {
      const r = await c.query<Row>(`SELECT ${columns} FROM report_snapshots WHERE id=$1`, [id]);
      return r.rows[0] ? toSnapshot(r.rows[0]) : null;
    });
  }
  async generate(
    input: GenerateReportRequest,
    territoryId: string,
    actor: string,
    requestId: string,
  ): Promise<ReportSnapshot> {
    return this.tx(async (c) => {
      // One repeatable-read view ensures the selected latest incident timeline timestamp
      // is also the latest timeline fact visible to the frozen payload.
      if (!this.transactionClient) await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const analytics = await new PostgresAnalyticsService(this.databaseUrl, c).analytics(
        territoryId,
        { period: input.period, facet: input.facet, facetId: input.facetId },
      );
      if (!analytics)
        throw new ReportError('NOT_FOUND', 'The governed report scope was not found.');
      let incident: unknown = null;
      let reportKnownAt = analytics.knownAt;
      if (input.kind === 'incident') {
        const incidentCutoff = await c.query<{ known_at: string }>(
          `SELECT ${ts('max(timeline.occurred_at)')} known_at
             FROM incidents incident
             JOIN incident_timeline timeline ON timeline.incident_id=incident.id
            WHERE incident.id=$1 AND incident.territory_id=$2`,
          [input.incidentId!, territoryId],
        );
        if (!incidentCutoff.rows[0]?.known_at)
          throw new ReportError('NOT_FOUND', 'The incident was not found.');
        reportKnownAt = incidentCutoff.rows[0]!.known_at;
        incident = await new PostgresIncidentService(this.databaseUrl, c).getIncident(
          input.incidentId!,
          reportKnownAt,
        );
      }
      const content =
        input.kind === 'allocation_compliance'
          ? { delivery: analytics.delivery, deviationMatrix: analytics.deviationMatrix }
          : input.kind === 'water_balance'
            ? { balance: analytics.balance }
            : input.kind === 'device_availability'
              ? { qualityCoverage: analytics.qualityCoverage, availability: analytics.availability }
              : input.kind === 'incident'
                ? { incident }
                : {
                    delivery: analytics.delivery,
                    balance: analytics.balance,
                    qualityCoverage: analytics.qualityCoverage,
                    availability: analytics.availability,
                  };
      const reportPayload = {
        reportKind: input.kind,
        context: {
          referenceAt: analytics.referenceAt,
          analyticsKnownAt: analytics.knownAt,
          reportKnownAt,
          presentationTimeZone: analytics.presentationTimeZone,
          scope: {
            territoryId: analytics.scope.territoryId,
            facet: analytics.scope.facet,
            facetId: analytics.scope.facetId,
            stationDenominator: analytics.scope.stationDenominator,
            deviceDenominator: analytics.scope.deviceDenominator,
          },
          scenario: analytics.scenario,
        },
        content,
        limitations: {
          measurementUncertainty: 'measurement_uncertainty_unavailable',
          interpretation:
            'Synthetic decision support only. No official accounting, alarm certification, loss/theft inference, forecast, or physical-control advice.',
        },
      };
      const deliveryQuality = (): ReportSnapshot['qualityState'] =>
        analytics.delivery.state === 'assessed'
          ? 'assessed'
          : analytics.delivery.state === 'unconfigured'
            ? 'unconfigured'
            : 'unassessable';
      const qualityState: ReportSnapshot['qualityState'] =
        input.kind === 'water_balance'
          ? analytics.balance.outcome === 'computed'
            ? 'assessed'
            : 'deferred'
          : input.kind === 'device_availability'
            ? analytics.qualityCoverage.state === 'assessed'
              ? 'assessed'
              : analytics.qualityCoverage.state
            : input.kind === 'incident'
              ? 'assessed'
              : deliveryQuality();
      const caveats = [
        'measurement_uncertainty_unavailable: exact arithmetic does not establish confidence.',
        'Synthetic/nonofficial data: not an official allocation, compliance, alarm, incident, loss, theft, forecast, or control determination.',
        ...(analytics.balance.outcome === 'deferred'
          ? ['Water balance is deferred; no residual is inferred.']
          : []),
        ...(analytics.availability.cadenceState === 'unconfigured'
          ? [
              'Device availability is counts and denominator only; cadence is unconfigured and no percentage is calculated.',
            ]
          : []),
      ];
      const canonical = canonicalJson(reportPayload);
      const fingerprint = reportFingerprint(reportPayload);
      await c.query(
        `SELECT set_config('isuv.report_actor_id',$1,true),set_config('isuv.report_reason',$2,true),set_config('isuv.report_request_id',$3,true)`,
        [actor, 'generate immutable governed report snapshot', requestId],
      );
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `${territoryId}:${input.kind}:${input.period}:${input.facet ?? ''}:${input.facetId ?? ''}:${input.incidentId ?? ''}`,
      ]);
      const existing = await c.query<Row>(
        `SELECT ${columns} FROM report_snapshots WHERE organization_id=(SELECT organization_id FROM territories WHERE id=$1) AND territory_id=$1 AND kind=$2 AND period=$3 AND facet IS NOT DISTINCT FROM $4 AND facet_id IS NOT DISTINCT FROM $5 AND incident_id IS NOT DISTINCT FROM $6 AND reference_at=$7 AND known_at=$8`,
        [
          territoryId,
          input.kind,
          input.period,
          input.facet ?? null,
          input.facetId ?? null,
          input.incidentId ?? null,
          analytics.referenceAt,
          reportKnownAt,
        ],
      );
      if (existing.rows[0]) return toSnapshot(existing.rows[0]);
      const prior = await c.query<{ version: number }>(
        `SELECT COALESCE(max(version),0)::integer version FROM report_snapshots WHERE organization_id=(SELECT organization_id FROM territories WHERE id=$1) AND territory_id=$1 AND kind=$2 AND period=$3 AND facet IS NOT DISTINCT FROM $4 AND facet_id IS NOT DISTINCT FROM $5 AND incident_id IS NOT DISTINCT FROM $6`,
        [
          territoryId,
          input.kind,
          input.period,
          input.facet ?? null,
          input.facetId ?? null,
          input.incidentId ?? null,
        ],
      );
      const inserted = await c.query<Row>(
        `INSERT INTO report_snapshots(organization_id,territory_id,kind,version,period,facet,facet_id,incident_id,reference_at,known_at,presentation_time_zone,method_id,method_version,quality_state,approval_status,analytics_scenario_id,analytics_scenario_version,source_revision_policy,payload,payload_canonical,caveats,fingerprint,provenance,generated_by_user_id) SELECT organization_id,$1,$2,$3,$4,$5,$6,$7,$8,$9,'Asia/Tashkent','governed_report_snapshot_v1',1,$10,'generated_not_approved',$11,$12,'known_at_frozen',$13::jsonb,$14,$15::jsonb,$16,$17,$18 FROM territories WHERE id=$1 RETURNING ${columns}`,
        [
          territoryId,
          input.kind,
          prior.rows[0]!.version + 1,
          input.period,
          input.facet ?? null,
          input.facetId ?? null,
          input.incidentId ?? null,
          analytics.referenceAt,
          reportKnownAt,
          qualityState,
          analytics.scenario.id,
          analytics.scenario.version,
          JSON.stringify(reportPayload),
          canonical,
          JSON.stringify(caveats),
          fingerprint,
          analytics.provenance.label,
          actor,
        ],
      );
      if (!inserted.rows[0])
        throw new ReportError('NOT_FOUND', 'The report territory was not found.');
      return toSnapshot(inserted.rows[0]);
    });
  }
  private rows(report: ReportSnapshot): Array<[string, string]> {
    const content = report.payload.content;
    const flattened: Array<[string, string]> = [];
    const visit = (value: unknown, path: string) => {
      if (value === null || typeof value !== 'object') {
        flattened.push([path, String(value ?? 'null')]);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
        return;
      }
      const object = value as Record<string, unknown>;
      for (const key of Object.keys(object).sort())
        visit(object[key], path ? `${path}.${key}` : key);
    };
    visit(content, 'Frozen content');
    return [
      ['Report kind', report.kind],
      ['Version', String(report.version)],
      ['Period', report.period],
      ['Reference at (UTC)', report.referenceAt],
      ['Known at (UTC)', report.knownAt],
      ['Method', `${report.method.id}:${report.method.version}`],
      ['Quality state', report.qualityState],
      ['Approval status', report.approvalStatus],
      ['Fingerprint', report.fingerprint],
      ['Measurement uncertainty', 'measurement_uncertainty_unavailable'],
      ...flattened,
    ];
  }
  async export(
    id: string,
    format: 'csv' | 'html',
    actor: string,
    requestId: string,
  ): Promise<{ body: string; contentType: string }> {
    return this.tx(async (c) => {
      const report = await this.getWithClient(c, id);
      if (!report) throw new ReportError('NOT_FOUND', 'The report was not found.');
      await c.query(
        `SELECT set_config('isuv.report_actor_id',$1,true),set_config('isuv.report_request_id',$2,true)`,
        [actor, requestId],
      );
      await c.query(
        `INSERT INTO report_exports(report_id,format,exported_by_user_id,request_id) VALUES($1,$2,$3,$4) ON CONFLICT(report_id,format,request_id) DO NOTHING`,
        [id, format, actor, requestId],
      );
      const rows = this.rows(report);
      if (format === 'csv')
        return {
          body:
            [
              'Field,Value',
              ...rows.map(([a, b]) => `${csvCell(a)},${csvCell(b)}`),
              ...report.caveats.map((x) => `${csvCell('Caveat')},${csvCell(x)}`),
            ].join('\r\n') + '\r\n',
          contentType: 'text/csv; charset=utf-8',
        };
      return {
        body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(report.kind)}</title><style>@page{size:A4;margin:18mm 16mm 20mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;font-size:10pt;line-height:1.35}header{border-bottom:2px solid #174a5b;margin-bottom:12px}footer{border-top:1px solid #777;margin-top:12px;padding-top:6px;font-size:8pt}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #555;padding:4px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{width:42%;background:#eef5f6}caption{font-weight:bold;text-align:left;margin:8px 0}.caveat{font-style:italic}.authority{font-weight:bold;color:#7a2e00}@media print{header,footer{break-inside:avoid}tr{break-inside:avoid}}</style></head><body><header><p>iSuv Regional Water Platform</p><h1>${escapeHtml(report.kind.replaceAll('_', ' '))}</h1><p class="authority">Synthetic/nonofficial decision support - not approved.</p></header><main><p>Generated ${escapeHtml(report.generatedAt)}. Report ${escapeHtml(report.id)}, version ${report.version}.</p><table><caption>Frozen report evidence (UTC and explicit units)</caption><thead><tr><th scope="col">Field</th><th scope="col">Value</th></tr></thead><tbody>${rows.map(([a, b]) => `<tr><th scope="row">${escapeHtml(a)}</th><td>${escapeHtml(b)}</td></tr>`).join('')}</tbody></table><section aria-label="Caveats"><h2>Caveats</h2>${report.caveats.map((x) => `<p class="caveat">${escapeHtml(x)}</p>`).join('')}</section></main><footer>Frozen fingerprint: ${escapeHtml(report.fingerprint)}. Monitoring and decision support only; no physical-control action.</footer></body></html>`,
        contentType: 'text/html; charset=utf-8',
      };
    });
  }
  private async getWithClient(c: Client, id: string) {
    const r = await c.query<Row>(`SELECT ${columns} FROM report_snapshots WHERE id=$1`, [id]);
    return r.rows[0] ? toSnapshot(r.rows[0]) : null;
  }
}

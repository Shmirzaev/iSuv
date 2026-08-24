import type {
  AlarmEventType,
  AlarmIncidentCenterQuery,
  AlarmIncidentCenterResponse,
  AlarmSeverity,
  AutomaticAlarmState,
  SystemDeviceCondition,
  WaterCondition,
} from '@isuv/contracts';
import { incidentMetric, incidentTimestampMicroseconds } from '@isuv/domain';
import { withDatabase } from '../../db/client.js';

const ts = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
type Client = {
  query: <T>(sql: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
};
type Row = {
  alarm_id: string;
  incident_id: string | null;
  territory_id: string;
  territory_code: string;
  territory_name: string;
  event_type: AlarmEventType;
  severity: AlarmSeverity;
  automatic_state: AutomaticAlarmState;
  incident_status: 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'closed' | null;
  water_condition: WaterCondition;
  system_condition: SystemDeviceCondition;
  detected_at: string;
  cleared_at: string | null;
  assigned_user_id: string | null;
  rule_id: string;
  catalog_version_id: string;
  evidence_id: string | null;
  evidence_status: 'assessable' | 'unassessable' | null;
  evidence_effective_at: string | null;
  evidence_known_at: string | null;
  signal_run_id: string | null;
  evidence_result: Record<string, unknown> | null;
  evidence_facts: Array<{ trusted?: boolean; complete?: boolean; estimated?: boolean }> | null;
  evidence_reason: string | null;
  signal_state: 'inactive' | 'pending_activation' | 'active' | 'pending_clear' | 'deferred' | null;
  rule_condition: { kind?: string; quantity?: string; unit?: string } | null;
  actor_may_write: boolean;
  all_linked_cleared: boolean;
  queue_denominator: number;
  provenance: string;
  incident_created_at: string | null;
  escalation_tier: number | null;
  escalation_procedure: string | null;
  acknowledgement_due_at: string | null;
  resolution_due_at: string | null;
  acknowledgement_target: string | null;
  resolution_target: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
};
const scope = `WITH RECURSIVE descendants AS (
 SELECT id FROM territories WHERE id=$1 UNION ALL
 SELECT t.id FROM territories t JOIN descendants d ON t.parent_territory_id=d.id
)`;
function fingerprint(q: AlarmIncidentCenterQuery, territoryId: string) {
  return JSON.stringify({
    territoryId,
    a: q.automaticState ?? null,
    i: q.incidentStatus ?? null,
    s: q.severity ?? null,
    e: q.evidenceAssessment ?? null,
    t: q.eventType ?? null,
    w: q.waterCondition ?? null,
    d: q.systemDeviceCondition ?? null,
    n: q.assignment ?? null,
    alarm: q.alarmId ?? null,
    incident: q.incidentId ?? null,
  });
}
function decode(cursor: string | undefined, query: AlarmIncidentCenterQuery, territoryId: string) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      d: string;
      id: string;
      f: string;
    };
    if (
      parsed.f !== fingerprint(query, territoryId) ||
      !/^\d{4}-/.test(parsed.d) ||
      !/^[0-9a-f-]{36}$/i.test(parsed.id)
    )
      throw new Error('CURSOR');
    return parsed;
  } catch {
    throw new Error('CURSOR');
  }
}
function encode(query: AlarmIncidentCenterQuery, territoryId: string, row: Row) {
  return Buffer.from(
    JSON.stringify({ d: row.detected_at, id: row.alarm_id, f: fingerprint(query, territoryId) }),
  ).toString('base64url');
}
function capability(allowed: boolean, disabledReason: string | null) {
  return { allowed, disabledReason };
}
function evidenceAssessment(
  row: Row,
): 'assessable' | 'unassessable' | 'missing' | 'pending' | 'deferred' {
  if (!row.evidence_id) return row.automatic_state === 'active' ? 'pending' : 'missing';
  if (row.signal_state === 'deferred') return 'deferred';
  return row.evidence_status === 'unassessable' ? 'unassessable' : 'assessable';
}
function unitBoundary(row: Row): 'stage_m' | 'discharge_m3s' | 'volume_m3' | 'not_applicable' {
  if (row.rule_condition?.quantity === 'stage' && row.rule_condition.unit === 'm') return 'stage_m';
  if (row.rule_condition?.quantity === 'discharge' && row.rule_condition.unit === 'm3/s')
    return 'discharge_m3s';
  if (row.rule_condition?.kind === 'allocation_deviation') return 'volume_m3';
  return 'not_applicable';
}
function evidenceQuality(row: Row): {
  state: 'valid' | 'estimated' | 'unknown' | 'unavailable';
  reason: string | null;
} {
  const facts = row.evidence_facts ?? [];
  if (facts.length === 0) return { state: 'unavailable', reason: row.evidence_reason };
  if (facts.some((fact) => fact.estimated))
    return { state: 'estimated', reason: row.evidence_reason ?? 'Estimated evidence.' };
  if (facts.every((fact) => fact.trusted === true && fact.complete === true))
    return { state: 'valid', reason: row.evidence_reason };
  return { state: 'unknown', reason: row.evidence_reason ?? 'Evidence quality is not trusted.' };
}

export class PostgresAlarmIncidentCenterService {
  public constructor(private readonly databaseUrl?: string) {}
  private async read<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    return withDatabase(this.databaseUrl, async (pool) => {
      const client = await pool.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    });
  }
  public async findDefaultTerritory(
    userId: string,
    organizationId: string,
    at: Date,
  ): Promise<string | null> {
    return this.read(
      async (c) =>
        (
          await c.query<{ territory_id: string }>(
            `SELECT COALESCE(
              (SELECT territory_id FROM user_role_grants WHERE user_id=$1 AND organization_id=$2 AND territory_id IS NOT NULL
               AND cancelled_at IS NULL AND effective_from<=$3 AND (effective_until IS NULL OR effective_until>$3)
               ORDER BY effective_from,id LIMIT 1),
              (SELECT id FROM territories WHERE organization_id=$2 AND parent_territory_id IS NULL
               ORDER BY code,id LIMIT 1)) territory_id`,
            [userId, organizationId, at],
          )
        ).rows[0]?.territory_id ?? null,
    );
  }
  public async list(
    territoryId: string,
    actorId: string,
    query: AlarmIncidentCenterQuery,
  ): Promise<AlarmIncidentCenterResponse | null> {
    return this.read(async (c) => {
      const cursor = decode(query.cursor, query, territoryId);
      const now = (await c.query<{ now: string }>(`SELECT ${ts('clock_timestamp()')} now`)).rows[0]
        ?.now;
      if (!now) return null;
      const result = await c.query<Row>(
        `${scope}, filtered AS (
        SELECT a.id alarm_id,i.id incident_id,a.territory_id,t.code territory_code,t.name territory_name,
          a.event_type,a.severity,a.automatic_state,i.status incident_status,a.water_condition,a.system_condition,
          ${ts('a.detected_at')} detected_at,${ts('a.cleared_at')} cleared_at,i.assigned_user_id,a.rule_id,a.catalog_version_id,
          evidence.id evidence_id,evidence.evidence_status,${ts('evidence.effective_at')} evidence_effective_at,${ts('evidence.known_at')} evidence_known_at,evidence.signal_run_id,evidence.result evidence_result,evidence.evidence evidence_facts,signal.reason evidence_reason,signal.state signal_state,rule_version.condition rule_condition,
          a.provenance,${ts('i.created_at')} incident_created_at,i.escalation_tier,i.escalation_procedure,
          ${ts('i.acknowledgement_due_at')} acknowledgement_due_at,${ts('i.resolution_due_at')} resolution_due_at,
          i.acknowledgement_target_microseconds::text acknowledgement_target,i.resolution_target_microseconds::text resolution_target,${ts('i.acknowledged_at')} acknowledged_at,${ts('i.resolved_at')} resolved_at,
          incident_actor_may_write($5,(SELECT organization_id FROM territories WHERE id=a.territory_id),a.territory_id,clock_timestamp()) actor_may_write,
          CASE WHEN i.id IS NULL THEN a.automatic_state='cleared' ELSE NOT EXISTS(
            SELECT 1 FROM incident_alarm_links incident_link
            JOIN alarms linked_alarm ON linked_alarm.id=incident_link.alarm_id
            WHERE incident_link.incident_id=i.id AND linked_alarm.automatic_state<>'cleared'
          ) END all_linked_cleared,
          count(*) OVER()::integer queue_denominator
        FROM alarms a JOIN descendants d ON d.id=a.territory_id JOIN territories t ON t.id=a.territory_id
        LEFT JOIN incident_alarm_links link ON link.alarm_id=a.id LEFT JOIN incidents i ON i.id=link.incident_id
        LEFT JOIN LATERAL (SELECT * FROM alarm_evidence x WHERE x.alarm_id=a.id ORDER BY x.effective_at DESC,x.known_at DESC,x.id DESC LIMIT 1) evidence ON true
        LEFT JOIN alarm_rule_evaluation_runs signal ON signal.id=evidence.signal_run_id
        LEFT JOIN alarm_rule_versions rule_version ON rule_version.id=a.rule_version_id
        WHERE ($2::text IS NULL OR a.automatic_state=$2)
          AND ($3::text IS NULL OR i.status=$3)
          AND ($4::text IS NULL OR a.severity=$4)
          AND ($6::text IS NULL OR a.event_type=$6)
          AND ($7::text IS NULL OR a.water_condition=$7)
          AND ($8::text IS NULL OR a.system_condition=$8)
          AND ($9::text IS NULL OR ($9='assigned' AND i.assigned_user_id IS NOT NULL) OR ($9='unassigned' AND i.assigned_user_id IS NULL))
          AND ($10::uuid IS NULL OR a.id=$10)
          AND ($11::uuid IS NULL OR i.id=$11)
          AND ($12::text IS NULL OR CASE
            WHEN evidence.id IS NULL THEN CASE WHEN a.automatic_state='active' THEN 'pending' ELSE 'missing' END
            WHEN signal.state='deferred' THEN 'deferred'
            WHEN evidence.evidence_status='unassessable' THEN 'unassessable'
            ELSE 'assessable' END=$12)
        ) SELECT * FROM filtered
        WHERE ($13::timestamptz IS NULL OR detected_at::timestamptz<$13 OR (detected_at::timestamptz=$13 AND alarm_id<$14::uuid))
        ORDER BY detected_at::timestamptz DESC,alarm_id DESC LIMIT $15`,
        [
          territoryId,
          query.automaticState ?? null,
          query.incidentStatus ?? null,
          query.severity ?? null,
          actorId,
          query.eventType ?? null,
          query.waterCondition ?? null,
          query.systemDeviceCondition ?? null,
          query.assignment ?? null,
          query.alarmId ?? null,
          query.incidentId ?? null,
          query.evidenceAssessment ?? null,
          cursor?.d ?? null,
          cursor?.id ?? null,
          query.limit + 1,
        ],
      );
      const permitted = result.rows;
      const after = permitted;
      const page = after.slice(0, query.limit);
      const makeItem = (row: Row) => {
        const assessment = evidenceAssessment(row);
        const quality = evidenceQuality(row);
        const allCleared = row.all_linked_cleared;
        const enabled = (condition: boolean, reason: string) =>
          capability(
            row.actor_may_write && condition,
            row.actor_may_write && condition
              ? null
              : row.actor_may_write
                ? reason
                : 'Incident write authority is not granted for this territory.',
          );
        const opened = row.incident_created_at
          ? incidentTimestampMicroseconds(row.incident_created_at)
          : null;
        const nowMicros = incidentTimestampMicroseconds(now);
        const elapsed = (target: string | null) =>
          opened && target !== null ? (nowMicros - opened).toString() : null;
        return {
          alarmId: row.alarm_id,
          incidentId: row.incident_id,
          territory: { id: row.territory_id, code: row.territory_code, name: row.territory_name },
          eventType: row.event_type,
          severity: row.severity,
          automaticState: row.automatic_state,
          incidentStatus: row.incident_status,
          waterCondition: row.water_condition,
          systemDeviceCondition: row.system_condition,
          detectedAt: row.detected_at,
          clearedAt: row.cleared_at,
          assignedUserId: row.assigned_user_id,
          evidence: {
            assessment,
            effectiveAt: row.evidence_effective_at,
            knownAt: row.evidence_known_at,
            detectedAt: row.detected_at,
            signalRunId: row.signal_run_id,
            latestEvidenceStatus: row.evidence_status,
            result: row.evidence_result,
            reason: row.evidence_reason,
            qualityState: quality.state,
            qualityReason: quality.reason,
            ruleId: row.rule_id,
            catalogVersionId: row.catalog_version_id,
            unitBoundary: unitBoundary(row),
            provenance: {
              dataClassification: 'synthetic' as const,
              officialComplianceEligible: false as const,
              label: row.provenance,
            },
          },
          escalation: {
            state:
              row.escalation_tier === null ? ('unconfigured' as const) : ('configured' as const),
            tier: row.escalation_tier,
            procedure: row.escalation_procedure,
            acknowledgementDueAt: row.acknowledgement_due_at,
            resolutionDueAt: row.resolution_due_at,
            acknowledgementElapsedMicroseconds: elapsed(row.acknowledgement_target),
            resolutionElapsedMicroseconds: elapsed(row.resolution_target),
            provenance:
              row.escalation_tier === null
                ? null
                : 'synthetic governed escalation snapshot; not statutory SLA',
          },
          capabilities: {
            createIncident: enabled(!row.incident_id, 'An incident already exists for this alarm.'),
            acknowledge: enabled(
              row.incident_status === 'open',
              'Only open incidents can be acknowledged.',
            ),
            investigate: enabled(
              row.incident_status === 'acknowledged',
              'Only acknowledged incidents can be investigated.',
            ),
            assign: enabled(
              !!row.incident_id && row.incident_status !== 'closed',
              'Closed or absent incidents cannot be assigned.',
            ),
            comment: enabled(
              !!row.incident_id && row.incident_status !== 'closed',
              'Closed or absent incidents cannot receive comments.',
            ),
            correctiveAction: enabled(
              !!row.incident_id && row.incident_status !== 'closed',
              'Closed or absent incidents cannot receive corrective actions.',
            ),
            resolve: enabled(
              row.incident_status === 'investigating' && allCleared,
              'Investigation and automatic clear are required.',
            ),
            close: enabled(
              row.incident_status === 'resolved' && allCleared,
              'Resolution and automatic clear are required.',
            ),
          },
          provenance: {
            dataClassification: 'synthetic' as const,
            officialComplianceEligible: false as const,
            label: row.provenance,
          },
        };
      };
      const mapped = page.map(makeItem);
      const selectedRow = query.alarmId || query.incidentId ? permitted[0] : undefined;
      const candidates = selectedRow
        ? await c.query<{ id: string; display_name: string }>(
            `SELECT DISTINCT u.id,u.display_name FROM identity_users u
             WHERE u.organization_id=(SELECT organization_id FROM territories WHERE id=$1)
               AND u.is_active
               AND incident_actor_may_write(u.id,u.organization_id,$1,clock_timestamp())
             ORDER BY u.display_name,u.id LIMIT 50`,
            [selectedRow.territory_id],
          )
        : { rows: [] };
      let panel: AlarmIncidentCenterResponse['panel'] = null;
      if (selectedRow) {
        const item = makeItem(selectedRow);
        const linked = selectedRow.incident_id
          ? await c.query<{
              alarm_id: string;
              automatic_state: 'active' | 'cleared';
              detected_at: string;
              cleared_at: string | null;
            }>(
              `SELECT a.id alarm_id,a.automatic_state,${ts('a.detected_at')} detected_at,${ts('a.cleared_at')} cleared_at FROM incident_alarm_links link JOIN alarms a ON a.id=link.alarm_id WHERE link.incident_id=$1 ORDER BY a.detected_at,a.id LIMIT 50`,
              [selectedRow.incident_id],
            )
          : { rows: [] };
        const timeline = selectedRow.incident_id
          ? await c.query<{
              sequence: number;
              kind:
                | 'created'
                | 'alarm_linked'
                | 'acknowledged'
                | 'investigating'
                | 'assigned'
                | 'commented'
                | 'corrective_action'
                | 'resolved'
                | 'closed';
              actor_user_id: string;
              reason: string;
              body: string | null;
              assignee_user_id: string | null;
              alarm_id: string | null;
              occurred_at: string;
              request_id: string;
            }>(
              `SELECT sequence,kind,actor_user_id,reason,body,assignee_user_id,alarm_id,${ts('occurred_at')} occurred_at,request_id FROM incident_timeline WHERE incident_id=$1 ORDER BY sequence LIMIT 200`,
              [selectedRow.incident_id],
            )
          : { rows: [] };
        const opened = selectedRow.incident_created_at
          ? incidentTimestampMicroseconds(selectedRow.incident_created_at)
          : null;
        const ack =
          opened === null
            ? null
            : incidentMetric(
                'acknowledgement',
                opened,
                selectedRow.acknowledged_at
                  ? incidentTimestampMicroseconds(selectedRow.acknowledged_at)
                  : null,
                incidentTimestampMicroseconds(now),
                selectedRow.acknowledgement_target
                  ? BigInt(selectedRow.acknowledgement_target)
                  : null,
              );
        const resolution =
          opened === null
            ? null
            : incidentMetric(
                'resolution',
                opened,
                selectedRow.resolved_at
                  ? incidentTimestampMicroseconds(selectedRow.resolved_at)
                  : null,
                incidentTimestampMicroseconds(now),
                selectedRow.resolution_target ? BigInt(selectedRow.resolution_target) : null,
              );
        panel = {
          item,
          linkedAlarms: linked.rows.map((x) => ({
            alarmId: x.alarm_id,
            automaticState: x.automatic_state,
            detectedAt: x.detected_at,
            clearedAt: x.cleared_at,
          })),
          timeline: timeline.rows.map((x) => ({
            sequence: x.sequence,
            kind: x.kind,
            actorUserId: x.actor_user_id,
            reason: x.reason,
            body: x.body,
            assigneeUserId: x.assignee_user_id,
            alarmId: x.alarm_id,
            occurredAt: x.occurred_at,
            requestId: x.request_id,
          })),
          metrics:
            ack && resolution
              ? {
                  acknowledgement: {
                    state: ack.state,
                    elapsedMicroseconds: ack.elapsedMicroseconds.toString(),
                    dueAt: selectedRow.acknowledgement_due_at,
                  },
                  resolution: {
                    state: resolution.state,
                    elapsedMicroseconds: resolution.elapsedMicroseconds.toString(),
                    dueAt: selectedRow.resolution_due_at,
                  },
                }
              : null,
        };
      }
      return {
        referenceAt: now,
        knownAt: now,
        presentationTimeZone: 'Asia/Tashkent' as const,
        scope: { territoryId, queueDenominator: permitted[0]?.queue_denominator ?? 0 },
        items: mapped,
        panel,
        assignmentCandidates: candidates.rows.map((x) => ({
          id: x.id,
          displayName: x.display_name,
        })),
        nextCursor:
          after.length > query.limit && page.at(-1)
            ? encode(query, territoryId, page.at(-1)!)
            : null,
        scenario: {
          dataClassification: 'synthetic' as const,
          officialComplianceEligible: false as const,
          label: 'Synthetic P5-005 queue composition; not official telemetry, policy, or SLA.',
        },
      };
    });
  }
}

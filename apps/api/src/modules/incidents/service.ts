import type { PoolClient } from 'pg';
import type {
  CreateEscalationPolicyRequest,
  RequestEscalationPolicyVersionRequest,
} from '@isuv/contracts';
import { incidentMetric, incidentTimestampMicroseconds } from '@isuv/domain';
import { withDatabase } from '../../db/client.js';

export class IncidentError extends Error {
  public constructor(
    public readonly kind: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR',
    message: string,
  ) {
    super(message);
  }
}
const ts = (c: string) => `to_char(${c} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const micros = (value: string) => BigInt(value);
interface PolicyRow {
  id: string;
  policy_id: string;
  version: number;
  organization_id: string;
  territory_id: string;
  event_type: string;
  severity: string;
  title: string;
  status: 'requested' | 'approved';
  effective_from: string;
  effective_until: string;
  tier: number;
  procedure: string;
  acknowledgement_target_microseconds: string;
  resolution_target_microseconds: string;
  provenance: string;
  requested_by_user_id: string;
  requested_at: string;
  request_reason: string;
  approved_by_user_id: string | null;
  approved_at: string | null;
  approval_reason: string | null;
}
interface PolicyIdentityRow {
  id: string;
  organization_id: string;
  territory_id: string;
  event_type: string;
  severity: string;
  title: string;
  provenance: string;
  created_by_user_id: string;
  created_at: string;
}
interface IncidentRow {
  id: string;
  organization_id: string;
  territory_id: string;
  status: 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'closed';
  primary_alarm_id: string;
  assigned_user_id: string | null;
  acknowledged_by_user_id: string | null;
  escalation_policy_id: string | null;
  escalation_policy_version_id: string | null;
  escalation_tier: number | null;
  escalation_procedure: string | null;
  acknowledgement_target_microseconds: string | null;
  resolution_target_microseconds: string | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  acknowledgement_due_at: string | null;
  resolution_due_at: string | null;
}
interface TimelineRow {
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
  request_id: string;
  occurred_at: string;
}

export class PostgresIncidentService {
  public constructor(private readonly databaseUrl?: string) {}
  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    return withDatabase(this.databaseUrl, async (pool) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const result = await fn(c);
        await c.query('COMMIT');
        return result;
      } catch (e) {
        await c.query('ROLLBACK');
        const code = (e as { code?: string }).code;
        if (code === '23505' || code === '23P01')
          throw new IncidentError('CONFLICT', 'The incident conflicts with governed history.');
        if (code === '23514' || code === '23503' || code === 'P0002')
          throw new IncidentError('VALIDATION_ERROR', 'The incident input is invalid.');
        throw e;
      } finally {
        c.release();
      }
    });
  }
  private async read<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    return withDatabase(this.databaseUrl, async (pool) => {
      const c = await pool.connect();
      try {
        return await fn(c);
      } finally {
        c.release();
      }
    });
  }
  private async databaseNow(client: PoolClient): Promise<string> {
    const result = await client.query<{ now: string }>(`SELECT ${ts('clock_timestamp()')} AS now`);
    return result.rows[0]!.now;
  }
  private async setActionContext(
    client: PoolClient,
    actor: string,
    reason: string,
    requestId: string,
  ): Promise<void> {
    await client.query(
      `SELECT set_config('isuv.incident_actor_id',$1,true),
        set_config('isuv.incident_reason',$2,true),
        set_config('isuv.incident_request_id',$3,true)`,
      [actor, reason, requestId],
    );
  }
  async findTerritory(id: string) {
    return this.read(
      async (c) =>
        (
          await c.query<{ id: string; organization_id: string }>(
            'SELECT id,organization_id FROM territories WHERE id=$1',
            [id],
          )
        ).rows[0] ?? null,
    );
  }
  async findPolicyScope(id: string) {
    return this.read(
      async (c) =>
        (
          await c.query<{ territory_id: string }>(
            'SELECT territory_id FROM escalation_policies WHERE id=$1',
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
  async findAlarmScope(id: string) {
    return this.read(
      async (c) =>
        (
          await c.query<{ territory_id: string }>('SELECT territory_id FROM alarms WHERE id=$1', [
            id,
          ])
        ).rows[0] ?? null,
    );
  }
  async createPolicy(v: CreateEscalationPolicyRequest, actor: string, requestId: string) {
    return this.tx(async (c) => {
      const r = await c.query<PolicyIdentityRow>(
        `INSERT INTO escalation_policies(organization_id,territory_id,event_type,severity,title,provenance,created_by_user_id,creation_reason,created_request_id)
         SELECT organization_id,$1,$2,$3,$4,$5,$6,$7,$8 FROM territories WHERE id=$1
         RETURNING id,organization_id,territory_id,event_type,severity,title,provenance,
           created_by_user_id,${ts('created_at')} created_at`,
        [v.territoryId, v.eventType, v.severity, v.title, v.provenance, actor, v.reason, requestId],
      );
      if (!r.rowCount)
        throw new IncidentError('NOT_FOUND', 'Escalation policy territory was not found.');
      const x = r.rows[0]!;
      return {
        policy: {
          id: x.id,
          organizationId: x.organization_id,
          territoryId: x.territory_id,
          eventType: x.event_type,
          severity: x.severity,
          title: x.title,
          provenance: x.provenance,
          dataClassification: 'synthetic' as const,
          officialComplianceEligible: false as const,
          createdByUserId: x.created_by_user_id,
          createdAt: x.created_at,
        },
      };
    });
  }
  async requestPolicyVersion(
    policyId: string,
    v: RequestEscalationPolicyVersionRequest,
    actor: string,
    requestId: string,
  ) {
    return this.tx(async (c) => {
      await c.query("SELECT set_config('isuv.incident_actor_id',$1,true)", [actor]);
      await c.query(
        'INSERT INTO escalation_policy_versions(policy_id,effective_from,effective_until,tier,procedure,acknowledgement_target_microseconds,resolution_target_microseconds,requested_by_user_id,request_reason,requested_request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          policyId,
          v.effectiveFrom,
          v.effectiveUntil,
          v.tier,
          v.procedure,
          v.acknowledgementTargetMicroseconds,
          v.resolutionTargetMicroseconds,
          actor,
          v.reason,
          requestId,
        ],
      );
      return this.policyVersion(c, policyId);
    });
  }
  async approvePolicyVersion(
    policyId: string,
    version: number,
    reason: string,
    actor: string,
    requestId: string,
  ) {
    return this.tx(async (c) => {
      const r = await c.query(
        "UPDATE escalation_policy_versions SET status='approved',approved_by_user_id=$3,approval_reason=$4,approved_request_id=$5 WHERE policy_id=$1 AND version=$2 AND status='requested' RETURNING id",
        [policyId, version, actor, reason, requestId],
      );
      if (!r.rowCount)
        throw new IncidentError('NOT_FOUND', 'Escalation policy version was not found.');
      return this.policyVersion(c, policyId, version);
    });
  }
  private async policyVersion(c: PoolClient, policyId: string, version?: number) {
    const r = await c.query<PolicyRow>(
      `SELECT v.id,v.policy_id,v.version,p.organization_id,p.territory_id,p.event_type,p.severity,p.title,v.status,${ts('v.effective_from')} effective_from,${ts('v.effective_until')} effective_until,v.tier,v.procedure,v.acknowledgement_target_microseconds::text,v.resolution_target_microseconds::text,p.provenance,v.requested_by_user_id,${ts('v.requested_at')} requested_at,v.request_reason,v.approved_by_user_id,${ts('v.approved_at')} approved_at,v.approval_reason FROM escalation_policies p JOIN escalation_policy_versions v ON v.policy_id=p.id WHERE p.id=$1 ${version ? 'AND v.version=$2' : ''} ORDER BY v.version DESC LIMIT 1`,
      version ? [policyId, version] : [policyId],
    );
    if (!r.rowCount)
      throw new IncidentError('NOT_FOUND', 'Escalation policy version was not found.');
    const x = r.rows[0]!;
    return {
      policyVersion: {
        id: x.id,
        policyId: x.policy_id,
        version: x.version,
        organizationId: x.organization_id,
        territoryId: x.territory_id,
        eventType: x.event_type,
        severity: x.severity,
        title: x.title,
        status: x.status,
        effectiveFrom: x.effective_from,
        effectiveUntil: x.effective_until,
        tier: x.tier,
        procedure: x.procedure,
        acknowledgementTargetMicroseconds: x.acknowledgement_target_microseconds,
        resolutionTargetMicroseconds: x.resolution_target_microseconds,
        provenance: x.provenance,
        dataClassification: 'synthetic' as const,
        officialComplianceEligible: false as const,
        requestedByUserId: x.requested_by_user_id,
        requestedAt: x.requested_at,
        requestReason: x.request_reason,
        approvedByUserId: x.approved_by_user_id,
        approvedAt: x.approved_at,
        approvalReason: x.approval_reason,
      },
    };
  }
  async getPolicy(policyId: string, effectiveAt: string, knownAt: string) {
    return this.read(async (c) => {
      const r = await c.query<{ version: number }>(
        `SELECT v.version FROM escalation_policy_versions v WHERE v.policy_id=$1 AND v.status='approved' AND v.effective_from<=$2 AND v.effective_until>$2 AND v.approved_at<=$3 ORDER BY v.version DESC LIMIT 1`,
        [policyId, effectiveAt, knownAt],
      );
      return r.rowCount ? this.policyVersion(c, policyId, r.rows[0]!.version) : null;
    });
  }
  async createIncident(alarmId: string, reason: string, actor: string, requestId: string) {
    return this.tx(async (c) => {
      await this.setActionContext(c, actor, reason, requestId);
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [alarmId]);
      const r = await c.query<{ id: string }>(
        'INSERT INTO incidents(organization_id,territory_id,primary_alarm_id,created_by_user_id,creation_reason,created_request_id) SELECT organization_id,territory_id,id,$2,$3,$4 FROM alarms WHERE id=$1 RETURNING id',
        [alarmId, actor, reason, requestId],
      );
      if (!r.rowCount) throw new IncidentError('NOT_FOUND', 'Alarm was not found.');
      const id = r.rows[0]!.id;
      await c.query(
        'INSERT INTO incident_alarm_links(incident_id,alarm_id,linked_by_user_id,link_reason,linked_request_id) VALUES($1,$2,$3,$4,$5)',
        [id, alarmId, actor, reason, requestId],
      );
      await c.query(
        "INSERT INTO incident_timeline(incident_id,kind,actor_user_id,reason,request_id) VALUES($1,'created',$2,$3,$4)",
        [id, actor, reason, requestId],
      );
      return this.incident(c, id, await this.databaseNow(c));
    });
  }
  async action(
    id: string,
    kind: 'acknowledged' | 'investigating' | 'resolved' | 'closed',
    reason: string,
    actor: string,
    requestId: string,
  ) {
    return this.tx(async (c) => {
      await this.setActionContext(c, actor, reason, requestId);
      const fields =
        kind === 'acknowledged'
          ? "status='acknowledged',acknowledged_by_user_id=$2"
          : `status='${kind}'`;
      const r = await c.query(
        `UPDATE incidents SET ${fields} WHERE id=$1 RETURNING id`,
        kind === 'acknowledged' ? [id, actor] : [id],
      );
      if (!r.rowCount) throw new IncidentError('NOT_FOUND', 'Incident was not found.');
      await c.query(
        'INSERT INTO incident_timeline(incident_id,kind,actor_user_id,reason,request_id) VALUES($1,$2,$3,$4,$5)',
        [id, kind, actor, reason, requestId],
      );
      return this.incident(c, id, await this.databaseNow(c));
    });
  }
  async assign(id: string, assignee: string, reason: string, actor: string, requestId: string) {
    return this.tx(async (c) => {
      await this.setActionContext(c, actor, reason, requestId);
      const r = await c.query(
        `UPDATE incidents i SET assigned_user_id=$2 WHERE i.id=$1 AND i.status<>'closed' AND EXISTS(SELECT 1 FROM identity_users u WHERE u.id=$2 AND u.organization_id=i.organization_id AND u.is_active AND incident_actor_may_write($2,i.organization_id,i.territory_id,clock_timestamp())) RETURNING i.id`,
        [id, assignee],
      );
      if (!r.rowCount)
        throw new IncidentError(
          'VALIDATION_ERROR',
          'Assignee is not active or lacks incident authority.',
        );
      await c.query(
        "INSERT INTO incident_timeline(incident_id,kind,actor_user_id,assignee_user_id,reason,request_id) VALUES($1,'assigned',$2,$3,$4,$5)",
        [id, actor, assignee, reason, requestId],
      );
      return this.incident(c, id, await this.databaseNow(c));
    });
  }
  async link(id: string, alarmId: string, reason: string, actor: string, requestId: string) {
    return this.tx(async (c) => {
      await this.setActionContext(c, actor, reason, requestId);
      await c.query(
        'INSERT INTO incident_alarm_links(incident_id,alarm_id,linked_by_user_id,link_reason,linked_request_id) VALUES($1,$2,$3,$4,$5)',
        [id, alarmId, actor, reason, requestId],
      );
      await c.query(
        "INSERT INTO incident_timeline(incident_id,kind,actor_user_id,alarm_id,reason,request_id) VALUES($1,'alarm_linked',$2,$3,$4,$5)",
        [id, actor, alarmId, reason, requestId],
      );
      return this.incident(c, id, await this.databaseNow(c));
    });
  }
  async note(
    id: string,
    kind: 'commented' | 'corrective_action',
    body: string,
    reason: string,
    actor: string,
    requestId: string,
  ) {
    return this.tx(async (c) => {
      await this.setActionContext(c, actor, reason, requestId);
      await c.query(
        'INSERT INTO incident_timeline(incident_id,kind,actor_user_id,reason,body,request_id) VALUES($1,$2,$3,$4,$5,$6)',
        [id, kind, actor, reason, body, requestId],
      );
      return this.incident(c, id, await this.databaseNow(c));
    });
  }
  async getIncident(id: string, evaluatedAt: string) {
    return this.read((c) => this.incident(c, id, evaluatedAt));
  }
  private async incident(c: PoolClient, id: string, evaluatedAt: string): Promise<unknown> {
    const r = await c.query<IncidentRow>(
      `SELECT i.*,${ts('i.created_at')} created_at,${ts('i.acknowledged_at')} acknowledged_at,${ts('i.resolved_at')} resolved_at,${ts('i.closed_at')} closed_at,${ts('i.acknowledgement_due_at')} acknowledgement_due_at,${ts('i.resolution_due_at')} resolution_due_at FROM incidents i WHERE i.id=$1`,
      [id],
    );
    if (!r.rowCount) throw new IncidentError('NOT_FOUND', 'Incident was not found.');
    const x = r.rows[0]!;
    const links = await c.query<{ alarm_id: string }>(
      'SELECT alarm_id FROM incident_alarm_links WHERE incident_id=$1 ORDER BY linked_at,alarm_id',
      [id],
    );
    const timeline = await c.query<TimelineRow>(
      `SELECT sequence,kind,actor_user_id,reason,body,assignee_user_id,alarm_id,request_id,${ts('occurred_at')} occurred_at FROM incident_timeline WHERE incident_id=$1 ORDER BY sequence`,
      [id],
    );
    const opened = incidentTimestampMicroseconds(x.created_at),
      at = incidentTimestampMicroseconds(evaluatedAt),
      ack = x.acknowledged_at ? incidentTimestampMicroseconds(x.acknowledged_at) : null,
      res = x.resolved_at ? incidentTimestampMicroseconds(x.resolved_at) : null;
    if (at < opened)
      throw new IncidentError(
        'VALIDATION_ERROR',
        'The metric cutoff cannot precede incident creation.',
      );
    const am = incidentMetric(
      'acknowledgement',
      opened,
      ack,
      at,
      x.acknowledgement_target_microseconds === null
        ? null
        : micros(x.acknowledgement_target_microseconds),
    );
    const rm = incidentMetric(
      'resolution',
      opened,
      res,
      at,
      x.resolution_target_microseconds === null ? null : micros(x.resolution_target_microseconds),
    );
    return {
      incident: {
        id: x.id,
        organizationId: x.organization_id,
        territoryId: x.territory_id,
        status: x.status,
        primaryAlarmId: x.primary_alarm_id,
        linkedAlarmIds: links.rows.map((y) => y.alarm_id),
        assignedUserId: x.assigned_user_id,
        acknowledgedByUserId: x.acknowledged_by_user_id,
        acknowledgedAt: x.acknowledged_at,
        resolvedAt: x.resolved_at,
        closedAt: x.closed_at,
        escalationPolicyId: x.escalation_policy_id,
        escalationPolicyVersionId: x.escalation_policy_version_id,
        escalationTier: x.escalation_tier,
        escalationProcedure: x.escalation_procedure,
        acknowledgementDueAt: x.acknowledgement_due_at,
        resolutionDueAt: x.resolution_due_at,
        dataClassification: 'synthetic',
        officialComplianceEligible: false,
        createdAt: x.created_at,
        timeline: timeline.rows.map((t) => ({
          sequence: t.sequence,
          kind: t.kind,
          actorUserId: t.actor_user_id,
          reason: t.reason,
          body: t.body,
          assigneeUserId: t.assignee_user_id,
          alarmId: t.alarm_id,
          occurredAt: t.occurred_at,
          requestId: t.request_id,
        })),
      },
      metrics: {
        evaluatedAt,
        acknowledgement: {
          state: am.state,
          targetMicroseconds: x.acknowledgement_target_microseconds,
          elapsedMicroseconds: am.elapsedMicroseconds.toString(),
          dueAt: x.acknowledgement_due_at,
        },
        resolution: {
          state: rm.state,
          targetMicroseconds: x.resolution_target_microseconds,
          elapsedMicroseconds: rm.elapsedMicroseconds.toString(),
          dueAt: x.resolution_due_at,
        },
      },
    };
  }
}

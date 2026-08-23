import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { PostgresAllocationPlanService } from './service.js';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests');
const pool = new Pool({ connectionString: databaseUrl });
after(async () => pool.end());
test(
  'approved m3 plans preserve microseconds, separate known/effective time, and leave gaps no_plan',
  { concurrency: false },
  async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const section = (
        await client.query<{ id: string; organization_id: string; territory_id: string }>(
          "SELECT id,organization_id,territory_id FROM water_sections WHERE lifecycle='active' ORDER BY id LIMIT 1",
        )
      ).rows[0]!;
      await client.query("UPDATE water_sections SET data_classification='official' WHERE id=$1", [
        section.id,
      ]);
      await client.query('SAVEPOINT official_plan_rejection');
      await assert.rejects(
        client.query(
          `INSERT INTO allocation_plans(organization_id,territory_id,water_section_id,data_classification,created_by_user_id,creation_reason,created_request_id)
           VALUES($1,$2,$3,'official','a3000000-0000-4000-8000-000000000001','official bypass attempt','allocation-db-test-official')`,
          [section.organization_id, section.territory_id, section.id],
        ),
        /synthetic/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT official_plan_rejection');
      await client.query('SAVEPOINT unauthorized_plan_identity');
      await assert.rejects(
        client.query(
          `INSERT INTO allocation_plans(organization_id,territory_id,water_section_id,data_classification,created_by_user_id,creation_reason,created_request_id)
           VALUES($1,$2,$3,'synthetic','a3000000-0000-4000-8000-000000000005','unauthorized plan identity','allocation-db-test-unauthorized')`,
          [section.organization_id, section.territory_id, section.id],
        ),
        /creator is not authorized/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT unauthorized_plan_identity');
      const service = new PostgresAllocationPlanService(databaseUrl, client);
      const content = {
        effectiveFrom: '2027-01-01T00:00:00.000001Z',
        effectiveUntil: '2027-01-02T00:00:00.000001Z',
        reason: 'synthetic plan test',
        entries: [
          {
            intervalStart: '2027-01-01T00:00:00.000001Z',
            intervalEnd: '2027-01-01T01:00:00.000001Z',
            plannedVolume: '0',
            unit: 'm3' as const,
            targetSemantics: 'whole_interval_target_no_proration' as const,
          },
        ],
      };
      const draft = await service.create(
        { ...content, waterSectionId: section.id },
        'a3000000-0000-4000-8000-000000000001',
        'allocation-db-test',
      );
      assert.equal(draft.entries[0]?.intervalStart, '2027-01-01T00:00:00.000001Z');
      assert.equal(draft.dataClassification, 'synthetic');
      assert.equal(draft.officialComplianceEligible, false);
      await client.query('SAVEPOINT unauthorized_entry_dml');
      await assert.rejects(
        client.query(
          `INSERT INTO allocation_plan_entries(
             plan_version_id,interval_start,interval_end,planned_volume_m3,unit,
             created_by_user_id,creation_reason,created_request_id
           ) VALUES(
             $1,'2027-01-01T03:00:00.000001Z','2027-01-01T04:00:00.000001Z',4,'m3',
             'a3000000-0000-4000-8000-000000000005','unauthorized entry','allocation-db-test-entry-bypass'
           )`,
          [draft.id],
        ),
        /authorized insert/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT unauthorized_entry_dml');

      const insertUnauthorizedDraft = (version: number, actorUserId: string) =>
        client.query(
          `INSERT INTO allocation_plan_versions(plan_id,version,effective_from,effective_until,drafted_by_user_id)
           VALUES($1,$2,'2040-01-01T00:00:00Z','2040-01-02T00:00:00Z',$3)`,
          [draft.planId, version, actorUserId],
        );
      await client.query('SAVEPOINT unauthorized_role_dml');
      await assert.rejects(
        insertUnauthorizedDraft(90, 'a3000000-0000-4000-8000-000000000005'),
        /authorized clean drafts/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT unauthorized_role_dml');

      await client.query(
        `INSERT INTO identity_users(id,organization_id,external_subject,display_name,is_active,data_classification)
         VALUES('a3000000-0000-4000-8000-000000000010',$1,'synthetic:p3-no-grant','Synthetic P3 no-grant user',true,'synthetic')`,
        [section.organization_id],
      );
      await client.query('SAVEPOINT no_grant_dml');
      await assert.rejects(
        insertUnauthorizedDraft(91, 'a3000000-0000-4000-8000-000000000010'),
        /authorized clean drafts/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT no_grant_dml');

      const crossTerritory = (
        await client.query<{ id: string }>(
          `WITH RECURSIVE ancestors(id,parent_territory_id) AS (
             SELECT id,parent_territory_id FROM territories WHERE id=$1
             UNION ALL
             SELECT parent.id,parent.parent_territory_id FROM territories parent
             JOIN ancestors child ON parent.id=child.parent_territory_id
           )
           SELECT territory.id FROM territories territory
           WHERE territory.organization_id=$2 AND territory.id NOT IN (SELECT id FROM ancestors)
           ORDER BY territory.id LIMIT 1`,
          [section.territory_id, section.organization_id],
        )
      ).rows[0]!;
      await client.query(
        `INSERT INTO identity_users(id,organization_id,external_subject,display_name,is_active,data_classification)
         VALUES('a3000000-0000-4000-8000-000000000009',$1,'synthetic:p3-cross-territory','Synthetic P3 cross-territory director',true,'synthetic')`,
        [section.organization_id],
      );
      await client.query(
        `INSERT INTO user_role_grants(id,user_id,organization_id,role,scope,territory_id,effective_from)
         VALUES('a4000000-0000-4000-8000-000000000009','a3000000-0000-4000-8000-000000000009',$1,'regional_director','territory',$2,'2026-01-01T00:00:00Z')`,
        [section.organization_id, crossTerritory.id],
      );
      await client.query('SAVEPOINT cross_territory_dml');
      await assert.rejects(
        insertUnauthorizedDraft(92, 'a3000000-0000-4000-8000-000000000009'),
        /authorized clean drafts/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT cross_territory_dml');
      await assert.rejects(
        service.history(draft.planId, {
          limit: 1,
          cursor: Buffer.from(JSON.stringify([1, 'not-a-uuid'])).toString('base64url'),
        }),
        /cursor is invalid/i,
      );
      assert.equal(
        (
          await service.current(
            draft.planId,
            '2027-01-01T00:30:00.000001Z',
            '2026-01-01T00:00:00.000000Z',
          )
        ).resolution,
        'no_plan',
      );
      await service.request(
        draft.planId,
        1,
        'request governed synthetic plan',
        'a3000000-0000-4000-8000-000000000001',
        'allocation-db-test',
      );
      const approved = await service.approve(
        draft.planId,
        1,
        { reason: 'approved governed synthetic plan', legalReference: 'SYN-LEGAL-1' },
        'a3000000-0000-4000-8000-000000000002',
        'allocation-db-test',
      );
      assert.equal(approved.status, 'approved');
      assert.equal(
        (
          await client.query<{ fresh: boolean }>(
            'SELECT abs(extract(epoch FROM (clock_timestamp() - $1::timestamptz))) < 30 AS fresh',
            [approved.approvedAt],
          )
        ).rows[0]?.fresh,
        true,
      );
      const databaseAudits = await client.query<{ action: string; provenance: string }>(
        `SELECT action::text,provenance FROM audit_events
         WHERE request_id='allocation-db-test' ORDER BY occurred_at,id`,
      );
      assert.deepEqual(
        databaseAudits.rows.map((event) => event.action),
        [
          'allocation_plan.created',
          'allocation_plan_version.created',
          'allocation_plan_entry.created',
          'allocation_plan_version.requested',
          'allocation_plan_version.approved',
        ],
      );
      assert.ok(
        databaseAudits.rows.every(
          (event) => event.provenance === 'database:allocation-plan-lifecycle',
        ),
      );
      const planned = await service.current(
        draft.planId,
        '2027-01-01T00:30:00.000001Z',
        '2027-01-01T00:00:00.000000Z',
      );
      assert.equal(planned.resolution, 'planned');
      assert.equal(planned.entry?.plannedVolume, '0');
      const gap = await service.current(
        draft.planId,
        '2027-01-01T02:00:00.000001Z',
        '2027-01-01T00:00:00.000000Z',
      );
      assert.equal(gap.resolution, 'no_plan');
      assert.equal(gap.noPlanReason, 'schedule_gap');
      assert.equal(gap.planVersion?.id, draft.id);
      const successor = await service.append(
        draft.planId,
        {
          effectiveFrom: '2027-01-01T01:00:00.000001Z',
          effectiveUntil: '2027-01-02T00:00:00.000001Z',
          reason: 'successor draft',
          entries: [
            {
              intervalStart: '2027-01-01T01:00:00.000001Z',
              intervalEnd: '2027-01-01T02:00:00.000001Z',
              plannedVolume: '1.250000',
              unit: 'm3',
              targetSemantics: 'whole_interval_target_no_proration',
            },
          ],
        },
        'a3000000-0000-4000-8000-000000000001',
        'allocation-db-test',
      );
      await client.query('SAVEPOINT direct_supersession_rejection');
      await assert.rejects(
        client.query(
          `UPDATE allocation_plan_versions SET status='superseded',superseded_effective_at='2027-01-01T01:00:00.000001Z',superseded_at='2026-08-25T00:00:00.000000Z',superseded_by_version_id=$2 WHERE id=$1`,
          [draft.id, successor.id],
        ),
        /lifecycle|approved/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT direct_supersession_rejection');
      await service.request(
        draft.planId,
        2,
        'request successor',
        'a3000000-0000-4000-8000-000000000001',
        'allocation-db-test',
      );
      const approvedSuccessor = await service.approve(
        draft.planId,
        2,
        { reason: 'approve successor', legalReference: 'SYN-LEGAL-2' },
        'a3000000-0000-4000-8000-000000000002',
        'allocation-db-test',
      );
      await client.query('SET CONSTRAINTS allocation_plan_versions_governed_nonoverlap IMMEDIATE');
      const knownBoundaries = (
        await client.query<{ before_known: string; exact_known_offset: string }>(
          `SELECT
             to_char((approved_at - interval '1 microsecond') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') before_known,
             to_char((approved_at AT TIME ZONE 'UTC') + interval '5 hours','YYYY-MM-DD"T"HH24:MI:SS.US') || '+05:00' exact_known_offset
           FROM allocation_plan_versions WHERE id=$1`,
          [approvedSuccessor.id],
        )
      ).rows[0]!;
      const beforeKnown = await service.current(
        draft.planId,
        '2027-01-01T00:30:00.000001Z',
        knownBoundaries.before_known,
      );
      assert.equal(beforeKnown.planVersion?.status, 'approved');
      assert.equal(beforeKnown.planVersion?.supersededAt, null);
      assert.equal(beforeKnown.planVersion?.governedEffectiveUntil, content.effectiveUntil);
      const predecessorAfterKnown = await service.current(
        draft.planId,
        '2027-01-01T00:30:00.000001Z',
        knownBoundaries.exact_known_offset,
      );
      assert.equal(predecessorAfterKnown.planVersion?.status, 'superseded');
      assert.equal(
        predecessorAfterKnown.planVersion?.governedEffectiveUntil,
        '2027-01-01T01:00:00.000001Z',
      );
      assert.equal(predecessorAfterKnown.planVersion?.supersededByVersionId, successor.id);
      assert.equal(predecessorAfterKnown.planVersion?.supersededAt, approvedSuccessor.approvedAt);
      const afterKnown = await service.current(
        draft.planId,
        '2027-01-01T01:30:00.000001Z',
        knownBoundaries.exact_known_offset,
      );
      assert.equal(afterKnown.resolution, 'planned');
      assert.equal(afterKnown.planVersion?.version, 2);
      assert.equal(afterKnown.entry?.targetSemantics, 'whole_interval_target_no_proration');

      await client.query('SAVEPOINT direct_integrity_rejections');
      await assert.rejects(
        client.query("UPDATE allocation_plans SET data_classification='official' WHERE id=$1", [
          draft.planId,
        ]),
        /immutable/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT direct_integrity_rejections');
      await client.query('SAVEPOINT direct_entry_delete');
      await assert.rejects(
        client.query('DELETE FROM allocation_plan_entries WHERE plan_version_id=$1', [draft.id]),
        /immutable/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT direct_entry_delete');

      const sameAuthor = await service.append(
        draft.planId,
        {
          effectiveFrom: '2027-01-01T02:00:00.000001Z',
          effectiveUntil: '2027-01-02T00:00:00.000001Z',
          reason: 'same-author rejection draft',
          entries: [
            {
              intervalStart: '2027-01-01T02:00:00.000001Z',
              intervalEnd: '2027-01-01T03:00:00.000001Z',
              plannedVolume: '2',
              unit: 'm3',
              targetSemantics: 'whole_interval_target_no_proration',
            },
          ],
        },
        'a3000000-0000-4000-8000-000000000001',
        'allocation-db-test',
      );
      await service.request(
        draft.planId,
        sameAuthor.version,
        'same-author request',
        'a3000000-0000-4000-8000-000000000001',
        'allocation-db-test',
      );
      await client.query('SAVEPOINT forged_approval_time');
      await assert.rejects(
        client.query(
          `UPDATE allocation_plan_versions
           SET status='approved',approved_by_user_id='a3000000-0000-4000-8000-000000000002',
               approved_at=statement_timestamp() - interval '1 microsecond',
               approval_reason='forged time',legal_reference='SYN-FORGED',approved_request_id='allocation-db-test-forged'
           WHERE id=$1`,
          [sameAuthor.id],
        ),
        /governed lifecycle/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT forged_approval_time');
      const auditsBeforeRejectedApproval = await client.query<{ count: string }>(
        "SELECT count(*)::text count FROM audit_events WHERE request_id='allocation-db-test'",
      );
      await assert.rejects(
        service.approve(
          draft.planId,
          sameAuthor.version,
          { reason: 'must fail', legalReference: 'SYN-REJECT' },
          'a3000000-0000-4000-8000-000000000001',
          'allocation-db-test',
        ),
        /distinct approver/i,
      );
      const auditsAfterRejectedApproval = await client.query<{ count: string }>(
        "SELECT count(*)::text count FROM audit_events WHERE request_id='allocation-db-test'",
      );
      assert.equal(
        auditsAfterRejectedApproval.rows[0]?.count,
        auditsBeforeRejectedApproval.rows[0]?.count,
      );
      const unchanged = await client.query<{ status: string }>(
        'SELECT status::text FROM allocation_plan_versions WHERE id=$1',
        [sameAuthor.id],
      );
      assert.equal(unchanged.rows[0]?.status, 'requested');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  },
);

test(
  'concurrent version appends and approvals serialize to one governed successor with atomic audit',
  { concurrency: false },
  async () => {
    const section = (
      await pool.query<{ id: string }>(
        "SELECT id FROM water_sections WHERE lifecycle='active' ORDER BY id OFFSET 1 LIMIT 1",
      )
    ).rows[0]!;
    const service = new PostgresAllocationPlanService(databaseUrl);
    const base = {
      effectiveFrom: '2030-01-01T00:00:00.000001Z',
      effectiveUntil: '2030-01-02T00:00:00.000001Z',
      reason: 'allocation race base',
      entries: [
        {
          intervalStart: '2030-01-01T00:00:00.000001Z',
          intervalEnd: '2030-01-01T01:00:00.000001Z',
          plannedVolume: '10',
          unit: 'm3' as const,
          targetSemantics: 'whole_interval_target_no_proration' as const,
        },
      ],
    };
    const initial = await service.create(
      { ...base, waterSectionId: section.id },
      'a3000000-0000-4000-8000-000000000001',
      'allocation-race',
    );
    await service.request(
      initial.planId,
      initial.version,
      'request base',
      'a3000000-0000-4000-8000-000000000001',
      'allocation-race',
    );
    await service.approve(
      initial.planId,
      initial.version,
      { reason: 'approve base', legalReference: 'SYN-RACE-BASE' },
      'a3000000-0000-4000-8000-000000000002',
      'allocation-race',
    );
    const successorContent = {
      effectiveFrom: '2030-01-01T01:00:00.000001Z',
      effectiveUntil: '2030-01-02T00:00:00.000001Z',
      reason: 'competing successor',
      entries: [
        {
          intervalStart: '2030-01-01T01:00:00.000001Z',
          intervalEnd: '2030-01-01T02:00:00.000001Z',
          plannedVolume: '11',
          unit: 'm3' as const,
          targetSemantics: 'whole_interval_target_no_proration' as const,
        },
      ],
    };
    const candidates = await Promise.all([
      service.append(
        initial.planId,
        successorContent,
        'a3000000-0000-4000-8000-000000000001',
        'allocation-race',
      ),
      service.append(
        initial.planId,
        successorContent,
        'a3000000-0000-4000-8000-000000000001',
        'allocation-race',
      ),
    ]);
    assert.deepEqual(
      candidates.map((candidate) => candidate.version).sort((left, right) => left - right),
      [2, 3],
    );
    for (const candidate of candidates)
      await service.request(
        initial.planId,
        candidate.version,
        'request competing successor',
        'a3000000-0000-4000-8000-000000000001',
        'allocation-race',
      );
    const approvals = await Promise.allSettled(
      candidates.map((candidate) =>
        service.approve(
          initial.planId,
          candidate.version,
          { reason: 'approve one successor', legalReference: `SYN-RACE-${candidate.version}` },
          'a3000000-0000-4000-8000-000000000002',
          'allocation-race',
        ),
      ),
    );
    assert.equal(approvals.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(approvals.filter((result) => result.status === 'rejected').length, 1);
    const statuses = await pool.query<{ status: string; count: string }>(
      `SELECT status::text,count(*)::text count FROM allocation_plan_versions
       WHERE plan_id=$1 GROUP BY status ORDER BY status`,
      [initial.planId],
    );
    assert.deepEqual(
      Object.fromEntries(statuses.rows.map((row) => [row.status, Number(row.count)])),
      { approved: 1, requested: 1, superseded: 1 },
    );
    const audits = await pool.query<{ count: string }>(
      "SELECT count(*)::text count FROM audit_events WHERE request_id='allocation-race'",
    );
    assert.equal(audits.rows[0]?.count, '13');
  },
);

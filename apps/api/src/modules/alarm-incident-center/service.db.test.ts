import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { alarmIncidentCenterResponseSchema } from '@isuv/contracts';
import { Pool } from 'pg';
import { PostgresIncidentService } from '../incidents/service.js';
import { PostgresAlarmIncidentCenterService } from './service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
after(async () => pool.end());

const organization = 'a1000000-0000-4000-8000-000000000001';
const national = 'a2000000-0000-4000-8000-000000000001';
const districtA = 'a2000000-0000-4000-8000-000000000004';
const districtB = 'a2000000-0000-4000-8000-000000000005';
const systemAdministrator = 'a3000000-0000-4000-8000-000000000001';
const nationalAdministrator = 'a3000000-0000-4000-8000-000000000002';
const scenarioProvenance =
  'synthetic: governed P5 alarm and incident scenario v1; not official telemetry, policy, or SLA';

function requireItem<T>(value: T, message: string): NonNullable<T> {
  assert.ok(value, message);
  return value as NonNullable<T>;
}

test('alarm and incident center composes the governed synthetic lifecycle with scoped, filter-bound pages', async () => {
  const service = new PostgresAlarmIncidentCenterService(databaseUrl);
  assert.equal(
    await service.findDefaultTerritory(systemAdministrator, organization, new Date()),
    national,
    'a system grant falls back to the organization national territory',
  );
  assert.equal(
    await service.findDefaultTerritory(nationalAdministrator, organization, new Date()),
    national,
    'a national grant falls back to the organization national territory',
  );

  const first = requireItem(
    await service.list(national, systemAdministrator, { limit: 1 }),
    'the fresh seed must provide a national alarm queue',
  );
  alarmIncidentCenterResponseSchema.parse(first);
  assert.equal(first.scope.territoryId, national);
  assert.ok(first.scope.queueDenominator >= 4, 'fixture retains every alarm episode in the queue');
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor, 'one-row page exposes a cursor when later episodes exist');

  const second = requireItem(
    await service.list(national, systemAdministrator, { limit: 1, cursor: first.nextCursor! }),
    'the next cursor must compose a second page',
  );
  alarmIncidentCenterResponseSchema.parse(second);
  assert.equal(second.items.length, 1);
  assert.notEqual(second.items[0]!.alarmId, first.items[0]!.alarmId);
  await assert.rejects(
    () =>
      service.list(national, systemAdministrator, {
        limit: 1,
        cursor: first.nextCursor!,
        automaticState: 'active',
      }),
    /CURSOR/,
    'a cursor cannot be replayed under different filters',
  );
  await assert.rejects(
    () => service.list(districtA, systemAdministrator, { limit: 1, cursor: first.nextCursor! }),
    /CURSOR/,
    'a cursor cannot be replayed into a different territory scope',
  );

  const all = requireItem(
    await service.list(national, systemAdministrator, { limit: 50 }),
    'the complete national fixture must compose',
  );
  alarmIncidentCenterResponseSchema.parse(all);
  const inDistrictA = requireItem(
    await service.list(districtA, systemAdministrator, { limit: 50 }),
    'district A has its own governed scenario row',
  );
  const inDistrictB = requireItem(
    await service.list(districtB, systemAdministrator, { limit: 50 }),
    'district B has its own governed scenario rows',
  );
  assert.ok(inDistrictA.items.every((item) => item.territory.id === districtA));
  assert.ok(inDistrictB.items.every((item) => item.territory.id === districtB));
  assert.ok(
    inDistrictA.items.every(
      (item) => !inDistrictB.items.some((foreign) => foreign.alarmId === item.alarmId),
    ),
    "district queues must not enumerate one another's alarm identifiers",
  );

  const unassessableMissingPolicy = requireItem(
    all.items.find(
      (item) =>
        item.provenance.label === scenarioProvenance &&
        item.territory.id === districtA &&
        item.automaticState === 'active' &&
        item.incidentId !== null &&
        item.evidence.assessment === 'deferred' &&
        item.evidence.latestEvidenceStatus === 'unassessable',
    ),
    'fixture provides active unassessable evidence with a governedly absent escalation policy',
  );
  assert.equal(unassessableMissingPolicy.evidence.unitBoundary, 'stage_m');
  assert.equal(unassessableMissingPolicy.evidence.latestEvidenceStatus, 'unassessable');
  assert.notEqual(unassessableMissingPolicy.evidence.qualityState, 'valid');
  assert.ok(unassessableMissingPolicy.evidence.reason);
  assert.equal(unassessableMissingPolicy.escalation.state, 'unconfigured');
  assert.equal(unassessableMissingPolicy.capabilities.resolve.allowed, false);
  const activeUnowned = requireItem(
    all.items.find(
      (item) =>
        item.provenance.label === scenarioProvenance &&
        item.automaticState === 'active' &&
        item.incidentId === null,
    ),
    'fixture provides an active, unowned alarm separately from any human case',
  );
  assert.equal(activeUnowned.capabilities.createIncident.allowed, true);

  const clearedHumanOpen = requireItem(
    all.items.find(
      (item) =>
        item.provenance.label === scenarioProvenance &&
        item.automaticState === 'cleared' &&
        item.incidentStatus === 'investigating',
    ),
    'fixture keeps a human investigation open after its linked alarm clears',
  );
  assert.equal(clearedHumanOpen.capabilities.resolve.allowed, true);
  assert.equal(clearedHumanOpen.escalation.state, 'configured');
  await new PostgresIncidentService(databaseUrl).link(
    clearedHumanOpen.incidentId!,
    activeUnowned.alarmId,
    'prove every linked automatic alarm must clear',
    systemAdministrator,
    'center-db-multi-link-active-regression',
  );
  const multiLink = requireItem(
    await service.list(national, systemAdministrator, {
      alarmId: clearedHumanOpen.alarmId,
      limit: 25,
    }),
    'the cleared primary alarm remains selectable after linking another governed alarm',
  );
  assert.equal(
    multiLink.panel?.item.capabilities.resolve.allowed,
    false,
    'one active linked alarm blocks resolve even when the selected alarm is cleared',
  );

  const activeAssigned = requireItem(
    all.items.find(
      (item) =>
        item.provenance.label === scenarioProvenance &&
        item.automaticState === 'active' &&
        item.incidentStatus === 'investigating' &&
        item.assignedUserId !== null,
    ),
    'fixture provides an active, assigned investigation',
  );
  assert.equal(activeAssigned.capabilities.resolve.allowed, false);
  assert.equal(activeAssigned.evidence.unitBoundary, 'stage_m');
  const activePanel = requireItem(
    await service.list(national, systemAdministrator, {
      alarmId: activeAssigned.alarmId,
      limit: 25,
    }),
    'selected alarm composes a panel',
  );
  assert.ok(activePanel.panel);
  assert.equal(activePanel.panel.item.alarmId, activeAssigned.alarmId);
  assert.ok(activePanel.assignmentCandidates.length > 0);
  const candidateIds = activePanel.assignmentCandidates.map((candidate) => candidate.id);
  const candidateAuthorization = await pool.query<{ id: string; may_write: boolean }>(
    `SELECT u.id,incident_actor_may_write(u.id,$1,$2,clock_timestamp()) may_write
       FROM identity_users u WHERE u.id=ANY($3::uuid[])`,
    [organization, activeAssigned.territory.id, candidateIds],
  );
  assert.equal(candidateAuthorization.rows.length, candidateIds.length);
  assert.ok(candidateAuthorization.rows.every((candidate) => candidate.may_write));

  const closed = requireItem(
    all.items.find(
      (item) => item.provenance.label === scenarioProvenance && item.incidentStatus === 'closed',
    ),
    'fixture provides a resolved and closed case',
  );
  const closedPanel = requireItem(
    await service.list(national, systemAdministrator, {
      incidentId: closed.incidentId!,
      limit: 25,
    }),
    'selected incident composes its panel',
  );
  assert.ok(closedPanel.panel);
  assert.equal(closedPanel.panel.item.incidentStatus, 'closed');
  assert.ok(closedPanel.panel.timeline.some((entry) => entry.kind === 'resolved'));
  assert.ok(closedPanel.panel.timeline.some((entry) => entry.kind === 'closed'));
  assert.ok(
    Object.values(closedPanel.panel.item.capabilities).every((capability) => !capability.allowed),
    'closed cases expose no mutable affordance',
  );
  const timelineAudit = await pool.query<{ count: string }>(
    `SELECT count(*)::text count
       FROM audit_events audit
       JOIN incident_timeline timeline ON timeline.request_id=audit.request_id
      WHERE timeline.incident_id=$1
        AND audit.resource='incident'
        AND audit.reason=timeline.reason`,
    [closed.incidentId],
  );
  assert.equal(
    timelineAudit.rows[0]?.count,
    String(closedPanel.panel.timeline.length),
    'every immutable timeline event has the matching database audit provenance',
  );

  assert.equal(
    (
      await service.list(national, systemAdministrator, {
        alarmId: 'f0000000-0000-4000-8000-000000000001',
        limit: 25,
      })
    )?.panel,
    null,
    'a foreign or nonexistent selector does not produce a panel',
  );
  const provenanceCount = await pool.query<{ count: string }>(
    'SELECT count(*)::text count FROM alarm_rules WHERE provenance=$1',
    [scenarioProvenance],
  );
  assert.equal(provenanceCount.rows[0]?.count, '3', 'the seed remains a bounded governed fixture');
});

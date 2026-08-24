import assert from 'node:assert/strict';
import test from 'node:test';
import type { EffectiveGrant } from '@isuv/domain';
import { authorizeTerritoryAction } from './service.js';

const districtA = 'a2000000-0000-4000-8000-000000000004';
const districtB = 'a2000000-0000-4000-8000-000000000005';

test('denies a cross-district mutation and allows a same-scope mutation', async () => {
  const grant: EffectiveGrant = {
    id: 'a4000000-0000-4000-8000-000000000005',
    role: 'district_operator',
    scope: 'territory',
    territoryId: districtA,
    coversTargetTerritory: false,
  };
  const repository = {
    async findEffectiveGrantsForTarget(
      _userId: string,
      territoryId: string,
    ): Promise<EffectiveGrant[]> {
      return [{ ...grant, coversTargetTerritory: territoryId === districtA }];
    },
  };

  const sameScope = await authorizeTerritoryAction(
    repository,
    'user-a',
    'telemetry:write',
    districtA,
  );
  const crossDistrict = await authorizeTerritoryAction(
    repository,
    'user-a',
    'telemetry:write',
    districtB,
  );
  const networkRead = await authorizeTerritoryAction(
    repository,
    'user-a',
    'network:read',
    districtA,
  );

  assert.deepEqual(sameScope, { allowed: true, grantId: grant.id, role: 'district_operator' });
  assert.deepEqual(crossDistrict, { allowed: false, reason: 'OUTSIDE_TERRITORY_SCOPE' });
  assert.deepEqual(networkRead, { allowed: true, grantId: grant.id, role: 'district_operator' });
});

test('allows an ancestor territory role and keeps auditors read-only', async () => {
  const ancestorGrant: EffectiveGrant = {
    id: 'a4000000-0000-4000-8000-000000000003',
    role: 'regional_director',
    scope: 'territory',
    territoryId: 'a2000000-0000-4000-8000-000000000002',
    coversTargetTerritory: true,
  };
  const auditorGrant: EffectiveGrant = {
    id: 'a4000000-0000-4000-8000-000000000008',
    role: 'auditor',
    scope: 'territory',
    territoryId: 'a2000000-0000-4000-8000-000000000002',
    coversTargetTerritory: true,
  };

  const directorRepository = {
    async findEffectiveGrantsForTarget(): Promise<EffectiveGrant[]> {
      return [ancestorGrant];
    },
  };
  const auditorRepository = {
    async findEffectiveGrantsForTarget(): Promise<EffectiveGrant[]> {
      return [auditorGrant];
    },
  };

  const ancestorWrite = await authorizeTerritoryAction(
    directorRepository,
    'director',
    'incident:write',
    districtB,
  );
  const auditorWrite = await authorizeTerritoryAction(
    auditorRepository,
    'auditor',
    'incident:write',
    districtA,
  );
  const auditorRead = await authorizeTerritoryAction(
    auditorRepository,
    'auditor',
    'incident:read',
    districtA,
  );

  assert.equal(ancestorWrite.allowed, true);
  assert.deepEqual(auditorWrite, { allowed: false, reason: 'ROLE_READ_ONLY' });
  assert.equal(auditorRead.allowed, true);
  assert.equal(
    (await authorizeTerritoryAction(auditorRepository, 'auditor', 'telemetry:read', districtA))
      .allowed,
    true,
  );
  assert.deepEqual(
    await authorizeTerritoryAction(auditorRepository, 'auditor', 'audit:write', districtA),
    { allowed: false, reason: 'ROLE_READ_ONLY' },
  );
});

test('reserves telemetry corrections for hydrologists and senior administrators', async () => {
  const territoryGrant = (role: EffectiveGrant['role']): EffectiveGrant => ({
    id: 'a4000000-0000-4000-8000-000000000009',
    role,
    scope: 'territory',
    territoryId: districtA,
    coversTargetTerritory: true,
  });
  for (const role of ['district_operator', 'basin_dispatcher'] as const) {
    const decision = await authorizeTerritoryAction(
      {
        async findEffectiveGrantsForTarget() {
          return [territoryGrant(role)];
        },
      },
      'operator',
      'telemetry:correct',
      districtA,
    );
    assert.equal(decision.allowed, false);
  }
  const hydrologist = await authorizeTerritoryAction(
    {
      async findEffectiveGrantsForTarget() {
        return [territoryGrant('hydrologist')];
      },
    },
    'hydrologist',
    'telemetry:correct',
    districtA,
  );
  assert.equal(hydrologist.allowed, true);
});

test('reserves alarm approval for hydrologists and senior administrators', async () => {
  const territoryGrant = (role: EffectiveGrant['role']): EffectiveGrant => ({
    id: 'a4000000-0000-4000-8000-000000000019',
    role,
    scope: 'territory',
    territoryId: districtA,
    coversTargetTerritory: true,
  });
  const decide = async (role: EffectiveGrant['role']) =>
    authorizeTerritoryAction(
      {
        async findEffectiveGrantsForTarget() {
          return [territoryGrant(role)];
        },
      },
      role,
      'alarm:approve',
      districtA,
    );

  assert.equal((await decide('hydrologist')).allowed, true);
  assert.equal((await decide('regional_director')).allowed, true);
  assert.deepEqual(await decide('district_operator'), {
    allowed: false,
    reason: 'ROLE_NOT_PERMITTED',
  });
  assert.deepEqual(await decide('auditor'), { allowed: false, reason: 'ROLE_READ_ONLY' });
});

test('reserves incident escalation policy approval for senior administrators', async () => {
  const decide = async (role: EffectiveGrant['role']) =>
    authorizeTerritoryAction(
      {
        async findEffectiveGrantsForTarget() {
          return [
            {
              id: 'a4000000-0000-4000-8000-000000000020',
              role,
              scope: 'territory' as const,
              territoryId: districtA,
              coversTargetTerritory: true,
            },
          ];
        },
      },
      role,
      'incident:approve',
      districtA,
    );

  assert.equal((await decide('regional_director')).allowed, true);
  assert.deepEqual(await decide('hydrologist'), {
    allowed: false,
    reason: 'ROLE_NOT_PERMITTED',
  });
  assert.deepEqual(await decide('district_operator'), {
    allowed: false,
    reason: 'ROLE_NOT_PERMITTED',
  });
  assert.deepEqual(await decide('auditor'), { allowed: false, reason: 'ROLE_READ_ONLY' });
});

test('fails closed for no effective grant and malformed elevated scope grants', async () => {
  const noGrantRepository = {
    async findEffectiveGrantsForTarget(): Promise<EffectiveGrant[]> {
      return [];
    },
  };
  const malformedGrantRepository = {
    async findEffectiveGrantsForTarget(): Promise<EffectiveGrant[]> {
      return [
        {
          id: 'a4000000-0000-4000-8000-000000000099',
          role: 'district_operator',
          scope: 'national',
          territoryId: null,
          coversTargetTerritory: false,
        },
      ];
    },
  };

  assert.deepEqual(
    await authorizeTerritoryAction(
      noGrantRepository,
      'user-without-grants',
      'device:write',
      districtA,
    ),
    { allowed: false, reason: 'NO_EFFECTIVE_GRANT' },
  );
  assert.deepEqual(
    await authorizeTerritoryAction(
      malformedGrantRepository,
      'bad-grant',
      'device:write',
      districtA,
    ),
    { allowed: false, reason: 'OUTSIDE_TERRITORY_SCOPE' },
  );
});

test('does not allow a national grant to cross organization boundaries', async () => {
  const repository = {
    async findEffectiveGrantsForTarget(): Promise<EffectiveGrant[]> {
      // The SQL repository removes a national grant before it reaches policy
      // when the target belongs to another organization.
      return [];
    },
  };

  assert.deepEqual(
    await authorizeTerritoryAction(repository, 'national-admin', 'territory:write', districtB),
    { allowed: false, reason: 'NO_EFFECTIVE_GRANT' },
  );
});

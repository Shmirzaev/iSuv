import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateWaterBalance, rational, shiftedBalanceInterval, utcMicros } from '../index.js';
import { decideTerritoryAuthorization } from '../authorization/policy.js';
test('water balance computes split and merge with signed storage and known additions/removals', () => {
  const result = calculateWaterBalance(
    [
      {
        waterSectionId: 'a',
        role: 'incoming',
        referencePlane: 'downstream',
        travelTimeMicroseconds: 0n,
        volume: rational(7n),
      },
      {
        waterSectionId: 'b',
        role: 'incoming',
        referencePlane: 'downstream',
        travelTimeMicroseconds: 0n,
        volume: rational(5n),
      },
      {
        waterSectionId: 'c',
        role: 'outgoing',
        referencePlane: 'upstream',
        travelTimeMicroseconds: 0n,
        volume: rational(10n),
      },
    ],
    {
      intervalStart: '2026-01-01T00:00:00.000000Z',
      intervalEnd: '2026-01-01T00:01:00.000000Z',
      storageChangeM3: rational(-1n),
      knownAdditionM3: rational(2n),
      knownRemovalM3: rational(1n),
    },
  );
  assert.equal(result.outcome, 'computed');
  if (result.outcome === 'computed') assert.equal(result.residualM3.numerator, 4n);
});
test('all four source interval shifts preserve microseconds and offsets', () => {
  const start = '2026-01-01T05:00:00.000001+05:00',
    end = '2026-01-01T05:01:00.000001+05:00';
  for (const [role, plane, expected] of [
    ['incoming', 'upstream', -7n],
    ['incoming', 'downstream', 0n],
    ['outgoing', 'upstream', 0n],
    ['outgoing', 'downstream', 7n],
  ] as const) {
    const interval = shiftedBalanceInterval(start, end, role, plane, 7n);
    assert.equal(interval.startMicros, utcMicros(start) + expected);
    assert.equal(interval.endMicros, utcMicros(end) + expected);
  }
});
test('water-balance approval is explicit: hydrologists may approve and auditors or writers may not', () => {
  const base = {
    id: 'g',
    scope: 'territory' as const,
    territoryId: 't',
    coversTargetTerritory: true,
  };
  assert.equal(
    decideTerritoryAuthorization({
      action: 'water_balance:approve',
      targetTerritoryId: 't',
      grants: [{ ...base, role: 'hydrologist' }],
    }).allowed,
    true,
  );
  assert.equal(
    decideTerritoryAuthorization({
      action: 'water_balance:approve',
      targetTerritoryId: 't',
      grants: [{ ...base, role: 'auditor' }],
    }).allowed,
    false,
  );
  assert.equal(
    decideTerritoryAuthorization({
      action: 'water_balance:approve',
      targetTerritoryId: 't',
      grants: [{ ...base, role: 'district_operator' }],
    }).allowed,
    false,
  );
});

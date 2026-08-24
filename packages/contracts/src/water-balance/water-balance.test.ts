import test from 'node:test';
import assert from 'node:assert/strict';
import { requestWaterBalanceVersionRequestSchema } from './water-balance.js';
const id = '11111111-1111-4111-8111-111111111111';
test('water balance contract accepts explicit bounded synthetic component and assumption', () => {
  assert.equal(
    requestWaterBalanceVersionRequestSchema.safeParse({
      effectiveFrom: '2026-01-01T00:00:00.000000Z',
      effectiveUntil: '2026-01-01T01:00:00.000000Z',
      provenance: 'synthetic:test',
      reason: 'test',
      components: [
        {
          waterSectionId: id,
          stationId: id,
          sensorId: id,
          deviceInstallationId: id,
          method: 'direct_discharge',
          role: 'incoming',
          referencePlane: 'downstream',
          travelTimeMicroseconds: '0',
          provenance: 'synthetic:test',
        },
      ],
      assumptions: [
        {
          intervalStart: '2026-01-01T00:00:00.000000Z',
          intervalEnd: '2026-01-01T01:00:00.000000Z',
          storageChangeM3: '-1',
          knownAdditionM3: '0',
          knownRemovalM3: '0',
          provenance: 'synthetic:test',
        },
      ],
    }).success,
    true,
  );
});

test('water balance contract rejects unbounded travel times', () => {
  const result = requestWaterBalanceVersionRequestSchema.safeParse({
    effectiveFrom: '2026-01-01T00:00:00.000000Z',
    effectiveUntil: '2026-01-01T01:00:00.000000Z',
    provenance: 'synthetic:test',
    reason: 'test',
    components: [
      {
        waterSectionId: id,
        stationId: id,
        sensorId: id,
        deviceInstallationId: id,
        method: 'direct_discharge',
        role: 'incoming',
        referencePlane: 'upstream',
        travelTimeMicroseconds: '31536000000001',
        provenance: 'synthetic:test',
      },
    ],
    assumptions: [
      {
        intervalStart: '2026-01-01T00:00:00.000000Z',
        intervalEnd: '2026-01-01T01:00:00.000000Z',
        storageChangeM3: '0',
        knownAdditionM3: '0',
        knownRemovalM3: '0',
        provenance: 'synthetic:test',
      },
    ],
  });
  assert.equal(result.success, false);
});

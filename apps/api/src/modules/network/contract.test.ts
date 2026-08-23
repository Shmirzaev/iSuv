import assert from 'node:assert/strict';
import test from 'node:test';
import { networkEntitySchema } from '@isuv/contracts';

const base = {
  id: 'dc000000-0000-4000-8000-000000000001',
  organizationId: 'dc000000-0000-4000-8000-000000000002',
  territoryId: 'dc000000-0000-4000-8000-000000000003',
  code: 'SENSOR-1',
  name: 'Synthetic sensor',
  lifecycle: 'active' as const,
  status: 'operational' as const,
  dataClassification: 'synthetic' as const,
  revision: 1,
  geometry: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

test('network contract makes canonical sensor units and entity geometry types explicit', () => {
  assert.equal(
    networkEntitySchema.safeParse({
      ...base,
      type: 'sensor',
      deviceId: 'dc000000-0000-4000-8000-000000000004',
      measurementKind: 'stage',
      unit: 'm3',
    }).success,
    false,
  );
  assert.equal(
    networkEntitySchema.safeParse({
      ...base,
      type: 'junction',
      geometry: {
        type: 'LineString',
        coordinates: [
          [69.1, 41.1],
          [69.2, 41.2],
        ],
      },
    }).success,
    false,
  );
  assert.equal(
    networkEntitySchema.safeParse({
      ...base,
      type: 'sensor',
      deviceId: 'dc000000-0000-4000-8000-000000000004',
      measurementKind: 'accumulated_volume',
      unit: 'm3',
    }).success,
    true,
  );
  assert.equal(
    networkEntitySchema.safeParse({
      ...base,
      type: 'junction',
      geometry: { type: 'Point', coordinates: [-180, 90] },
    }).success,
    true,
  );
  assert.equal(
    networkEntitySchema.safeParse({
      ...base,
      type: 'junction',
      geometry: { type: 'Point', coordinates: [200, 95] },
    }).success,
    false,
  );
  assert.equal(
    networkEntitySchema.safeParse({
      ...base,
      type: 'waterway',
      basinId: null,
      geometry: {
        type: 'LineString',
        coordinates: [
          [69.1, 41.1],
          [181, 41.2],
        ],
      },
    }).success,
    false,
  );
  assert.equal(
    networkEntitySchema.safeParse({
      ...base,
      type: 'region',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [69, 41],
              [70, 41],
              [70, 91],
              [69, 41],
            ],
          ],
        ],
      },
    }).success,
    false,
  );
  assert.equal(
    networkEntitySchema.safeParse({
      ...base,
      type: 'section',
      waterwayId: null,
      upstreamJunctionId: 'dc000000-0000-4000-8000-000000000004',
      downstreamJunctionId: null,
      upstreamBoundary: false,
      downstreamBoundary: true,
      geometry: {
        type: 'LineString',
        coordinates: [
          [69.1, 41.1],
          [69.2, 41.2],
        ],
      },
    }).success,
    true,
  );
  assert.equal(
    networkEntitySchema.safeParse({
      ...base,
      type: 'junction',
      geometry: { type: 'Point', coordinates: [69.1, 41.1, 100] },
    }).success,
    false,
  );
});

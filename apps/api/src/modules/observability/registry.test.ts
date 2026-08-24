import assert from 'node:assert/strict';
import test from 'node:test';
import { InProcessOperationalMetricsRegistry, normalizeMetricRoute } from './registry.js';

test('registry records only bounded route-template API error labels and explicit API outcomes', () => {
  const registry = new InProcessOperationalMetricsRegistry();
  registry.recordResponse('/api/v1/observations', 201, JSON.stringify({ idempotent: false }));
  registry.recordResponse('/api/v1/observations', 200, { idempotent: true });
  registry.recordResponse('/api/v1/observations/:lineageId/validate', 200, { outcome: 'applied' });
  registry.recordResponse('/api/v1/observations/:lineageId/validate', 200, { outcome: 'deferred' });
  registry.recordResponse('/api/v1/observations/:lineageId', 404, {
    error: { code: 'NOT_FOUND' },
  });
  registry.recordResponse('/api/v1/observations/123e4567-e89b-42d3-a456-426614174000', 500, {});

  assert.deepEqual(registry.snapshot(), {
    apiErrors: [
      {
        route: '/api/v1/observations/:lineageId',
        statusClass: '4xx',
        code: 'NOT_FOUND',
        count: 1,
      },
      { route: 'unmatched', statusClass: '5xx', code: 'unclassified', count: 1 },
    ],
    observationIngestion: { accepted: 1, idempotent: 1 },
    validation: { applied: 1, deferred: 1 },
  });
  assert.equal(
    normalizeMetricRoute('/api/v1/items/123e4567-e89b-42d3-a456-426614174000'),
    'unmatched',
  );
});

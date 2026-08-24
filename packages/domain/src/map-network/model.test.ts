import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedDirectedTrace } from './model.js';

test('directed traversal preserves a deterministic branch and merge without reversing flow', () => {
  const edges = [
    { id: 'a', from: 'A', to: 'B' },
    { id: 'b', from: 'A', to: 'C' },
    { id: 'c', from: 'B', to: 'D' },
    { id: 'd', from: 'C', to: 'D' },
    { id: 'loop', from: 'D', to: 'A' },
  ];
  const first = boundedDirectedTrace('A', edges, 'downstream', 4);
  const second = boundedDirectedTrace('A', edges, 'downstream', 4);
  assert.deepEqual(first, second);
  assert.deepEqual(first.nodes, ['A', 'B', 'C', 'D']);
  assert.deepEqual(
    first.edges.map((edge) => edge.id),
    ['a', 'b', 'c', 'd'],
  );
  assert.equal(first.truncated, true);
  assert.deepEqual(boundedDirectedTrace('D', edges, 'upstream').nodes, ['D', 'B', 'C', 'A']);
});

test('bounded traversal stops at its cap without introducing arbitrary nodes', () => {
  const result = boundedDirectedTrace(
    'A',
    [
      { id: 'a', from: 'A', to: 'B' },
      { id: 'b', from: 'A', to: 'C' },
    ],
    'downstream',
    1,
  );
  assert.deepEqual(
    result.edges.map((edge) => edge.id),
    ['a'],
  );
  assert.deepEqual(result.nodes, ['A', 'B']);
  assert.equal(result.truncated, true);
});

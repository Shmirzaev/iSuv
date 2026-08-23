import assert from 'node:assert/strict';
import test from 'node:test';
import { coverageState, evaluateObservationValidation } from './model.js';

const candidate = {
  measurementKind: 'stage' as const,
  value: '1.0',
  observedAt: '2026-08-23T00:00:00.000000Z',
  ingestedAt: '2026-08-23T00:00:00.000000Z',
  rawQualityState: 'unknown' as const,
  totalizerTransition: null,
};
test('validation evaluator defers fresh unknowns unless substantive evidence is evaluated', () => {
  assert.equal(
    evaluateObservationValidation(
      {},
      { candidate, preceding: [], arrivedOutOfOrder: false, evaluationAt: candidate.observedAt },
    ).deferred,
    true,
  );
  assert.equal(
    evaluateObservationValidation(
      { staleAfterSeconds: 1 },
      {
        candidate,
        preceding: [],
        arrivedOutOfOrder: false,
        evaluationAt: '2026-08-23T00:00:02.000000Z',
      },
    ).qualityState,
    'suspect',
  );
  assert.equal(
    evaluateObservationValidation(
      { lateAfterSeconds: 1 },
      {
        candidate: { ...candidate, ingestedAt: '2026-08-23T00:00:02.000000Z' },
        preceding: [],
        arrivedOutOfOrder: false,
        evaluationAt: candidate.observedAt,
      },
    ).qualityState,
    'suspect',
  );
  assert.equal(
    evaluateObservationValidation(
      { maximumRatePerSecond: '0.1' },
      {
        candidate: { ...candidate, value: '2.0', observedAt: '2026-08-23T00:00:10.000000Z' },
        preceding: [{ value: '0.0', observedAt: candidate.observedAt }],
        arrivedOutOfOrder: false,
        evaluationAt: '2026-08-23T00:00:10.000000Z',
      },
    ).qualityState,
    'invalid',
  );
});
test('counter transitions are explicit and coverage never creates a zero', () => {
  const counter = {
    ...candidate,
    measurementKind: 'accumulated_volume' as const,
    value: '2',
    totalizerTransition: 'normal' as const,
  };
  assert.equal(
    evaluateObservationValidation(
      {},
      {
        candidate: counter,
        preceding: [{ value: '4', observedAt: '2026-08-22T23:59:00.000000Z' }],
        arrivedOutOfOrder: false,
        evaluationAt: counter.observedAt,
      },
    ).qualityState,
    'suspect',
  );
  assert.equal(
    evaluateObservationValidation(
      { acceptReportedCounterTransitions: true },
      {
        candidate: { ...counter, totalizerTransition: 'reset_reported' },
        preceding: [{ value: '4', observedAt: '2026-08-22T23:59:00.000000Z' }],
        arrivedOutOfOrder: false,
        evaluationAt: counter.observedAt,
      },
    ).qualityState,
    'valid',
  );
  assert.equal(coverageState({ configured: true, expectedCount: 1, observedCount: 0 }), 'no_data');
  assert.equal(
    coverageState({ configured: false, expectedCount: 1, observedCount: 0 }),
    'unconfigured',
  );
  assert.equal(
    coverageState({ configured: true, expectedCount: 3, observedCount: 2 }),
    'incomplete',
  );
  assert.equal(coverageState({ configured: true, expectedCount: 2, observedCount: 2 }), 'complete');
});
test('microsecond rate boundaries, frozen runs, and out-of-order evidence stay deterministic', () => {
  const at = '2026-08-23T00:00:00.000001Z';
  const base = { ...candidate, value: '1.000001', observedAt: at, ingestedAt: at };
  assert.equal(
    evaluateObservationValidation(
      { maximumRatePerSecond: '1' },
      {
        candidate: base,
        preceding: [{ value: '1.000000', observedAt: '2026-08-23T00:00:00.000000Z' }],
        arrivedOutOfOrder: false,
        evaluationAt: at,
      },
    ).qualityState,
    'valid',
  );
  assert.equal(
    evaluateObservationValidation(
      { maximumRatePerSecond: '0.999999' },
      {
        candidate: base,
        preceding: [{ value: '1.000000', observedAt: '2026-08-23T00:00:00.000000Z' }],
        arrivedOutOfOrder: false,
        evaluationAt: at,
      },
    ).qualityState,
    'invalid',
  );
  assert.equal(
    evaluateObservationValidation(
      { frozenAfterCount: 3 },
      {
        candidate: base,
        preceding: [
          { value: base.value, observedAt: '2026-08-22T23:59:59.000000Z' },
          { value: base.value, observedAt: '2026-08-22T23:59:58.000000Z' },
        ],
        arrivedOutOfOrder: false,
        evaluationAt: at,
      },
    ).qualityState,
    'suspect',
  );
  assert.equal(
    evaluateObservationValidation(
      { staleAfterSeconds: 600 },
      { candidate: base, preceding: [], arrivedOutOfOrder: true, evaluationAt: at },
    ).qualityState,
    'suspect',
  );
});
test('fresh temporal-only and context-dependent readings defer without governed evidence, bounded bootstrap is explicit', () => {
  assert.equal(
    evaluateObservationValidation(
      { staleAfterSeconds: 60 },
      { candidate, preceding: [], arrivedOutOfOrder: false, evaluationAt: candidate.observedAt },
    ).deferred,
    true,
  );
  assert.equal(
    evaluateObservationValidation(
      { maximumRatePerSecond: '1', minimumValue: '0', maximumValue: '2' },
      { candidate, preceding: [], arrivedOutOfOrder: false, evaluationAt: candidate.observedAt },
    ).deferred,
    true,
  );
  const bootstrap = evaluateObservationValidation(
    {
      maximumRatePerSecond: '1',
      minimumValue: '0',
      maximumValue: '2',
      allowBootstrapWithoutPrior: true,
    },
    { candidate, preceding: [], arrivedOutOfOrder: false, evaluationAt: candidate.observedAt },
  );
  assert.equal(bootstrap.deferred, false);
  assert.equal(bootstrap.evidence.includes('bootstrap_without_prior'), true);
  const freshCounter = {
    ...candidate,
    measurementKind: 'accumulated_volume' as const,
    value: '5',
    totalizerTransition: 'normal' as const,
  };
  assert.equal(
    evaluateObservationValidation(
      { minimumValue: '0', maximumValue: '10', allowBootstrapWithoutPrior: true },
      {
        candidate: freshCounter,
        preceding: [],
        arrivedOutOfOrder: false,
        evaluationAt: candidate.observedAt,
      },
    ).deferred,
    true,
  );
});

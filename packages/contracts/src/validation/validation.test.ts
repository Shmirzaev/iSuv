import assert from 'node:assert/strict';
import test from 'node:test';
import { validationRulesSchema } from './validation.js';

test('validation rules require explicit, exact bounded bootstrap semantics', () => {
  assert.equal(validationRulesSchema.safeParse({ minimumValue: '-1.000001' }).success, true);
  assert.equal(
    validationRulesSchema.safeParse({ allowBootstrapWithoutPrior: true }).success,
    false,
  );
  assert.equal(
    validationRulesSchema.safeParse({ minimumValue: '2', maximumValue: '1' }).success,
    false,
  );
  assert.equal(validationRulesSchema.safeParse({ unknownRule: 1 }).success, false);
  assert.equal(
    validationRulesSchema.safeParse({ minimumValue: '0', allowBootstrapWithoutPrior: true })
      .success,
    true,
  );
});

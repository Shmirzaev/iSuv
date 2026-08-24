import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, csvCell, escapeHtml, reportFingerprint } from './model.js';
test('report serialization is deterministic and export-safe', () => {
  assert.equal(canonicalJson({ b: 1, a: ['x'] }), '{"a":["x"],"b":1}');
  assert.equal(reportFingerprint({ a: 1 }), reportFingerprint({ a: 1 }));
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell('\t=1+1'), '"\'\t=1+1"');
  assert.equal(csvCell('\rformula'), '"\'\rformula"');
  assert.equal(escapeHtml('<x>'), '&lt;x&gt;');
});

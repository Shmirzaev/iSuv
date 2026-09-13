import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterReferenceRecords,
  referenceCounts,
  regionalReferenceData,
} from './regional-reference-data.js';

const record = (row: number) =>
  regionalReferenceData.records.find(
    (item) => item.sourceId === 'savay-register' && item.row === row,
  )!;

test('reference import preserves both sources and excludes only genuinely empty placeholders', () => {
  assert.equal(regionalReferenceData.records.length, 64);
  assert.deepEqual(referenceCounts, { savay: 60, oqbura: 3, supplement: 1, unnamed: 1 });
  assert.equal(new Set(regionalReferenceData.records.map((item) => item.id)).size, 64);
  assert.equal(record(46).name, null);
  assert.equal(record(46).raw.smartWater, 'йук');
  assert.equal(regionalReferenceData.sources[1]?.excludedPlaceholderRows, 16);
  for (const item of regionalReferenceData.records) {
    assert.equal(item.coordinates, null);
    assert.equal(item.observedAt, null);
    assert.equal(item.annualVolumeM3, null);
    assert.equal(item.sheet, 'Sheet1');
    assert.ok(
      regionalReferenceData.sources.some(
        (source) => source.id === item.sourceId && /^[a-f0-9]{64}$/.test(source.sha256),
      ),
    );
  }
});

test('missing actual discharge never becomes zero or a calculated compliance percentage', () => {
  assert.equal(record(6).actualM3s, 0);
  assert.equal(record(6).derivedRatioPercent, 0);
  for (const row of [35, 60, 61, 62, 63, 64, 65]) {
    assert.equal(record(row).actualM3s, null);
    assert.equal(record(row).derivedRatioPercent, null);
    assert.equal(record(row).raw.ratio, 0);
    assert.ok(record(row).issues.includes('ratio_without_inputs'));
  }
  assert.equal(record(43).limitM3s, null);
  assert.equal(record(43).derivedRatioPercent, null);
  assert.ok(Math.abs(record(7).derivedRatioPercent! - 240.6417112299465) < 1e-10);
});

test('ambiguous source entries remain visible without guessed normalization', () => {
  assert.equal(record(23).raw.annualVolume, '58,449,6');
  assert.ok(record(23).issues.includes('annual_volume_ambiguous'));
  assert.equal(record(35).raw.capacity, '0,80/0,25');
  assert.equal(record(35).capacityM3s, null);
  assert.equal(record(48).raw.area, '1,32,2');
  assert.equal(record(48).areaHa, null);
  assert.equal(record(6).raw.area, 13.261);
  assert.equal(record(6).areaHa, null);
  assert.equal(record(59).areaHa, null);
  assert.equal(record(6).capacityM3s, 30);
  assert.equal(record(14).smartWater, 'missing');
  assert.ok(record(16).issues.includes('actual_above_stated_capacity'));
});

test('search and canal/source filters preserve independent register identities', () => {
  assert.equal(filterReferenceRecords('', 'oqbura', '').length, 3);
  assert.equal(filterReferenceRecords('', 'savay', 'savay-register').length, 60);
  assert.equal(filterReferenceRecords('Бирлашган', '', '')[0]?.sourceId, 'savay-supplement');
  assert.equal(filterReferenceRecords(' НАСОС ', '', '')[0]?.row, 35);
  assert.equal(filterReferenceRecords('no-such-reference', '', '').length, 0);
});

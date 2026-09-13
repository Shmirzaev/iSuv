import assert from 'node:assert/strict';
import test from 'node:test';
import { andijanScene, savayScene, viewForArea } from './regional-atlas-model.js';
import { filterReferenceRecords } from './regional-reference-data.js';

test('reference atlas uses illustration-space geometry and valid scene membership', () => {
  for (const scene of [andijanScene, savayScene]) {
    assert.equal(scene.width, 1280);
    assert.equal(new Set(scene.areas.map((item) => item.id)).size, scene.areas.length);
    assert.equal(new Set(scene.waterways.map((item) => item.id)).size, scene.waterways.length);
    const areaIds = new Set(scene.areas.map((item) => item.id));
    for (const water of scene.waterways) {
      assert.ok(water.areas.every((id) => areaIds.has(id)));
      assert.ok(water.path.startsWith('M'));
    }
    for (const area of scene.areas) {
      const [x, y, width, height] = viewForArea(area);
      assert.ok([x, y, width, height].every(Number.isFinite));
      assert.ok(width > 0 && height > 0);
      assert.ok(area.path.endsWith('Z'));
    }
    assert.doesNotMatch(
      JSON.stringify(scene),
      /latitude|longitude|stationId|deviceId|flowDirection/,
    );
  }
  assert.equal(andijanScene.areas.length, 5);
  assert.equal(savayScene.areas.length, 3);
});

test('only the two named supplied waterways link to the register; missing data is never invented', () => {
  for (const scene of [andijanScene, savayScene]) {
    const linked = scene.waterways.filter((water) => water.register);
    assert.equal(linked.length, 2);
    for (const water of linked) {
      const records = filterReferenceRecords('', water.register!, '');
      assert.equal(records.length, water.register === 'savay' ? 61 : 3);
      assert.ok(
        records.every((record) => record.coordinates === null && record.observedAt === null),
      );
    }
  }
});

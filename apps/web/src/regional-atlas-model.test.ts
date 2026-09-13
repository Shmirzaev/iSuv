import assert from 'node:assert/strict';
import test from 'node:test';
import {
  andijanScene,
  savayScene,
  viewForArea,
  displayWaterwayPath,
} from './regional-atlas-model.js';
import { atlasDetail, visibleLandmarks } from './regional-atlas-detail.js';
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

test('detailed landmarks retain source labels and numbered source points never become Excel or telemetry identities', () => {
  assert.equal(atlasDetail.andijan.landmarks.length, 16);
  assert.equal(atlasDetail.andijan.lakes.length, 3);
  const details = atlasDetail.savay.landmarks;
  assert.equal(details.filter((item) => item.kind === 'settlement').length, 30);
  assert.equal(details.filter((item) => item.kind === 'pump').length, 3);
  assert.deepEqual(
    details.filter((item) => item.kind === 'point').map((item) => item.name),
    Array.from({ length: 33 }, (_, i) => String(i + 1)),
  );
  for (const [id, scene] of Object.entries(atlasDetail)) {
    assert.equal(new Set(scene.landmarks.map((item) => item.id)).size, scene.landmarks.length);
    for (const item of scene.landmarks) {
      assert.ok(item.sourceLabel.length > 0);
      assert.ok(item.at.every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0));
      assert.ok(item.at[0] <= 1280 && item.at[1] <= (id === 'savay' ? 905 : 870));
    }
  }
  assert.doesNotMatch(
    JSON.stringify(atlasDetail),
    /latitude|longitude|sensorId|deviceId|observedAt|registerId/,
  );
});

test('layer filtering and zoom reveal detail without changing source geometry', () => {
  assert.equal(visibleLandmarks('savay', true, false, false, true).length, 33);
  assert.equal(visibleLandmarks('savay', true, false, true, false).length, 3);
  assert.equal(visibleLandmarks('savay', true, false, false, false).length, 0);
  assert.ok(
    visibleLandmarks('savay', true, true, false, false).length >
      visibleLandmarks('savay', false, true, false, false).length,
  );
  assert.equal(displayWaterwayPath('M0 0 L10 10'), 'M0 0 L10 10');
  assert.equal(displayWaterwayPath('M0 0 Q10 0 10 10'), 'M0 0 Q10 0 10 10');
  assert.match(displayWaterwayPath('M0 0 L10 0 L10 10'), /^M0 0 L8.4 0 Q10 0 10 1.6 L10 10$/);
});

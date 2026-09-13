import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  andijanSourceIndex,
  sourceViews,
  fullSourceView,
  featureView,
  constrainCamera,
  zoomSource,
  type SourceView,
} from './andijan-source-model.js';

test('default Andijan source is the fingerprinted detailed PDF, not the irrigation screenshot or AI art', () => {
  const source = sourceViews['andijan-pdf'];
  assert.equal(source.asset, '/regional-maps/andijan-detailed.svg');
  assert.equal(
    andijanSourceIndex.sourceSha256,
    'acc3d11a437275ac098a7f9fb459eae385ae43d7fb48e3b7f40ac316d781445d',
  );
  assert.equal(andijanSourceIndex.drawingObjects, 3841);
  assert.equal(source.features.length, 41);
  assert.equal(source.features.filter((item) => item.kind === 'district').length, 14);
  assert.equal(new Set(source.features.map((item) => item.id)).size, 41);
  assert.ok(source.features.some((item) => item.sourceLabel === 'Андижон сув омбори'));
  assert.ok(source.features.some((item) => item.sourceLabel === 'н.ст. Хонобод'));
  assert.ok(source.features.every((item) => !item.register));
  const vector = readFileSync(
    new URL('../public/regional-maps/andijan-detailed.svg', import.meta.url),
  );
  assert.equal(createHash('sha256').update(vector).digest('hex'), andijanSourceIndex.assetSha256);
  assert.doesNotMatch(
    vector.toString(),
    /<(script|foreignObject|a|style)\b|\son\w+=|(?:xlink:)?href="(?:https?:|javascript:|\/\/)/i,
  );
  assert.match(vector.toString(), /viewBox="0 0 841.92 595.32"/);
});

test('each map uses its own source coordinate space and safe navigable label positions', () => {
  for (const view of Object.keys(sourceViews) as SourceView[]) {
    const scene = sourceViews[view];
    assert.equal(new Set(scene.features.map((item) => item.id)).size, scene.features.length);
    for (const feature of scene.features) {
      assert.ok(feature.at[0] >= 0 && feature.at[0] <= scene.width);
      assert.ok(feature.at[1] >= 0 && feature.at[1] <= scene.height);
      assert.ok(feature.bounds[2] > 0 && feature.bounds[3] > 0);
      const camera = featureView(view, feature);
      assert.ok(camera.every(Number.isFinite));
      assert.ok(camera[2] < scene.width);
      assert.ok(feature.at[0] >= camera[0] && feature.at[0] <= camera[0] + camera[2]);
      assert.ok(feature.at[1] >= camera[1] && feature.at[1] <= camera[1] + camera[3]);
    }
    assert.doesNotMatch(JSON.stringify(scene), /latitude|longitude|stationId|deviceId|observation/);
  }
  const savay = sourceViews.savay.features;
  assert.equal(savay.filter((item) => item.kind === 'point').length, 33);
  assert.equal(savay.filter((item) => item.kind === 'pump').length, 3);
  assert.deepEqual(
    savay
      .filter((item) => item.register)
      .map((item) => item.register)
      .sort(),
    ['oqbura', 'savay'],
  );
});

test('zoom preserves its pointer anchor, stays bounded and keeps a consistent aspect ratio', () => {
  for (const view of Object.keys(sourceViews) as SourceView[]) {
    const full = fullSourceView(view);
    const at: [number, number] = [full[2] / 2, full[3] / 2];
    const close = zoomSource(view, full, 0.5, at);
    assert.equal(close[2], full[2] / 2);
    assert.equal(close[0] + close[2] / 2, at[0]);
    assert.equal(close[1] + close[3] / 2, at[1]);
    for (const factor of [0.00001, 1000]) {
      const camera = zoomSource(view, full, factor);
      assert.ok(camera[2] >= full[2] / 16 && camera[2] <= full[2] * 1.3);
      assert.ok(Math.abs(camera[3] / camera[2] - full[3] / full[2]) < 0.00001);
    }
    const bounded = constrainCamera(view, [100000, -100000, full[2], full[3]]);
    assert.ok(bounded[0] < full[2] && bounded[1] > -full[3]);
  }
});

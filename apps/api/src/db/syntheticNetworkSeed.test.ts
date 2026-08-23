import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSyntheticNetworkSeed,
  syntheticDataClassification,
  syntheticHotspotCodePrefix,
  syntheticNetworkSeedCounts,
} from './syntheticNetworkSeed.js';

test('deterministic synthetic network generator produces 83 connected rooted DAG fixtures', () => {
  const first = buildSyntheticNetworkSeed();
  const second = buildSyntheticNetworkSeed();
  assert.deepEqual(first, second);
  assert.deepEqual(syntheticNetworkSeedCounts(first), {
    hotspots: 83,
    regions: 1,
    basins: 5,
    waterways: 88,
    junctions: 493,
    sections: 571,
    controlStructures: 83,
    stations: 83,
    devices: 83,
    installations: 83,
    sensors: 249,
  });

  const identifiers = [
    ...first.regions,
    ...first.basins,
    ...first.waterways,
    ...first.junctions,
    ...first.sections,
    ...first.controlStructures,
    ...first.stations,
    ...first.devices,
    ...first.installations,
    ...first.sensors,
  ].map((record) => record.id);
  assert.equal(new Set(identifiers).size, identifiers.length);
  assert.equal(
    first.hotspotCodes.filter((code) => code.startsWith(syntheticHotspotCodePrefix)).length,
    83,
  );
  assert.equal(first.junctions.filter((junction) => junction.code.endsWith('-ENTRY')).length, 83);
  assert.equal(
    first.junctions.every(
      (junction) => junction.dataClassification === syntheticDataClassification,
    ),
    true,
  );
  assert.equal(
    first.sensors.every((sensor) => sensor.dataClassification === syntheticDataClassification),
    true,
  );
  assert.deepEqual(
    new Set(first.sensors.map((sensor) => `${sensor.measurementKind}:${sensor.unit}`)),
    new Set(['stage:m', 'discharge:m3/s', 'accumulated_volume:m3']),
  );
  assert.equal(new Set(first.junctions.map((junction) => junction.territoryId)).size, 2);

  for (const code of first.hotspotCodes) {
    const waterway = first.waterways.find((candidate) => candidate.hotspotCode === code);
    assert.ok(waterway);
    const sections = first.sections.filter((section) => section.waterwayId === waterway.id);
    assert.equal(sections.length, 5);
    const entry = first.junctions.find((junction) => junction.code === `${code}-ENTRY`);
    assert.ok(entry);
    assert.equal(
      sections.some((section) => section.downstreamJunctionId === entry.id),
      false,
    );
    assert.equal(sections.filter((section) => section.upstreamJunctionId === entry.id).length, 1);
    assert.equal(
      [...new Set(sections.map((section) => section.upstreamJunctionId))].some(
        (junctionId) =>
          sections.filter((section) => section.upstreamJunctionId === junctionId).length >= 2,
      ),
      true,
    );
    assert.equal(
      [...new Set(sections.map((section) => section.downstreamJunctionId))].some(
        (junctionId) =>
          sections.filter((section) => section.downstreamJunctionId === junctionId).length >= 2,
      ),
      true,
    );
    const reachable = new Set([entry.id]);
    for (let pass = 0; pass < sections.length; pass += 1) {
      for (const section of sections) {
        if (reachable.has(section.upstreamJunctionId)) reachable.add(section.downstreamJunctionId);
      }
    }
    assert.equal(reachable.size, 5);
    const station = first.stations.find((candidate) => candidate.hotspotCode === code);
    assert.equal(station?.junctionId, entry.id);
    const installation = first.installations.find(
      (candidate) => candidate.stationId === station?.id,
    );
    assert.ok(installation);
    assert.equal(
      first.sensors.filter((sensor) => sensor.deviceId === installation.deviceId).length,
      3,
    );
  }

  const junctionById = new Map(first.junctions.map((junction) => [junction.id, junction]));
  const basinByWaterway = new Map(
    first.waterways.map((waterway) => [waterway.id, waterway.basinId]),
  );
  const crossBasinIds = new Set(
    first.sections
      .filter((section) => {
        const upstream = junctionById.get(section.upstreamJunctionId)!;
        const downstream = junctionById.get(section.downstreamJunctionId)!;
        return (
          section.territoryId !== upstream.territoryId ||
          section.territoryId !== downstream.territoryId
        );
      })
      .map((section) => basinByWaterway.get(section.waterwayId)!),
  );
  assert.equal(crossBasinIds.size, 5);
  for (const basin of first.basins) {
    const basinWaterways = first.waterways.filter((waterway) => waterway.basinId === basin.id);
    const basinSections = first.sections.filter((section) =>
      basinWaterways.some((waterway) => waterway.id === section.waterwayId),
    );
    const outlet = first.junctions.find((junction) => junction.code === `${basin.code}-OUTLET`);
    assert.ok(outlet);
    const entries = first.hotspotCodes
      .filter(
        (code) =>
          first.waterways.find((waterway) => waterway.hotspotCode === code)?.basinId === basin.id,
      )
      .map((code) => first.junctions.find((junction) => junction.code === `${code}-ENTRY`)!);
    const crossTerritorySections = basinSections.filter((section) => {
      const upstream = junctionById.get(section.upstreamJunctionId)!;
      const downstream = junctionById.get(section.downstreamJunctionId)!;
      return upstream.territoryId !== downstream.territoryId;
    });
    assert.equal(crossTerritorySections.length, 1);
    assert.equal(entries.length >= 16, true);
    for (const entry of entries) {
      const reachable = new Set([entry.id]);
      for (let pass = 0; pass < basinSections.length; pass += 1) {
        for (const section of basinSections) {
          if (reachable.has(section.upstreamJunctionId))
            reachable.add(section.downstreamJunctionId);
        }
      }
      assert.equal(reachable.has(outlet.id), true);
    }
  }
});

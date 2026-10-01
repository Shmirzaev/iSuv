import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  RegionalReferenceWorkspace,
  ReferenceRecordDetail,
  RegionalMapWorkspace,
  regionalMapView,
} from './regional-reference.js';
import { regionalReferenceData } from './regional-reference-data.js';
import { regionalWords } from './regional-reference-i18n.js';
import { sourceMapWords } from './andijan-source-i18n.js';

test('regional workspace renders supplied map controls and reference distinctions in every locale', () => {
  for (const locale of ['en', 'ru', 'uz'] as const) {
    const w = regionalWords[locale];
    const html = renderToStaticMarkup(<RegionalReferenceWorkspace locale={locale} />);
    assert.ok(html.includes(w.supplied));
    assert.ok(html.includes(w.note));
    assert.ok(html.includes(w.zoomIn));
    assert.ok(html.includes(w.register));
    assert.ok(html.includes(sourceMapWords[locale].reference));
    assert.ok(html.includes(sourceMapWords[locale].hint));
    assert.match(html, /data-source-view="andijan-pdf"/);
    assert.match(html, /href="\/regional-maps\/andijan-detailed.svg"/);
    assert.doesNotMatch(html, /atlas-terrain.png/);
    assert.match(html, /src="\/regional-maps\/savay-area.webp"/);
    assert.match(html, /value="fergana-valley"/);
    assert.match(html, /class="source-map-finder"/);
    assert.match(html, /Харита.pdf/);
    assert.equal((html.match(/data-kind="district"/g) ?? []).length, 14);
    assert.ok(!html.includes('SYN-HOTSPOT'));
  }
});

test('detail shows original ambiguous evidence and missing timestamp without a live status', () => {
  const record = regionalReferenceData.records.find(
    (item) => item.sourceId === 'savay-register' && item.row === 23,
  )!;
  const html = renderToStaticMarkup(<ReferenceRecordDetail record={record} locale="en" />);
  assert.match(html, /58,449,6/);
  assert.match(html, /Sheet1!A23:I23/);
  assert.match(html, /not a live reading/);
  assert.match(html, /no station pin has been invented/);
  assert.match(html, /not an approved allocation plan/);
  assert.match(html, /Annual-volume scale is unconfirmed/);
});

test('default map lazy-loads supplied network without presenting operational data as authenticated', () => {
  const html = renderToStaticMarkup(
    <RegionalMapWorkspace
      access="unavailable"
      locale="en"
      selection={{ stationId: null, deviceId: null }}
      onSelection={() => undefined}
    />,
  );
  assert.match(html, /Andijan water network/);
  assert.match(html, /#map\?view=reference/);
  assert.match(html, /#map\?view=demo/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /SYN-HOTSPOT/);
});

test('map routes retain regional references and selected synthetic network deep links', () => {
  assert.equal(regionalMapView('#map'), 'andijan');
  assert.equal(regionalMapView('#map?view=reference'), 'reference');
  assert.equal(regionalMapView('#map?view=demo'), 'demo');
  assert.equal(regionalMapView('#map?stationId=station', true), 'demo');
});

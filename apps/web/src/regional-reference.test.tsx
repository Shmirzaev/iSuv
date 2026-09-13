import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  RegionalReferenceWorkspace,
  ReferenceRecordDetail,
  RegionalMapWorkspace,
} from './regional-reference.js';
import { regionalReferenceData } from './regional-reference-data.js';
import { regionalWords } from './regional-reference-i18n.js';
import { atlasWords } from './regional-atlas-i18n.js';

test('regional workspace renders supplied map controls and reference distinctions in every locale', () => {
  for (const locale of ['en', 'ru', 'uz'] as const) {
    const w = regionalWords[locale];
    const html = renderToStaticMarkup(<RegionalReferenceWorkspace locale={locale} />);
    assert.ok(html.includes(w.supplied));
    assert.ok(html.includes(w.note));
    assert.ok(html.includes(w.zoomIn));
    assert.ok(html.includes(w.register));
    assert.ok(html.includes(atlasWords[locale].reference));
    assert.ok(html.includes(atlasWords[locale].hint));
    assert.match(html, /data-scene="andijan"/);
    assert.match(html, /href="\/regional-maps\/atlas-terrain.png"/);
    assert.match(html, /src="\/regional-maps\/savay-area.webp"/);
    assert.equal((html.match(/<option /g) ?? []).length, 5);
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

test('bundled references remain readable without presenting unavailable operational data as authenticated', () => {
  const html = renderToStaticMarkup(
    <RegionalMapWorkspace
      access="unavailable"
      locale="en"
      selection={{ stationId: null, deviceId: null }}
      onSelection={() => undefined}
    />,
  );
  assert.match(html, /Supplied reference data/);
  assert.match(html, /regional-maps\/savay-area.webp/);
  assert.doesNotMatch(html, /SYN-HOTSPOT/);
});

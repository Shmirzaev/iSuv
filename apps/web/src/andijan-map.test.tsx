import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { andijanMapLayerLabels, andijanMapPointLabels, andijanMapWords } from '@isuv/i18n';
import AndijanMap from './andijan-map.js';
import { ANDIJAN_LAYERS, ANDIJAN_POINT_TYPES } from './andijan-map-model.js';

test('Andijan map loading chrome is labelled in every locale and renders without window or Leaflet', () => {
  for (const locale of ['uz', 'ru', 'en'] as const) {
    const html = renderToStaticMarkup(<AndijanMap locale={locale} />);
    assert.ok(html.includes(andijanMapWords[locale].loading));
    assert.match(html, /role="status"/);
    assert.match(html, /aria-label=/);
    assert.doesNotMatch(html, /leaflet-container|SYN-HOTSPOT|REPORTED/);
  }
});

test('localized layer chrome preserves every original Uzbek label and point category', () => {
  assert.equal(
    andijanMapWords.uz.selectedPilotDetail,
    'Hujjatda: 11,1 km uzunlik, 10 m³/s loyihaviy quvvat. KMZda kanal konturi ko‘rsatilgan.',
  );
  for (const layer of ANDIJAN_LAYERS) {
    const id = layer.id as keyof typeof andijanMapLayerLabels.uz;
    assert.equal(andijanMapLayerLabels.uz[id], layer.label);
    assert.ok(andijanMapLayerLabels.en[id]);
    assert.ok(andijanMapLayerLabels.ru[id]);
  }
  for (const [id, [label]] of Object.entries(ANDIJAN_POINT_TYPES)) {
    const key = id as keyof typeof andijanMapPointLabels.uz;
    assert.equal(andijanMapPointLabels.uz[key], label);
    assert.ok(andijanMapPointLabels.en[key]);
    assert.ok(andijanMapPointLabels.ru[key]);
  }
});

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import { WorkspaceHeader } from './workspace-header.js';

test('workspace header keeps provenance available in a closed native disclosure', () => {
  const markup = renderToStaticMarkup(
    <WorkspaceHeader
      heading="Operations"
      headingId="operations-heading"
      locale="en"
      provenance={<p>Scenario evidence</p>}
    />,
  );
  assert.match(markup, /<header class="workspace-header">/);
  assert.match(markup, /<h2 id="operations-heading">Operations<\/h2>/);
  assert.match(markup, /<details class="workspace-header__provenance">/);
  assert.doesNotMatch(markup, /<details[^>]+open/);
});

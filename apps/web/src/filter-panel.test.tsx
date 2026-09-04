import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import { FilterPanel } from './filter-panel.js';

test('filter panel starts collapsed and exposes filter count and removable choices', () => {
  const markup = renderToStaticMarkup(
    <FilterPanel
      activeFilters={[{ id: 'quality', label: 'Validated', onRemove: () => undefined }]}
      clearLabel="Clear"
      filtersLabel="Filters"
    >
      <label>
        State{' '}
        <select>
          <option>All</option>
        </select>
      </label>
    </FilterPanel>,
  );
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /Filters \(1\)/);
  assert.match(markup, /class="filter-chip">Validated/);
  assert.match(markup, /hidden=""/);
});

test('collapsed filter content cannot be made visible by the panel layout rules', async () => {
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.filter-panel__content\[hidden\]\s*\{\s*display: none !important;/);
  assert.match(styles, /grid-template-columns: repeat\(auto-fill, minmax\(12rem, 1fr\)\);/);
});

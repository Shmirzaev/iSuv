import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { locales, projectPageWords, translate } from '@isuv/i18n';
import { accessibleNavigationItems } from './app-model.js';
import { meteringPoints, projectMilestones } from './project-pages-model.js';
import { ProjectOverviewPage, ProjectRoadmapPage } from './project-pages.js';
import { ShellChrome } from './shell-semantics.js';

test('both project pages render complete localized content without browser or API dependencies', () => {
  for (const locale of locales) {
    const words = projectPageWords[locale];
    const overview = renderToStaticMarkup(<ProjectOverviewPage locale={locale} />);
    const roadmap = renderToStaticMarkup(<ProjectRoadmapPage locale={locale} />);
    for (const [html, title] of [
      [overview, words.title],
      [roadmap, words.roadmapTitle],
    ] as const) {
      assert.ok(html.includes(title));
      assert.equal(html.match(/<h1\b/g)?.length, 1);
      assert.ok(html.includes(words.footerNote));
      assert.doesNotMatch(html, /investor|investment|pitch|инвестор|инвести|dahana|даҳана|дахана/i);
    }
    assert.doesNotMatch(overview, /<table\b/);
    assert.match(overview, /role="img" aria-label=/);
    assert.match(overview, /href="#map"/);
    for (const unit of ['m', 'm³/s', 'm³']) assert.ok(overview.includes(unit));
    for (const milestone of projectMilestones) {
      assert.ok(roadmap.includes(words[milestone.status]));
      assert.ok(roadmap.includes(words[milestone.date]));
    }
  }
});

test('every locale has exactly the same nonempty project keys', () => {
  const expectedKeys = Object.keys(projectPageWords.en).sort();
  for (const locale of locales) {
    assert.deepEqual(Object.keys(projectPageWords[locale]).sort(), expectedKeys);
    for (const [key, value] of Object.entries(projectPageWords[locale])) {
      assert.ok(value.trim().length > 0, `${locale}.${key}`);
      assert.doesNotMatch(
        value,
        /investor|investment|pitch|инвестор|инвести|dahana|даҳана|дахана/i,
      );
    }
    assert.ok(translate(locale, 'navProject').trim());
    assert.ok(translate(locale, 'navRoadmap').trim());
  }
});

test('metering model preserves head, 17 numbered outlets, tail and proposed tiers', () => {
  assert.equal(meteringPoints.length, 19);
  assert.equal(new Set(meteringPoints.map((point) => point.id)).size, 19);
  assert.deepEqual(
    meteringPoints.filter((point) => point.kind === 'head').map((point) => point.tier),
    ['A'],
  );
  assert.deepEqual(
    meteringPoints.filter((point) => point.kind === 'tail').map((point) => point.tier),
    ['B'],
  );
  const outlets = meteringPoints.filter((point) => point.kind === 'outlet');
  assert.deepEqual(
    outlets.map((point) => point.number),
    Array.from({ length: 17 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    outlets.map((point) => point.tier),
    [...Array<string>(6).fill('B'), ...Array<string>(11).fill('C')],
  );
});

test('project and roadmap navigation is public without a session', () => {
  const navigation = accessibleNavigationItems(null);
  for (const area of ['project', 'roadmap'] as const) {
    assert.ok(navigation.some((item) => item.area === area && item.href === `#${area}`));
    for (const locale of locales) {
      const html = renderToStaticMarkup(
        <ShellChrome
          area={area}
          locale={locale}
          navigation={navigation}
          onAreaChange={() => undefined}
          onLocaleChange={() => undefined}
          onThemeChange={() => undefined}
          session={null}
          theme="light"
        />,
      );
      assert.ok(html.includes(`aria-current="page" href="#${area}"`));
      assert.ok(html.includes(`data-icon="${area}"`));
      assert.ok(html.includes(translate(locale, area === 'project' ? 'navProject' : 'navRoadmap')));
      assert.doesNotMatch(html, /<path><\/path>/);
    }
  }
});

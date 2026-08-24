import { strict as assert } from 'node:assert';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import { navigationItems, skipTargetId } from './app-model.js';
import { ShellChrome, StatusVocabulary } from './shell-semantics.js';

test('rendered shell exposes native keyboard navigation, landmarks, locale controls, and current status', () => {
  const markup = renderToStaticMarkup(
    <ShellChrome
      area="dashboard"
      locale="en"
      navigation={navigationItems}
      onAreaChange={() => undefined}
      onLocaleChange={() => undefined}
    />,
  );
  assert.match(
    markup,
    new RegExp(`<a class="skip-link" href="#${skipTargetId}">Skip to main content</a>`),
  );
  assert.match(markup, /<header class="site-header">/);
  assert.match(markup, /<nav aria-label="Primary navigation" class="primary-navigation">/);
  assert.match(markup, /<input[^>]+type="radio"[^>]+value="uz"/);
  assert.match(markup, /<a aria-current="page" href="#dashboard">Dashboard<\/a>/);
  assert.match(markup, /href="#alarms">Alarms and incidents<\/a>/);
});

test('status vocabulary renders distinct text, icon, and explicit synthetic value samples', () => {
  const markup = renderToStaticMarkup(<StatusVocabulary locale="en" />);
  for (const [status, label] of [
    ['statusOver', 'Over'],
    ['statusOnPlan', 'On plan'],
    ['statusUnder', 'Under'],
    ['noData', 'No data'],
    ['deviceFault', 'Device fault / unreliable'],
  ]) {
    assert.match(
      markup,
      new RegExp(`data-status="${status}"[^>]*>[\\s\\S]*?<strong>${label}</strong>`),
    );
  }
  assert.equal((markup.match(/aria-hidden="true"/g) ?? []).length, 5);
  assert.match(markup, /Synthetic display examples only/);
  assert.match(markup, /No observation available/);
  assert.match(markup, /Not suitable for operational use/);
});

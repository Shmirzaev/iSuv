import { strict as assert } from 'node:assert';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import { navigationItems, skipTargetId } from './app-model.js';
import {
  ReferenceContent,
  ShellChrome,
  StatusVocabulary,
  SyntheticDisclosure,
} from './shell-semantics.js';

test('rendered shell exposes compact keyboard navigation, locale control, and current area', () => {
  const markup = renderToStaticMarkup(
    <ShellChrome
      area="dashboard"
      locale="en"
      navigation={navigationItems}
      onAreaChange={() => undefined}
      onLocaleChange={() => undefined}
      onThemeChange={() => undefined}
      session={null}
      theme="light"
    />,
  );
  assert.match(
    markup,
    new RegExp(`<a class="skip-link" href="#${skipTargetId}">Skip to main content</a>`),
  );
  assert.match(markup, /<aside class="app-sidebar" aria-label="Primary navigation">/);
  assert.match(markup, /<nav aria-label="Primary navigation" class="primary-navigation">/);
  assert.match(markup, /<select aria-label="Language">/);
  assert.match(markup, /<option value="uz">Uzbek<\/option>/);
  assert.match(
    markup,
    /class="eyebrow topbar__area-label">Current work area<\/span><strong class="topbar__area-name">Dashboard<\/strong>/,
  );
  assert.match(markup, /aria-label="Change color theme"[^>]*title="Change color theme"/);
  assert.match(
    markup,
    /aria-label="Identity and authorization"[^>]*title="Identity and authorization"/,
  );
  assert.match(markup, /aria-label="Toggle navigation"[^>]*title="Toggle navigation"/);
  assert.match(
    markup,
    /<a aria-current="page" href="#dashboard"[^>]*>[\s\S]*?Dashboard<\/span><\/a>/,
  );
  assert.match(markup, /href="#alarms"[^>]*>[\s\S]*?Alarms and incidents<\/span><\/a>/);
  assert.match(markup, /class="synthetic-badge"/);
});

test('shell dialog triggers advertise dialog behavior before their focus-managed popovers open', () => {
  const markup = renderToStaticMarkup(
    <ShellChrome
      area="dashboard"
      locale="en"
      navigation={navigationItems}
      onAreaChange={() => undefined}
      onLocaleChange={() => undefined}
      onThemeChange={() => undefined}
      session={null}
      theme="light"
    />,
  );

  assert.equal((markup.match(/aria-haspopup="dialog"/g) ?? []).length, 2);
  assert.match(markup, /aria-haspopup="dialog"[^>]*aria-label="Identity and authorization"/);
  assert.match(markup, /aria-haspopup="dialog"[^>]*>Reference<\/button>/);
});

test('full synthetic disclosure is visible until dismissed and retains safety meaning', () => {
  const visible = renderToStaticMarkup(
    <SyntheticDisclosure dismissed={false} locale="en" onDismiss={() => undefined} />,
  );
  assert.match(visible, /Synthetic demonstration data/);
  assert.match(visible, /Dismiss synthetic-data notice/);
  assert.equal(
    renderToStaticMarkup(<SyntheticDisclosure dismissed locale="en" onDismiss={() => undefined} />),
    '',
  );
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

test('the one shell reference retains all physical measurement boundaries', () => {
  const markup = renderToStaticMarkup(<ReferenceContent locale="en" />);
  for (const unit of ['metres (m)', 'cubic metres per second (m³/s)', 'cubic metres (m³)']) {
    assert.match(markup, new RegExp(unit.replace(/[()]/g, '\\$&')));
  }
});

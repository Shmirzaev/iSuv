import type { Dispatch, SetStateAction } from 'react';

import {
  languageName,
  skipTargetId,
  type ApplicationArea,
  type NavigationItem,
} from './app-model.js';
import { locales, translate, type Locale, type TranslationKey } from '@isuv/i18n';

interface ShellChromeProps {
  area: ApplicationArea;
  locale: Locale;
  navigation: readonly NavigationItem[];
  onAreaChange: Dispatch<SetStateAction<ApplicationArea>>;
  onLocaleChange: Dispatch<SetStateAction<Locale>>;
}

export function ShellChrome({
  area,
  locale,
  navigation,
  onAreaChange,
  onLocaleChange,
}: ShellChromeProps) {
  const t = (key: TranslationKey) => translate(locale, key);
  return (
    <>
      <a className="skip-link" href={`#${skipTargetId}`}>
        {t('skipToContent')}
      </a>
      <header className="site-header">
        <div>
          <p className="eyebrow">{t('applicationShortName')}</p>
          <h1>{t('applicationName')}</h1>
        </div>
        <fieldset className="language-picker">
          <legend>{t('language')}</legend>
          <div>
            {locales.map((option) => (
              <label key={option}>
                <input
                  checked={locale === option}
                  name="language"
                  onChange={() => onLocaleChange(option)}
                  type="radio"
                  value={option}
                />
                {t(languageName(option))}
              </label>
            ))}
          </div>
        </fieldset>
      </header>
      <nav aria-label={t('navigation')} className="primary-navigation">
        <ul>
          {navigation.map((item) => (
            <li key={item.area}>
              <a
                aria-current={area === item.area ? 'page' : undefined}
                href={item.href}
                onClick={() => onAreaChange(item.area)}
              >
                {t(item.label)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

export function StatusVocabulary({ locale }: { locale: Locale }) {
  const t = (key: TranslationKey) => translate(locale, key);
  const statuses = [
    { key: 'statusOver', icon: '↑', value: 'statusSyntheticExample' },
    { key: 'statusOnPlan', icon: '✓', value: 'statusSyntheticExample' },
    { key: 'statusUnder', icon: '↓', value: 'statusSyntheticExample' },
    { key: 'noData', icon: '—', value: 'statusNoObservation' },
    { key: 'deviceFault', icon: '!', value: 'statusUnreliableValue' },
  ] as const satisfies readonly {
    key: TranslationKey;
    icon: string;
    value: TranslationKey;
  }[];

  return (
    <section aria-labelledby="status-vocabulary-heading" className="status-vocabulary">
      <h3 id="status-vocabulary-heading">{t('statusVocabulary')}</h3>
      <p>{t('statusVocabularyDetail')}</p>
      <ul>
        {statuses.map((status) => (
          <li data-status={status.key} key={status.key}>
            <span aria-hidden="true" className="status-vocabulary__icon">
              {status.icon}
            </span>
            <strong>{t(status.key)}</strong>
            <span>{t(status.value)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

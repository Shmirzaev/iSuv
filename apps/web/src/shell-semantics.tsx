import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import type { Session } from '@isuv/contracts';
import { locales, translate, type Locale, type TranslationKey } from '@isuv/i18n';

import {
  areaLabel,
  languageName,
  roleKey,
  scopeKey,
  skipTargetId,
  type ApplicationArea,
  type NavigationItem,
} from './app-model.js';

export type Theme = 'light' | 'dark';

interface ShellChromeProps {
  area: ApplicationArea;
  locale: Locale;
  navigation: readonly NavigationItem[];
  onAreaChange: Dispatch<SetStateAction<ApplicationArea>>;
  onLocaleChange: Dispatch<SetStateAction<Locale>>;
  onThemeChange: Dispatch<SetStateAction<Theme>>;
  session: Session | null;
  theme: Theme;
}

const navIcons: Record<ApplicationArea, string> = {
  dashboard: '▦',
  operations: '◉',
  map: '⌁',
  alarms: '!',
  analytics: '▥',
  reports: '▤',
  audit: '◌',
};

function CloseOnEscape({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  return null;
}

/** Keeps dialog-popover focus with the surface that opened it. */
function usePopoverFocus(open: boolean) {
  const popoverRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      popoverRef.current?.focus();
      return;
    }

    if (wasOpen.current) {
      triggerRef.current?.focus();
      wasOpen.current = false;
    }
  }, [open]);

  return { popoverRef, triggerRef };
}

function UserMenu({ locale, session }: { locale: Locale; session: Session | null }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const { popoverRef, triggerRef } = usePopoverFocus(open);
  const t = (key: TranslationKey) => translate(locale, key);
  return (
    <div className="shell-menu">
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('identity')}
        className="shell-icon-button"
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        title={t('identity')}
        type="button"
      >
        <span aria-hidden="true">◉</span>
        <span className="visually-hidden">{t('identity')}</span>
      </button>
      {open ? <CloseOnEscape onClose={() => setOpen(false)} /> : null}
      {open ? (
        <section
          aria-labelledby={`${menuId}-heading`}
          className="shell-popover shell-popover--user"
          id={menuId}
          ref={popoverRef}
          role="dialog"
          tabIndex={-1}
        >
          <h2 id={`${menuId}-heading`}>{t('identity')}</h2>
          {session ? (
            <dl className="identity-details">
              <div>
                <dt>{t('signedInAs')}</dt>
                <dd>{session.user.displayName}</dd>
              </div>
              <div>
                <dt>{t('organization')}</dt>
                <dd>{session.organization.name}</dd>
              </div>
              <div className="identity-details__wide">
                <dt>{t('activeRoles')}</dt>
                <dd>
                  {session.currentGrants.length === 0 ? (
                    t('noActiveRoles')
                  ) : (
                    <ul className="grant-list">
                      {session.currentGrants.map((grant) => (
                        <li key={grant.id}>
                          <strong>{t(roleKey(grant.role))}</strong>
                          <span>{t(scopeKey(grant.scope))}</span>
                          {grant.territoryId ? (
                            <code title={grant.territoryId}>{grant.territoryId}</code>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
            </dl>
          ) : (
            <p>{t('identityCheckingDetail')}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

function ReferenceMenu({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const { popoverRef, triggerRef } = usePopoverFocus(open);
  const t = (key: TranslationKey) => translate(locale, key);
  return (
    <div className="shell-menu">
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="shell-reference-button"
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        title={t('reference')}
        type="button"
      >
        {t('reference')}
      </button>
      {open ? <CloseOnEscape onClose={() => setOpen(false)} /> : null}
      {open ? (
        <section
          aria-label={t('measurementBoundary')}
          className="shell-popover shell-popover--reference"
          id={menuId}
          ref={popoverRef}
          role="dialog"
          tabIndex={-1}
        >
          <ReferenceContent locale={locale} />
        </section>
      ) : null}
    </div>
  );
}

/** The shell's single authoritative measurement and status reference surface. */
export function ReferenceContent({ locale }: { locale: Locale }) {
  const t = (key: TranslationKey) => translate(locale, key);
  return (
    <>
      <h2>{t('measurementBoundary')}</h2>
      <dl className="measurement-list">
        <div>
          <dt>{t('stage')}</dt>
          <dd>{t('stageUnit')}</dd>
        </div>
        <div>
          <dt>{t('discharge')}</dt>
          <dd>{t('dischargeUnit')}</dd>
        </div>
        <div>
          <dt>{t('volume')}</dt>
          <dd>{t('volumeUnit')}</dd>
        </div>
      </dl>
      <StatusVocabulary locale={locale} />
    </>
  );
}

export function ShellChrome({
  area,
  locale,
  navigation,
  onAreaChange,
  onLocaleChange,
  onThemeChange,
  session,
  theme,
}: ShellChromeProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const t = (key: TranslationKey) => translate(locale, key);
  return (
    <>
      <a className="skip-link" href={`#${skipTargetId}`}>
        {t('skipToContent')}
      </a>
      <aside
        className={`app-sidebar${drawerOpen ? ' app-sidebar--open' : ''}`}
        aria-label={t('navigation')}
      >
        <a className="product-mark" href="#dashboard" onClick={() => onAreaChange('dashboard')}>
          <span aria-hidden="true" className="product-mark__icon">
            ≈
          </span>
          <span className="product-mark__wordmark">{t('applicationShortName')}</span>
        </a>
        <nav aria-label={t('navigation')} className="primary-navigation">
          <ul>
            {navigation.map((item) => (
              <li key={item.area}>
                <a
                  aria-current={area === item.area ? 'page' : undefined}
                  href={item.href}
                  onClick={() => {
                    onAreaChange(item.area);
                    setDrawerOpen(false);
                  }}
                  title={t(item.label)}
                >
                  <span aria-hidden="true" className="primary-navigation__icon">
                    {navIcons[item.area]}
                  </span>
                  <span>{t(item.label)}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      {drawerOpen ? (
        <button
          aria-label={t('menuClose')}
          className="app-sidebar-backdrop"
          onClick={() => setDrawerOpen(false)}
          type="button"
        />
      ) : null}
      <header className="topbar">
        <button
          aria-label={drawerOpen ? t('menuClose') : t('navigationToggle')}
          aria-expanded={drawerOpen}
          className="topbar__menu-button"
          onClick={() => setDrawerOpen((value) => !value)}
          title={drawerOpen ? t('menuClose') : t('navigationToggle')}
          type="button"
        >
          <span aria-hidden="true">☰</span>
          <span className="visually-hidden">
            {drawerOpen ? t('menuClose') : t('navigationToggle')}
          </span>
        </button>
        <div className="topbar__area">
          <span className="eyebrow topbar__area-label">{t('currentArea')}</span>
          <strong className="topbar__area-name">{t(areaLabel(area))}</strong>
        </div>
        <span aria-describedby="synthetic-badge-description" className="synthetic-badge">
          <span aria-hidden="true">◆</span>
          {t('syntheticBadge')}
        </span>
        <span className="visually-hidden" id="synthetic-badge-description">
          {t('syntheticBadgeDescription')}
        </span>
        <div className="topbar__actions">
          <label className="locale-select">
            <span className="visually-hidden">{t('language')}</span>
            <select
              aria-label={t('language')}
              onChange={(event) => onLocaleChange(event.target.value as Locale)}
              value={locale}
            >
              {locales.map((option) => (
                <option key={option} value={option}>
                  {t(languageName(option))}
                </option>
              ))}
            </select>
          </label>
          <button
            aria-label={t('themeToggle')}
            className="shell-icon-button"
            onClick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')}
            title={t('themeToggle')}
            type="button"
          >
            <span aria-hidden="true">{theme === 'light' ? '◐' : '☼'}</span>
          </button>
          <ReferenceMenu locale={locale} />
          <UserMenu locale={locale} session={session} />
        </div>
      </header>
    </>
  );
}

export function SyntheticDisclosure({
  dismissed,
  locale,
  onDismiss,
}: {
  dismissed: boolean;
  locale: Locale;
  onDismiss: () => void;
}) {
  const t = (key: TranslationKey) => translate(locale, key);
  if (dismissed) return null;
  return (
    <section className="synthetic-notice" role="status">
      <span aria-hidden="true">◆</span>
      <div>
        <strong>{t('syntheticData')}</strong>
        <p>{t('syntheticDetail')}</p>
      </div>
      <button aria-label={t('dismissSyntheticNotice')} onClick={onDismiss} type="button">
        ×
      </button>
    </section>
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
  ] as const satisfies readonly { key: TranslationKey; icon: string; value: TranslationKey }[];
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

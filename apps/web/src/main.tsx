import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { apiErrorSchema, sessionResponseSchema, type Session } from '@isuv/contracts';

import {
  accessibleNavigationItems,
  applyDocumentLocale,
  areaLabel,
  canDiscoverAlarmWorkspace,
  identityPresentation,
  roleKey,
  scopeKey,
  skipTargetId,
  type ApplicationArea,
  type IdentityState,
} from './app-model.js';
import { initialLocale, translate, type Locale } from '@isuv/i18n';
import { ShellChrome, StatusVocabulary } from './shell-semantics.js';
import './styles.css';

const initialArea: ApplicationArea = 'dashboard';
const localeStorageKey = 'isuv.locale';

function browserInitialLocale(): Locale {
  if (typeof window === 'undefined') return initialLocale(null);
  try {
    return initialLocale(window.localStorage.getItem(localeStorageKey));
  } catch {
    return initialLocale(null);
  }
}

const initialBrowserLocale = browserInitialLocale();
if (typeof document !== 'undefined')
  applyDocumentLocale(document.documentElement, initialBrowserLocale);

function areaFromHash(hash: string): ApplicationArea {
  const area = hash.replace(/^#/, '');
  return ['dashboard', 'operations', 'map', 'alarms', 'analytics', 'reports', 'audit'].includes(
    area,
  )
    ? (area as ApplicationArea)
    : initialArea;
}

function statusLabel(locale: Locale, status: ReturnType<typeof identityPresentation>['status']) {
  return translate(
    locale,
    status === 'information'
      ? 'statusInformation'
      : status === 'warning'
        ? 'statusWarning'
        : 'statusUnavailable',
  );
}

function StatusNotice({
  locale,
  status,
  title,
  detail,
}: {
  locale: Locale;
  status: 'information' | 'warning' | 'unavailable';
  title: string;
  detail: string;
}) {
  const icon = status === 'information' ? 'ℹ' : status === 'warning' ? '⚠' : '⊘';
  return (
    <div className={`status-notice status-notice--${status}`} role="status">
      <span aria-hidden="true" className="status-notice__icon">
        {icon}
      </span>
      <div>
        <strong>{`${statusLabel(locale, status)}: ${title}`}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function SessionScope({ locale, session }: { locale: Locale; session: Session }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  return (
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
                    <span>{`${t('territoryIdentifier')}: ${grant.territoryId}`}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </div>
    </dl>
  );
}

function IdentityPanel({ locale, state }: { locale: Locale; state: IdentityState }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const presentation = identityPresentation(state);
  return (
    <section aria-labelledby="identity-heading" className="panel">
      <h2 id="identity-heading">{t('identity')}</h2>
      <StatusNotice
        locale={locale}
        status={presentation.status}
        title={t(presentation.title)}
        detail={t(presentation.detail)}
      />
      {state.kind === 'authenticated' ? (
        <SessionScope locale={locale} session={state.session} />
      ) : null}
    </section>
  );
}

export function App() {
  const [locale, setLocale] = useState<Locale>(initialBrowserLocale);
  const [identity, setIdentity] = useState<IdentityState>({ kind: 'loading' });
  const [area, setArea] = useState<ApplicationArea>(() =>
    areaFromHash(typeof window === 'undefined' ? '' : window.location.hash),
  );
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  useEffect(() => {
    applyDocumentLocale(document.documentElement, locale);
    try {
      window.localStorage.setItem(localeStorageKey, locale);
    } catch {
      // A blocked storage backend must not prevent localization or shell access.
    }
  }, [locale]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadSession() {
      try {
        const response = await fetch('/api/v1/session', { signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (response.ok) {
          const parsed = sessionResponseSchema.safeParse(body);
          setIdentity(
            parsed.success
              ? { kind: 'authenticated', session: parsed.data.session }
              : { kind: 'unavailable' },
          );
          return;
        }
        const error = apiErrorSchema.safeParse(body);
        setIdentity(
          error.success && error.data.error.code === 'UNAUTHENTICATED'
            ? { kind: 'unauthenticated' }
            : { kind: 'unavailable' },
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setIdentity({ kind: 'unavailable' });
      }
    }
    void loadSession();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const updateArea = () => setArea(areaFromHash(window.location.hash));
    window.addEventListener('hashchange', updateArea);
    return () => window.removeEventListener('hashchange', updateArea);
  }, []);

  const session = identity.kind === 'authenticated' ? identity.session : null;
  return (
    <div className="application-shell">
      <ShellChrome
        area={area}
        locale={locale}
        navigation={accessibleNavigationItems(session)}
        onAreaChange={setArea}
        onLocaleChange={setLocale}
      />
      <StatusNotice
        locale={locale}
        status="warning"
        title={t('syntheticData')}
        detail={t('syntheticDetail')}
      />
      <main id={skipTargetId} tabIndex={-1}>
        <section aria-labelledby="workspace-heading" className="panel">
          <p className="eyebrow">{t('currentArea')}</p>
          <h2 id="workspace-heading">{t(areaLabel(area))}</h2>
          <p>{t('workspaceDetail')}</p>
          {canDiscoverAlarmWorkspace(session) ? (
            <>
              <a className="action-link" href="#alarms" onClick={() => setArea('alarms')}>
                <span aria-hidden="true">⚠</span> {t('globalAlarmAccess')}
              </a>
              <p className="supporting-text">{t('globalAlarmAccessDetail')}</p>
            </>
          ) : null}
          <h3>{t('plannedWorkArea')}</h3>
          <p>{t('plannedWorkAreaDetail')}</p>
        </section>
        <IdentityPanel locale={locale} state={identity} />
        <section aria-labelledby="measurements-heading" className="panel">
          <h2 id="measurements-heading">{t('measurementBoundary')}</h2>
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
        </section>
      </main>
      <footer>{t('footer')}</footer>
    </div>
  );
}

if (typeof document !== 'undefined') {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

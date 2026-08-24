import type { Session, UserRole } from '@isuv/contracts';

import type { Locale, TranslationKey } from '@isuv/i18n';

export const skipTargetId = 'main-content';

export function applyDocumentLocale(root: { lang: string }, locale: Locale): void {
  root.lang = locale;
}

export type ApplicationArea =
  'dashboard' | 'operations' | 'map' | 'alarms' | 'analytics' | 'reports' | 'audit';

export interface NavigationItem {
  area: ApplicationArea;
  label: TranslationKey;
  href: `#${ApplicationArea}`;
}

export const navigationItems: readonly NavigationItem[] = [
  { area: 'dashboard', label: 'navDashboard', href: '#dashboard' },
  { area: 'operations', label: 'navOperations', href: '#operations' },
  { area: 'map', label: 'navMap', href: '#map' },
  { area: 'alarms', label: 'navAlarms', href: '#alarms' },
  { area: 'analytics', label: 'navAnalytics', href: '#analytics' },
  { area: 'reports', label: 'navReports', href: '#reports' },
  { area: 'audit', label: 'navAudit', href: '#audit' },
];

export function areaLabel(area: ApplicationArea): TranslationKey {
  return navigationItems.find((item) => item.area === area)!.label;
}

export type IdentityState =
  | { kind: 'loading' }
  | { kind: 'authenticated'; session: Session }
  | { kind: 'unauthenticated' }
  | { kind: 'unavailable' };

export type DashboardIdentityState = 'loading' | 'ready' | 'unauthenticated' | 'unavailable';

/** Do not mistake an identity dependency outage for a sign-in prompt. */
export function dashboardIdentityState(identity: IdentityState): DashboardIdentityState {
  if (identity.kind === 'loading') return 'loading';
  if (identity.kind === 'authenticated') return 'ready';
  if (identity.kind === 'unauthenticated') return 'unauthenticated';
  return 'unavailable';
}

export interface IdentityPresentation {
  status: 'information' | 'warning' | 'unavailable';
  title: TranslationKey;
  detail: TranslationKey;
}

export function identityPresentation(state: IdentityState): IdentityPresentation {
  switch (state.kind) {
    case 'loading':
      return { status: 'information', title: 'identityChecking', detail: 'identityCheckingDetail' };
    case 'authenticated':
      return { status: 'information', title: 'identityActive', detail: 'identityActiveDetail' };
    case 'unauthenticated':
      return {
        status: 'warning',
        title: 'identityUnavailable',
        detail: 'identityUnavailableDetail',
      };
    case 'unavailable':
      return {
        status: 'unavailable',
        title: 'serviceUnavailable',
        detail: 'serviceUnavailableDetail',
      };
  }
}

export function hasAdministrativeScope(session: Session): boolean {
  return session.currentGrants.some((grant) =>
    (['system_admin', 'national_admin', 'regional_director'] as UserRole[]).includes(grant.role),
  );
}

export function canDiscoverAlarmWorkspace(session: Session | null): boolean {
  if (!session) return false;
  return session.currentGrants.some((grant) =>
    (
      [
        'system_admin',
        'national_admin',
        'regional_director',
        'basin_dispatcher',
        'district_operator',
        'maintenance_engineer',
        'auditor',
      ] as UserRole[]
    ).includes(grant.role),
  );
}

/** Conservative display discovery only. The API remains the authorization authority. */
export function accessibleNavigationItems(session: Session | null): readonly NavigationItem[] {
  return navigationItems.filter((item) => {
    if (item.area === 'alarms') return canDiscoverAlarmWorkspace(session);
    if (item.area === 'audit')
      return (
        session !== null &&
        (hasAdministrativeScope(session) ||
          session.currentGrants.some((grant) => grant.role === 'auditor'))
      );
    return true;
  });
}

export function languageName(locale: Locale): TranslationKey {
  return locale === 'en'
    ? 'languageEnglish'
    : locale === 'ru'
      ? 'languageRussian'
      : 'languageUzbek';
}

export function roleKey(role: UserRole): TranslationKey {
  const keys: Record<UserRole, TranslationKey> = {
    system_admin: 'roleSystemAdmin',
    national_admin: 'roleNationalAdmin',
    regional_director: 'roleRegionalDirector',
    basin_dispatcher: 'roleBasinDispatcher',
    district_operator: 'roleDistrictOperator',
    hydrologist: 'roleHydrologist',
    maintenance_engineer: 'roleMaintenanceEngineer',
    auditor: 'roleAuditor',
  };
  return keys[role];
}

export function scopeKey(scope: Session['currentGrants'][number]['scope']): TranslationKey {
  return scope === 'system'
    ? 'scopeSystem'
    : scope === 'national'
      ? 'scopeNational'
      : 'scopeTerritory';
}

import type { ReactNode } from 'react';

import type { Locale, TranslationKey } from '@isuv/i18n';
import { translate } from '@isuv/i18n';

interface WorkspaceHeaderProps {
  children?: ReactNode;
  detail?: ReactNode;
  heading: string;
  headingId: string;
  locale: Locale;
  provenance?: ReactNode;
}

/** A compact, consistent header that leaves evidence discoverable without leading every workspace. */
export function WorkspaceHeader({
  children,
  detail,
  heading,
  headingId,
  locale,
  provenance,
}: WorkspaceHeaderProps) {
  const t = (key: TranslationKey) => translate(locale, key);
  return (
    <header className="workspace-header">
      <div className="workspace-header__title">
        <h2 id={headingId}>{heading}</h2>
        {detail ? <p>{detail}</p> : null}
      </div>
      {children ? <div className="workspace-header__actions">{children}</div> : null}
      {provenance ? (
        <details className="workspace-header__provenance">
          <summary>{t('provenance')}</summary>
          <div>{provenance}</div>
        </details>
      ) : null}
    </header>
  );
}

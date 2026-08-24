import { useEffect, useRef, useState } from 'react';
import {
  auditEventResponseSchema,
  auditEventsResponseSchema,
  type AuditEvent,
  type AuditEventSummary,
  type AuditTerritoryScope,
} from '@isuv/contracts';
import { translate, type Locale, type TranslationKey } from '@isuv/i18n';
import {
  auditActions,
  auditEventIdFromHash,
  auditEventPath,
  auditEventsPath,
  auditHash,
  auditResources,
  auditTimestamp,
  defaultAuditFilters,
  type AuditFilters,
} from './audit-explorer-model.js';

type WorkspaceState =
  'loading' | 'ready' | 'empty' | 'unauthenticated' | 'forbidden' | 'unavailable' | 'degraded';
type DetailState =
  'idle' | 'loading' | 'ready' | 'unauthenticated' | 'unavailable' | 'forbidden' | 'degraded';
const t = (locale: Locale, key: TranslationKey) => translate(locale, key);
const uuidPattern =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';

function Notice({
  locale,
  state,
  retry,
}: {
  locale: Locale;
  state: Exclude<WorkspaceState, 'ready' | 'empty'>;
  retry: () => void;
}) {
  const content: Record<
    Exclude<WorkspaceState, 'ready' | 'empty'>,
    [string, TranslationKey, TranslationKey, string]
  > = {
    loading: ['◌', 'auditLoading', 'auditLoadingDetail', 'information'],
    unauthenticated: ['⊘', 'auditSignIn', 'auditSignInDetail', 'warning'],
    forbidden: ['⊘', 'auditForbidden', 'auditForbiddenDetail', 'warning'],
    unavailable: ['!', 'auditUnavailable', 'auditUnavailableDetail', 'unavailable'],
    degraded: ['!', 'auditDegraded', 'auditDegradedDetail', 'warning'],
  };
  const [icon, heading, detail, tone] = content[state];
  return (
    <section className={`status-notice status-notice--${tone}`} aria-live="polite">
      <span aria-hidden="true" className="status-notice__icon">
        {icon}
      </span>
      <div>
        <h2>{t(locale, heading)}</h2>
        <p>{t(locale, detail)}</p>
        {state === 'unavailable' || state === 'degraded' ? (
          <button className="action-button" onClick={retry} type="button">
            {t(locale, 'auditRetry')}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function AuditFiltersForm({
  locale,
  filters,
  onApply,
  busy,
}: {
  locale: Locale;
  filters: AuditFilters;
  onApply: (next: AuditFilters) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(filters);
  useEffect(() => setDraft(filters), [filters]);
  return (
    <form
      className="audit-filters"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(draft);
      }}
    >
      <fieldset disabled={busy}>
        <legend>{t(locale, 'auditFilters')}</legend>
        <p>{t(locale, 'auditFiltersDetail')}</p>
        <div className="audit-filters__grid">
          <label htmlFor="audit-action">
            {t(locale, 'auditAction')}
            <select
              id="audit-action"
              onChange={(e) =>
                setDraft({ ...draft, action: e.target.value as AuditFilters['action'] })
              }
              value={draft.action}
            >
              <option value="">{t(locale, 'auditAll')}</option>
              {auditActions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="audit-resource">
            {t(locale, 'auditResource')}
            <select
              id="audit-resource"
              onChange={(e) =>
                setDraft({ ...draft, resource: e.target.value as AuditFilters['resource'] })
              }
              value={draft.resource}
            >
              <option value="">{t(locale, 'auditAll')}</option>
              {auditResources.map((resource) => (
                <option key={resource} value={resource}>
                  {resource}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="audit-actor">
            {t(locale, 'auditActorId')}
            <input
              id="audit-actor"
              onChange={(e) => setDraft({ ...draft, actorUserId: e.target.value.trim() })}
              pattern={uuidPattern}
              type="text"
              value={draft.actorUserId}
            />
          </label>
          <label htmlFor="audit-resource-id">
            {t(locale, 'auditResourceId')}
            <input
              id="audit-resource-id"
              onChange={(e) => setDraft({ ...draft, resourceId: e.target.value.trim() })}
              pattern={uuidPattern}
              type="text"
              value={draft.resourceId}
            />
          </label>
          <label htmlFor="audit-request-id">
            {t(locale, 'auditRequestId')}
            <input
              id="audit-request-id"
              maxLength={256}
              onChange={(e) => setDraft({ ...draft, requestId: e.target.value.trim() })}
              type="text"
              value={draft.requestId}
            />
          </label>
          <label htmlFor="audit-from">
            {t(locale, 'auditFrom')}
            <input
              id="audit-from"
              max={draft.occurredUntil || undefined}
              onChange={(e) => setDraft({ ...draft, occurredFrom: e.target.value })}
              type="datetime-local"
              value={draft.occurredFrom}
            />
          </label>
          <label htmlFor="audit-until">
            {t(locale, 'auditUntil')}
            <input
              id="audit-until"
              min={draft.occurredFrom || undefined}
              onChange={(e) => setDraft({ ...draft, occurredUntil: e.target.value })}
              type="datetime-local"
              value={draft.occurredUntil}
            />
          </label>
        </div>
        <div className="audit-actions">
          <button className="action-button" type="submit">
            {t(locale, 'auditApplyFilters')}
          </button>
          <button
            onClick={() => {
              setDraft(defaultAuditFilters);
              onApply(defaultAuditFilters);
            }}
            type="button"
          >
            {t(locale, 'auditClearFilters')}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function EventsTable({
  locale,
  events,
  selectedId,
  onSelect,
}: {
  locale: Locale;
  events: readonly AuditEventSummary[];
  selectedId: string | null;
  onSelect: (event: AuditEventSummary, focusId: string) => void;
}) {
  return (
    <section className="panel audit-list" aria-labelledby="audit-list-heading">
      <h2 id="audit-list-heading">{t(locale, 'auditEvents')}</h2>
      <p>{t(locale, 'auditListDetail')}</p>
      <div
        className="audit-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={t(locale, 'auditEvents')}
      >
        <table>
          <caption className="visually-hidden">{t(locale, 'auditEvents')}</caption>
          <thead>
            <tr>
              <th scope="col">{t(locale, 'auditOccurredAt')}</th>
              <th scope="col">{t(locale, 'auditAction')}</th>
              <th scope="col">{t(locale, 'auditResource')}</th>
              <th scope="col">{t(locale, 'auditActorId')}</th>
              <th scope="col">{t(locale, 'auditReason')}</th>
              <th scope="col">{t(locale, 'auditOpen')}</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const focusId = `audit-row-${event.id}`;
              return (
                <tr aria-current={selectedId === event.id ? 'true' : undefined} key={event.id}>
                  <td data-label={t(locale, 'auditOccurredAt')}>
                    {auditTimestamp(event.occurredAt)}
                  </td>
                  <td data-label={t(locale, 'auditAction')}>
                    <code>{event.action}</code>
                  </td>
                  <td data-label={t(locale, 'auditResource')}>
                    <code>{event.resource}</code>
                  </td>
                  <td data-label={t(locale, 'auditActorId')}>
                    <code>{event.actorUserId}</code>
                  </td>
                  <td data-label={t(locale, 'auditReason')}>{event.reason}</td>
                  <td data-label={t(locale, 'auditOpen')}>
                    <button id={focusId} onClick={() => onSelect(event, focusId)} type="button">
                      {t(locale, 'auditOpen')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StateBlock({
  locale,
  title,
  value,
}: {
  locale: Locale;
  title: TranslationKey;
  value: Record<string, unknown> | null;
}) {
  return (
    <section className="audit-state" aria-labelledby={`${title}-heading`}>
      <h3 id={`${title}-heading`}>{t(locale, title)}</h3>
      {value === null ? (
        <p>{t(locale, 'auditNoState')}</p>
      ) : (
        <pre>{JSON.stringify(value, null, 2)}</pre>
      )}
    </section>
  );
}

export function AuditEventDetail({
  locale,
  event,
  state,
  onClose,
}: {
  locale: Locale;
  event: AuditEvent | null;
  state: DetailState;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state === 'ready') heading.current?.focus();
  }, [state, event?.id]);
  if (state === 'idle') return null;
  if (state !== 'ready' || !event) {
    const [headingKey, detailKey]: [TranslationKey, TranslationKey] =
      state === 'loading'
        ? ['auditDetailLoading', 'auditDetailLoadingDetail']
        : state === 'unauthenticated'
          ? ['auditSignIn', 'auditSignInDetail']
          : state === 'forbidden'
            ? ['auditForbidden', 'auditForbiddenDetail']
            : state === 'degraded'
              ? ['auditDegraded', 'auditDegradedDetail']
              : ['auditDetailUnavailable', 'auditDetailUnavailableDetail'];
    return (
      <section className="panel audit-detail" aria-live="polite">
        <h2>{t(locale, headingKey)}</h2>
        <p>{t(locale, detailKey)}</p>
        {state !== 'loading' ? (
          <button onClick={onClose} type="button">
            {t(locale, 'auditClose')}
          </button>
        ) : null}
      </section>
    );
  }
  const fields: readonly [TranslationKey, string][] = [
    ['auditOccurredAt', auditTimestamp(event.occurredAt)],
    ['auditAction', event.action],
    ['auditResource', event.resource],
    ['auditResourceId', event.resourceId],
    ['auditActorId', event.actorUserId],
    ['auditActorOrganizationId', event.actorOrganizationId],
    ['auditTargetOrganizationId', event.organizationId],
    ['auditTerritory', event.territoryId],
    ['auditRequestId', event.requestId],
    ['auditClassification', event.dataClassification],
    ['auditProvenance', event.provenance],
    ['auditReason', event.reason],
  ];
  return (
    <article className="panel audit-detail" aria-labelledby="audit-detail-heading">
      <p className="eyebrow">{t(locale, 'syntheticScenario')}</p>
      <h2 id="audit-detail-heading" ref={heading} tabIndex={-1}>
        {t(locale, 'auditDetailHeading')}
      </h2>
      <p className="audit-authority">⚠ {t(locale, 'auditSyntheticNonOfficial')}</p>
      <dl className="audit-metadata">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{t(locale, label)}</dt>
            <dd>
              <code>{value}</code>
            </dd>
          </div>
        ))}
      </dl>
      <StateBlock locale={locale} title="auditOldState" value={event.oldState} />
      <StateBlock locale={locale} title="auditNewState" value={event.newState} />
      <div className="audit-actions">
        <button onClick={onClose} type="button">
          {t(locale, 'auditClose')}
        </button>
        <a href={auditHash(event.id)}>{t(locale, 'auditStableLink')}</a>
      </div>
    </article>
  );
}

export function AuditExplorerWorkspace({
  locale,
  access,
}: {
  locale: Locale;
  access: 'loading' | 'ready' | 'unauthenticated' | 'unavailable';
}) {
  const [filters, setFilters] = useState(defaultAuditFilters);
  const [pageCursors, setPageCursors] = useState<(string | null)[]>([null]);
  const [response, setResponse] = useState<{
    events: readonly AuditEventSummary[];
    nextCursor: string | null;
    scope: AuditTerritoryScope;
  } | null>(null);
  const [state, setState] = useState<WorkspaceState>('loading');
  const [retry, setRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    auditEventIdFromHash(typeof window === 'undefined' ? '' : window.location.hash),
  );
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [detailState, setDetailState] = useState<DetailState>('idle');
  const returnFocus = useRef<string | null>(null);
  const cursor = pageCursors.at(-1) ?? null;

  useEffect(() => {
    const update = () => setSelectedId(auditEventIdFromHash(window.location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    if (access === 'loading') {
      setResponse(null);
      setState('loading');
      return;
    }
    if (access !== 'ready') {
      setResponse(null);
      setState(access === 'unauthenticated' ? 'unauthenticated' : 'unavailable');
      return;
    }
    const controller = new AbortController();
    setResponse(null);
    setState('loading');
    void fetch(auditEventsPath(filters, cursor), { signal: controller.signal })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        if (res.ok) {
          const parsed = auditEventsResponseSchema.safeParse(body);
          if (parsed.success) {
            setResponse(parsed.data);
            setState(parsed.data.events.length ? 'ready' : 'empty');
          } else setState('degraded');
          return;
        }
        setState(
          res.status === 401
            ? 'unauthenticated'
            : res.status === 403 || res.status === 404
              ? 'forbidden'
              : 'unavailable',
        );
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setState('unavailable');
      });
    return () => controller.abort();
  }, [access, cursor, filters, retry]);
  useEffect(() => {
    if (!selectedId || access !== 'ready' || !response) {
      setSelected(null);
      setDetailState(selectedId ? 'loading' : 'idle');
      return;
    }
    const controller = new AbortController();
    setSelected(null);
    setDetailState('loading');
    void fetch(auditEventPath(selectedId, response.scope.territoryId), {
      signal: controller.signal,
    })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        if (res.ok) {
          const parsed = auditEventResponseSchema.safeParse(body);
          if (parsed.success) {
            setSelected(parsed.data.event);
            setDetailState('ready');
          } else setDetailState('degraded');
          return;
        }
        setDetailState(
          res.status === 401
            ? 'unauthenticated'
            : res.status === 403 || res.status === 404
              ? 'forbidden'
              : 'unavailable',
        );
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setDetailState('unavailable');
      });
    return () => controller.abort();
  }, [access, response, selectedId]);
  useEffect(() => {
    if (selectedId || !returnFocus.current) return;
    const id = returnFocus.current;
    const frame = requestAnimationFrame(() => document.getElementById(id)?.focus());
    returnFocus.current = null;
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);

  const choose = (event: AuditEventSummary, focusId: string) => {
    returnFocus.current = focusId;
    if (typeof window !== 'undefined') window.location.hash = auditHash(event.id);
    setSelectedId(event.id);
  };
  const close = () => {
    if (typeof window !== 'undefined') window.location.hash = auditHash(null);
    setSelectedId(null);
  };
  const apply = (next: AuditFilters) => {
    setFilters(next);
    setPageCursors([null]);
    if (selectedId) close();
  };
  if (state !== 'ready' && state !== 'empty')
    return <Notice locale={locale} retry={() => setRetry((value) => value + 1)} state={state} />;
  return (
    <section className="audit-workspace" aria-labelledby="audit-heading">
      <header className="panel audit-intro">
        <p className="eyebrow">{t(locale, 'syntheticScenario')}</p>
        <h2 id="audit-heading">{t(locale, 'auditHeading')}</h2>
        <p>{t(locale, 'auditDetail')}</p>
        <p className="audit-authority">⚠ {t(locale, 'auditSyntheticNonOfficial')}</p>
        {response ? (
          <p className="supporting-text">
            {t(locale, 'auditScope')}: <code>{response.scope.territoryId}</code> —{' '}
            {t(locale, 'auditDescendantsIncluded')}
          </p>
        ) : null}
      </header>
      <AuditFiltersForm busy={false} filters={filters} locale={locale} onApply={apply} />
      {state === 'empty' ? (
        <section className="status-notice status-notice--information" aria-live="polite">
          <span aria-hidden="true" className="status-notice__icon">
            —
          </span>
          <div>
            <h2>{t(locale, 'auditEmpty')}</h2>
            <p>{t(locale, 'auditEmptyDetail')}</p>
          </div>
        </section>
      ) : null}
      {response && state === 'ready' ? (
        <>
          <EventsTable
            events={response.events}
            locale={locale}
            onSelect={choose}
            selectedId={selectedId}
          />
          <nav className="audit-pagination" aria-label={t(locale, 'auditPagination')}>
            <button
              disabled={pageCursors.length === 1}
              onClick={() => setPageCursors((items) => items.slice(0, -1))}
              type="button"
            >
              {t(locale, 'auditPreviousPage')}
            </button>
            <span>{t(locale, 'auditPageSize')}</span>
            <button
              disabled={!response.nextCursor}
              onClick={() =>
                response.nextCursor && setPageCursors((items) => [...items, response.nextCursor!])
              }
              type="button"
            >
              {t(locale, 'auditNextPage')}
            </button>
          </nav>
        </>
      ) : null}
      <AuditEventDetail event={selected} locale={locale} onClose={close} state={detailState} />
    </section>
  );
}

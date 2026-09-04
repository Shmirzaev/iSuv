import { useEffect, useRef, useState } from 'react';
import {
  alarmIncidentCenterResponseSchema,
  apiErrorSchema,
  type AlarmIncidentCenterItem,
  type AlarmIncidentCenterResponse,
} from '@isuv/contracts';

import { translate, type Locale, type TranslationKey } from '@isuv/i18n';

import {
  alarmCenterPath,
  actionErrorKey,
  capabilityDisabledReasonKey,
  emptyAlarmCenterFilters,
  evidencePresentation,
  evidenceQualityKey,
  eventTypeKey,
  formatAlarmCenterMicros,
  incidentStatePresentation,
  metricStateKey,
  selectionForAlarmCenterItem,
  severityPresentation,
  systemConditionKey,
  unitBoundaryKey,
  waterConditionKey,
  automaticStatePresentation,
  type AlarmCenterFilters,
  type AlarmCenterSelection,
} from './alarm-incident-center-model.js';
import { formatNumber, presentationTimestamp } from './format.js';
import { FilterPanel, type ActiveFilter } from './filter-panel.js';
import { StatusChip, type StatusChipTone } from './status-chip.js';
import { WorkspaceHeader } from './workspace-header.js';

type WorkspaceState =
  'loading' | 'ready' | 'empty' | 'unauthenticated' | 'inaccessible' | 'unavailable' | 'degraded';

type ActionKind =
  | 'create'
  | 'acknowledge'
  | 'investigate'
  | 'assign'
  | 'comment'
  | 'correctiveAction'
  | 'resolve'
  | 'close';

const eventTypes = [
  'over_allocation',
  'under_allocation',
  'unexplained_balance',
  'sudden_flow_change',
  'high_stage',
  'dry_canal',
  'sensor_frozen',
  'sensor_impossible',
  'communication_loss',
  'power_problem',
  'calibration_overdue',
  'network_inconsistency',
] as const;
const waterConditions = [
  'over_allocation',
  'under_allocation',
  'high_stage',
  'dry_canal',
  'sudden_flow_change',
  'unexplained_balance',
  'not_assessed',
  'unassessable',
] as const;
const systemConditions = [
  'sensor_frozen',
  'sensor_impossible',
  'communication_loss',
  'power_problem',
  'calibration_overdue',
  'network_inconsistency',
  'not_assessed',
  'unconfigured',
  'unassessable',
] as const;

function t(locale: Locale, key: TranslationKey): string {
  return translate(locale, key);
}

function StateNotice({
  locale,
  state,
  onRetry,
}: {
  locale: Locale;
  state: Exclude<WorkspaceState, 'ready' | 'empty'>;
  onRetry: () => void;
}) {
  const content: Record<
    Exclude<WorkspaceState, 'ready' | 'empty'>,
    [string, TranslationKey, TranslationKey, 'information' | 'warning' | 'unavailable']
  > = {
    loading: ['◌', 'alarmCenterLoading', 'alarmCenterLoadingDetail', 'information'],
    unauthenticated: ['⊘', 'alarmCenterSignIn', 'alarmCenterSignInDetail', 'warning'],
    inaccessible: ['⊘', 'alarmCenterInaccessible', 'alarmCenterInaccessibleDetail', 'warning'],
    unavailable: ['!', 'alarmCenterUnavailable', 'alarmCenterUnavailableDetail', 'unavailable'],
    degraded: ['!', 'alarmCenterDegraded', 'alarmCenterDegradedDetail', 'warning'],
  };
  const [icon, heading, detail, tone] = content[state];
  return (
    <section aria-live="polite" className={`status-notice status-notice--${tone}`}>
      <span aria-hidden="true" className="status-notice__icon">
        {icon}
      </span>
      <div>
        <h2>{t(locale, heading)}</h2>
        <p>{t(locale, detail)}</p>
        {state === 'unavailable' || state === 'degraded' ? (
          <button className="action-button" type="button" onClick={onRetry}>
            {t(locale, 'alarmCenterRetry')}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function StatusValue({
  icon,
  label,
  value,
  locale,
}: {
  icon: string;
  label: TranslationKey;
  value: TranslationKey;
  locale: Locale;
}) {
  const tone: StatusChipTone =
    label === 'alarmSeverityCritical'
      ? 'critical'
      : label === 'alarmSeverityWarning' || label === 'alarmSeverityAdvisory'
        ? 'attention'
        : label === 'alarmAutomaticCleared' ||
            label === 'incidentResolved' ||
            label === 'incidentClosed' ||
            label === 'alarmEvidenceAssessable'
          ? 'positive'
          : 'information';
  return <StatusChip detail={t(locale, value)} icon={icon} label={t(locale, label)} tone={tone} />;
}

function ConditionChip({
  condition,
  locale,
  type,
}: {
  condition:
    AlarmIncidentCenterItem['waterCondition'] | AlarmIncidentCenterItem['systemDeviceCondition'];
  locale: Locale;
  type: 'water' | 'system';
}) {
  const label = t(
    locale,
    type === 'water'
      ? waterConditionKey(condition as AlarmIncidentCenterItem['waterCondition'])
      : systemConditionKey(condition as AlarmIncidentCenterItem['systemDeviceCondition']),
  );
  const heading = t(locale, type === 'water' ? 'alarmWaterCondition' : 'alarmSystemCondition');
  const unassessed = condition === 'not_assessed' || condition === 'unassessable';
  return (
    <StatusChip
      detail={`${heading}: ${label}`}
      icon={type === 'water' ? '≈' : '⌁'}
      label={label}
      tone={unassessed ? 'neutral' : type === 'system' ? 'attention' : 'information'}
    />
  );
}

function Timestamp({ locale, value }: { locale: Locale; value: string | null }) {
  if (!value) return <span aria-label={t(locale, 'notAvailable')}>—</span>;
  const timestamp = presentationTimestamp(locale, value);
  return (
    <time dateTime={timestamp.dateTime} title={timestamp.title}>
      {timestamp.value}
    </time>
  );
}

function Assignee({
  locale,
  userId,
  candidates,
}: {
  locale: Locale;
  userId: string | null;
  candidates: AlarmIncidentCenterResponse['assignmentCandidates'];
}) {
  if (!userId) return <span>{t(locale, 'alarmUnassigned')}</span>;
  const candidate = candidates.find((value) => value.id === userId);
  if (candidate) return <span>{candidate.displayName}</span>;
  return (
    <code className="stable-identifier" title={userId} aria-label={userId}>
      {userId.slice(0, 8)}
    </code>
  );
}

function FilterSelect({
  locale,
  label,
  value,
  values,
  display,
  onChange,
}: {
  locale: Locale;
  label: TranslationKey;
  value: string | undefined;
  values: readonly string[];
  display: (value: string) => string;
  onChange: (value: string | undefined) => void;
}) {
  const id = `alarm-center-filter-${label}`;
  return (
    <label htmlFor={id}>
      {t(locale, label)}
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{t(locale, 'liveAll')}</option>
        {values.map((option) => (
          <option key={option} value={option}>
            {display(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterForm({
  locale,
  filters,
  onChange,
  onClear,
}: {
  locale: Locale;
  filters: AlarmCenterFilters;
  onChange: (next: AlarmCenterFilters) => void;
  onClear: () => void;
}) {
  const update = <Key extends keyof AlarmCenterFilters>(key: Key, value: AlarmCenterFilters[Key]) =>
    onChange({ ...filters, [key]: value });
  const active = Object.entries(filters).filter(([, value]) => Boolean(value)) as [
    keyof AlarmCenterFilters,
    string,
  ][];
  const labelFor = (key: keyof AlarmCenterFilters): TranslationKey =>
    (
      ({
        eventType: 'alarmEventType',
        severity: 'alarmSeverity',
        automaticState: 'alarmAutomaticState',
        incidentStatus: 'alarmIncidentState',
        waterCondition: 'alarmWaterCondition',
        systemDeviceCondition: 'alarmSystemCondition',
        assignment: 'alarmAssignment',
        evidenceAssessment: 'alarmEvidenceAssessment',
      }) as Record<keyof AlarmCenterFilters, TranslationKey>
    )[key];
  const valueFor = (key: keyof AlarmCenterFilters, value: string): string => {
    if (key === 'eventType')
      return t(locale, eventTypeKey(value as AlarmIncidentCenterItem['eventType']));
    if (key === 'severity')
      return t(locale, severityPresentation(value as AlarmIncidentCenterItem['severity']).label);
    if (key === 'automaticState')
      return t(
        locale,
        automaticStatePresentation(value as AlarmIncidentCenterItem['automaticState']).label,
      );
    if (key === 'incidentStatus')
      return t(
        locale,
        incidentStatePresentation(value as AlarmIncidentCenterItem['incidentStatus']).label,
      );
    if (key === 'waterCondition')
      return t(locale, waterConditionKey(value as AlarmIncidentCenterItem['waterCondition']));
    if (key === 'systemDeviceCondition')
      return t(
        locale,
        systemConditionKey(value as AlarmIncidentCenterItem['systemDeviceCondition']),
      );
    if (key === 'assignment')
      return t(locale, value === 'assigned' ? 'alarmAssigned' : 'alarmUnassigned');
    return t(
      locale,
      evidencePresentation(value as AlarmIncidentCenterItem['evidence']['assessment']).label,
    );
  };
  const activeFilters: ActiveFilter[] = active.map(([key, value]) => ({
    id: key,
    label: `${t(locale, labelFor(key))}: ${valueFor(key, value)}`,
    onRemove: () => update(key, undefined as never),
  }));
  return (
    <FilterPanel
      activeFilters={activeFilters}
      clearLabel={t(locale, 'filtersClearAll')}
      filtersLabel={t(locale, 'alarmCenterFilters')}
      onClear={onClear}
    >
      <fieldset className="alarm-center-filters">
        <legend className="visually-hidden">{t(locale, 'alarmCenterFilters')}</legend>
        <div className="alarm-center-filters__grid">
          <FilterSelect
            locale={locale}
            label="alarmEventType"
            value={filters.eventType}
            values={eventTypes}
            display={(value) =>
              t(locale, eventTypeKey(value as AlarmIncidentCenterItem['eventType']))
            }
            onChange={(value) => update('eventType', value as AlarmCenterFilters['eventType'])}
          />
          <FilterSelect
            locale={locale}
            label="alarmSeverity"
            value={filters.severity}
            values={['information', 'advisory', 'warning', 'critical']}
            display={(value) =>
              t(locale, severityPresentation(value as AlarmIncidentCenterItem['severity']).label)
            }
            onChange={(value) => update('severity', value as AlarmCenterFilters['severity'])}
          />
          <FilterSelect
            locale={locale}
            label="alarmAutomaticState"
            value={filters.automaticState}
            values={['active', 'cleared']}
            display={(value) =>
              t(
                locale,
                automaticStatePresentation(value as AlarmIncidentCenterItem['automaticState'])
                  .label,
              )
            }
            onChange={(value) =>
              update('automaticState', value as AlarmCenterFilters['automaticState'])
            }
          />
          <FilterSelect
            locale={locale}
            label="alarmIncidentState"
            value={filters.incidentStatus}
            values={['open', 'acknowledged', 'investigating', 'resolved', 'closed']}
            display={(value) =>
              t(
                locale,
                incidentStatePresentation(value as AlarmIncidentCenterItem['incidentStatus']).label,
              )
            }
            onChange={(value) =>
              update('incidentStatus', value as AlarmCenterFilters['incidentStatus'])
            }
          />
          <FilterSelect
            locale={locale}
            label="alarmWaterCondition"
            value={filters.waterCondition}
            values={waterConditions}
            display={(value) =>
              t(locale, waterConditionKey(value as AlarmIncidentCenterItem['waterCondition']))
            }
            onChange={(value) =>
              update('waterCondition', value as AlarmCenterFilters['waterCondition'])
            }
          />
          <FilterSelect
            locale={locale}
            label="alarmSystemCondition"
            value={filters.systemDeviceCondition}
            values={systemConditions}
            display={(value) =>
              t(
                locale,
                systemConditionKey(value as AlarmIncidentCenterItem['systemDeviceCondition']),
              )
            }
            onChange={(value) =>
              update('systemDeviceCondition', value as AlarmCenterFilters['systemDeviceCondition'])
            }
          />
          <FilterSelect
            locale={locale}
            label="alarmAssignment"
            value={filters.assignment}
            values={['assigned', 'unassigned']}
            display={(value) =>
              t(locale, value === 'assigned' ? 'alarmAssigned' : 'alarmUnassigned')
            }
            onChange={(value) => update('assignment', value as AlarmCenterFilters['assignment'])}
          />
          <FilterSelect
            locale={locale}
            label="alarmEvidenceAssessment"
            value={filters.evidenceAssessment}
            values={['assessable', 'unassessable', 'missing', 'pending', 'deferred']}
            display={(value) =>
              t(
                locale,
                evidencePresentation(value as AlarmIncidentCenterItem['evidence']['assessment'])
                  .label,
              )
            }
            onChange={(value) =>
              update('evidenceAssessment', value as AlarmCenterFilters['evidenceAssessment'])
            }
          />
        </div>
      </fieldset>
    </FilterPanel>
  );
}

export function AlarmCenterQueue({
  locale,
  response,
  selection,
  onSelect,
}: {
  locale: Locale;
  response: AlarmIncidentCenterResponse;
  selection: AlarmCenterSelection;
  onSelect: (item: AlarmIncidentCenterItem) => void;
}) {
  return (
    <section className="alarm-center-queue panel" aria-labelledby="alarm-center-queue-heading">
      <h3 id="alarm-center-queue-heading">{t(locale, 'alarmCenterQueue')}</h3>
      <p>
        {t(locale, 'alarmCenterQueueCount')}:{' '}
        {formatNumber(locale, response.scope.queueDenominator)}
      </p>
      <div
        aria-label={t(locale, 'alarmCenterQueue')}
        className="table-scroll alarm-center-table-scroll"
        role="region"
        tabIndex={0}
      >
        <table className="alarm-center-table">
          <caption>{t(locale, 'alarmCenterQueueDetail')}</caption>
          <thead>
            <tr>
              <th>{t(locale, 'alarmEventType')}</th>
              <th>{t(locale, 'alarmSeverity')}</th>
              <th>{t(locale, 'alarmAutomaticState')}</th>
              <th>{t(locale, 'alarmIncidentState')}</th>
              <th>{t(locale, 'alarmWaterCondition')}</th>
              <th>{t(locale, 'alarmSystemCondition')}</th>
              <th>{t(locale, 'territory')}</th>
              <th>{t(locale, 'alarmAssignee')}</th>
              <th>{t(locale, 'alarmDetectedAt')}</th>
              <th>{t(locale, 'alarmEvidenceAssessment')}</th>
              <th>{t(locale, 'alarmCenterSelect')}</th>
            </tr>
          </thead>
          <tbody>
            {response.items.map((item) => {
              const severity = severityPresentation(item.severity);
              const automatic = automaticStatePresentation(item.automaticState);
              const incident = incidentStatePresentation(item.incidentStatus);
              const evidence = evidencePresentation(item.evidence.assessment);
              const selected = item.incidentId
                ? selection.incidentId === item.incidentId
                : selection.alarmId === item.alarmId;
              return (
                <tr className="alarm-center-table__row" key={item.alarmId}>
                  <td
                    className="alarm-center-table__event"
                    data-label={t(locale, 'alarmEventType')}
                  >
                    {t(locale, eventTypeKey(item.eventType))}
                  </td>
                  <td className="alarm-center-table__chip" data-label={t(locale, 'alarmSeverity')}>
                    <StatusValue locale={locale} {...severity} />
                  </td>
                  <td
                    className="alarm-center-table__chip"
                    data-label={t(locale, 'alarmAutomaticState')}
                  >
                    <StatusValue locale={locale} {...automatic} />
                  </td>
                  <td
                    className="alarm-center-table__chip"
                    data-label={t(locale, 'alarmIncidentState')}
                  >
                    <StatusValue locale={locale} {...incident} />
                  </td>
                  <td
                    className="alarm-center-table__chip"
                    data-label={t(locale, 'alarmWaterCondition')}
                  >
                    <ConditionChip condition={item.waterCondition} locale={locale} type="water" />
                  </td>
                  <td
                    className="alarm-center-table__chip"
                    data-label={t(locale, 'alarmSystemCondition')}
                  >
                    <ConditionChip
                      condition={item.systemDeviceCondition}
                      locale={locale}
                      type="system"
                    />
                  </td>
                  <td className="alarm-center-table__territory" data-label={t(locale, 'territory')}>
                    <span title={item.territory.name}>{item.territory.name}</span>
                    <small title={item.territory.code}>{item.territory.code}</small>
                  </td>
                  <td
                    className="alarm-center-table__assignee"
                    data-label={t(locale, 'alarmAssignee')}
                  >
                    <Assignee
                      candidates={response.assignmentCandidates}
                      locale={locale}
                      userId={item.assignedUserId}
                    />
                  </td>
                  <td
                    className="alarm-center-table__timestamp"
                    data-label={t(locale, 'alarmDetectedAt')}
                  >
                    <Timestamp locale={locale} value={item.detectedAt} />
                  </td>
                  <td
                    className="alarm-center-table__chip"
                    data-label={t(locale, 'alarmEvidenceAssessment')}
                  >
                    <StatusValue locale={locale} {...evidence} />
                  </td>
                  <td
                    className="alarm-center-table__select"
                    data-label={t(locale, 'alarmCenterSelect')}
                  >
                    <button
                      aria-pressed={selected}
                      className="action-button"
                      id={`alarm-center-row-${item.alarmId}`}
                      type="button"
                      onClick={() => onSelect(item)}
                    >
                      {t(locale, 'alarmCenterSelect')}
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

function CapabilityButton({
  action,
  capability,
  locale,
  onSelect,
}: {
  action: ActionKind;
  capability: AlarmIncidentCenterItem['capabilities'][keyof AlarmIncidentCenterItem['capabilities']];
  locale: Locale;
  onSelect: (action: ActionKind) => void;
}) {
  const labels: Record<ActionKind, TranslationKey> = {
    create: 'alarmActionCreateIncident',
    acknowledge: 'alarmActionAcknowledge',
    investigate: 'alarmActionInvestigate',
    assign: 'alarmActionAssign',
    comment: 'alarmActionComment',
    correctiveAction: 'alarmActionCorrectiveAction',
    resolve: 'alarmActionResolve',
    close: 'alarmActionClose',
  };
  const localizedReason = capabilityDisabledReasonKey(capability.disabledReason);
  return (
    <div className="alarm-center-action">
      <button
        className="action-button"
        disabled={!capability.allowed}
        type="button"
        onClick={() => onSelect(action)}
      >
        {t(locale, labels[action])}
      </button>
      {!capability.allowed && capability.disabledReason ? (
        <small>
          {localizedReason
            ? t(locale, localizedReason)
            : `${t(locale, 'alarmCapabilityUnavailableFallback')}: ${capability.disabledReason}`}
        </small>
      ) : null}
    </div>
  );
}

function mutationRequest(
  item: AlarmIncidentCenterItem,
  action: ActionKind,
  reason: string,
  body: string,
  assigneeUserId: string,
): { path: string; body: unknown } | null {
  if (action === 'create')
    return { path: '/api/v1/incidents', body: { alarmId: item.alarmId, reason } };
  if (!item.incidentId) return null;
  const base = `/api/v1/incidents/${encodeURIComponent(item.incidentId)}`;
  if (action === 'assign') return { path: `${base}/assign`, body: { assigneeUserId, reason } };
  if (action === 'comment') return { path: `${base}/comments`, body: { body, reason } };
  if (action === 'correctiveAction')
    return { path: `${base}/corrective-actions`, body: { body, reason } };
  const endpoints: Record<
    Exclude<ActionKind, 'create' | 'assign' | 'comment' | 'correctiveAction'>,
    string
  > = {
    acknowledge: 'acknowledge',
    investigate: 'investigate',
    resolve: 'resolve',
    close: 'close',
  };
  return { path: `${base}/${endpoints[action]}`, body: { reason } };
}

function ActionForm({
  action,
  item,
  candidates,
  locale,
  onCancel,
  onComplete,
}: {
  action: ActionKind;
  item: AlarmIncidentCenterItem;
  candidates: AlarmIncidentCenterResponse['assignmentCandidates'];
  locale: Locale;
  onCancel: () => void;
  onComplete: (message: string | null) => void;
}) {
  const [reason, setReason] = useState('');
  const [body, setBody] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [error, setError] = useState('');
  const needsBody = action === 'comment' || action === 'correctiveAction';
  const needsAssignee = action === 'assign';
  const label: Record<ActionKind, TranslationKey> = {
    create: 'alarmActionCreateIncident',
    acknowledge: 'alarmActionAcknowledge',
    investigate: 'alarmActionInvestigate',
    assign: 'alarmActionAssign',
    comment: 'alarmActionComment',
    correctiveAction: 'alarmActionCorrectiveAction',
    resolve: 'alarmActionResolve',
    close: 'alarmActionClose',
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason.trim() || (needsBody && !body.trim()) || (needsAssignee && !assigneeUserId)) {
      setState('error');
      setError(t(locale, 'alarmActionRequiredFields'));
      return;
    }
    const request = mutationRequest(item, action, reason.trim(), body.trim(), assigneeUserId);
    if (!request) {
      setState('error');
      setError(t(locale, 'alarmActionUnavailable'));
      return;
    }
    setState('sending');
    setError('');
    try {
      const response = await fetch(request.path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request.body),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(payload);
        setState('error');
        const message = parsed.success
          ? actionErrorKey(parsed.data.error.message)
            ? t(locale, actionErrorKey(parsed.data.error.message)!)
            : `${t(locale, 'alarmActionAuthoritativeFallback')}: ${parsed.data.error.message}`
          : t(locale, 'alarmActionFailed');
        setError(message);
        onComplete(message);
        return;
      }
      onComplete(null);
    } catch {
      setState('error');
      setError(t(locale, 'alarmActionFailed'));
      onComplete(t(locale, 'alarmActionFailed'));
    }
  };
  return (
    <form className="alarm-center-action-form" onSubmit={submit}>
      <h4>{t(locale, label[action])}</h4>
      {needsAssignee ? (
        <label>
          {t(locale, 'alarmAssignee')}
          <select
            value={assigneeUserId}
            onChange={(event) => setAssigneeUserId(event.target.value)}
          >
            <option value="">{t(locale, 'alarmSelectAssignee')}</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {needsBody ? (
        <label>
          {t(locale, action === 'comment' ? 'alarmCommentBody' : 'alarmCorrectiveActionBody')}
          <textarea value={body} onChange={(event) => setBody(event.target.value)} />
        </label>
      ) : null}
      <label>
        {t(locale, 'alarmActionReason')}
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      {state === 'error' ? <p role="alert">{error}</p> : null}
      <div className="alarm-center-action-form__buttons">
        <button className="action-button" disabled={state === 'sending'} type="submit">
          {state === 'sending' ? t(locale, 'alarmActionSending') : t(locale, 'alarmActionSubmit')}
        </button>
        <button className="action-button" type="button" onClick={onCancel}>
          {t(locale, 'alarmActionCancel')}
        </button>
      </div>
    </form>
  );
}

function Evidence({ item, locale }: { item: AlarmIncidentCenterItem; locale: Locale }) {
  const evidence = evidencePresentation(item.evidence.assessment);
  const result = item.evidence.result ? JSON.stringify(item.evidence.result) : null;
  return (
    <section aria-labelledby="alarm-evidence-heading">
      <h3 id="alarm-evidence-heading">{t(locale, 'alarmEvidence')}</h3>
      <StatusValue locale={locale} {...evidence} />
      <dl className="alarm-center-details">
        <div>
          <dt>{t(locale, 'alarmUnitBoundary')}</dt>
          <dd>{t(locale, unitBoundaryKey(item.evidence.unitBoundary))}</dd>
        </div>
        <div>
          <dt>{t(locale, 'alarmEffectiveAt')}</dt>
          <dd>
            <Timestamp locale={locale} value={item.evidence.effectiveAt} />
          </dd>
        </div>
        <div>
          <dt>{t(locale, 'knownAt')}</dt>
          <dd>
            <Timestamp locale={locale} value={item.evidence.knownAt} />
          </dd>
        </div>
        <div>
          <dt>{t(locale, 'provenance')}</dt>
          <dd>{item.evidence.provenance.label}</dd>
        </div>
        <div>
          <dt>{t(locale, 'dataQuality')}</dt>
          <dd>{t(locale, evidenceQualityKey(item.evidence.qualityState))}</dd>
          {item.evidence.qualityReason ? <small>{item.evidence.qualityReason}</small> : null}
        </div>
      </dl>
      {item.evidence.reason ? (
        <p className="alarm-center-unconfigured">
          <span aria-hidden="true">⚙</span> <strong>{t(locale, 'alarmEvidenceReason')}</strong>:{' '}
          {item.evidence.reason}
        </p>
      ) : null}
      {result ? (
        <details>
          <summary>{t(locale, 'alarmEvidencePayload')}</summary>
          <pre>{result}</pre>
        </details>
      ) : null}
    </section>
  );
}

export function AlarmCenterPanel({
  locale,
  response,
  onClose,
  onRefresh,
}: {
  locale: Locale;
  response: AlarmIncidentCenterResponse;
  onClose: () => void;
  onRefresh: (message: string | null) => void;
}) {
  const panel = response.panel;
  const heading = useRef<HTMLHeadingElement>(null);
  const [action, setAction] = useState<ActionKind | null>(null);
  useEffect(() => {
    setAction(null);
    heading.current?.focus();
  }, [panel?.item.alarmId]);
  if (!panel)
    return (
      <section className="panel">
        <h2>{t(locale, 'alarmCenterPanel')}</h2>
        <p>{t(locale, 'alarmCenterNoSelection')}</p>
      </section>
    );
  const item = panel.item;
  const automatic = automaticStatePresentation(item.automaticState);
  const incident = incidentStatePresentation(item.incidentStatus);
  const caps = item.capabilities;
  return (
    <aside className="alarm-center-panel panel" aria-labelledby="alarm-center-panel-heading">
      <button className="action-button" type="button" onClick={onClose}>
        {t(locale, 'alarmCenterClose')}
      </button>
      <h2 id="alarm-center-panel-heading" ref={heading} tabIndex={-1}>
        {t(locale, 'alarmCenterPanel')}
      </h2>
      <p>{t(locale, 'alarmLifecycleSeparation')}</p>
      <dl className="alarm-center-details">
        <div>
          <dt>{t(locale, 'alarmEventType')}</dt>
          <dd>{t(locale, eventTypeKey(item.eventType))}</dd>
        </div>
        <div>
          <dt>{t(locale, 'alarmSeverity')}</dt>
          <dd>
            <StatusValue locale={locale} {...severityPresentation(item.severity)} />
          </dd>
        </div>
        <div>
          <dt>{t(locale, 'alarmAutomaticState')}</dt>
          <dd>
            <StatusValue locale={locale} {...automatic} />
          </dd>
        </div>
        <div>
          <dt>{t(locale, 'alarmIncidentState')}</dt>
          <dd>
            <StatusValue locale={locale} {...incident} />
          </dd>
        </div>
        <div>
          <dt>{t(locale, 'alarmWaterCondition')}</dt>
          <dd>{t(locale, waterConditionKey(item.waterCondition))}</dd>
        </div>
        <div>
          <dt>{t(locale, 'alarmSystemCondition')}</dt>
          <dd>{t(locale, systemConditionKey(item.systemDeviceCondition))}</dd>
        </div>
        <div>
          <dt>{t(locale, 'territory')}</dt>
          <dd>{`${item.territory.name} (${item.territory.code})`}</dd>
        </div>
        <div>
          <dt>{t(locale, 'alarmAssignee')}</dt>
          <dd>
            <Assignee
              candidates={response.assignmentCandidates}
              locale={locale}
              userId={item.assignedUserId}
            />
          </dd>
        </div>
        <div>
          <dt>{t(locale, 'alarmDetectedAt')}</dt>
          <dd>
            <Timestamp locale={locale} value={item.detectedAt} />
          </dd>
        </div>
        <div>
          <dt>{t(locale, 'alarmClearedAt')}</dt>
          <dd>
            <Timestamp locale={locale} value={item.clearedAt} />
          </dd>
        </div>
        <div>
          <dt>{t(locale, 'provenance')}</dt>
          <dd>{item.provenance.label}</dd>
        </div>
      </dl>
      <Evidence item={item} locale={locale} />
      <section aria-labelledby="alarm-escalation-heading">
        <h3 id="alarm-escalation-heading">{t(locale, 'alarmEscalation')}</h3>
        <dl className="alarm-center-details">
          <div>
            <dt>{t(locale, 'alarmEscalationState')}</dt>
            <dd>
              {t(
                locale,
                item.escalation.state === 'configured' ? 'statusReported' : 'statusUnconfigured',
              )}
            </dd>
          </div>
          <div>
            <dt>{t(locale, 'alarmEscalationTier')}</dt>
            <dd>{item.escalation.tier ?? '—'}</dd>
          </div>
          <div>
            <dt>{t(locale, 'alarmEscalationProcedure')}</dt>
            <dd>{item.escalation.procedure ?? t(locale, 'sourceUnconfigured')}</dd>
          </div>
        </dl>
        {panel.metrics ? (
          <dl className="alarm-center-details">
            <div>
              <dt>{t(locale, 'alarmAcknowledgementMetric')}</dt>
              <dd>{t(locale, metricStateKey(panel.metrics.acknowledgement.state))}</dd>
              <small>
                {t(locale, 'alarmElapsed')}:{' '}
                {formatAlarmCenterMicros(panel.metrics.acknowledgement.elapsedMicroseconds, locale)}
              </small>
              <small>
                {t(locale, 'alarmDueAt')}:{' '}
                <Timestamp locale={locale} value={panel.metrics.acknowledgement.dueAt} />
              </small>
            </div>
            <div>
              <dt>{t(locale, 'alarmResolutionMetric')}</dt>
              <dd>{t(locale, metricStateKey(panel.metrics.resolution.state))}</dd>
              <small>
                {t(locale, 'alarmElapsed')}:{' '}
                {formatAlarmCenterMicros(panel.metrics.resolution.elapsedMicroseconds, locale)}
              </small>
              <small>
                {t(locale, 'alarmDueAt')}:{' '}
                <Timestamp locale={locale} value={panel.metrics.resolution.dueAt} />
              </small>
            </div>
          </dl>
        ) : (
          <p className="alarm-center-unconfigured">{t(locale, 'alarmMetricsUnconfigured')}</p>
        )}
        <p>
          {t(locale, 'provenance')}: {item.escalation.provenance ?? t(locale, 'sourceUnconfigured')}
        </p>
      </section>
      <section aria-labelledby="alarm-linked-heading">
        <h3 id="alarm-linked-heading">{t(locale, 'alarmLinkedAlarms')}</h3>
        <ul className="alarm-center-linked">
          {panel.linkedAlarms.map((alarm) => {
            const status = automaticStatePresentation(alarm.automaticState);
            return (
              <li key={alarm.alarmId}>
                <StatusValue locale={locale} {...status} />
                <span>
                  <Timestamp locale={locale} value={alarm.detectedAt} />
                </span>
                <span>
                  <Timestamp locale={locale} value={alarm.clearedAt} />
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-labelledby="alarm-actions-heading">
        <h3 id="alarm-actions-heading">{t(locale, 'alarmActions')}</h3>
        <div className="alarm-center-actions">
          <CapabilityButton
            action="create"
            capability={caps.createIncident}
            locale={locale}
            onSelect={setAction}
          />
          <CapabilityButton
            action="acknowledge"
            capability={caps.acknowledge}
            locale={locale}
            onSelect={setAction}
          />
          <CapabilityButton
            action="investigate"
            capability={caps.investigate}
            locale={locale}
            onSelect={setAction}
          />
          <CapabilityButton
            action="assign"
            capability={caps.assign}
            locale={locale}
            onSelect={setAction}
          />
          <CapabilityButton
            action="comment"
            capability={caps.comment}
            locale={locale}
            onSelect={setAction}
          />
          <CapabilityButton
            action="correctiveAction"
            capability={caps.correctiveAction}
            locale={locale}
            onSelect={setAction}
          />
          <CapabilityButton
            action="resolve"
            capability={caps.resolve}
            locale={locale}
            onSelect={setAction}
          />
          <CapabilityButton
            action="close"
            capability={caps.close}
            locale={locale}
            onSelect={setAction}
          />
        </div>
        {action ? (
          <ActionForm
            action={action}
            candidates={response.assignmentCandidates}
            item={item}
            locale={locale}
            onCancel={() => setAction(null)}
            onComplete={(message) => {
              setAction(null);
              onRefresh(message);
            }}
          />
        ) : null}
      </section>
      <section aria-labelledby="alarm-timeline-heading">
        <h3 id="alarm-timeline-heading">{t(locale, 'alarmImmutableTimeline')}</h3>
        {panel.timeline.length ? (
          <ol className="alarm-center-timeline">
            {panel.timeline.map((entry) => (
              <li key={entry.sequence}>
                <strong>{`${entry.sequence}. ${t(locale, `alarmTimeline${entry.kind.replace(/(^|_)([a-z])/g, (_, __, letter: string) => letter.toUpperCase())}` as TranslationKey)}`}</strong>
                <span>
                  <Timestamp locale={locale} value={entry.occurredAt} />
                </span>
                <span>{entry.reason}</span>
                {entry.body ? <span>{entry.body}</span> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p>{t(locale, 'alarmNoTimeline')}</p>
        )}
      </section>
    </aside>
  );
}

export function AlarmIncidentCenterWorkspace({
  locale,
  access,
  selection,
  onSelection,
}: {
  locale: Locale;
  access: 'loading' | 'ready' | 'unauthenticated' | 'unavailable';
  selection: AlarmCenterSelection;
  onSelection: (selection: AlarmCenterSelection) => void;
}) {
  const [filters, setFilters] = useState<AlarmCenterFilters>(emptyAlarmCenterFilters);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<readonly string[]>([]);
  const [response, setResponse] = useState<AlarmIncidentCenterResponse | null>(null);
  const [state, setState] = useState<WorkspaceState>('loading');
  const [refresh, setRefresh] = useState(0);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const returnFocus = useRef<string | null>(null);

  useEffect(() => {
    if (selection.alarmId || selection.incidentId || !returnFocus.current || state !== 'ready')
      return;
    const targetId = returnFocus.current;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (target) {
        target.focus();
        returnFocus.current = null;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [response, selection, state]);
  useEffect(() => {
    setCursor(null);
    setPrevious([]);
  }, [filters]);
  useEffect(() => {
    if (access === 'loading') {
      setState('loading');
      return;
    }
    if (access !== 'ready') {
      setState(access === 'unauthenticated' ? 'unauthenticated' : 'unavailable');
      return;
    }
    const controller = new AbortController();
    setState('loading');
    void fetch(alarmCenterPath(filters, selection, cursor), { signal: controller.signal })
      .then(async (result) => {
        const body: unknown = await result.json().catch(() => null);
        if (result.ok) {
          const parsed = alarmIncidentCenterResponseSchema.safeParse(body);
          if (parsed.success) {
            setResponse(parsed.data);
            setState(parsed.data.items.length ? 'ready' : 'empty');
            return;
          }
          setState('degraded');
          return;
        }
        setState(
          result.status === 401
            ? 'unauthenticated'
            : result.status === 403 || result.status === 404
              ? 'inaccessible'
              : 'unavailable',
        );
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setState('unavailable');
      });
    return () => controller.abort();
  }, [access, cursor, filters, refresh, selection]);
  const changeFilters = (next: AlarmCenterFilters) => {
    onSelection({ alarmId: null, incidentId: null });
    setFilters(next);
  };
  const select = (item: AlarmIncidentCenterItem) => {
    returnFocus.current = `alarm-center-row-${item.alarmId}`;
    onSelection(selectionForAlarmCenterItem(item));
  };
  const refreshAuthoritative = (message: string | null) => {
    setActionMessage(message ?? t(locale, 'alarmActionUpdated'));
    setRefresh((value) => value + 1);
  };
  if (state !== 'ready' && state !== 'empty')
    return (
      <StateNotice locale={locale} state={state} onRetry={() => setRefresh((value) => value + 1)} />
    );
  if (!response)
    return (
      <StateNotice
        locale={locale}
        state="degraded"
        onRetry={() => setRefresh((value) => value + 1)}
      />
    );
  const degraded = response.items.some((item) => item.evidence.assessment !== 'assessable');
  return (
    <section className="alarm-center" aria-labelledby="alarm-center-heading">
      <WorkspaceHeader
        detail={t(locale, 'alarmCenterDetail')}
        heading={t(locale, 'alarmCenterHeading')}
        headingId="alarm-center-heading"
        locale={locale}
        provenance={
          <>
            <p>{response.scenario.label}</p>
            <p>
              <strong>{t(locale, 'referenceAt')}:</strong>{' '}
              <Timestamp locale={locale} value={response.referenceAt} />
            </p>
            <p>
              <strong>{t(locale, 'knownAt')}:</strong>{' '}
              <Timestamp locale={locale} value={response.knownAt} />
            </p>
          </>
        }
      />
      {actionMessage ? (
        <p className="alarm-center-action-message" role="status">
          {actionMessage}
        </p>
      ) : null}
      {degraded ? (
        <section
          className="status-notice status-notice--warning"
          aria-label={t(locale, 'alarmCenterDegraded')}
        >
          <span aria-hidden="true" className="status-notice__icon">
            !
          </span>
          <div>
            <strong>{t(locale, 'alarmCenterDegraded')}</strong>
            <p>{t(locale, 'alarmCenterEvidenceDegraded')}</p>
          </div>
        </section>
      ) : null}
      <FilterForm
        filters={filters}
        locale={locale}
        onChange={changeFilters}
        onClear={() => changeFilters(emptyAlarmCenterFilters)}
      />
      {state === 'empty' ? (
        <section className="status-notice status-notice--information" aria-live="polite">
          <span aria-hidden="true" className="status-notice__icon">
            —
          </span>
          <div>
            <h3>{t(locale, 'alarmCenterEmpty')}</h3>
            <p>{t(locale, 'alarmCenterEmptyDetail')}</p>
          </div>
        </section>
      ) : (
        <>
          <AlarmCenterQueue
            locale={locale}
            response={response}
            selection={selection}
            onSelect={select}
          />
          <div className="alarm-center-pagination">
            {previous.length ? (
              <button
                className="action-button"
                type="button"
                onClick={() => {
                  const next = previous.at(-1) ?? null;
                  setPrevious((entries) => entries.slice(0, -1));
                  setCursor(next);
                }}
              >
                {t(locale, 'livePreviousPage')}
              </button>
            ) : null}
            {response.nextCursor ? (
              <button
                className="action-button"
                type="button"
                onClick={() => {
                  setPrevious((entries) => [...entries, cursor ?? '']);
                  setCursor(response.nextCursor);
                }}
              >
                {t(locale, 'liveNextPage')}
              </button>
            ) : null}
          </div>
          <AlarmCenterPanel
            locale={locale}
            response={response}
            onClose={() => onSelection({ alarmId: null, incidentId: null })}
            onRefresh={refreshAuthoritative}
          />
        </>
      )}
    </section>
  );
}

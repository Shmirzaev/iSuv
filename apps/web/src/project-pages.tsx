import { projectPageWords, type Locale, type ProjectPageWord } from '@isuv/i18n';
import {
  meteringPoints,
  pilotGates,
  projectFigures,
  projectMilestones,
  workflowSteps,
  type MeteringTier,
} from './project-pages-model.js';

function TierMarker({ tier, x = 0, y = 0 }: { tier: MeteringTier; x?: number; y?: number }) {
  if (tier === 'A') return <circle cx={x} cy={y} r={5} />;
  if (tier === 'B') return <rect x={x - 5} y={y - 5} width={10} height={10} />;
  return <path d={`M ${x} ${y - 6} l 6 11 h -12 Z`} />;
}

function MeteringSchematic({ locale }: { locale: Locale }) {
  const words = projectPageWords[locale];
  return (
    <figure className="project-schematic">
      <div className="project-scroll" tabIndex={0} role="region" aria-label={words.schematicLabel}>
        <svg
          className="project-network"
          viewBox="0 0 880 126"
          role="img"
          aria-label={words.schematicLabel}
        >
          <line x1={44} y1={50} x2={836} y2={50} />
          {meteringPoints.map((point, index) => (
            <g key={point.id}>
              <TierMarker tier={point.tier} x={44 + index * 44} y={50} />
              <text x={44 + index * 44} y={31} textAnchor="middle">
                {point.number ?? point.tier}
              </text>
            </g>
          ))}
          <text x={8} y={84}>
            {words.head}
          </text>
          <text x={8} y={108}>
            {words.headChainage}
          </text>
          <text x={872} y={84} textAnchor="end">
            {words.tail}
          </text>
          <text x={872} y={108} textAnchor="end">
            {words.tailChainage}
          </text>
        </svg>
      </div>
      <ul className="project-legend">
        {(['A', 'B', 'C'] as const).map((tier) => (
          <li key={tier}>
            <svg viewBox="-8 -8 16 16" aria-hidden="true">
              <TierMarker tier={tier} />
            </svg>
            {words[`tier${tier}`]}
          </li>
        ))}
      </ul>
      <figcaption>{words.schematicCaption}</figcaption>
    </figure>
  );
}

function WordList({ locale, keys }: { locale: Locale; keys: readonly ProjectPageWord[] }) {
  return (
    <ul>
      {keys.map((key) => (
        <li key={key}>{projectPageWords[locale][key]}</li>
      ))}
    </ul>
  );
}

export function ProjectOverviewPage({ locale }: { locale: Locale }) {
  const words = projectPageWords[locale];
  return (
    <article className="project-page" lang={locale} aria-labelledby="project-title">
      <header>
        <h1 id="project-title">{words.title}</h1>
        <p className="project-lead">{words.lead}</p>
      </header>
      <section>
        <h2>{words.goalHeading}</h2>
        <p>{words.goalBody}</p>
        <WordList locale={locale} keys={['outcomeFair', 'outcomeLosses', 'outcomeAudit']} />
      </section>
      <section>
        <h2>{words.workHeading}</h2>
        <h3>{words.platformHeading}</h3>
        <p>{words.platformBody}</p>
        <h3>{words.pilotHeading}</h3>
        <p>
          {words.pilotBody} <a href="#map">{words.mapLink}</a>
        </p>
      </section>
      <section>
        <h2>{words.figuresHeading}</h2>
        <dl className="project-figures">
          {projectFigures.map((figure) => (
            <div key={figure.label}>
              <dt>{words[figure.label]}</dt>
              <dd>
                <span>{new Intl.NumberFormat(locale).format(figure.value)}</span>
                {figure.unit ? (
                  <>
                    {' '}
                    <small>{words[figure.unit]}</small>
                  </>
                ) : null}
              </dd>
              {figure.note ? <dd className="project-figure-note">{words[figure.note]}</dd> : null}
            </div>
          ))}
        </dl>
        <p className="project-note">{words.designNote}</p>
      </section>
      <section>
        <h2>{words.meteringHeading}</h2>
        <MeteringSchematic locale={locale} />
        <p className="project-note">{words.configurationNote}</p>
      </section>
      <section>
        <h2>{words.howHeading}</h2>
        <ol className="project-steps">
          {workflowSteps.map((key, index) => (
            <li key={key}>
              {index > 0 ? <span aria-hidden="true">→ </span> : null}
              {words[key]}
            </li>
          ))}
        </ol>
      </section>
      <p className="project-endnote">{words.footerNote}</p>
    </article>
  );
}

export function ProjectRoadmapPage({ locale }: { locale: Locale }) {
  const words = projectPageWords[locale];
  return (
    <article className="project-page" lang={locale} aria-labelledby="roadmap-title">
      <header>
        <h1 id="roadmap-title">{words.roadmapTitle}</h1>
        <p className="project-lead">{words.roadmapLead}</p>
      </header>
      <ol className="project-timeline">
        {projectMilestones.map((milestone) => (
          <li key={milestone.date}>
            <p className="project-date">
              {words[milestone.date]} <span>· {words[milestone.status]}</span>
            </p>
            <h2>{words[milestone.title]}</h2>
            <WordList locale={locale} keys={milestone.bullets} />
          </li>
        ))}
      </ol>
      <section>
        <h2>{words.gatesHeading}</h2>
        <ul className="project-gates">
          {pilotGates.map((key) => (
            <li key={key}>
              <span aria-hidden="true">✓</span>
              <span>{words[key]}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>{words.afterHeading}</h2>
        <WordList locale={locale} keys={['afterNotices', 'afterMobile', 'afterForecast']} />
      </section>
      <p className="project-endnote">{words.footerNote}</p>
    </article>
  );
}

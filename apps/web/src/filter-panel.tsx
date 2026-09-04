import type { ReactNode } from 'react';
import { useId, useState } from 'react';

export interface ActiveFilter {
  id: string;
  label: string;
  onRemove: () => void;
}

interface FilterPanelProps {
  activeFilters?: readonly ActiveFilter[];
  children: ReactNode;
  clearLabel: string;
  filtersLabel: string;
  onClear?: () => void;
  search?: ReactNode;
}

/** Shared filter disclosure: search and active choices remain visible while the full form stays compact. */
export function FilterPanel({
  activeFilters = [],
  children,
  clearLabel,
  filtersLabel,
  onClear,
  search,
}: FilterPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  return (
    <section className="filter-panel" aria-label={filtersLabel}>
      <div className="filter-panel__toolbar">
        {search ? <div className="filter-panel__search">{search}</div> : null}
        <div className="filter-panel__chips" aria-live="polite">
          {activeFilters.map((filter) => (
            <span className="filter-chip" key={filter.id}>
              {filter.label}
              <button aria-label={`${filter.label} ×`} onClick={filter.onRemove} type="button">
                <span aria-hidden="true">×</span>
              </button>
            </span>
          ))}
        </div>
        <button
          aria-controls={contentId}
          aria-expanded={expanded}
          className="filter-panel__toggle"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {`${filtersLabel} (${activeFilters.length})`}
        </button>
        {activeFilters.length > 0 && onClear ? (
          <button className="filter-panel__clear" onClick={onClear} type="button">
            {clearLabel}
          </button>
        ) : null}
      </div>
      <div className="filter-panel__content" hidden={!expanded} id={contentId}>
        {children}
      </div>
    </section>
  );
}

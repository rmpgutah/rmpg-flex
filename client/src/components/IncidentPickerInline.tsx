// ============================================================
// IncidentPickerInline — inline form-friendly variant of IncidentPicker
// ============================================================
// IncidentPicker is a full panel meant for the document-intake "where
// does this go?" step. For form fields embedded inside larger pages
// (UseOfForcePage, JailFormModal, EvidencePropertyPage) we want the
// same UX as PersonPicker / OfficerPicker: text input with dropdown
// below. Pulls /incidents once on mount + client-filters because the
// search endpoint doesn't take a `q` param and < 1000 incidents per
// org keeps this responsive.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, FileText, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { humanizeType } from '../utils/statusLabels';
import { useTypeaheadKeyboard } from '../hooks/useTypeaheadKeyboard';

export interface IncidentSummary {
  id: number;
  incident_number: string;
  type?: string | null;
  status?: string | null;
  location?: string | null;
  narrative_summary?: string | null;
  officer_name?: string | null;
  created_at?: string | null;
}

interface Props {
  value: number | null;
  /** Pre-fill the visible incident_number when editing an existing record. */
  displayValue?: string;
  onChange: (id: number | null, incident?: IncidentSummary) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
}

export default function IncidentPickerInline({
  value, displayValue, onChange,
  placeholder = 'Search incident # / type / location…',
  disabled = false, required = false, id, className = '',
}: Props) {
  const [query, setQuery] = useState(displayValue ?? '');
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (displayValue != null && displayValue !== query && value != null) {
      setQuery(displayValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayValue, value]);

  // Self-heal: hydrate the visible name from the loaded list when value is
  // set but query is empty (edit-mode forms without an explicit displayValue).
  useEffect(() => {
    if (value != null && query === '' && incidents.length > 0) {
      const match = incidents.find((i) => i.id === value);
      if (match) setQuery(match.incident_number);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, incidents]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<IncidentSummary[] | { data?: IncidentSummary[] }>('/incidents?archived=false')
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        setIncidents(list);
        setError(null);
      })
      .catch((err: any) => { if (!cancelled) setError(err?.message || 'Failed to load incidents'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return incidents.slice(0, 12);
    return incidents
      .filter((i) =>
        (i.incident_number ?? '').toLowerCase().includes(q) ||
        (humanizeType(i.type ?? '') ?? '').toLowerCase().includes(q) ||
        (i.type ?? '').toLowerCase().includes(q) ||
        (i.location ?? '').toLowerCase().includes(q) ||
        (i.narrative_summary ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, incidents]);

  const select = useCallback((incident: IncidentSummary) => {
    setQuery(incident.incident_number);
    setOpen(false);
    onChange(incident.id, incident);
  }, [onChange]);

  const clear = useCallback(() => {
    setQuery('');
    setOpen(false);
    onChange(null);
    inputRef.current?.focus();
  }, [onChange]);

  const showClear = value != null || query.length > 0;

  const idPrefix = useId();
  const { onKeyDown, activeIndex, listboxProps, optionProps, activeDescendantId } =
    useTypeaheadKeyboard({
      open, items: filtered, onSelect: select,
      onClose: () => setOpen(false), idPrefix: `ip${idPrefix}`,
    });

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
        <input
          id={id}
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (value != null) onChange(null); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className="w-full bg-surface-sunken border border-border-default pl-7 pr-7 py-1.5 text-[11px] text-rmpg-100 disabled:opacity-50"
          style={{ borderRadius: 2 }}
          role="combobox"
          aria-label={required ? 'Search incident (required)' : 'Search incident'}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxProps.id}
          aria-activedescendant={activeDescendantId ?? undefined}
        />
        {showClear && !disabled && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-fg-muted hover:text-rmpg-100"
            aria-label="Clear selection"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {open && (filtered.length > 0 || loading || error) && (
        <div
          {...listboxProps}
          className="absolute left-0 right-0 mt-1 bg-surface-base border border-border-default panel-beveled z-30 max-h-[260px] overflow-y-auto scrollbar-dark"
          style={{ borderRadius: 2 }}
        >
          {loading && (
            <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">Loading incidents…</div>
          )}
          {error && (
            <div className="px-3 py-2 text-[11px] text-[color:var(--sev-critical)]">{error}</div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">No matches.</div>
          )}
          {filtered.map((i, idx) => {
            const selected = value === i.id;
            const active = idx === activeIndex;
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => select(i)}
                {...optionProps(idx, selected)}
                className={`w-full text-left px-3 py-2 border-b border-border-default flex items-start gap-2 ${selected ? 'bg-surface-deep' : ''} ${active ? 'bg-surface-raised' : 'hover:bg-surface-raised'}`}
                style={{ borderLeft: selected ? '2px solid var(--field-label-color)' : '2px solid transparent' }}
              >
                <FileText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: selected ? 'var(--field-label-color)' : 'var(--text-muted)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono font-semibold text-[color:var(--field-label-color)]">{i.incident_number}</div>
                  <div className="text-[10px] text-rmpg-400 mt-0.5">
                    {humanizeType(i.type ?? '') || 'Unknown type'}
                    {i.officer_name && <span className="ml-2">· {i.officer_name}</span>}
                  </div>
                  {i.location && (
                    <div className="text-[10px] text-fg-muted mt-0.5 truncate">{i.location}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

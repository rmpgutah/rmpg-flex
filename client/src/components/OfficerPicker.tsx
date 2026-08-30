// ============================================================
// OfficerPicker — inline name-search dropdown for RMPG personnel
// ============================================================
// Same UX as PersonPicker but pulls from `users` via /api/personnel
// (officers, not civilian persons). With <100 RMPG officers the
// list fits in one fetch + client-side filter — no debounced
// server search needed. Filters on full_name, badge_number, rank,
// and unit call sign.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, Shield, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useTypeaheadKeyboard } from '../hooks/useTypeaheadKeyboard';

export interface OfficerSummary {
  id: number;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  badge_number?: string | null;
  rank?: string | null;
  role?: string | null;
  status?: string | null;
  unit_call_sign?: string | null;
}

interface Props {
  value: number | null;
  /** Pre-fill the visible name when editing an existing record. */
  displayValue?: string;
  onChange: (id: number | null, officer?: OfficerSummary) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  /** Restrict to active officers (default true — usually you don't want
   *  to link a booking to a terminated officer). */
  activeOnly?: boolean;
}

const formatName = (o: OfficerSummary): string =>
  o.full_name?.trim() ||
  [o.first_name, o.last_name].filter(Boolean).join(' ').trim() ||
  `Officer #${o.id}`;

export default function OfficerPicker({
  value, displayValue, onChange,
  placeholder = 'Search officer by name, badge, or unit…',
  disabled = false, required = false, id, className = '', activeOnly = true,
}: Props) {
  const [query, setQuery] = useState(displayValue ?? '');
  const [officers, setOfficers] = useState<OfficerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Hydrate visible name on late displayValue.
  useEffect(() => {
    if (displayValue != null && displayValue !== query && value != null) {
      setQuery(displayValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayValue, value]);

  // Self-heal hydration: when the parent passes `value` (an officer FK)
  // without a `displayValue` (the common case — modal forms hydrate the
  // numeric FK from an existing record but don't know the officer's
  // name), look up the officer in the already-loaded list and surface
  // the name. Without this, editing an existing record would show the
  // picker BLANK until the operator re-typed, which made every edit
  // look like "no officer assigned" — high-risk for booking / IA /
  // QA forms (caught by the 2026-06-21 audit).
  useEffect(() => {
    if (value != null && query === '' && officers.length > 0) {
      const match = officers.find((o) => o.id === value);
      if (match) setQuery(formatName(match));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, officers]);

  // One-shot fetch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = activeOnly ? '/personnel?status=active' : '/personnel';
    apiFetch<OfficerSummary[] | { data?: OfficerSummary[] }>(url)
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        setOfficers(list);
        setError(null);
      })
      .catch((err: any) => { if (!cancelled) setError(err?.message || 'Failed to load officers'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeOnly]);

  // Close on click-outside.
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
    if (!q) return officers.slice(0, 12);
    // If the input matches the already-selected officer's name exactly,
    // don't replay the full list — just show that one row.
    return officers
      .filter((o) =>
        (o.full_name ?? '').toLowerCase().includes(q) ||
        (o.badge_number ?? '').toLowerCase().includes(q) ||
        (o.rank ?? '').toLowerCase().includes(q) ||
        (o.unit_call_sign ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, officers]);

  const select = useCallback((officer: OfficerSummary) => {
    setQuery(formatName(officer));
    setOpen(false);
    onChange(officer.id, officer);
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
      onClose: () => setOpen(false), idPrefix: `op${idPrefix}`,
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
          aria-label={required ? 'Search officer (required)' : 'Search officer'}
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
            <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">Loading officers…</div>
          )}
          {error && (
            <div className="px-3 py-2 text-[11px] text-[color:var(--sev-critical)]">{error}</div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">No matches.</div>
          )}
          {filtered.map((o, i) => {
            const selected = value === o.id;
            const active = i === activeIndex;
            const name = formatName(o);
            const tag = [o.rank, o.badge_number].filter(Boolean).join(' · ');
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => select(o)}
                {...optionProps(i, selected)}
                className={`w-full text-left px-3 py-2 border-b border-border-default flex items-start gap-2 ${selected ? 'bg-surface-deep' : ''} ${active ? 'bg-surface-raised' : 'hover:bg-surface-raised'}`}
                style={{ borderLeft: selected ? '2px solid var(--field-label-color)' : '2px solid transparent' }}
              >
                <Shield className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: selected ? 'var(--field-label-color)' : 'var(--text-muted)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-rmpg-100">{name}</div>
                  <div className="text-[10px] text-rmpg-400 mt-0.5 flex gap-2 flex-wrap">
                    {tag && <span>{tag}</span>}
                    {o.unit_call_sign && <span>· Unit {o.unit_call_sign}</span>}
                    {o.status && o.status !== 'active' && <span className="text-amber-400">· {o.status.toUpperCase()}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// CasePicker — inline search dropdown for Cases
// ============================================================
// Pulls /cases (full list, client-filters) on case_number, case_type,
// title, suspect_name. Identical UX to Person/Officer/Incident pickers.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, Briefcase, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useTypeaheadKeyboard } from '../hooks/useTypeaheadKeyboard';

export interface CaseSummary {
  id: number;
  case_number?: string | null;
  case_type?: string | null;
  title?: string | null;
  status?: string | null;
  suspect_name?: string | null;
  victim_name?: string | null;
  assigned_to_name?: string | null;
  opened_at?: string | null;
}

interface Props {
  value: number | null;
  displayValue?: string;
  onChange: (id: number | null, kase?: CaseSummary) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
}

const formatLabel = (k: CaseSummary): string =>
  k.case_number ?? k.title ?? `Case #${k.id}`;

export default function CasePicker({
  value, displayValue, onChange,
  placeholder = 'Search case # / title / suspect…',
  disabled = false, required = false, id, className = '',
}: Props) {
  const [query, setQuery] = useState(displayValue ?? '');
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (displayValue != null && displayValue !== query && value != null) setQuery(displayValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayValue, value]);

  useEffect(() => {
    if (value != null && query === '' && cases.length > 0) {
      const match = cases.find((k) => k.id === value);
      if (match) setQuery(formatLabel(match));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, cases]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<{ data?: CaseSummary[] } | CaseSummary[]>('/cases?limit=300')
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        setCases(list);
        setError(null);
      })
      .catch((err: any) => { if (!cancelled) setError(err?.message || 'Failed to load cases'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cases.slice(0, 12);
    return cases
      .filter((k) =>
        (k.case_number ?? '').toLowerCase().includes(q) ||
        (k.title ?? '').toLowerCase().includes(q) ||
        (k.case_type ?? '').toLowerCase().includes(q) ||
        (k.suspect_name ?? '').toLowerCase().includes(q) ||
        (k.victim_name ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, cases]);

  const select = useCallback((kase: CaseSummary) => {
    setQuery(formatLabel(kase));
    setOpen(false);
    onChange(kase.id, kase);
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
      onClose: () => setOpen(false), idPrefix: `kp${idPrefix}`,
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
          aria-label={required ? 'Search case (required)' : 'Search case'}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxProps.id}
          aria-activedescendant={activeDescendantId ?? undefined}
        />
        {showClear && !disabled && (
          <button type="button" onClick={clear} className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-fg-muted hover:text-rmpg-100" aria-label="Clear selection">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {open && (filtered.length > 0 || loading || error || query.trim().length > 0) && (
        <div className="absolute left-0 right-0 mt-1 bg-surface-base border border-border-default panel-beveled z-30 max-h-[260px] overflow-y-auto scrollbar-dark" style={{ borderRadius: 2 }}>
          {loading && <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">Loading cases…</div>}
          {error && <div className="px-3 py-2 text-[11px] text-[color:var(--sev-critical)]">{error}</div>}
          {!loading && !error && filtered.length === 0 && <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">No matches.</div>}
          {filtered.map((k, i) => {
            const selected = value === k.id;
            const active = i === activeIndex;
            const sub = [k.case_type, k.suspect_name && `Suspect: ${k.suspect_name}`, k.assigned_to_name].filter(Boolean).join(' · ');
            return (
              <button key={k.id} type="button" onClick={() => select(k)}
                {...optionProps(i, selected)}
                className={`w-full text-left px-3 py-2 border-b border-border-default  flex items-start gap-2 ${selected ? 'bg-surface-deep' : ''} ${active ? 'bg-surface-raised' : 'hover:bg-surface-raised'}`}
                style={{ borderLeft: selected ? '2px solid var(--field-label-color)' : '2px solid transparent' }}>
                <Briefcase className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: selected ? 'var(--field-label-color)' : 'var(--text-muted)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono font-semibold text-[color:var(--field-label-color)]">{formatLabel(k)}</div>
                  {k.title && <div className="text-[10px] text-rmpg-300 mt-0.5 truncate">{k.title}</div>}
                  {sub && <div className="text-[10px] text-fg-muted mt-0.5 truncate">{sub}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

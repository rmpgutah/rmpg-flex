// ============================================================
// ArrestPicker — inline name-search dropdown for jail bookings
// ============================================================
// "Arrest records" map to the `inmates` table — each row is a
// booking. Pulls /jail/inmates (paginated, default 100 per page;
// RMPG has fewer than that at once, so one fetch covers the
// active set + recent history) and client-filters on
// booking_number + last/first name + housing_unit + cell.
//
// Closes the typed-numeric fallback in RecordPicker for arrest
// linking from IncidentsPage / TaskFormModal.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, Gavel, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useTypeaheadKeyboard } from '../hooks/useTypeaheadKeyboard';

export interface ArrestSummary {
  id: number;
  booking_number?: string | null;
  last_name?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  status?: string | null;
  housing_unit?: string | null;
  housing_cell?: string | null;
  arresting_agency?: string | null;
  booking_date?: string | null;
  arrest_incident_id?: number | null;
}

interface Props {
  value: number | null;
  displayValue?: string;
  onChange: (id: number | null, arrest?: ArrestSummary) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
}

const formatLabel = (a: ArrestSummary): string => {
  const name = [a.first_name, a.middle_name, a.last_name].filter(Boolean).join(' ');
  return a.booking_number ?? name ?? `Booking #${a.id}`;
};

interface JailListResponse {
  data?: ArrestSummary[];
  inmates?: ArrestSummary[];
  pagination?: { total: number; page: number; per_page: number };
}

export default function ArrestPicker({
  value, displayValue, onChange,
  placeholder = 'Search booking # / name / cell…',
  disabled = false, required = false, id, className = '',
}: Props) {
  const [query, setQuery] = useState(displayValue ?? '');
  const [arrests, setArrests] = useState<ArrestSummary[]>([]);
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
    if (value != null && query === '' && arrests.length > 0) {
      const match = arrests.find((a) => a.id === value);
      if (match) setQuery(formatLabel(match));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, arrests]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<JailListResponse | ArrestSummary[]>('/jail/inmates?per_page=200')
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res)
          ? res
          : (res?.data ?? res?.inmates ?? []);
        setArrests(list);
        setError(null);
      })
      .catch((err: any) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load bookings'); })
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
    if (!q) return arrests.slice(0, 12);
    return arrests
      .filter((a) =>
        (a.booking_number ?? '').toLowerCase().includes(q) ||
        (a.last_name ?? '').toLowerCase().includes(q) ||
        (a.first_name ?? '').toLowerCase().includes(q) ||
        (a.housing_unit ?? '').toLowerCase().includes(q) ||
        (a.housing_cell ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, arrests]);

  const select = useCallback((arrest: ArrestSummary) => {
    setQuery(formatLabel(arrest));
    setOpen(false);
    onChange(arrest.id, arrest);
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
      onClose: () => setOpen(false), idPrefix: `ap${idPrefix}`,
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
          aria-label={required ? 'Search arrest record (required)' : 'Search arrest record'}
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
          {loading && <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">Loading bookings…</div>}
          {error && <div className="px-3 py-2 text-[11px] text-[color:var(--sev-critical)]">{error}</div>}
          {!loading && !error && filtered.length === 0 && <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">No matches.</div>}
          {filtered.map((a, i) => {
            const selected = value === a.id;
            const active = i === activeIndex;
            const name = [a.first_name, a.last_name].filter(Boolean).join(' ');
            const housing = [a.housing_unit, a.housing_cell].filter(Boolean).join(' / ');
            const sub = [name, housing, a.arresting_agency].filter(Boolean).join(' · ');
            return (
              <button key={a.id} type="button" onClick={() => select(a)}
                {...optionProps(i, selected)}
                className={`w-full text-left px-3 py-2 border-b border-border-default  flex items-start gap-2 ${selected ? 'bg-surface-deep' : ''} ${active ? 'bg-surface-raised' : 'hover:bg-surface-raised'}`}
                style={{ borderLeft: selected ? '2px solid var(--field-label-color)' : '2px solid transparent' }}>
                <Gavel className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: selected ? 'var(--field-label-color)' : 'var(--text-muted)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono font-semibold text-[color:var(--field-label-color)]">{formatLabel(a)}</div>
                  {sub && <div className="text-[10px] text-rmpg-400 mt-0.5 truncate">{sub}</div>}
                  {a.status && a.status !== 'booked' && <div className="text-[9px] text-amber-400 mt-0.5">{a.status.toUpperCase()}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

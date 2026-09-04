// ============================================================
// UnitPicker — inline name-search dropdown for dispatch units
// ============================================================
// Same shape as PersonPicker / OfficerPicker. Pulls /dispatch/units
// once (RMPG has ~20 units, fits in one fetch) + client-filters on
// call_sign, officer_name, badge_number, vehicle_number.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, Radio, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useTypeaheadKeyboard } from '../hooks/useTypeaheadKeyboard';

export interface UnitSummary {
  id: number;
  call_sign?: string | null;
  status?: string | null;
  officer_id?: number | null;
  officer_name?: string | null;
  badge_number?: string | null;
  vehicle_number?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
}

interface Props {
  value: number | null;
  displayValue?: string;
  onChange: (id: number | null, unit?: UnitSummary) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
}

const formatLabel = (u: UnitSummary): string =>
  u.call_sign ?? (u.vehicle_number ? `Veh ${u.vehicle_number}` : `Unit #${u.id}`);

export default function UnitPicker({
  value, displayValue, onChange,
  placeholder = 'Search by call sign, officer, vehicle…',
  disabled = false, required = false, id, className = '',
}: Props) {
  const [query, setQuery] = useState(displayValue ?? '');
  const [units, setUnits] = useState<UnitSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (displayValue != null && displayValue !== query && value != null) setQuery(displayValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayValue, value]);

  // Self-heal hydration from the loaded list.
  useEffect(() => {
    if (value != null && query === '' && units.length > 0) {
      const match = units.find((u) => u.id === value);
      if (match) setQuery(formatLabel(match));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, units]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<UnitSummary[] | { data?: UnitSummary[] }>('/dispatch/units')
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        setUnits(list);
        setError(null);
      })
      .catch((err: any) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load units'); })
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
    if (!q) return units.slice(0, 12);
    return units
      .filter((u) =>
        (u.call_sign ?? '').toLowerCase().includes(q) ||
        (u.officer_name ?? '').toLowerCase().includes(q) ||
        (u.badge_number ?? '').toLowerCase().includes(q) ||
        (u.vehicle_number ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, units]);

  const select = useCallback((unit: UnitSummary) => {
    setQuery(formatLabel(unit));
    setOpen(false);
    onChange(unit.id, unit);
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
      onClose: () => setOpen(false), idPrefix: `up${idPrefix}`,
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
          aria-label={required ? 'Search unit (required)' : 'Search unit'}
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
          {loading && <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">Loading units…</div>}
          {error && <div className="px-3 py-2 text-[11px] text-[color:var(--sev-critical)]">{error}</div>}
          {!loading && !error && filtered.length === 0 && <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">No matches.</div>}
          {filtered.map((u, i) => {
            const selected = value === u.id;
            const active = i === activeIndex;
            const sub = [u.officer_name, u.badge_number && `#${u.badge_number}`, u.vehicle_number && `Veh ${u.vehicle_number}`].filter(Boolean).join(' · ');
            return (
              <button key={u.id} type="button" onClick={() => select(u)}
                {...optionProps(i, selected)}
                className={`w-full text-left px-3 py-2 border-b border-border-default  flex items-start gap-2 ${selected ? 'bg-surface-deep' : ''} ${active ? 'bg-surface-raised' : 'hover:bg-surface-raised'}`}
                style={{ borderLeft: selected ? '2px solid var(--field-label-color)' : '2px solid transparent' }}>
                <Radio className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: selected ? 'var(--field-label-color)' : 'var(--text-muted)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono font-semibold text-rmpg-100">{formatLabel(u)}</div>
                  {sub && <div className="text-[10px] text-rmpg-400 mt-0.5 truncate">{sub}</div>}
                  {u.status && u.status !== 'available' && <div className="text-[9px] text-amber-400 mt-0.5">{u.status.toUpperCase()}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

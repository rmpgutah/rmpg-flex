// ============================================================
// CallPicker — inline search dropdown for Calls for Service
// ============================================================
// Same shape as IncidentPickerInline but pulls /dispatch/calls.
// Searches by call_number (CFS26-…), incident_type, location_address.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, Phone, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useTypeaheadKeyboard } from '../hooks/useTypeaheadKeyboard';

export interface CallSummary {
  id: number;
  call_number?: string | null;
  incident_type?: string | null;
  priority?: string | null;
  status?: string | null;
  location_address?: string | null;
  dispatched_at?: string | null;
}

interface Props {
  value: number | null;
  displayValue?: string;
  onChange: (id: number | null, call?: CallSummary) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
}

const formatLabel = (c: CallSummary): string => c.call_number ?? `Call #${c.id}`;

export default function CallPicker({
  value, displayValue, onChange,
  placeholder = 'Search call # / type / location…',
  disabled = false, required = false, id, className = '',
}: Props) {
  const [query, setQuery] = useState(displayValue ?? '');
  const [calls, setCalls] = useState<CallSummary[]>([]);
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
    if (value != null && query === '' && calls.length > 0) {
      const match = calls.find((c) => c.id === value);
      if (match) setQuery(formatLabel(match));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, calls]);

  // /dispatch/calls supports server-side `search` param + paging; ask for a
  // generous page (300) so the recent-calls universe fits in one fetch and
  // we can client-filter without burning network on every keystroke.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<{ data?: CallSummary[] } | CallSummary[]>('/dispatch/calls?limit=300')
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        setCalls(list);
        setError(null);
      })
      .catch((err: any) => { if (!cancelled) setError(err?.message || 'Failed to load calls'); })
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
    if (!q) return calls.slice(0, 12);
    return calls
      .filter((c) =>
        (c.call_number ?? '').toLowerCase().includes(q) ||
        (c.incident_type ?? '').toLowerCase().includes(q) ||
        (c.location_address ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, calls]);

  const select = useCallback((call: CallSummary) => {
    setQuery(formatLabel(call));
    setOpen(false);
    onChange(call.id, call);
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
      onClose: () => setOpen(false), idPrefix: `cp${idPrefix}`,
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
          aria-label={required ? 'Search call (required)' : 'Search call'}
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
          {loading && <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">Loading calls…</div>}
          {error && <div className="px-3 py-2 text-[11px] text-[color:var(--sev-critical)]">{error}</div>}
          {!loading && !error && filtered.length === 0 && <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">No matches.</div>}
          {filtered.map((c, i) => {
            const selected = value === c.id;
            const active = i === activeIndex;
            return (
              <button key={c.id} type="button" onClick={() => select(c)}
                {...optionProps(i, selected)}
                className={`w-full text-left px-3 py-2 border-b border-border-default  flex items-start gap-2 ${selected ? 'bg-surface-deep' : ''} ${active ? 'bg-surface-raised' : 'hover:bg-surface-raised'}`}
                style={{ borderLeft: selected ? '2px solid var(--field-label-color)' : '2px solid transparent' }}>
                <Phone className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: selected ? 'var(--field-label-color)' : 'var(--text-muted)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono font-semibold text-[color:var(--field-label-color)]">{formatLabel(c)}</div>
                  <div className="text-[10px] text-rmpg-400 mt-0.5">
                    {c.incident_type || 'Unknown type'}
                    {c.priority && <span className="ml-2">P{c.priority}</span>}
                    {c.status && <span className="ml-2 text-fg-muted">[{c.status.toUpperCase()}]</span>}
                  </div>
                  {c.location_address && <div className="text-[10px] text-fg-muted mt-0.5 truncate">{c.location_address}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

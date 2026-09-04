// ============================================================
// ClientPicker — inline name-search dropdown for billing clients
// ============================================================
// Pulls /clients (returns active-by-default) and client-filters by
// name + primary_contact + phone. Same UX as the other pickers.
// Used in BillingFormModal where the operator was previously typing
// the numeric client.id into a number input.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, Building2, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useTypeaheadKeyboard } from '../hooks/useTypeaheadKeyboard';

export interface ClientSummary {
  id: number;
  name?: string | null;
  primary_contact?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  status?: string | null;
}

interface Props {
  value: number | null;
  displayValue?: string;
  onChange: (id: number | null, client?: ClientSummary) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  /** Only show active clients (default true). */
  activeOnly?: boolean;
}

const formatLabel = (c: ClientSummary): string => c.name ?? `Client #${c.id}`;

export default function ClientPicker({
  value, displayValue, onChange,
  placeholder = 'Search client by name, contact…',
  disabled = false, required = false, id, className = '', activeOnly = true,
}: Props) {
  const [query, setQuery] = useState(displayValue ?? '');
  const [clients, setClients] = useState<ClientSummary[]>([]);
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
    if (value != null && query === '' && clients.length > 0) {
      const match = clients.find((c) => c.id === value);
      if (match) setQuery(formatLabel(match));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, clients]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = activeOnly ? '/clients?status=active' : '/clients';
    apiFetch<ClientSummary[] | { data?: ClientSummary[] }>(url)
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        setClients(list);
        setError(null);
      })
      .catch((err: any) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load clients'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeOnly]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients.slice(0, 12);
    return clients
      .filter((c) =>
        (c.name ?? '').toLowerCase().includes(q) ||
        (c.primary_contact ?? '').toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, clients]);

  const select = useCallback((client: ClientSummary) => {
    setQuery(formatLabel(client));
    setOpen(false);
    onChange(client.id, client);
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
      onClose: () => setOpen(false), idPrefix: `clp${idPrefix}`,
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
          aria-label={required ? 'Search client (required)' : 'Search client'}
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
          {loading && <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">Loading clients…</div>}
          {error && <div className="px-3 py-2 text-[11px] text-[color:var(--sev-critical)]">{error}</div>}
          {!loading && !error && filtered.length === 0 && <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">No matches.</div>}
          {filtered.map((c, i) => {
            const selected = value === c.id;
            const active = i === activeIndex;
            const sub = [c.primary_contact, c.phone, [c.city, c.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
            return (
              <button key={c.id} type="button" onClick={() => select(c)}
                {...optionProps(i, selected)}
                className={`w-full text-left px-3 py-2 border-b border-border-default  flex items-start gap-2 ${selected ? 'bg-surface-deep' : ''} ${active ? 'bg-surface-raised' : 'hover:bg-surface-raised'}`}
                style={{ borderLeft: selected ? '2px solid var(--field-label-color)' : '2px solid transparent' }}>
                <Building2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: selected ? 'var(--field-label-color)' : 'var(--text-muted)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-rmpg-100">{formatLabel(c)}</div>
                  {sub && <div className="text-[10px] text-rmpg-400 mt-0.5 truncate">{sub}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

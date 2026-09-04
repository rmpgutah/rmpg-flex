// ============================================================
// ContractPicker — inline name-search dropdown for client_contracts
// ============================================================
// Pulls /billing/contracts and client-filters on contract_number,
// client_name, contract_type. Supports an optional `clientId` prop
// to scope the dropdown to a single client's contracts — the typical
// invoice-creation flow picks a client first, then a contract within
// it. When clientId is null the picker shows all contracts.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, FileText, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useTypeaheadKeyboard } from '../hooks/useTypeaheadKeyboard';

export interface ContractSummary {
  id: number;
  contract_number?: string | null;
  contract_type?: string | null;
  client_id?: number | null;
  client_name?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  rate_amount?: number | null;
  rate_type?: string | null;
}

interface Props {
  value: number | null;
  displayValue?: string;
  onChange: (id: number | null, contract?: ContractSummary) => void;
  /** When set, only contracts belonging to this client appear. The picker
   *  re-fetches when clientId changes so a newly-picked client's contracts
   *  populate without a parent remount. */
  clientId?: number | null;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
}

const formatLabel = (k: ContractSummary): string =>
  k.contract_number ?? (k.contract_type ? `${k.contract_type} contract` : `Contract #${k.id}`);

export default function ContractPicker({
  value, displayValue, onChange, clientId,
  placeholder = 'Search contract # / type / client…',
  disabled = false, required = false, id, className = '',
}: Props) {
  const [query, setQuery] = useState(displayValue ?? '');
  const [contracts, setContracts] = useState<ContractSummary[]>([]);
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
    if (value != null && query === '' && contracts.length > 0) {
      const match = contracts.find((k) => k.id === value);
      if (match) setQuery(formatLabel(match));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, contracts]);

  // Refetch when clientId changes so the dropdown reflects the new scope.
  // If the previously-selected contract belonged to a different client,
  // surface that mismatch by clearing the selection — keeps the FK aligned
  // with the on-screen client. The user can re-pick within the new client.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = clientId ? `/billing/contracts?client_id=${clientId}` : '/billing/contracts';
    apiFetch<ContractSummary[] | { data?: ContractSummary[] }>(url)
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        setContracts(list);
        setError(null);
        // If clientId is set and the current value points at a contract
        // outside this client, clear it. (Skipped on initial mount when
        // value matches displayValue — the parent hydrated us with a
        // consistent pair.)
        if (clientId != null && value != null) {
          const stillValid = list.some((k) => k.id === value);
          if (!stillValid) {
            setQuery('');
            onChange(null);
          }
        }
      })
      .catch((err: any) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load contracts'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contracts.slice(0, 12);
    return contracts
      .filter((k) =>
        (k.contract_number ?? '').toLowerCase().includes(q) ||
        (k.contract_type ?? '').toLowerCase().includes(q) ||
        (k.client_name ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, contracts]);

  const select = useCallback((contract: ContractSummary) => {
    setQuery(formatLabel(contract));
    setOpen(false);
    onChange(contract.id, contract);
  }, [onChange]);

  const clear = useCallback(() => {
    setQuery('');
    setOpen(false);
    onChange(null);
    inputRef.current?.focus();
  }, [onChange]);

  const showClear = value != null || query.length > 0;
  const isDisabled = disabled || (clientId === null && false); // clientId optional — never disables

  const idPrefix = useId();
  const { onKeyDown, activeIndex, listboxProps, optionProps, activeDescendantId } =
    useTypeaheadKeyboard({
      open, items: filtered, onSelect: select,
      onClose: () => setOpen(false), idPrefix: `ctp${idPrefix}`,
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
          disabled={isDisabled}
          autoComplete="off"
          className="w-full bg-surface-sunken border border-border-default pl-7 pr-7 py-1.5 text-[11px] text-rmpg-100 disabled:opacity-50"
          style={{ borderRadius: 2 }}
          role="combobox"
          aria-label={required ? 'Search contract (required)' : 'Search contract'}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxProps.id}
          aria-activedescendant={activeDescendantId ?? undefined}
        />
        {showClear && !isDisabled && (
          <button type="button" onClick={clear} className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-fg-muted hover:text-rmpg-100" aria-label="Clear selection">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {open && (filtered.length > 0 || loading || error || query.trim().length > 0) && (
        <div className="absolute left-0 right-0 mt-1 bg-surface-base border border-border-default panel-beveled z-30 max-h-[260px] overflow-y-auto scrollbar-dark" style={{ borderRadius: 2 }}>
          {loading && <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">Loading contracts…</div>}
          {error && <div className="px-3 py-2 text-[11px] text-[color:var(--sev-critical)]">{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">
              {clientId != null ? 'No contracts for this client.' : 'No matches.'}
            </div>
          )}
          {filtered.map((k, i) => {
            const selected = value === k.id;
            const active = i === activeIndex;
            const sub = [k.client_name, k.contract_type, k.rate_amount != null && `$${k.rate_amount}${k.rate_type ? '/' + k.rate_type : ''}`].filter(Boolean).join(' · ');
            return (
              <button key={k.id} type="button" onClick={() => select(k)}
                {...optionProps(i, selected)}
                className={`w-full text-left px-3 py-2 border-b border-border-default  flex items-start gap-2 ${selected ? 'bg-surface-deep' : ''} ${active ? 'bg-surface-raised' : 'hover:bg-surface-raised'}`}
                style={{ borderLeft: selected ? '2px solid var(--field-label-color)' : '2px solid transparent' }}>
                <FileText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: selected ? 'var(--field-label-color)' : 'var(--text-muted)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono font-semibold text-[color:var(--field-label-color)]">{formatLabel(k)}</div>
                  {sub && <div className="text-[10px] text-rmpg-400 mt-0.5 truncate">{sub}</div>}
                  {k.status && k.status !== 'active' && <div className="text-[9px] text-amber-400 mt-0.5">{k.status.toUpperCase()}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

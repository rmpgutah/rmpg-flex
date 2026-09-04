// ============================================================
// WarrantPicker — inline name-search dropdown for warrants
// ============================================================
// Uses POST /warrants/search-all (the federated warrant search that
// hits local + external sources). Debounced 300ms, 2-char min so
// every keystroke doesn't fire a federated search. Searches by
// last name OR warrant number — the server expects a structured
// body, so we route 2-letter alpha-leading queries to lastName and
// digit-only queries to warrantNumber.
//
// Closes the typed-numeric fallback in RecordPicker for warrant
// linking from IncidentsPage / TaskFormModal.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, FileWarning, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useTypeaheadKeyboard } from '../hooks/useTypeaheadKeyboard';

export interface WarrantSummary {
  id: number;
  warrant_number?: string | null;
  type?: string | null;
  status?: string | null;
  charge_description?: string | null;
  subject_first_name?: string | null;
  subject_last_name?: string | null;
  issuing_court?: string | null;
  issued_date?: string | null;
  source?: string | null;
}

interface Props {
  value: number | null;
  displayValue?: string;
  onChange: (id: number | null, warrant?: WarrantSummary) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
}

const formatLabel = (w: WarrantSummary): string =>
  w.warrant_number ?? ([w.subject_first_name, w.subject_last_name].filter(Boolean).join(' ') || `Warrant #${w.id}`);

interface SearchAllResponse {
  local?: WarrantSummary[];
  external?: WarrantSummary[];
}

export default function WarrantPicker({
  value, displayValue, onChange,
  placeholder = 'Search warrant # / last name…',
  disabled = false, required = false, id, className = '',
}: Props) {
  const [query, setQuery] = useState(displayValue ?? '');
  const [results, setResults] = useState<WarrantSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (displayValue != null && displayValue !== query && value != null) setQuery(displayValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayValue, value]);

  // Self-heal: warrant FKs use the local warrants list endpoint to fetch
  // the specific row by id when value is set but query is empty.
  useEffect(() => {
    if (value == null || query !== '' || displayValue) return;
    let cancelled = false;
    apiFetch<{ warrants?: WarrantSummary[] }>(`/warrants?id=${value}&limit=1`)
      .then((r) => {
        if (cancelled) return;
        const w = (r?.warrants ?? [])[0];
        if (!w) return;
        // Race-defense: use functional setQuery so a mid-type user input
        // doesn't get clobbered when the fetch finally resolves.
        setQuery((current) => (current === '' ? formatLabel(w) : current));
      })
      .catch(() => { /* leave blank */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, displayValue]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Debounced search. /warrants/search-all is a federated POST endpoint
  // that hits local + external sources; only fire it when the query is
  // at least 2 chars and stable for 300ms, otherwise every keystroke
  // would hit the external warrant indices.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || (value != null && q === displayValue)) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        // Route digit-only queries to warrantNumber, anything else to lastName.
        // Both fields are LIKE-searched on the server so partial matches work.
        const body: Record<string, string> = /^\d+$/.test(q)
          ? { warrantNumber: q }
          : { lastName: q };
        const data = await apiFetch<SearchAllResponse>(
          '/warrants/search-all',
          { method: 'POST', body: JSON.stringify(body) },
        );
        if (cancelled) return;
        // Local hits are authoritative for FK linking; external hits would
        // be informational only (no DB id), so we filter them out for the
        // RecordPicker use case.
        const list = (data.local ?? []).slice(0, 20);
        setResults(list);
        setError(null);
        setOpen(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Warrant search failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, value, displayValue]);

  const select = useCallback((warrant: WarrantSummary) => {
    setQuery(formatLabel(warrant));
    setOpen(false);
    onChange(warrant.id, warrant);
  }, [onChange]);

  const clear = useCallback(() => {
    setQuery('');
    setOpen(false);
    onChange(null);
    inputRef.current?.focus();
  }, [onChange]);

  const showClear = useMemo(() => value != null || query.length > 0, [value, query]);

  const idPrefix = useId();
  const { onKeyDown, activeIndex, listboxProps, optionProps, activeDescendantId } =
    useTypeaheadKeyboard({
      open, items: results, onSelect: select,
      onClose: () => setOpen(false), idPrefix: `wp${idPrefix}`,
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
          aria-label={required ? 'Search warrant (required)' : 'Search warrant'}
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
      {open && (results.length > 0 || loading || error || query.trim().length >= 2) && (
        <div className="absolute left-0 right-0 mt-1 bg-surface-base border border-border-default panel-beveled z-30 max-h-[260px] overflow-y-auto scrollbar-dark" style={{ borderRadius: 2 }}>
          {loading && <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">Searching warrants…</div>}
          {error && <div className="px-3 py-2 text-[11px] text-[rgb(var(--sev-critical-rgb))]">{error}</div>}
          {!loading && !error && results.length === 0 && query.trim().length >= 2 && (
            <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">No local warrants matched.</div>
          )}
          {results.map((w, i) => {
            const selected = value === w.id;
            const active = i === activeIndex;
            const name = [w.subject_first_name, w.subject_last_name].filter(Boolean).join(' ');
            return (
              <button key={w.id} type="button" onClick={() => select(w)}
                {...optionProps(i, selected)}
                className={`w-full text-left px-3 py-2 border-b border-border-default  flex items-start gap-2 ${selected ? 'bg-[rgb(var(--brand-gold-rgb)/0.12)]' : ''} ${active ? 'bg-surface-raised' : 'hover:bg-surface-raised'}`}
                style={{ borderLeft: selected ? '2px solid var(--brand-gold)' : '2px solid transparent' }}>
                <FileWarning className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: selected ? 'var(--brand-gold)' : 'var(--spm-text-muted)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono font-semibold text-[var(--brand-gold)]">
                    {w.warrant_number || `Warrant #${w.id}`}
                    {w.type && <span className="ml-2 text-fg-muted">[{w.type}]</span>}
                  </div>
                  {name && <div className="text-[10px] text-rmpg-300 mt-0.5 truncate">{name}</div>}
                  {w.charge_description && <div className="text-[10px] text-fg-muted mt-0.5 truncate">{w.charge_description}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

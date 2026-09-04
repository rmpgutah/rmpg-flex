// ============================================================
// CitationPicker — inline name-search dropdown for citations
// ============================================================
// Uses GET /citations/search?q=… (the server endpoint already
// supports a 2-char minimum and LIKE-searches citation_number,
// person_name, vehicle_plate). Debounced 300ms.
//
// Closes the typed-numeric fallback in RecordPicker for citation
// linking from IncidentsPage / TaskFormModal.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, ScrollText, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useTypeaheadKeyboard } from '../hooks/useTypeaheadKeyboard';

export interface CitationSummary {
  id: number;
  citation_number?: string | null;
  person_name?: string | null;
  vehicle_plate?: string | null;
  violation_date?: string | null;
  violation_code?: string | null;
  violation_description?: string | null;
  fine_amount?: number | null;
  status?: string | null;
}

interface Props {
  value: number | null;
  displayValue?: string;
  onChange: (id: number | null, citation?: CitationSummary) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
}

const formatLabel = (k: CitationSummary): string =>
  k.citation_number ?? k.person_name ?? `Citation #${k.id}`;

export default function CitationPicker({
  value, displayValue, onChange,
  placeholder = 'Search citation # / name / plate…',
  disabled = false, required = false, id, className = '',
}: Props) {
  const [query, setQuery] = useState(displayValue ?? '');
  const [results, setResults] = useState<CitationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (displayValue != null && displayValue !== query && value != null) setQuery(displayValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayValue, value]);

  // Self-heal: fetch the citation by id when value is set but query is empty.
  useEffect(() => {
    if (value == null || query !== '' || displayValue) return;
    let cancelled = false;
    apiFetch<CitationSummary>(`/citations/${value}`)
      .then((c) => {
        if (cancelled || !c) return;
        setQuery((current) => (current === '' ? formatLabel(c) : current));
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
        const data = await apiFetch<{ data?: CitationSummary[] } | CitationSummary[]>(
          `/citations/search?q=${encodeURIComponent(q)}`,
        );
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data?.data ?? []);
        setResults(list.slice(0, 20));
        setError(null);
        setOpen(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Citation search failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, value, displayValue]);

  const select = useCallback((citation: CitationSummary) => {
    setQuery(formatLabel(citation));
    setOpen(false);
    onChange(citation.id, citation);
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
      onClose: () => setOpen(false), idPrefix: `ctnp${idPrefix}`,
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
          aria-label={required ? 'Search citation (required)' : 'Search citation'}
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
          {loading && <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">Searching citations…</div>}
          {error && <div className="px-3 py-2 text-[11px] text-[color:var(--sev-critical)]">{error}</div>}
          {!loading && !error && results.length === 0 && query.trim().length >= 2 && (
            <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">No citations matched.</div>
          )}
          {results.map((k, i) => {
            const selected = value === k.id;
            const active = i === activeIndex;
            const sub = [k.person_name, k.vehicle_plate, k.violation_code].filter(Boolean).join(' · ');
            return (
              <button key={k.id} type="button" onClick={() => select(k)}
                {...optionProps(i, selected)}
                className={`w-full text-left px-3 py-2 border-b border-border-default  flex items-start gap-2 ${selected ? 'bg-surface-deep' : ''} ${active ? 'bg-surface-raised' : 'hover:bg-surface-raised'}`}
                style={{ borderLeft: selected ? '2px solid var(--field-label-color)' : '2px solid transparent' }}>
                <ScrollText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: selected ? 'var(--field-label-color)' : 'var(--text-muted)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono font-semibold text-[color:var(--field-label-color)]">{formatLabel(k)}</div>
                  {sub && <div className="text-[10px] text-rmpg-400 mt-0.5 truncate">{sub}</div>}
                  {k.violation_description && <div className="text-[10px] text-fg-muted mt-0.5 truncate">{k.violation_description}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// PersonPicker — inline name-search dropdown for civilian records
// ============================================================
// Replaces "type the person's numeric ID into this field" with
// "type the person's name and pick from a dropdown." The DB still
// stores the FK ID — only the input surface changes.
//
// UX:
//   • Single text input. When empty, shows placeholder.
//   • Typing >= 2 chars debounces 300 ms then queries
//     /api/records/persons/search?q=. Dropdown opens with up to
//     8 results: name • DOB • phone (last known if available).
//   • Click a row → input fills with the person's name; onChange
//     fires with (id, person). Dropdown closes.
//   • "×" button clears the selection (onChange(null)).
//   • In controlled mode, displayValue hydrates the input when
//     editing an existing record (avoids a "what's person 4's
//     name?" round-trip on form open).
//
// Note: officers (RMPG personnel) live in `users`, not `persons`.
// For officer pickers use OfficerPicker, which has the same shape
// but pulls from /api/personnel.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, User, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useTypeaheadKeyboard } from '../hooks/useTypeaheadKeyboard';

export interface PersonSummary {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  date_of_birth?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
}

interface Props {
  value: number | null;
  /** Pre-fill the visible name when editing an existing record so the
   *  user sees "Camden Clark" on form open instead of having to type. */
  displayValue?: string;
  onChange: (id: number | null, person?: PersonSummary) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Render `Person *` label tag in the input (red asterisk). */
  required?: boolean;
  id?: string;
  className?: string;
}

const formatName = (p: PersonSummary): string => {
  const parts = [p.first_name, p.middle_name, p.last_name].filter(Boolean) as string[];
  return parts.join(' ').trim() || `Person #${p.id}`;
};

export default function PersonPicker({
  value, displayValue, onChange,
  placeholder = 'Search by name…',
  disabled = false, required = false, id, className = '',
}: Props) {
  const [query, setQuery] = useState(displayValue ?? '');
  const [results, setResults] = useState<PersonSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Hydrate the visible name when displayValue arrives late (parent fetched it).
  useEffect(() => {
    if (displayValue != null && displayValue !== query && value != null) {
      setQuery(displayValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayValue, value]);

  // Self-heal: when the parent passes `value` (a person FK) without a
  // `displayValue`, fetch that person's record by id and surface the name.
  // PersonPicker uses server-search (debounced 2-char min) instead of a
  // one-shot list, so unlike the other 8 pickers it can't pull the name
  // from a local cache — it has to ask the server. One GET per edit-mode
  // mount; cheap.
  //
  // Race-defense: the fetch is async, so the user can start typing before
  // it resolves. The functional setQuery checks the LATEST query, not the
  // value captured when the effect ran — if the user is mid-type, we
  // don't overwrite their input.
  useEffect(() => {
    if (value == null || query !== '' || displayValue) return;
    let cancelled = false;
    apiFetch<PersonSummary>(`/records/persons/${value}`)
      .then((p) => {
        if (cancelled || !p) return;
        setQuery((current) => (current === '' ? formatName(p) : current));
      })
      .catch(() => { /* leave blank; the user can search */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, displayValue]);

  // Click-outside closes the dropdown without losing the selection.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Debounced search. Skips when the input matches the already-selected
  // person's name so re-focusing doesn't re-fetch.
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
        const data = await apiFetch<{ data?: PersonSummary[] } | PersonSummary[]>(
          `/records/persons/search?q=${encodeURIComponent(q)}`,
        );
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data?.data ?? []);
        setResults(list);
        setError(null);
        setOpen(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, value, displayValue]);

  const select = useCallback((person: PersonSummary) => {
    setQuery(formatName(person));
    setOpen(false);
    onChange(person.id, person);
  }, [onChange]);

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
    setOpen(false);
    onChange(null);
    inputRef.current?.focus();
  }, [onChange]);

  const showClear = useMemo(() => value != null || query.length > 0, [value, query]);

  // Keyboard navigation — ArrowUp/Down/Home/End/Enter/Esc. Hook resets the
  // active index when the dropdown closes so opening fresh starts at -1
  // (no preselection — Enter on a fresh dropdown picks results[0]).
  const idPrefix = useId();
  const { onKeyDown, activeIndex, listboxProps, optionProps, activeDescendantId } =
    useTypeaheadKeyboard({
      open,
      items: results,
      onSelect: select,
      onClose: () => setOpen(false),
      idPrefix: `pp${idPrefix}`,
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
          aria-label={required ? 'Search person (required)' : 'Search person'}
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
      {open && (results.length > 0 || loading || error || query.trim().length >= 2) && (
        <div
          {...listboxProps}
          className="absolute left-0 right-0 mt-1 bg-surface-base border border-border-default panel-beveled z-30 max-h-[260px] overflow-y-auto scrollbar-dark"
          style={{ borderRadius: 2 }}
        >
          {loading && (
            <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">Searching…</div>
          )}
          {error && (
            <div className="px-3 py-2 text-[11px] text-[color:var(--sev-critical)]">{error}</div>
          )}
          {!loading && !error && results.length === 0 && query.trim().length >= 2 && (
            <div className="px-3 py-2 text-[10px] text-rmpg-400 italic">No matches.</div>
          )}
          {results.map((p, i) => {
            const selected = value === p.id;
            const active = i === activeIndex;
            const name = formatName(p);
            const dob = p.date_of_birth ? new Date(p.date_of_birth).toLocaleDateString('en-US', { timeZone: 'UTC' }) : null;
            const cityState = [p.city, p.state].filter(Boolean).join(', ');
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => select(p)}
                {...optionProps(i, selected)}
                className={`w-full text-left px-3 py-2 border-b border-border-default flex items-start gap-2 ${selected ? 'bg-surface-deep' : ''} ${active ? 'bg-surface-raised' : 'hover:bg-surface-raised'}`}
                style={{ borderLeft: selected ? '2px solid var(--field-label-color)' : '2px solid transparent' }}
              >
                <User className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: selected ? 'var(--field-label-color)' : 'var(--text-muted)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-rmpg-100">{name}</div>
                  <div className="text-[10px] text-rmpg-400 mt-0.5 flex gap-2 flex-wrap">
                    {dob && <span>DOB {dob}</span>}
                    {p.phone && <span>· {p.phone}</span>}
                    {cityState && <span className="truncate">· {cityState}</span>}
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

import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface ComboboxProps<T> {
  value: T | null;
  onChange: (v: T | null) => void;
  options?: T[];
  getLabel: (item: T) => string;
  getKey: (item: T) => string | number;
  renderOption?: (item: T) => React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  fetcher?: (query: string) => Promise<T[]>;
  minQueryLength?: number;
}

export function Combobox<T>(props: ComboboxProps<T>) {
  const {
    value, onChange, options = [], getLabel, getKey,
    renderOption = getLabel, placeholder, disabled, error,
  } = props;
  const [query, setQuery] = useState(value ? getLabel(value) : '');
  const [open, setOpen] = useState(false);
  const [asyncResults, setAsyncResults] = useState<T[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  const effectiveMin = props.minQueryLength ?? (props.fetcher ? 2 : 0);

  useEffect(() => { setQuery(value ? getLabel(value) : ''); }, [value, getLabel]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!props.fetcher) return;
    if (query.length < effectiveMin) { setAsyncResults([]); return; }
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(async () => {
      try {
        const rows = await props.fetcher!(query);
        setAsyncResults(rows);
      } catch {
        setAsyncResults([]);
      }
    }, 250);
  }, [query, props.fetcher, effectiveMin]);

  const filtered = useMemo(() => {
    if (props.fetcher) return asyncResults;
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => getLabel(o).toLowerCase().includes(q));
  }, [props.fetcher, asyncResults, options, query, getLabel]);

  useEffect(() => { setHighlight(-1); }, [filtered.length]);

  const handleBlur = () => {
    if (!query.trim() && value !== null) onChange(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(-1, h - 1));
    } else if (e.key === 'Enter') {
      if (highlight >= 0 && filtered[highlight]) {
        e.preventDefault();
        const opt = filtered[highlight];
        onChange(opt);
        setQuery(getLabel(opt));
        setOpen(false);
        setHighlight(-1);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlight(-1);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${inputId}-listbox`}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className="input-dark w-full py-2 text-xs min-h-[44px]"
      />
      {open && filtered.length > 0 && (
        <ul
          id={`${inputId}-listbox`}
          role="listbox"
          className="absolute z-50 mt-1 w-full max-h-60 overflow-auto border border-[#222] bg-[#0a0a0a] shadow-lg"
        >
          {filtered.map((opt, i) => {
            const isActive = i === highlight;
            const isSelected = (value !== null && getKey(opt) === getKey(value)) || isActive;
            return (
              <li
                key={getKey(opt)}
                role="option"
                aria-selected={isSelected}
                onMouseDown={(e) => { e.preventDefault(); }}
                onClick={() => {
                  onChange(opt);
                  setQuery(getLabel(opt));
                  setOpen(false);
                }}
                className={`px-3 py-2 text-xs text-rmpg-100 hover:bg-[#1a1a1a] cursor-pointer ${isActive ? 'bg-[#1a1a1a]' : ''}`}
              >
                {renderOption(opt)}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
    </div>
  );
}

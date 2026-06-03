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
}

export function Combobox<T>(props: ComboboxProps<T>) {
  const {
    value, onChange, options = [], getLabel, getKey,
    renderOption = getLabel, placeholder, disabled, error,
  } = props;
  const [query, setQuery] = useState(value ? getLabel(value) : '');
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value ? getLabel(value) : ''); }, [value, getLabel]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => getLabel(o).toLowerCase().includes(q));
  }, [options, query, getLabel]);

  const handleBlur = () => {
    if (!query.trim() && value !== null) onChange(null);
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
          {filtered.map((opt) => (
            <li
              key={getKey(opt)}
              role="option"
              aria-selected={value !== null && getKey(opt) === getKey(value)}
              onMouseDown={(e) => { e.preventDefault(); }}
              onClick={() => {
                onChange(opt);
                setQuery(getLabel(opt));
                setOpen(false);
              }}
              className="px-3 py-2 text-xs text-white hover:bg-[#1a1a1a] cursor-pointer"
            >
              {renderOption(opt)}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
    </div>
  );
}

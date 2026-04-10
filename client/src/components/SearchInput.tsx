import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
  autoFocus?: boolean;
}

export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  debounceMs = 300,
  className = '',
  autoFocus = false,
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const emitChange = useCallback(
    (val: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (debounceMs > 0) {
        timerRef.current = setTimeout(() => onChange(val), debounceMs);
      } else {
        onChange(val);
      }
    },
    [onChange, debounceMs],
  );

  // Cleanup timer on unmount
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalValue(val);
    emitChange(val);
  };

  const handleClear = () => {
    setLocalValue('');
    onChange('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClear();
    }
  };

  return (
    <div className={`relative flex items-center ${className}`}>
      <Search
        size={14}
        className="absolute left-2.5 text-rmpg-500 pointer-events-none"
      />
      <input
        ref={inputRef}
        type="text"
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        className="w-full pl-8 pr-7 py-1.5 text-xs bg-surface-sunken border border-rmpg-600 text-rmpg-200 placeholder-rmpg-500 focus:outline-none focus:border-brand-600 focus:shadow-[0_0_0_1px_rgba(136,136,136,0.3)] transition-all"
      />
      {localValue && (
        <button type="button"
          onClick={handleClear}
          className="absolute right-1.5 p-0.5 text-rmpg-500 hover:text-rmpg-300 transition-colors"
          aria-label="Clear search"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

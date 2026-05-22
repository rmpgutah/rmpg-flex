import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Search } from 'lucide-react';

export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  danger?: boolean;
}

export interface DropdownGroup {
  label: string;
  options: DropdownOption[];
}

interface DropdownProps {
  options: (string | DropdownOption)[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  searchable?: boolean;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  groups?: DropdownGroup[];
  clearable?: boolean;
  hint?: string;
}

function normalizeOption(opt: string | DropdownOption): DropdownOption {
  return typeof opt === 'string' ? { value: opt, label: opt } : opt;
}

export default function Dropdown({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  label,
  searchable = false,
  className = '',
  disabled = false,
  required = false,
  error,
  groups,
  clearable = false,
  hint,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const flattenedOptions: DropdownOption[] = useMemo(() => {
    if (groups) {
      return groups.flatMap((g) => g.options.map(normalizeOption));
    }
    return options.map(normalizeOption);
  }, [options, groups]);

  const selectedOption = useMemo(
    () => flattenedOptions.find((o) => o.value === value),
    [flattenedOptions, value]
  );

  const filteredOptions = useMemo(() => {
    if (!search) return flattenedOptions;
    const q = search.toLowerCase();
    return flattenedOptions.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.description && o.description.toLowerCase().includes(q))
    );
  }, [flattenedOptions, search]);

  const filteredGroups = useMemo(() => {
    if (!groups) return undefined;
    if (!search) return groups;
    const q = search.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        options: g.options.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            o.value.toLowerCase().includes(q) ||
            (o.description && o.description.toLowerCase().includes(q))
        ),
      }))
      .filter((g) => g.options.length > 0);
  }, [groups, search]);

  useEffect(() => {
    if (!open) return;
    if (searchable && searchRef.current) {
      searchRef.current.focus();
      setSearch('');
    }
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleSelect = useCallback(
    (opt: DropdownOption) => {
      if (opt.disabled) return;
      onChange(opt.value);
      setOpen(false);
      setSearch('');
    },
    [onChange]
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange('');
      setSearch('');
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setSearch('');
      }
    },
    []
  );

  const renderOption = (opt: DropdownOption) => (
    <button
      key={opt.value}
      type="button"
      onClick={() => handleSelect(opt)}
      disabled={opt.disabled}
      className={`
        w-full text-left flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors duration-100
        ${opt.disabled
          ? 'text-rmpg-600 cursor-not-allowed'
          : opt.danger
            ? 'text-red-400 hover:bg-red-900/20'
            : opt.value === value
              ? 'text-[#d4a017] bg-[#d4a017]/5'
              : 'text-rmpg-200 hover:bg-surface-raised'
        }
      `}
    >
      <span className="flex-1 min-w-0">
        <div className="truncate">{opt.label}</div>
        {opt.description && (
          <div className="text-[10px] text-rmpg-500 truncate">{opt.description}</div>
        )}
      </span>
      {opt.value === value && (
        <span className="text-[#d4a017] shrink-0">&#10003;</span>
      )}
    </button>
  );

  const renderOptionsList = () => {
    if (filteredGroups) {
      return filteredGroups.map((group) => (
        <div key={group.label}>
          <div className="px-3 py-1 text-[10px] font-semibold text-rmpg-500 uppercase tracking-wider bg-surface-sunken">
            {group.label}
          </div>
          {group.options.map(renderOption)}
        </div>
      ));
    }

    if (filteredOptions.length === 0) {
      return (
        <div className="px-3 py-3 text-[11px] text-rmpg-500 text-center">
          No results
        </div>
      );
    }

    return filteredOptions.map(renderOption);
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`} onKeyDown={handleKeyDown}>
      {label && (
        <label className="field-label">
          {label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
      )}
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
        disabled={disabled}
        className={`
          w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors duration-100
          ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
          ${error ? 'border-red-500' : ''}
          ${selectedOption ? 'text-white' : 'text-rmpg-500'}
          select-dark pr-7
        `}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex-1 min-w-0 truncate">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        {clearable && value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="shrink-0 text-rmpg-500 hover:text-white p-0.5"
            aria-label="Clear selection"
            tabIndex={-1}
          >
            &#10005;
          </button>
        )}
      </button>
      {hint && !error && (
        <p className="text-[10px] text-rmpg-500 mt-0.5">{hint}</p>
      )}
      {error && (
        <p className="text-[10px] text-red-400 mt-0.5">{error}</p>
      )}
      {open && (
        <div
          className="absolute z-50 mt-1 w-full bg-surface-base border border-[#2a2a2a] shadow-xl animate-fade-in"
          role="listbox"
        >
          {searchable && (
            <div className="relative border-b border-[#2a2a2a]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full bg-surface-sunken text-white text-[11px] pl-7 pr-3 py-1.5 focus:outline-none"
              />
            </div>
          )}
          <div className="max-h-60 overflow-y-auto">
            {renderOptionsList()}
          </div>
        </div>
      )}
    </div>
  );
}

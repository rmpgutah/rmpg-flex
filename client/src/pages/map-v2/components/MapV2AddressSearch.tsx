import { useState, useRef, useEffect } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import type { AddressResult } from '../hooks/useOlAddressSearch';

interface MapV2AddressSearchProps {
  results: AddressResult[];
  searching: boolean;
  onSearch: (q: string) => void;
  onSelect: (r: AddressResult) => void;
  onClear: () => void;
}

/**
 * Top-center address search bar for /map-v2.
 *
 * Spillman dark theme, 320px wide. Typing fires debounced search via
 * the parent hook. Result list opens below the input; clicking a row
 * selects it (parent pans the map + drops a pin) and collapses the list.
 */
export default function MapV2AddressSearch({
  results, searching, onSearch, onSelect, onClear,
}: MapV2AddressSearchProps) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Click-outside collapses the dropdown
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function handleChange(value: string) {
    setQ(value);
    onSearch(value);
    setOpen(value.trim().length >= 3);
  }

  function handleSelect(r: AddressResult) {
    onSelect(r);
    setOpen(false);
  }

  function handleClear() {
    setQ('');
    setOpen(false);
    onClear();
    onSearch('');
    inputRef.current?.focus();
  }

  return (
    <div
      ref={containerRef}
      className="absolute top-2 left-1/2 -translate-x-1/2 z-20 w-[320px] font-mono text-[11px] select-none"
    >
      <div className="flex items-center bg-[#141414] border border-[#222222]">
        <Search className="w-3 h-3 ml-2 text-[#888888]" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => q.trim().length >= 3 && setOpen(true)}
          placeholder="Search address…"
          aria-label="Search address"
          className="flex-1 bg-transparent border-none outline-none px-2 py-1.5 text-[#e5e7eb] placeholder:text-[#666666] font-mono"
        />
        {searching && <Loader2 className="w-3 h-3 mr-2 text-[#d4a017] animate-spin" aria-hidden="true" />}
        {q && !searching && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear search"
            className="px-1.5 py-1 hover:bg-[#1a1a1a] text-[#888888]"
          >
            <X className="w-3 h-3" aria-hidden="true" />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="mt-1 bg-[#141414] border border-[#222222] divide-y divide-[#1a1a1a] max-h-[280px] overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={`${r.latitude},${r.longitude}-${i}`}
              type="button"
              onClick={() => handleSelect(r)}
              className="w-full text-left px-2 py-1.5 hover:bg-[#1a1a1a] text-[#e5e7eb]"
            >
              <div className="text-[10px] truncate">{r.display_name}</div>
              {r.type && (
                <div className="text-[9px] text-[#666666] uppercase tracking-wider">{r.type}</div>
              )}
            </button>
          ))}
        </div>
      )}
      {open && !searching && q.trim().length >= 3 && results.length === 0 && (
        <div className="mt-1 bg-[#141414] border border-[#222222] px-2 py-2 text-[10px] text-[#666666]">
          No results
        </div>
      )}
    </div>
  );
}

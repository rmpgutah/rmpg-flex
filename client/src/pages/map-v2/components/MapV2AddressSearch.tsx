import React, { useState, useRef, useEffect } from 'react';
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
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Click-outside collapses the dropdown
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Reset highlight when results change
  useEffect(() => { setHighlight(0); }, [results]);

  // Keep highlighted item scrolled into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${highlight}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function handleChange(value: string) {
    setQ(value);
    onSearch(value);
    setOpen(value.trim().length >= 3);
  }

  function handleSelect(r: AddressResult) {
    setQ(r.display_name);
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

  // Keyboard autocomplete: ↓/↑ navigate, Enter selects, Tab/→ autofills
  // input with highlighted suggestion's display_name (without selecting),
  // Esc closes dropdown.
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) {
      if (e.key === 'ArrowDown' && results.length > 0) {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHighlight((h) => (h + 1) % results.length);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHighlight((h) => (h - 1 + results.length) % results.length);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      handleSelect(results[highlight] || results[0]);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      setOpen(false);
      e.preventDefault();
    } else if (e.key === 'Tab' || (e.key === 'ArrowRight' && inputRef.current && inputRef.current.selectionStart === q.length)) {
      // Autofill the input with the highlighted suggestion text without
      // collapsing the dropdown — user can then press Enter to confirm.
      const r = results[highlight];
      if (r) {
        setQ(r.display_name);
        e.preventDefault();
      }
    }
  }

  // Highlight matching substring in result label so the user can see why
  // a suggestion matched their query.
  function renderHighlighted(text: string, query: string) {
    if (!query.trim()) return text;
    const i = text.toLowerCase().indexOf(query.trim().toLowerCase());
    if (i < 0) return text;
    return (
      <>
        {text.slice(0, i)}
        <span className="text-[#d4a017] font-bold">{text.slice(i, i + query.trim().length)}</span>
        {text.slice(i + query.trim().length)}
      </>
    );
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
          onKeyDown={handleKeyDown}
          onFocus={() => q.trim().length >= 3 && setOpen(true)}
          placeholder="Search address…"
          aria-label="Search address"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-activedescendant={open && results.length > 0 ? `addr-opt-${highlight}` : undefined}
          role="combobox"
          autoComplete="off"
          spellCheck={false}
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
        <div
          ref={listRef}
          role="listbox"
          className="mt-1 bg-[#141414] border border-[#222222] divide-y divide-[#1a1a1a] max-h-[280px] overflow-y-auto"
        >
          {results.map((r, i) => {
            const active = i === highlight;
            return (
              <button
                key={`${r.latitude},${r.longitude}-${i}`}
                id={`addr-opt-${i}`}
                data-idx={i}
                role="option"
                aria-selected={active}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => handleSelect(r)}
                className={
                  'w-full text-left px-2 py-1.5 text-[#e5e7eb] ' +
                  (active ? 'bg-[#1a1a1a] border-l-2 border-[#d4a017]' : 'hover:bg-[#1a1a1a]')
                }
              >
                <div className="text-[10px] truncate">{renderHighlighted(r.display_name, q)}</div>
                {r.type && (
                  <div className="text-[9px] text-[#666666] uppercase tracking-wider">{r.type}</div>
                )}
              </button>
            );
          })}
          <div className="px-2 py-1 text-[8px] text-[#555555] uppercase tracking-wider bg-[#0d0d0d]">
            ↑↓ navigate · Enter select · Tab autofill · Esc close
          </div>
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

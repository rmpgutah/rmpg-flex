// ============================================================
// RMPG Flex — StatuteLookup Component
// ============================================================
// Reusable search-and-select component for Utah Criminal Code
// (Title 76) and Vehicle Code (Title 41) statute references.
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Scale, Car, X, ChevronDown, ChevronUp } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

export interface StatuteResult {
  id: number;
  citation: string;
  short_title: string;
  description?: string;
  offense_level: string | null;
  category: 'criminal' | 'vehicle';
  subcategory: string;
  /** Base fine amount for traffic citations / infractions */
  citation_fine?: number | null;
}

interface StatuteLookupProps {
  /** Called when user selects a statute */
  onSelect: (statute: StatuteResult) => void;
  /** Pre-selected statute citation to display */
  value?: string;
  /** Callback to clear selection */
  onClear?: () => void;
  /** Placeholder text */
  placeholder?: string;
  /** Filter to only show criminal or vehicle codes */
  categoryFilter?: 'criminal' | 'vehicle';
  /** Show as compact inline or full-width */
  compact?: boolean;
}

const OFFENSE_COLORS: Record<string, string> = {
  capital_felony: 'bg-red-900/60 text-red-300 border-red-700/50',
  first_degree_felony: 'bg-red-900/50 text-red-300 border-red-700/50',
  second_degree_felony: 'bg-red-900/40 text-red-400 border-red-700/40',
  third_degree_felony: 'bg-orange-900/40 text-orange-300 border-orange-700/40',
  class_a_misdemeanor: 'bg-amber-900/40 text-amber-300 border-amber-700/40',
  class_b_misdemeanor: 'bg-amber-900/30 text-amber-400 border-amber-700/30',
  class_c_misdemeanor: 'bg-yellow-900/30 text-yellow-400 border-yellow-700/30',
  infraction: 'bg-blue-900/30 text-blue-400 border-blue-700/30',
  enhancement: 'bg-purple-900/30 text-purple-400 border-purple-700/30',
};

function formatOffenseLevel(level: string | null): string {
  if (!level) return '';
  return level
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function StatuteLookup({
  onSelect,
  value,
  onClear,
  placeholder = 'Search statutes (e.g. "76-5-102" or "assault")...',
  categoryFilter,
  compact = false,
}: StatuteLookupProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StatuteResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<'all' | 'criminal' | 'vehicle'>(
    categoryFilter || 'all'
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search
  const doSearch = useCallback(async (searchQuery: string, cat: string) => {
    if (searchQuery.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const catParam = cat !== 'all' ? `&category=${cat}` : '';
      const res = await apiFetch<{ data: StatuteResult[] }>(`/statutes/search?q=${encodeURIComponent(searchQuery)}${catParam}&limit=15`);
      setResults(res.data || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (query.length < 2) {
      setResults([]);
      return;
    }
    timerRef.current = setTimeout(() => {
      doSearch(query, activeCategory);
    }, 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query, activeCategory, doSearch]);

  const handleSelect = (statute: StatuteResult) => {
    onSelect(statute);
    setQuery('');
    setResults([]);
    setIsOpen(false);
  };

  // If a value is pre-selected, show it as a badge
  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-brand-900/30 text-brand-300 border border-brand-700/40 text-xs font-mono">
          <Scale className="w-3 h-3" />
          {value}
        </span>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="p-0.5 text-rmpg-400 hover:text-red-400 transition-colors"
            title="Remove statute"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className={`relative ${compact ? '' : 'w-full'}`}>
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400 pointer-events-none" />
        <input
          type="text"
          className="input-dark text-xs w-full pl-8 pr-3"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => query.length >= 2 && setIsOpen(true)}
        />
      </div>

      {/* Category Filter Tabs */}
      {isOpen && !categoryFilter && (
        <div className="absolute z-50 top-full left-0 right-0 flex border-x border-t border-rmpg-600 bg-surface-base">
          {(['all', 'criminal', 'vehicle'] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                activeCategory === cat
                  ? 'bg-brand-900/30 text-brand-300 border-b-2 border-brand-500'
                  : 'text-rmpg-400 hover:text-rmpg-200 hover:bg-rmpg-700/30'
              }`}
            >
              {cat === 'criminal' && <Scale className="w-3 h-3" />}
              {cat === 'vehicle' && <Car className="w-3 h-3" />}
              {cat === 'all' ? 'All' : cat === 'criminal' ? 'Criminal' : 'Vehicle'}
            </button>
          ))}
        </div>
      )}

      {/* Results Dropdown */}
      {isOpen && (query.length >= 2 || results.length > 0) && (
        <div
          className={`absolute z-50 left-0 right-0 bg-surface-base border border-rmpg-600 shadow-xl max-h-[300px] overflow-y-auto ${
            !categoryFilter ? 'top-[calc(100%+30px)]' : 'top-full'
          }`}
        >
          {loading ? (
            <div className="px-3 py-4 text-center text-xs text-rmpg-400">Searching...</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-rmpg-400">
              {query.length >= 2 ? 'No statutes found' : 'Type at least 2 characters...'}
            </div>
          ) : (
            results.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelect(s)}
                className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-rmpg-700/30 transition-colors border-b border-rmpg-700/30 last:border-b-0"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-brand-400 font-bold">{s.citation}</span>
                    {s.category === 'vehicle' ? (
                      <Car className="w-3 h-3 text-blue-400 flex-shrink-0" />
                    ) : (
                      <Scale className="w-3 h-3 text-red-400 flex-shrink-0" />
                    )}
                    {s.offense_level && (
                      <span
                        className={`px-1.5 py-0.5 text-[9px] font-bold uppercase border ${
                          OFFENSE_COLORS[s.offense_level] || 'bg-rmpg-700 text-rmpg-300 border-rmpg-600'
                        }`}
                      >
                        {formatOffenseLevel(s.offense_level)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-rmpg-200 mt-0.5">{s.short_title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-rmpg-500 truncate">{s.subcategory}</span>
                    {s.citation_fine != null && s.citation_fine > 0 && (
                      <span className="text-[9px] font-mono font-bold text-green-400 bg-green-900/30 border border-green-700/40 px-1 py-0">
                        ${s.citation_fine}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Display badge for an offense level.
 * Exported for use in other components (warrants, incidents, admin).
 */
export function OffenseLevelBadge({ level }: { level: string | null }) {
  if (!level) return null;
  return (
    <span
      className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold uppercase border ${
        OFFENSE_COLORS[level] || 'bg-rmpg-700 text-rmpg-300 border-rmpg-600'
      }`}
    >
      {formatOffenseLevel(level)}
    </span>
  );
}

// ============================================================
// RMPG Flex — StatuteLookup Component
// ============================================================
// Reusable search-and-select component for criminal and vehicle
// statutes across all supported states (UT, CO, WY, ID, NV, AZ, NM).
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Scale, Car, X, ChevronDown, ChevronUp, BookOpen } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

export interface StatuteResult {
  id: number;
  state?: string;
  state_name?: string;
  citation: string;
  short_title: string;
  description?: string;
  /** Legal definition / elements of crime for law reference */
  definition?: string | null;
  offense_level: string | null;
  category: 'criminal' | 'vehicle';
  subcategory: string;
  /** Base fine amount for traffic citations / infractions */
  citation_fine?: number | null;
}

const STATE_CODES = ['ALL', 'UT', 'CO', 'WY', 'ID', 'NV', 'AZ', 'NM'] as const;
const STATE_LABELS: Record<string, string> = {
  ALL: 'All States',
  UT: 'Utah',
  CO: 'Colorado',
  WY: 'Wyoming',
  ID: 'Idaho',
  NV: 'Nevada',
  AZ: 'Arizona',
  NM: 'New Mexico',
};

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
  /** Filter to a specific state (e.g. 'UT', 'CO') */
  stateFilter?: string;
  /** Show state selector bar */
  showStateFilter?: boolean;
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
  infraction: 'bg-gray-900/30 text-gray-400 border-gray-700/30',
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
  stateFilter,
  showStateFilter = false,
  compact = false,
}: StatuteLookupProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StatuteResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<'all' | 'criminal' | 'vehicle'>(
    categoryFilter || 'all'
  );
  const [activeState, setActiveState] = useState<string>(stateFilter || 'ALL');
  const [showDefinition, setShowDefinition] = useState<number | null>(null);
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
  const doSearch = useCallback(async (searchQuery: string, cat: string, st: string) => {
    if (searchQuery.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const catParam = cat !== 'all' ? `&category=${cat}` : '';
      const stateParam = st && st !== 'ALL' ? `&state=${st}` : '';
      const res = await apiFetch<{ data: StatuteResult[] }>(`/statutes/search?q=${encodeURIComponent(searchQuery)}${catParam}${stateParam}&limit=20`);
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
      doSearch(query, activeCategory, activeState);
    }, 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query, activeCategory, activeState, doSearch]);

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
            aria-label="Remove statute selection">
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
          aria-label="Search statutes"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => query.length >= 2 && setIsOpen(true)}
        />
      </div>

      {/* State + Category Filter Tabs */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 right-0 border-x border-t border-rmpg-600 bg-surface-base">
          {/* State filter row */}
          {showStateFilter && !stateFilter && (
            <div className="flex border-b border-rmpg-700/50 overflow-x-auto">
              {STATE_CODES.map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setActiveState(st)}
                  className={`flex-shrink-0 px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                    activeState === st
                      ? 'bg-brand-900/40 text-brand-300 border-b-2 border-brand-500'
                      : 'text-rmpg-500 hover:text-rmpg-200 hover:bg-rmpg-700/30'
                  }`}
                >
                  {st === 'ALL' ? 'All' : st}
                </button>
              ))}
            </div>
          )}
          {/* Category filter row */}
          {!categoryFilter && (
            <div className="flex">
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
        </div>
      )}

      {/* Results Dropdown */}
      {isOpen && (query.length >= 2 || results.length > 0) && (() => {
        // Calculate offset for filter bars above the dropdown
        let filterHeight = 0;
        if (showStateFilter && !stateFilter) filterHeight += 26;
        if (!categoryFilter) filterHeight += 30;
        const topOffset = filterHeight > 0 ? `calc(100% + ${filterHeight}px)` : '100%';

        return (
          <div
            className="absolute z-50 left-0 right-0 bg-surface-base border border-rmpg-600 shadow-xl max-h-[300px] overflow-y-auto"
            style={{ top: topOffset }}
          >
            {loading ? (
              <div className="px-3 py-4 text-center text-xs text-rmpg-400">Searching...</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-rmpg-400">
                {query.length >= 2 ? 'No statutes found' : 'Type at least 2 characters...'}
              </div>
            ) : (
              results.map((s) => (
                <div
                  key={s.id}
                  className="border-b border-rmpg-700/30 last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => handleSelect(s)}
                    className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-rmpg-700/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {s.state && (
                          <span className="px-1 py-0 text-[8px] font-bold uppercase bg-rmpg-700/60 text-rmpg-300 border border-rmpg-600 leading-tight">
                            {s.state}
                          </span>
                        )}
                        <span className="text-xs font-mono text-brand-400 font-bold">{s.citation}</span>
                        {s.category === 'vehicle' ? (
                          <Car className="w-3 h-3 text-gray-400 flex-shrink-0" />
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
                        {s.definition && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowDefinition(showDefinition === s.id ? null : s.id);
                            }}
                            className="ml-auto p-0.5 text-rmpg-500 hover:text-brand-400 transition-colors"
                            title="View law reference"
                          >
                            <BookOpen className="w-3 h-3" />
                          </button>
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
                  {/* Definition / Law Reference Panel */}
                  {showDefinition === s.id && s.definition && (
                    <div className="px-3 pb-2 pt-0.5">
                      <div className="bg-rmpg-800/60 border border-rmpg-600/50 p-2 text-[10px] text-rmpg-300 leading-relaxed whitespace-pre-line">
                        <div className="flex items-center gap-1 mb-1 text-brand-400 font-bold text-[9px] uppercase tracking-wider">
                          <BookOpen className="w-3 h-3" />
                          Law Reference
                        </div>
                        {s.definition}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        );
      })()}
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

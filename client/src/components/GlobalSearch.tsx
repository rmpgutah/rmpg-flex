import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  User,
  Car,
  FileText,
  Phone,
  AlertTriangle,
  X,
  ArrowRight,
  Clock,
  Loader2,
  Command,
  Shield,
  Building2,
  Users,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

type EntityType = 'person' | 'vehicle' | 'incident' | 'call' | 'bolo' | 'warrant' | 'property' | 'personnel';

interface SearchResult {
  id: string;
  type: EntityType;
  primaryText: string;
  secondaryText: string;
}

interface RecentSearch {
  id: string;
  type: EntityType;
  primaryText: string;
  secondaryText: string;
  timestamp: number;
}

const ENTITY_CONFIG = {
  person: {
    icon: User,
    label: 'Persons',
    route: '/records',
    color: 'text-brand-400',
  },
  vehicle: {
    icon: Car,
    label: 'Vehicles',
    route: '/records',
    color: 'text-purple-400',
  },
  incident: {
    icon: FileText,
    label: 'Incidents',
    route: '/incidents',
    color: 'text-orange-400',
  },
  call: {
    icon: Phone,
    label: 'Calls',
    route: '/dispatch',
    color: 'text-green-400',
  },
  bolo: {
    icon: AlertTriangle,
    label: 'BOLOs',
    route: '/communications',
    color: 'text-red-400',
  },
  warrant: {
    icon: Shield,
    label: 'Warrants',
    route: '/warrants',
    color: 'text-amber-400',
  },
  property: {
    icon: Building2,
    label: 'Properties',
    route: '/records',
    color: 'text-blue-400',
  },
  personnel: {
    icon: Users,
    label: 'Personnel',
    route: '/personnel',
    color: 'text-cyan-400',
  },
};

const RECENT_SEARCHES_KEY = 'rmpg-recent-searches';
const MAX_RECENT_SEARCHES = 5;

export const GlobalSearch: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const navigate = useNavigate();

  // Load recent searches from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        setRecentSearches(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load recent searches:', error);
    }
  }, []);

  // Keyboard shortcut to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Reset state when closing
  const handleClose = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setResults([]);
    setSelectedIndex(0);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const searchPromises = [
          apiFetch<any[]>(`/records/persons?search=${encodeURIComponent(query)}`)
            .then((data) =>
              (Array.isArray(data) ? data : []).map((item) => ({
                id: item.id,
                type: 'person' as EntityType,
                primaryText: `${item.firstName} ${item.lastName}`,
                secondaryText: item.dateOfBirth || 'No DOB',
              }))
            )
            .catch(() => []),
          apiFetch<any[]>(`/records/vehicles?search=${encodeURIComponent(query)}`)
            .then((data) =>
              (Array.isArray(data) ? data : []).map((item) => ({
                id: item.id,
                type: 'vehicle' as EntityType,
                primaryText: item.plate || 'No Plate',
                secondaryText: `${item.make} ${item.model}`,
              }))
            )
            .catch(() => []),
          apiFetch<any[]>(`/incidents?search=${encodeURIComponent(query)}`)
            .then((data) =>
              (Array.isArray(data) ? data : []).map((item) => ({
                id: item.id,
                type: 'incident' as EntityType,
                primaryText: item.incidentNumber || `Incident #${item.id}`,
                secondaryText: item.type || 'Unknown Type',
              }))
            )
            .catch(() => []),
          apiFetch<any[]>(`/dispatch/calls?search=${encodeURIComponent(query)}`)
            .then((data) =>
              (Array.isArray(data) ? data : []).map((item) => ({
                id: item.id,
                type: 'call' as EntityType,
                primaryText: item.callNumber || `Call #${item.id}`,
                secondaryText: item.address || 'No Address',
              }))
            )
            .catch(() => []),
          apiFetch<any[]>(`/comms/bolos?search=${encodeURIComponent(query)}`)
            .then((data) =>
              (Array.isArray(data) ? data : []).map((item) => ({
                id: item.id,
                type: 'bolo' as EntityType,
                primaryText: item.subject || 'BOLO',
                secondaryText: item.description || 'No Description',
              }))
            )
            .catch(() => []),
          // Warrants search
          apiFetch<any>(`/warrants?subject_name=${encodeURIComponent(query)}&per_page=10`)
            .then((resp) =>
              (resp.data || resp || []).map((item: any) => ({
                id: item.id,
                type: 'warrant' as EntityType,
                primaryText: item.warrant_number || `Warrant #${item.id}`,
                secondaryText: `${item.subject_name || 'Unknown Subject'} — ${item.charge || item.warrant_type || ''}`,
              }))
            )
            .catch(() => []),
          // Properties search
          apiFetch<any[]>(`/records/properties?search=${encodeURIComponent(query)}`)
            .then((data) =>
              (data || []).slice(0, 10).map((item: any) => ({
                id: item.id,
                type: 'property' as EntityType,
                primaryText: item.name || item.property_name || 'Unknown Property',
                secondaryText: item.address || 'No Address',
              }))
            )
            .catch(() => []),
          // Personnel search
          apiFetch<any[]>('/personnel')
            .then((data) => {
              const q = query.toLowerCase();
              return (data || [])
                .filter((u: any) => {
                  const name = (u.full_name || `${u.first_name || ''} ${u.last_name || ''}`).toLowerCase();
                  const badge = (u.badge_number || '').toLowerCase();
                  return name.includes(q) || badge.includes(q);
                })
                .slice(0, 10)
                .map((item: any) => ({
                  id: item.id,
                  type: 'personnel' as EntityType,
                  primaryText: item.full_name || `${item.first_name} ${item.last_name}`,
                  secondaryText: `${item.badge_number ? `Badge: ${item.badge_number}` : ''} ${item.rank || item.role || ''}`.trim(),
                }));
            })
            .catch(() => []),
        ];

        const allResults = await Promise.all(searchPromises);
        const flatResults = allResults.flat();
        setResults(flatResults);
        setSelectedIndex(0);
      } catch (error) {
        console.error('Search failed:', error);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query]);

  // Save to recent searches
  const saveToRecent = useCallback((result: SearchResult) => {
    const recent: RecentSearch = {
      ...result,
      timestamp: Date.now(),
    };

    setRecentSearches((prev) => {
      const filtered = prev.filter((item) => item.id !== result.id || item.type !== result.type);
      const updated = [recent, ...filtered].slice(0, MAX_RECENT_SEARCHES);
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error('Failed to save recent search:', error);
      }
      return updated;
    });
  }, []);

  // Handle result selection
  const handleSelect = useCallback(
    (result: SearchResult) => {
      saveToRecent(result);
      const config = ENTITY_CONFIG[result.type];
      navigate(config.route);
      handleClose();
    },
    [navigate, handleClose, saveToRecent]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const displayedResults = query.trim() ? results : recentSearches;

      if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, displayedResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && displayedResults.length > 0) {
        e.preventDefault();
        handleSelect(displayedResults[selectedIndex]);
      }
    },
    [query, results, recentSearches, selectedIndex, handleClose, handleSelect]
  );

  // Group results by type
  const groupedResults = results.reduce((acc, result) => {
    if (!acc[result.type]) {
      acc[result.type] = [];
    }
    acc[result.type].push(result);
    return acc;
  }, {} as Record<EntityType, SearchResult[]>);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh] bg-black/70 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="bg-surface-base border border-rmpg-600 shadow-2xl w-full max-w-2xl max-h-[60vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-rmpg-600">
          {isLoading ? (
            <Loader2 className="w-5 h-5 text-rmpg-300 animate-spin" />
          ) : (
            <Search className="w-5 h-5 text-rmpg-300" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search persons, vehicles, incidents, warrants, personnel..."
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
          />
          <div className="flex items-center gap-2 text-xs text-rmpg-400">
            <kbd className="px-2 py-1 bg-rmpg-700 border border-rmpg-600">
              <Command className="w-3 h-3 inline" />
              K
            </kbd>
            <button onClick={handleClose} className="hover:text-rmpg-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex-1">
          {!query.trim() && recentSearches.length > 0 && (
            <div className="p-2">
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-rmpg-400 font-medium">
                <Clock className="w-3 h-3" />
                RECENT
              </div>
              {recentSearches.map((result, index) => (
                <ResultItem
                  key={`${result.type}-${result.id}`}
                  result={result}
                  isSelected={index === selectedIndex}
                  onClick={() => handleSelect(result)}
                />
              ))}
            </div>
          )}

          {query.trim() && results.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-rmpg-400">
              <Search className="w-12 h-12 mb-3 opacity-50" />
              <p className="text-sm">No results found</p>
            </div>
          )}

          {query.trim() && results.length > 0 && (
            <div className="p-2">
              {Object.entries(groupedResults).map(([type, typeResults]) => {
                const config = ENTITY_CONFIG[type as EntityType];
                const startIndex = results.findIndex((r) => r.type === type);

                return (
                  <div key={type} className="mb-4 last:mb-0">
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-rmpg-400 font-medium">
                      <config.icon className="w-3 h-3" />
                      {config.label.toUpperCase()}
                    </div>
                    {typeResults.map((result, index) => (
                      <ResultItem
                        key={`${result.type}-${result.id}`}
                        result={result}
                        isSelected={startIndex + index === selectedIndex}
                        onClick={() => handleSelect(result)}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

interface ResultItemProps {
  result: SearchResult;
  isSelected: boolean;
  onClick: () => void;
}

const ResultItem: React.FC<ResultItemProps> = ({ result, isSelected, onClick }) => {
  const config = ENTITY_CONFIG[result.type];
  const Icon = config.icon;

  return (
    <button
      className={`
        w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
        ${isSelected ? 'bg-rmpg-700' : 'hover:bg-rmpg-800'}
      `}
      onClick={onClick}
    >
      <Icon className={`w-4 h-4 ${config.color} flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{result.primaryText}</p>
        <p className="text-xs text-rmpg-300 truncate">{result.secondaryText}</p>
      </div>
      <span className="px-2 py-0.5 bg-rmpg-700 text-rmpg-200 text-xs border border-rmpg-600 flex-shrink-0">
        {config.label}
      </span>
      <ArrowRight className="w-4 h-4 text-rmpg-400 flex-shrink-0" />
    </button>
  );
};

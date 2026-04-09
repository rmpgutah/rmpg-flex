import React, { useState, useEffect, useRef } from 'react';
import { Link2, Search, X, Loader2, CheckCircle } from 'lucide-react';
import FormModal from './FormModal';
import { apiFetch } from '../hooks/useApi';

// ── Types ──────────────────────────────────────────────────

interface AddLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  incidentId: number | string;
  onLinked: () => void;
}

interface SearchResult {
  id: number;
  label: string;
  status: string;
}

// ── Constants ──────────────────────────────────────────────

const TYPE_OPTIONS = [
  { value: 'incident', label: 'Incident Report' },
  { value: 'call', label: 'Call for Service' },
  { value: 'case', label: 'Case' },
  { value: 'warrant', label: 'Warrant' },
  { value: 'citation', label: 'Citation' },
  { value: 'arrest', label: 'Arrest Record' },
];

const PLACEHOLDER_MAP: Record<string, string> = {
  incident: 'Search by incident number (e.g., RMP-25-...)',
  call: 'Search by call number (e.g., CFS-25-...)',
  case: 'Search by case number',
  warrant: 'Search by warrant number (e.g., WRT-...)',
  citation: 'Search by citation number',
  arrest: 'Search by booking number',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'text-red-400',
  pending: 'text-amber-400',
  draft: 'text-rmpg-400',
  submitted: 'text-brand-300',
  approved: 'text-green-400',
  served: 'text-green-400',
  cleared: 'text-green-400',
  closed: 'text-rmpg-500',
  voided: 'text-rmpg-600',
  open: 'text-amber-400',
  in_custody: 'text-red-400',
  released: 'text-green-400',
};

// ── Component ──────────────────────────────────────────────

export default function AddLinkModal({ isOpen, onClose, incidentId, onLinked }: AddLinkModalProps) {
  const [linkedType, setLinkedType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [linkReason, setLinkReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setLinkedType('');
      setSearchQuery('');
      setResults([]);
      setSelected(null);
      setLinkReason('');
      setError('');
      setShowDropdown(false);
    }
  }, [isOpen]);

  // Reset search when type changes
  useEffect(() => {
    setSearchQuery('');
    setResults([]);
    setSelected(null);
    setShowDropdown(false);
    if (linkedType && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [linkedType]);

  // Debounced search
  useEffect(() => {
    if (!linkedType || searchQuery.length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch<SearchResult[]>(
          `/incidents/link-search?type=${linkedType}&q=${encodeURIComponent(searchQuery)}`
        );
        setResults(Array.isArray(data) ? data : []);
        setShowDropdown(true);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, linkedType]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (result: SearchResult) => {
    setSelected(result);
    setSearchQuery('');
    setShowDropdown(false);
    setError('');
  };

  const handleClearSelection = () => {
    setSelected(null);
    setSearchQuery('');
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !linkedType) {
      setError('Select a record type and search for a record to link');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await apiFetch(`/incidents/${incidentId}/links`, {
        method: 'POST',
        body: JSON.stringify({
          linked_type: linkedType,
          linked_id: selected.id,
          link_reason: linkReason.trim() || null,
        }),
      });
      onLinked();
    } catch (err: any) {
      if (err?.message?.includes('already exists') || err?.message?.includes('409')) {
        setError('This record is already linked to this incident');
      } else {
        setError(err?.message || 'Failed to create link');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title="Link Cross-Reference"
      icon={Link2}
      submitLabel={selected ? `Link ${TYPE_OPTIONS.find(t => t.value === linkedType)?.label || 'Record'}` : 'Select a record'}
      isSubmitting={isSubmitting}
      maxWidth="max-w-lg"
      isDirty={!!selected}
    >
      {error && (
        <div className="px-3 py-2 -mt-2 mb-3 bg-red-900/30 border border-red-700/50 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Record Type */}
      <div>
        <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Record Type</label>
        <select
          className="select-dark mt-1 w-full"
          value={linkedType}
          onChange={(e) => setLinkedType(e.target.value)}
        >
          <option value="">-- Select record type --</option>
          {TYPE_OPTIONS.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Search Input */}
      {linkedType && !selected && (
        <div className="relative" ref={dropdownRef}>
          <label className="text-[10px] text-rmpg-400 uppercase font-semibold">
            Search {TYPE_OPTIONS.find(t => t.value === linkedType)?.label || 'Record'}
          </label>
          <div className="relative mt-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-rmpg-500" />
            <input
              ref={searchRef}
              type="text"
              className="input-dark w-full pl-8 pr-8"
              placeholder={PLACEHOLDER_MAP[linkedType] || 'Search...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {isSearching && (
              <Loader2 className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-rmpg-400 animate-spin" />
            )}
          </div>

          {/* Search Results Dropdown */}
          {showDropdown && (
            <div className="absolute z-50 left-0 right-0 mt-1 bg-[#0a0a0a] border border-[#222] rounded-sm shadow-lg max-h-[200px] overflow-auto scrollbar-thin">
              {results.length === 0 ? (
                <div className="px-3 py-3 text-xs text-rmpg-500 text-center">
                  {searchQuery.length < 2 ? 'Type at least 2 characters...' : 'No matching records found'}
                </div>
              ) : (
                results.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handleSelect(r)}
                    className="w-full text-left px-3 py-2 hover:bg-[#141414] transition-colors border-b border-[#1a1a1a] last:border-b-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-rmpg-200 font-mono truncate">{r.label}</span>
                      {r.status && (
                        <span className={`text-[9px] font-semibold uppercase shrink-0 ${STATUS_COLORS[r.status] || 'text-rmpg-500'}`}>
                          {r.status}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Selected Record Chip */}
      {selected && (
        <div>
          <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Selected Record</label>
          <div className="mt-1 flex items-center gap-2 px-3 py-2 bg-brand-900/20 border border-brand-700/40 rounded-sm">
            <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-xs font-mono text-white truncate block">{selected.label}</span>
              <span className="text-[9px] text-rmpg-400">
                {TYPE_OPTIONS.find(t => t.value === linkedType)?.label} #{selected.id}
                {selected.status && <> &middot; <span className={STATUS_COLORS[selected.status] || 'text-rmpg-400'}>{selected.status.toUpperCase()}</span></>}
              </span>
            </div>
            <button type="button" onClick={handleClearSelection} className="text-rmpg-500 hover:text-white p-0.5">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Link Reason */}
      {selected && (
        <div>
          <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Link Reason (optional)</label>
          <input
            type="text"
            className="input-dark mt-1 w-full"
            placeholder="e.g., Related suspect, Same location, Follow-up..."
            value={linkReason}
            onChange={(e) => setLinkReason(e.target.value)}
          />
        </div>
      )}
    </FormModal>
  );
}

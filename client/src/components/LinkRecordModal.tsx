import React, { useState, useEffect, useCallback } from 'react';
import { Link2, Search, UserCircle, Car, Building2, Package, Loader2, Check } from 'lucide-react';
import FormModal from './FormModal';
import { apiFetch } from '../hooks/useApi';
import type { RecordEntityType } from '../types';

interface LinkRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceType: RecordEntityType;
  sourceId: string;
  onLinked: () => void;
}

const TYPE_OPTIONS: { type: RecordEntityType; label: string; icon: React.ElementType }[] = [
  { type: 'person', label: 'Person', icon: UserCircle },
  { type: 'vehicle', label: 'Vehicle', icon: Car },
  { type: 'property', label: 'Property', icon: Building2 },
  { type: 'evidence', label: 'Evidence', icon: Package },
];

const RELATIONSHIP_OPTIONS = [
  'Associated',
  'Owner',
  'Resident',
  'Employee',
  'Witness',
  'Suspect',
  'Victim',
  'Evidence Linked',
  'Related',
  'Other',
];

const labelClass = 'block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1';

export default function LinkRecordModal({
  isOpen,
  onClose,
  sourceType,
  sourceId,
  onLinked,
}: LinkRecordModalProps) {
  const [targetType, setTargetType] = useState<RecordEntityType>('person');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<{ id: string; label: string } | null>(null);
  const [relationship, setRelationship] = useState('associated');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setTargetType('person');
      setSearchQuery('');
      setSearchResults([]);
      setSelectedTarget(null);
      setRelationship('associated');
      setNotes('');
      setError('');
    }
  }, [isOpen]);

  // Clear search results and selected target when target type changes
  useEffect(() => {
    setSearchResults([]);
    setSelectedTarget(null);
    setSearchQuery('');
  }, [targetType]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await apiFetch<any[]>(
          `/records/search?q=${encodeURIComponent(searchQuery.trim())}&type=${targetType}`
        );
        if (cancelled) return;
        setSearchResults(results);
      } catch (err) {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchQuery, targetType]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedTarget) {
        setError('Please select a target record to link.');
        return;
      }

      setIsSubmitting(true);
      setError('');

      try {
        await apiFetch('/records/links', {
          method: 'POST',
          body: JSON.stringify({
            source_type: sourceType,
            source_id: sourceId,
            target_type: targetType,
            target_id: selectedTarget.id,
            relationship,
            notes: notes.trim() || undefined,
          }),
        });

        onLinked();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create link.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [selectedTarget, sourceType, sourceId, targetType, relationship, notes, onLinked, onClose]
  );

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title="Link Record"
      icon={Link2}
      submitLabel="Link"
      isSubmitting={isSubmitting}
      maxWidth="max-w-lg"
    >
      {/* Target Type Selector */}
      <div>
        <label className={labelClass}>Target Type</label>
        <div className="flex items-center gap-2">
          {TYPE_OPTIONS.map(({ type, label, icon: TypeIcon }) => (
            <button
              key={type}
              type="button"
              onClick={() => setTargetType(type)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border rounded transition-colors ${
                targetType === type
                  ? 'bg-brand-900/40 text-brand-400 border-brand-700/50'
                  : 'bg-rmpg-700 text-rmpg-400 border-rmpg-600 hover:bg-rmpg-600'
              }`}
            >
              <TypeIcon style={{ width: 12, height: 12 }} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Search Input */}
      <div>
        <label className={labelClass}>Search {targetType}</label>
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-rmpg-500"
            style={{ width: 13, height: 13 }}
          />
          <input
            type="text"
            className="input-dark w-full text-xs pl-8"
            placeholder={`Search for a ${targetType}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searching && (
            <Loader2
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-rmpg-500 animate-spin"
              style={{ width: 13, height: 13 }}
            />
          )}
        </div>
      </div>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div className="max-h-48 overflow-y-auto space-y-1">
          {searchResults.map((result) => {
            const isSelected = selectedTarget?.id === result.id;
            return (
              <div
                key={result.id}
                onClick={() =>
                  setSelectedTarget({
                    id: result.id,
                    label: result.label || result.name || result.id,
                  })
                }
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-rmpg-700/50 text-xs text-rmpg-200 border rounded transition-colors ${
                  isSelected
                    ? 'border-brand-500/50 bg-brand-900/20'
                    : 'border-transparent'
                }`}
              >
                {isSelected && (
                  <Check
                    className="text-brand-400 flex-shrink-0"
                    style={{ width: 12, height: 12 }}
                  />
                )}
                <span className="truncate">{result.label || result.name || result.id}</span>
                <span className="ml-auto text-[9px] font-bold uppercase tracking-wider text-rmpg-500 bg-rmpg-700 px-1.5 py-0.5 rounded">
                  {result.record_type || targetType}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* No results message */}
      {searchQuery.trim() && !searching && searchResults.length === 0 && (
        <p className="text-[10px] text-rmpg-500 italic">No results found.</p>
      )}

      {/* Selected Target Display */}
      {selectedTarget && (
        <div className="flex items-center gap-2 px-3 py-2 rounded border border-brand-500/50 bg-brand-900/20">
          <Check className="text-brand-400 flex-shrink-0" style={{ width: 14, height: 14 }} />
          <span className="text-xs text-brand-300 font-medium truncate">
            {selectedTarget.label}
          </span>
          <button
            type="button"
            onClick={() => setSelectedTarget(null)}
            className="ml-auto text-[9px] text-rmpg-500 hover:text-rmpg-300 transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Relationship Dropdown */}
      <div>
        <label className={labelClass}>Relationship</label>
        <select
          className="input-dark w-full text-xs"
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
        >
          {RELATIONSHIP_OPTIONS.map((opt) => (
            <option key={opt} value={opt.toLowerCase().replace(/ /g, '_')}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      {/* Notes Textarea */}
      <div>
        <label className={labelClass}>Notes (optional)</label>
        <textarea
          className="input-dark w-full text-xs"
          rows={3}
          placeholder="Add any relevant notes about this link..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* Error Display */}
      {error && (
        <div className="text-[10px] text-red-400 bg-red-900/20 border border-red-800/40 rounded px-3 py-2">
          {error}
        </div>
      )}
    </FormModal>
  );
}

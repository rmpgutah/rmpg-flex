import React, { useState, useEffect, useCallback } from 'react';
import { UserPlus, Search, Loader2, AlertTriangle, PlusCircle } from 'lucide-react';
import FormModal from './FormModal';
import PersonFormModal, { type PersonFormData } from './PersonFormModal';
import { apiFetch } from '../hooks/useApi';
import type { PersonRole } from '../types';

interface LinkPersonModalProps {
  isOpen: boolean;
  onClose: () => void;
  incidentId: string;
  onLinked: () => void;
}

interface PersonResult {
  id: number;
  first_name: string;
  last_name: string;
  dob?: string;
  phone?: string;
  flags?: string;
}

interface WarrantCheckResult {
  has_warrants: boolean;
  count: number;
  warrants: { id: number; warrant_number: string; warrant_type: string; charge_description?: string }[];
}

const PERSON_ROLES: { value: PersonRole; label: string }[] = [
  { value: 'suspect', label: 'Suspect' },
  { value: 'victim', label: 'Victim' },
  { value: 'witness', label: 'Witness' },
  { value: 'reporting_party', label: 'Reporting Party' },
  { value: 'involved', label: 'Involved' },
  { value: 'other', label: 'Other' },
];

export default function LinkPersonModal({ isOpen, onClose, incidentId, onLinked }: LinkPersonModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PersonResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<PersonResult | null>(null);
  const [role, setRole] = useState<PersonRole>('involved');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [warrantWarning, setWarrantWarning] = useState<WarrantCheckResult | null>(null);
  const [checkingWarrants, setCheckingWarrants] = useState(false);
  const [showCreatePerson, setShowCreatePerson] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const resetForm = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedPerson(null);
    setRole('involved');
    setNotes('');
    setError('');
    setWarrantWarning(null);
    setShowCreatePerson(false);
  }, []);

  useEffect(() => {
    if (!isOpen) resetForm();
  }, [isOpen, resetForm]);

  const handleSearch = useCallback(async (query: string) => {
    if (query.length < 2) return;
    setIsSearching(true);
    setError('');
    try {
      const results = await apiFetch<PersonResult[]>(`/records/persons/search?q=${encodeURIComponent(query)}`);
      setSearchResults(results);
    } catch {
      setError('Failed to search persons');
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (searchQuery.length >= 2) handleSearch(searchQuery);
      else setSearchResults([]);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, handleSearch]);

  const checkWarrants = useCallback(async (personId: number) => {
    setCheckingWarrants(true);
    setWarrantWarning(null);
    try {
      const result = await apiFetch<WarrantCheckResult>(`/warrants/check/${personId}`);
      if (result.has_warrants) {
        setWarrantWarning(result);
      }
    } catch {
      // Silently fail — warrant check is advisory, not blocking
    } finally {
      setCheckingWarrants(false);
    }
  }, []);

  const handleCreatePerson = async (data: PersonFormData) => {
    setIsCreating(true);
    setError('');
    try {
      const result = await apiFetch<{ id: number }>('/records/persons', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      // Auto-select the newly created person
      const newPerson: PersonResult = {
        id: result.id,
        first_name: data.first_name,
        last_name: data.last_name,
        dob: data.dob || undefined,
        phone: data.phone || undefined,
      };
      setSelectedPerson(newPerson);
      setShowCreatePerson(false);
      checkWarrants(result.id);
    } catch (err: any) {
      setError(err?.message || 'Failed to create person');
    } finally {
      setIsCreating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPerson) {
      setError('Please select a person');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      await apiFetch(`/incidents/${incidentId}/persons`, {
        method: 'POST',
        body: JSON.stringify({ person_id: selectedPerson.id, role, notes: notes || undefined }),
      });
      onLinked();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to link person');
    } finally {
      setIsSubmitting(false);
    }
  };

  const parseFlags = (flags?: string): string[] => {
    if (!flags) return [];
    try { return JSON.parse(flags); } catch { return []; }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title="Link Person to Incident"
      icon={UserPlus}
      submitLabel="Link Person"
      isSubmitting={isSubmitting}
      maxWidth="max-w-lg"
    >
      {error && (
        <div className="px-3 py-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Search */}
      <div>
        <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Search Person</label>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400" />
          <input
            type="text"
            className="input-dark pl-8"
            placeholder="Search by name, phone, email..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSelectedPerson(null); }}
            autoFocus
          />
          {isSearching && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-brand-400" />}
        </div>

        {/* Results dropdown */}
        {searchResults.length > 0 && !selectedPerson && (
          <div className="mt-1 max-h-48 overflow-y-auto border border-rmpg-600 bg-surface-sunken divide-y divide-gray-700">
            {searchResults.map((person) => {
              const flags = parseFlags(person.flags);
              return (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => { setSelectedPerson(person); setSearchResults([]); checkWarrants(person.id); }}
                  className="w-full text-left px-3 py-2 hover:bg-rmpg-800 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white font-medium">
                      {person.last_name}, {person.first_name}
                    </span>
                    {flags.length > 0 && (
                      <div className="flex gap-1">
                        {flags.map((f, i) => (
                          <span key={`${f}-${i}`} className="px-1.5 py-0.5 bg-red-900/40 text-red-400 text-[10px] uppercase font-bold">
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3 text-[11px] text-rmpg-400 mt-0.5">
                    {person.dob && <span>DOB: {person.dob}</span>}
                    {person.phone && <span>{person.phone}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && !selectedPerson && (
          <div className="mt-1 flex items-center gap-2">
            <p className="text-xs text-rmpg-400">No persons found</p>
            <button
              type="button"
              onClick={() => setShowCreatePerson(true)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase text-brand-400 bg-brand-900/30 border border-brand-700/40 hover:bg-brand-900/50 transition-colors"
            >
              <PlusCircle className="w-3 h-3" />
              Create New Person
            </button>
          </div>
        )}
      </div>

      {/* Selected person display */}
      {selectedPerson && (
        <div className="px-3 py-2 bg-brand-900/20 border border-brand-700/40 flex items-center justify-between">
          <div>
            <span className="text-sm text-white font-medium">
              {selectedPerson.last_name}, {selectedPerson.first_name}
            </span>
            <div className="flex gap-3 text-[11px] text-rmpg-400 mt-0.5">
              {selectedPerson.dob && <span>DOB: {selectedPerson.dob}</span>}
              {selectedPerson.phone && <span>{selectedPerson.phone}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setSelectedPerson(null); setSearchQuery(''); setWarrantWarning(null); }}
            className="text-xs text-rmpg-300 hover:text-white"
          >
            Change
          </button>
        </div>
      )}

      {/* Warrant Warning */}
      {checkingWarrants && (
        <div className="px-3 py-2 bg-yellow-900/20 border border-yellow-700/40 text-yellow-400 text-xs flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Checking warrants...
        </div>
      )}
      {warrantWarning && (
        <div className="px-3 py-2 bg-red-900/30 border border-red-600 text-red-300 text-xs">
          <div className="flex items-center gap-2 font-bold text-red-400 mb-1">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            ACTIVE WARRANTS ({warrantWarning.count})
          </div>
          <ul className="ml-6 space-y-0.5">
            {warrantWarning.warrants.map((w) => (
              <li key={w.id} className="list-disc">
                <span className="font-mono text-red-400">{w.warrant_number}</span>
                {' '}{w.warrant_type}{w.charge_description ? ` — ${w.charge_description}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Role */}
      <div>
        <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Role</label>
        <select className="select-dark" value={role} onChange={(e) => setRole(e.target.value as PersonRole)}>
          {PERSON_ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Notes (Optional)</label>
        <textarea
          className="textarea-dark"
          rows={2}
          placeholder="Additional details about this person's involvement..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {/* Create Person Modal */}
      <PersonFormModal
        isOpen={showCreatePerson}
        onClose={() => setShowCreatePerson(false)}
        onSubmit={handleCreatePerson}
        isSubmitting={isCreating}
      />
    </FormModal>
  );
}

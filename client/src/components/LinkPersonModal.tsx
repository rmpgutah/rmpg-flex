import React, { useState, useEffect, useCallback } from 'react';
import { UserPlus, Search, Loader2, AlertTriangle, Plus } from 'lucide-react';
import FormModal from './FormModal';
import { apiFetch } from '../hooks/useApi';
import type { PersonRole } from '../types';

interface LinkPersonModalProps {
  isOpen: boolean;
  onClose: () => void;
  incidentId: string;
  onLinked: () => void;
  /** Pre-fill the search (and create) form from external context */
  defaultName?: string;
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

export default function LinkPersonModal({ isOpen, onClose, incidentId, onLinked, defaultName }: LinkPersonModalProps) {
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

  // --- Create New Person state ---
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newDob, setNewDob] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  const resetForm = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedPerson(null);
    setRole('involved');
    setNotes('');
    setError('');
    setWarrantWarning(null);
    setShowCreateForm(false);
    setNewFirstName('');
    setNewLastName('');
    setNewDob('');
    setNewPhone('');
    setNewAddress('');
    setHasSearched(false);
  }, []);

  useEffect(() => {
    if (!isOpen) resetForm();
  }, [isOpen, resetForm]);

  // Pre-fill search from defaultName
  useEffect(() => {
    if (isOpen && defaultName && !searchQuery) {
      setSearchQuery(defaultName);
    }
  }, [isOpen, defaultName]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = useCallback(async () => {
    if (searchQuery.length < 2) return;
    setIsSearching(true);
    setError('');
    setHasSearched(true);
    try {
      const results = await apiFetch<PersonResult[]>(`/records/persons/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(results);
    } catch {
      setError('Failed to search persons');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (searchQuery.length >= 2) handleSearch();
      else { setSearchResults([]); setHasSearched(false); }
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

  /** Parse search query into first/last name for pre-filling create form */
  const prefillFromSearch = useCallback(() => {
    const parts = searchQuery.trim().split(/\s+/);
    if (parts.length >= 2) {
      setNewFirstName(parts[0]);
      setNewLastName(parts.slice(1).join(' '));
    } else if (parts.length === 1) {
      setNewLastName(parts[0]);
    }
    setShowCreateForm(true);
  }, [searchQuery]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // If in create mode, first create the person then link
    if (showCreateForm) {
      if (!newFirstName.trim() || !newLastName.trim()) {
        setError('First and last name are required');
        return;
      }

      setIsSubmitting(true);
      setError('');
      try {
        // Create person
        const newPerson = await apiFetch<{ id: number; first_name: string; last_name: string }>('/records/persons', {
          method: 'POST',
          body: JSON.stringify({
            first_name: newFirstName.trim(),
            last_name: newLastName.trim(),
            dob: newDob.trim() || undefined,
            phone: newPhone.trim() || undefined,
            address: newAddress.trim() || undefined,
          }),
        });

        // Link to incident
        await apiFetch(`/incidents/${incidentId}/persons`, {
          method: 'POST',
          body: JSON.stringify({ person_id: newPerson.id, role, notes: notes || undefined }),
        });

        onLinked();
        onClose();
      } catch (err: any) {
        setError(err?.message || 'Failed to create and link person');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Standard flow — link existing person
    if (!selectedPerson) {
      setError('Please select a person or create a new one');
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
      title={showCreateForm ? 'Create & Link Person' : 'Link Person to Incident'}
      icon={showCreateForm ? Plus : UserPlus}
      submitLabel={showCreateForm ? 'Create & Link' : 'Link Person'}
      isSubmitting={isSubmitting}
      maxWidth="max-w-lg"
    >
      {error && (
        <div className="px-3 py-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* ── Create New Person Form ── */}
      {showCreateForm ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-brand-400 uppercase tracking-wider">New Person Details</span>
            <button type="button" onClick={() => setShowCreateForm(false)} className="text-[10px] text-rmpg-400 hover:text-white">
              Back to Search
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">First Name *</label>
              <input type="text" className="input-field" placeholder="John" value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} autoFocus required />
            </div>
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Last Name *</label>
              <input type="text" className="input-field" placeholder="Smith" value={newLastName} onChange={(e) => setNewLastName(e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">DOB</label>
              <input type="date" className="input-field" value={newDob} onChange={(e) => setNewDob(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Phone</label>
              <input type="text" className="input-field" placeholder="555-123-4567" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Address</label>
            <input type="text" className="input-field" placeholder="123 Main St, City, ST 12345" value={newAddress} onChange={(e) => setNewAddress(e.target.value)} />
          </div>
        </div>
      ) : (
        <>
          {/* ── Search ── */}
          <div>
            <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Search Person</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400" />
              <input
                type="text"
                className="input-field pl-8"
                placeholder="Search by name, phone, email..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setSelectedPerson(null); setShowCreateForm(false); }}
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
                              <span key={i} className="px-1.5 py-0.5 bg-red-900/40 text-red-400 text-[10px] uppercase font-bold">
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

            {/* No results + Create New button */}
            {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && !selectedPerson && hasSearched && (
              <div className="mt-1 border border-rmpg-600 bg-surface-sunken p-3">
                <p className="text-xs text-rmpg-400 mb-2">No persons found matching "{searchQuery}"</p>
                <button
                  type="button"
                  onClick={prefillFromSearch}
                  className="flex items-center gap-1.5 text-xs font-bold text-brand-400 hover:text-brand-300 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
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
        </>
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
        <select className="input-field" value={role} onChange={(e) => setRole(e.target.value as PersonRole)}>
          {PERSON_ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Notes (Optional)</label>
        <textarea
          className="input-field"
          rows={2}
          placeholder="Additional details about this person's involvement..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </FormModal>
  );
}

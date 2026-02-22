import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  Plus,
  Trash2,
  User,
  Star,
  Search,
  X,
  Link2,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

// ── Types ──────────────────────────────────────────

interface ClientPersonLink {
  id: number;
  client_id: number;
  person_id: number;
  relationship: string;
  title: string | null;
  notes: string | null;
  is_primary: number;
  created_at: string;
  // Joined fields (person side)
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  // Joined fields (client side)
  client_name?: string;
  client_status?: string;
  client_phone?: string;
  created_by_name?: string;
}

// ── Relationship display config ─────────────────────

const RELATIONSHIP_OPTIONS = [
  { value: 'employee', label: 'Employee', color: 'bg-blue-900/40 text-blue-300 border-blue-700/40' },
  { value: 'contact', label: 'Contact', color: 'bg-teal-900/40 text-teal-300 border-teal-700/40' },
  { value: 'tenant', label: 'Tenant', color: 'bg-indigo-900/40 text-indigo-300 border-indigo-700/40' },
  { value: 'owner', label: 'Owner', color: 'bg-green-900/40 text-green-300 border-green-700/40' },
  { value: 'manager', label: 'Manager', color: 'bg-purple-900/40 text-purple-300 border-purple-700/40' },
  { value: 'subject', label: 'Subject', color: 'bg-amber-900/40 text-amber-300 border-amber-700/40' },
  { value: 'trespass_warning', label: 'Trespass Warning', color: 'bg-red-900/40 text-red-300 border-red-700/40' },
  { value: 'frequent_visitor', label: 'Frequent Visitor', color: 'bg-sky-900/40 text-sky-300 border-sky-700/40' },
  { value: 'banned', label: 'Banned', color: 'bg-red-900/60 text-red-300 border-red-600/60' },
  { value: 'other', label: 'Other', color: 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/40' },
];

function getRelBadgeClass(rel: string): string {
  return RELATIONSHIP_OPTIONS.find(r => r.value === rel)?.color || 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/40';
}

function getRelLabel(rel: string): string {
  return RELATIONSHIP_OPTIONS.find(r => r.value === rel)?.label || rel;
}

// ── Component: Person's linked clients (shown in Person detail) ──

interface PersonClientLinksProps {
  personId: string;
  personName: string;
}

export function PersonClientLinks({ personId, personName }: PersonClientLinksProps) {
  const [links, setLinks] = useState<ClientPersonLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  const fetchLinks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch(`/records/persons/${personId}/clients`) as ClientPersonLink[];
      setLinks(data);
    } catch (err) {
      console.error('Failed to load person-client links:', err);
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  const handleRemove = async (linkId: number) => {
    try {
      await apiFetch(`/records/client-persons/${linkId}`, { method: 'DELETE' });
      fetchLinks();
    } catch (err) {
      console.error('Failed to remove link:', err);
    }
  };

  return (
    <div className="panel-beveled p-3 bg-surface-base">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
          <Building2 className="w-3 h-3" /> Linked Clients
        </h3>
        <button
          type="button"
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase text-rmpg-300 hover:text-white bg-rmpg-700/40 hover:bg-rmpg-600/40 border border-rmpg-600/40 transition-colors"
        >
          {showAddForm ? <X className="w-2.5 h-2.5" /> : <Plus className="w-2.5 h-2.5" />}
          {showAddForm ? 'Cancel' : 'Link Client'}
        </button>
      </div>

      {showAddForm && (
        <AddClientPersonLinkForm
          personId={personId}
          onLinked={() => { setShowAddForm(false); fetchLinks(); }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {loading ? (
        <div className="text-[10px] text-rmpg-500 py-2">Loading...</div>
      ) : links.length === 0 ? (
        <div className="text-[10px] text-rmpg-500 py-2">No clients linked to this person.</div>
      ) : (
        <div className="space-y-1.5">
          {links.map((link) => (
            <div key={link.id} className="flex items-center justify-between gap-2 px-2 py-1.5 bg-rmpg-900/50 border border-rmpg-700/30 group">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="w-3.5 h-3.5 text-rmpg-400 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-rmpg-100 font-medium truncate">{link.client_name}</span>
                    {link.is_primary === 1 && (
                      <Star className="w-3 h-3 text-amber-400 flex-shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`inline-block px-1.5 py-px text-[8px] font-bold uppercase border ${getRelBadgeClass(link.relationship)}`}>
                      {getRelLabel(link.relationship)}
                    </span>
                    {link.title && (
                      <span className="text-[9px] text-rmpg-400">{link.title}</span>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(link.id)}
                className="p-1 text-rmpg-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                title="Remove link"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Component: Client's linked persons (shown in Client detail) ──

interface ClientPersonLinksProps {
  clientId: string;
  clientName: string;
}

export function ClientPersonLinks({ clientId, clientName }: ClientPersonLinksProps) {
  const [links, setLinks] = useState<ClientPersonLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  const fetchLinks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch(`/records/clients/${clientId}/persons`) as ClientPersonLink[];
      setLinks(data);
    } catch (err) {
      console.error('Failed to load client-person links:', err);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  const handleRemove = async (linkId: number) => {
    try {
      await apiFetch(`/records/client-persons/${linkId}`, { method: 'DELETE' });
      fetchLinks();
    } catch (err) {
      console.error('Failed to remove link:', err);
    }
  };

  return (
    <div className="panel-beveled p-3 bg-surface-base">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
          <User className="w-3 h-3" /> Linked Persons
          {links.length > 0 && (
            <span className="ml-1 px-1.5 py-px bg-rmpg-700/60 text-rmpg-300 text-[9px] font-mono">{links.length}</span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase text-rmpg-300 hover:text-white bg-rmpg-700/40 hover:bg-rmpg-600/40 border border-rmpg-600/40 transition-colors"
        >
          {showAddForm ? <X className="w-2.5 h-2.5" /> : <Plus className="w-2.5 h-2.5" />}
          {showAddForm ? 'Cancel' : 'Link Person'}
        </button>
      </div>

      {showAddForm && (
        <AddClientPersonLinkForm
          clientId={clientId}
          onLinked={() => { setShowAddForm(false); fetchLinks(); }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {loading ? (
        <div className="text-[10px] text-rmpg-500 py-2">Loading...</div>
      ) : links.length === 0 ? (
        <div className="text-[10px] text-rmpg-500 py-2">No persons linked to this client.</div>
      ) : (
        <div className="space-y-1.5">
          {links.map((link) => (
            <div key={link.id} className="flex items-center justify-between gap-2 px-2 py-1.5 bg-rmpg-900/50 border border-rmpg-700/30 group">
              <div className="flex items-center gap-2 min-w-0">
                <User className="w-3.5 h-3.5 text-rmpg-400 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-rmpg-100 font-medium truncate">
                      {link.last_name}, {link.first_name}
                    </span>
                    {link.is_primary === 1 && (
                      <Star className="w-3 h-3 text-amber-400 flex-shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`inline-block px-1.5 py-px text-[8px] font-bold uppercase border ${getRelBadgeClass(link.relationship)}`}>
                      {getRelLabel(link.relationship)}
                    </span>
                    {link.title && (
                      <span className="text-[9px] text-rmpg-400">{link.title}</span>
                    )}
                    {link.phone && (
                      <span className="text-[9px] text-rmpg-500">{link.phone}</span>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(link.id)}
                className="p-1 text-rmpg-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                title="Remove link"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared Add-Link Form ────────────────────────────

interface AddLinkFormProps {
  personId?: string;
  clientId?: string;
  onLinked: () => void;
  onCancel: () => void;
}

function AddClientPersonLinkForm({ personId, clientId, onLinked, onCancel }: AddLinkFormProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string>('');
  const [relationship, setRelationship] = useState('contact');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine if we're searching for persons or clients
  const searchingFor = personId ? 'clients' : 'persons';

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        if (searchingFor === 'clients') {
          // Search clients
          const data = await apiFetch(`/records/clients?q=${encodeURIComponent(searchQuery)}`) as any;
          const items = Array.isArray(data) ? data : (data?.data || []);
          setSearchResults(items.slice(0, 10));
        } else {
          // Search persons
          const data = await apiFetch(`/records/persons/search?q=${encodeURIComponent(searchQuery)}`) as any[];
          setSearchResults((Array.isArray(data) ? data : []).slice(0, 10));
        }
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchingFor]);

  const handleSelect = (item: any) => {
    if (searchingFor === 'clients') {
      setSelectedId(String(item.id));
      setSelectedLabel(item.name);
    } else {
      setSelectedId(String(item.id));
      setSelectedLabel(`${item.first_name} ${item.last_name}`);
    }
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleSubmit = async () => {
    if (!selectedId) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/records/client-persons', {
        method: 'POST',
        body: JSON.stringify({
          client_id: personId ? selectedId : clientId,
          person_id: personId || selectedId,
          relationship,
          title: title || null,
          notes: notes || null,
          is_primary: isPrimary,
        }),
      });
      onLinked();
    } catch (err: any) {
      setError(err?.message || 'Failed to create link');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mb-3 p-2.5 border border-rmpg-600/50 bg-rmpg-800/50 space-y-2">
      {/* Search field */}
      {!selectedId ? (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
          <input
            type="text"
            placeholder={`Search ${searchingFor}...`}
            className="input-dark pl-7 text-xs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          {searchResults.length > 0 && (
            <div className="absolute z-20 w-full mt-1 max-h-40 overflow-y-auto bg-rmpg-800 border border-rmpg-600 shadow-lg">
              {searchResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item)}
                  className="w-full text-left px-3 py-1.5 text-xs text-rmpg-200 hover:bg-rmpg-700 transition-colors flex items-center gap-2"
                >
                  {searchingFor === 'clients' ? (
                    <><Building2 className="w-3 h-3 text-rmpg-400" /> {item.name}</>
                  ) : (
                    <><User className="w-3 h-3 text-rmpg-400" /> {item.first_name} {item.last_name}</>
                  )}
                </button>
              ))}
            </div>
          )}
          {searching && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-rmpg-500">Searching...</div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between bg-rmpg-700/30 px-2 py-1 border border-rmpg-600/30">
          <div className="flex items-center gap-2 text-xs text-rmpg-100">
            <Link2 className="w-3 h-3 text-rmpg-400" />
            <span className="font-medium">{selectedLabel}</span>
          </div>
          <button type="button" onClick={() => { setSelectedId(null); setSelectedLabel(''); }} className="text-rmpg-500 hover:text-red-400">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Relationship & details */}
      {selectedId && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] text-rmpg-400 uppercase font-semibold">Relationship</label>
              <select className="select-dark mt-0.5 text-xs" value={relationship} onChange={(e) => setRelationship(e.target.value)}>
                {RELATIONSHIP_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-rmpg-400 uppercase font-semibold">Title / Role</label>
              <input
                type="text"
                className="input-dark mt-0.5 text-xs"
                placeholder="e.g. Property Manager"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-[9px] text-rmpg-400 uppercase font-semibold">Notes</label>
            <input
              type="text"
              className="input-dark mt-0.5 text-xs"
              placeholder="Optional notes about this link"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-[10px] text-rmpg-300 cursor-pointer">
              <input
                type="checkbox"
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
                className="w-3.5 h-3.5 bg-rmpg-800 border-rmpg-600"
              />
              Primary contact
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="px-2 py-1 text-[9px] font-bold uppercase text-rmpg-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="px-3 py-1 text-[9px] font-bold uppercase bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Linking...' : 'Link'}
              </button>
            </div>
          </div>
          {error && <div className="text-[10px] text-red-400">{error}</div>}
        </>
      )}
    </div>
  );
}

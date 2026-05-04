import { useState, useEffect, useCallback, useMemo } from 'react';
import RichTextArea from '../../components/RichTextArea';
import { formatPhoneInput } from '../../utils/formatters';
import {
  Search,
  MapPin,
  Phone,
  Mail,
  Globe,
  Trash2,
  Pencil,
  X,
  Users,
  Briefcase,
  ArrowUpDown,
  Filter,
  Shield,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import FileAttachments from '../../components/FileAttachments';
import LinkedRecordsSection from '../../components/LinkedRecordsSection';
import CollapsibleSection from '../../components/CollapsibleSection';
import type { RecordEntityType } from '../../types';

// ── Types ──────────────────────────────────────

export interface Business {
  id: string;
  name: string;
  dba_name?: string;
  business_type?: string;
  ein?: string;
  license_number?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  website?: string;
  owner_name?: string;
  owner_phone?: string;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  industry?: string;
  employee_count?: string;
  annual_revenue?: string;
  status?: string;
  notes?: string;
  flags: string[];
  created_at: string;
  updated_at: string;
}

export function mapDbBusiness(row: Record<string, unknown>): Business {
  let flags: string[] = [];
  try { flags = JSON.parse(String(row.flags || '[]')); } catch { flags = []; }
  return {
    id: String(row.id),
    name: String(row.name || ''),
    dba_name: row.dba_name ? String(row.dba_name) : undefined,
    business_type: row.business_type ? String(row.business_type) : undefined,
    ein: row.ein ? String(row.ein) : undefined,
    license_number: row.license_number ? String(row.license_number) : undefined,
    address: row.address ? String(row.address) : undefined,
    city: row.city ? String(row.city) : undefined,
    state: row.state ? String(row.state) : undefined,
    zip: row.zip ? String(row.zip) : undefined,
    phone: row.phone ? String(row.phone) : undefined,
    email: row.email ? String(row.email) : undefined,
    website: row.website ? String(row.website) : undefined,
    owner_name: row.owner_name ? String(row.owner_name) : undefined,
    owner_phone: row.owner_phone ? String(row.owner_phone) : undefined,
    contact_name: row.contact_name ? String(row.contact_name) : undefined,
    contact_phone: row.contact_phone ? String(row.contact_phone) : undefined,
    contact_email: row.contact_email ? String(row.contact_email) : undefined,
    industry: row.industry ? String(row.industry) : undefined,
    employee_count: row.employee_count ? String(row.employee_count) : undefined,
    annual_revenue: row.annual_revenue ? String(row.annual_revenue) : undefined,
    status: row.status ? String(row.status) : 'active',
    notes: row.notes ? String(row.notes) : undefined,
    flags,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

// ── State interface ──────────────────────────────

export interface BusinessTabState {
  businesses: Business[];
  filteredBusinesses: Business[];
  selectedBusiness: Business | null;
  setSelectedBusiness: (b: Business | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  showArchived: boolean;
  loading: boolean;
  setDeleteTarget: (t: { type: string; id: string; label: string } | null) => void;
  handleArchive: (type: string, id: string) => Promise<void>;
  handleUnarchive: (type: string, id: string) => Promise<void>;
  // Modal
  showFormModal: boolean;
  setShowFormModal: (v: boolean) => void;
  editingBusiness: Business | null;
  formSubmitting: boolean;
  handleSubmit: (data: Partial<Business>) => Promise<void>;
  openEdit: (b: Business) => void;
  linkRefreshKey: number;
  openLinkModal: (type: RecordEntityType, id: string) => void;
}

// ── Hook ──────────────────────────────────────

export function useBusinessTab(props: {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  showArchived: boolean;
  setError: (e: string | null) => void;
  setDeleteTarget: (t: any) => void;
  linkRefreshKey: number;
  openLinkModal: (type: RecordEntityType, id: string) => void;
  handleArchiveRecord: (type: string, id: string) => Promise<void>;
  handleUnarchiveRecord: (type: string, id: string) => Promise<void>;
  fetchBusinesses?: () => void;
}): BusinessTabState {
  const { searchQuery, setSearchQuery, showArchived, setError, setDeleteTarget, linkRefreshKey, openLinkModal, handleArchiveRecord, handleUnarchiveRecord } = props;
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState<Business | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const fetchBusinesses = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch<any[]>(`/records/businesses?archived=${showArchived}`);
      setBusinesses((data || []).map(mapDbBusiness));
    } catch (err: any) {
      setError(err.message || 'Failed to load businesses');
    }
    setLoading(false);
  }, [showArchived, setError]);

  useEffect(() => { fetchBusinesses(); }, [fetchBusinesses]);

  const filteredBusinesses = useMemo(() => {
    if (!searchQuery) return businesses;
    const q = searchQuery.toLowerCase();
    return businesses.filter(b =>
      b.name.toLowerCase().includes(q) ||
      (b.dba_name || '').toLowerCase().includes(q) ||
      (b.address || '').toLowerCase().includes(q) ||
      (b.phone || '').includes(q) ||
      (b.owner_name || '').toLowerCase().includes(q) ||
      (b.ein || '').includes(q)
    );
  }, [businesses, searchQuery]);

  const handleSubmit = useCallback(async (data: Partial<Business>) => {
    setFormSubmitting(true);
    try {
      if (editingBusiness) {
        await apiFetch(`/records/businesses/${editingBusiness.id}`, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        await apiFetch('/records/businesses', { method: 'POST', body: JSON.stringify(data) });
      }
      setShowFormModal(false);
      setEditingBusiness(null);
      fetchBusinesses();
    } catch (err: any) {
      setError(err.message || 'Failed to save business');
    }
    setFormSubmitting(false);
  }, [editingBusiness, fetchBusinesses, setError]);

  const openEdit = useCallback((b: Business) => {
    setEditingBusiness(b);
    setShowFormModal(true);
  }, []);

  return {
    businesses, filteredBusinesses, selectedBusiness, setSelectedBusiness,
    searchQuery, setSearchQuery, showArchived, loading,
    setDeleteTarget,
    handleArchive: handleArchiveRecord as any,
    handleUnarchive: handleUnarchiveRecord as any,
    showFormModal, setShowFormModal, editingBusiness, formSubmitting,
    handleSubmit, openEdit, linkRefreshKey, openLinkModal,
  };
}

// ── List Component ──────────────────────────────

export function BusinessTabList({ state }: { state: BusinessTabState }) {
  const { user } = useAuth();
  const { filteredBusinesses, selectedBusiness, setSelectedBusiness, searchQuery, setSearchQuery, showArchived, openEdit, setDeleteTarget, handleArchive, handleUnarchive, showFormModal, editingBusiness, formSubmitting, handleSubmit, setShowFormModal } = state;
  const isAdmin = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor';

  const [sortBy, setSortBy] = useState<'name' | 'type' | 'newest'>('name');
  const [filterType, setFilterType] = useState<string | null>(null);

  const displayBusinesses = useMemo(() => {
    let list = [...filteredBusinesses];
    if (filterType) {
      list = list.filter(b => {
        if (filterType === 'active') return b.status === 'active';
        if (filterType === 'inactive') return b.status !== 'active';
        return true;
      });
    }
    if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'type') list.sort((a, b) => (a.business_type || '').localeCompare(b.business_type || ''));
    else if (sortBy === 'newest') list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return list;
  }, [filteredBusinesses, sortBy, filterType]);

  return (
    <div className="h-full flex flex-col">
      {/* Search */}
      <div className="p-3 border-b border-rmpg-600" role="search">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400 pointer-events-none" />
          <input type="text" className="input-dark pl-9 w-full text-[11px] min-h-[36px]" placeholder="Search businesses by name, DBA, address, EIN..."
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-white"><X className="w-3 h-3" /></button>}
        </div>
      </div>

      {/* Stats + Sort + Filter */}
      <div className="px-3 py-1.5 border-b border-rmpg-700/50 bg-surface-sunken flex items-center gap-4 text-[9px] flex-wrap">
        <span className="text-rmpg-400 flex items-center gap-1"><Briefcase className="w-3 h-3" /> <strong className="text-white">{filteredBusinesses.length}</strong> Businesses</span>
        <div className="ml-auto flex items-center gap-1">
          <ArrowUpDown className="w-3 h-3 text-rmpg-500" />
          {(['name', 'type', 'newest'] as const).map(s => (
            <button key={s} type="button" onClick={() => setSortBy(s)}
              className={`px-1.5 py-0.5 font-medium border transition-all ${sortBy === s ? 'bg-brand-900/30 border-brand-500/50 text-brand-400' : 'bg-transparent border-transparent text-rmpg-500'}`}>
              {s === 'name' ? 'Name' : s === 'type' ? 'Type' : 'Newest'}
            </button>
          ))}
        </div>
      </div>
      <div className="px-3 py-1 border-b border-rmpg-700/30 flex items-center gap-1.5 text-[9px]">
        <Filter className="w-3 h-3 text-rmpg-500" />
        {[{ key: null, label: 'All' }, { key: 'active', label: 'Active' }, { key: 'inactive', label: 'Inactive' }].map(f => (
          <button key={f.key || 'all'} type="button" onClick={() => setFilterType(f.key)}
            className={`px-2 py-0.5 font-medium border transition-all ${filterType === f.key ? 'bg-brand-900/30 border-brand-500/50 text-brand-400' : 'bg-transparent border-rmpg-700/50 text-rmpg-500'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto scrollbar-dark" role="list">
        {displayBusinesses.length === 0 && (
          <div className="text-center py-16">
            <Briefcase className="w-10 h-10 text-rmpg-600 mx-auto mb-3" />
            <p className="text-sm text-rmpg-400">{searchQuery ? 'No businesses match.' : 'No business records found.'}</p>
          </div>
        )}
        {displayBusinesses.map((b, idx) => (
          <div key={b.id} role="listitem" tabIndex={0}
            onClick={() => setSelectedBusiness(selectedBusiness?.id === b.id ? null : b)}
            onKeyDown={e => { if (e.key === 'Enter') setSelectedBusiness(selectedBusiness?.id === b.id ? null : b); }}
            className={`px-4 py-3 border-b border-rmpg-700/50 cursor-pointer transition-all duration-150 ${selectedBusiness?.id === b.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : `hover:bg-rmpg-700/30 border-l-2 border-l-transparent ${idx % 2 === 1 ? 'bg-rmpg-800/20' : ''}`}`}>
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-sm flex items-center justify-center text-xs font-bold bg-purple-900/30 text-purple-400 border border-purple-700/50">
                {(b.name || '')[0]?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white truncate">{b.name}</span>
                  {b.dba_name && <span className="text-[10px] text-amber-400 italic">DBA: {b.dba_name}</span>}
                  {b.status === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Active" />}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[10px] text-rmpg-400">
                  {b.business_type && <span>{b.business_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>}
                  {b.industry && <span>{b.industry}</span>}
                  {b.phone && <span className="flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" />{b.phone}</span>}
                </div>
                {b.address && (
                  <div className="flex items-center gap-1 mt-0.5 text-[9px] text-rmpg-500 truncate">
                    <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                    {[b.address, b.city, b.state, b.zip].filter(Boolean).join(', ')}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                {b.phone && <a href={`tel:${b.phone}`} onClick={e => e.stopPropagation()} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-green-400"><Phone className="w-3 h-3" /></a>}
                {b.email && <a href={`mailto:${b.email}`} onClick={e => e.stopPropagation()} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-blue-400"><Mail className="w-3 h-3" /></a>}
                {b.website && <a href={b.website.startsWith('http') ? b.website : `https://${b.website}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-brand-400"><Globe className="w-3 h-3" /></a>}
                {isAdmin && <button type="button" onClick={e => { e.stopPropagation(); openEdit(b); }} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-brand-400"><Pencil className="w-3 h-3" /></button>}
                {isAdmin && <button type="button" onClick={e => { e.stopPropagation(); setDeleteTarget({ type: 'business', id: b.id, label: b.name }); }} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Form Modal — simplified inline */}
      {showFormModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="panel-surface w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto p-4 space-y-3">
            <h3 className="text-sm font-bold text-white">{editingBusiness ? 'Edit Business' : 'New Business'}</h3>
            <BusinessForm initial={editingBusiness} onSubmit={handleSubmit} onCancel={() => setShowFormModal(false)} submitting={formSubmitting} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Detail Component ──────────────────────────────

export function BusinessTabDetail({ state }: { state: BusinessTabState }) {
  const { selectedBusiness, linkRefreshKey, openLinkModal } = state;
  if (!selectedBusiness) return (
    <div className="h-full flex items-center justify-center text-rmpg-400">
      <div className="text-center">
        <Briefcase className="w-8 h-8 mx-auto mb-2 text-rmpg-500" />
        <p className="text-sm">Select a business to view details</p>
      </div>
    </div>
  );

  const b = selectedBusiness;
  return (
    <div className="h-full overflow-auto p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 rounded-sm flex items-center justify-center text-lg font-bold bg-purple-900/30 text-purple-400 border border-purple-700/50">
          {(b.name || '')[0]?.toUpperCase()}
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">{b.name}</h2>
          {b.dba_name && <p className="text-[10px] text-amber-400">DBA: {b.dba_name}</p>}
          <p className="text-[10px] text-rmpg-400">{b.business_type?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} · {b.industry || 'N/A'}</p>
        </div>
      </div>

      <CollapsibleSection title="Business Information" icon={Briefcase} defaultOpen>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div><span className="text-rmpg-500">EIN:</span> <span className="text-rmpg-200">{b.ein || '—'}</span></div>
          <div><span className="text-rmpg-500">License #:</span> <span className="text-rmpg-200">{b.license_number || '—'}</span></div>
          <div><span className="text-rmpg-500">Type:</span> <span className="text-rmpg-200">{b.business_type || '—'}</span></div>
          <div><span className="text-rmpg-500">Industry:</span> <span className="text-rmpg-200">{b.industry || '—'}</span></div>
          <div><span className="text-rmpg-500">Employees:</span> <span className="text-rmpg-200">{b.employee_count || '—'}</span></div>
          <div><span className="text-rmpg-500">Revenue:</span> <span className="text-rmpg-200">{b.annual_revenue || '—'}</span></div>
          <div><span className="text-rmpg-500">Status:</span> <span className={b.status === 'active' ? 'text-green-400' : 'text-rmpg-400'}>{(b.status || 'N/A').toUpperCase()}</span></div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Contact & Address" icon={Phone} defaultOpen>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div><span className="text-rmpg-500">Phone:</span> <span className="text-rmpg-200">{b.phone || '—'}</span></div>
          <div><span className="text-rmpg-500">Email:</span> <span className="text-rmpg-200">{b.email || '—'}</span></div>
          <div><span className="text-rmpg-500">Website:</span> <span className="text-rmpg-200">{b.website || '—'}</span></div>
          <div className="col-span-2"><span className="text-rmpg-500">Address:</span> <span className="text-rmpg-200">{[b.address, b.city, b.state, b.zip].filter(Boolean).join(', ') || '—'}</span></div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Owner & Key Contact" icon={Users}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div><span className="text-rmpg-500">Owner:</span> <span className="text-rmpg-200">{b.owner_name || '—'}</span></div>
          <div><span className="text-rmpg-500">Owner Phone:</span> <span className="text-rmpg-200">{b.owner_phone || '—'}</span></div>
          <div><span className="text-rmpg-500">Contact:</span> <span className="text-rmpg-200">{b.contact_name || '—'}</span></div>
          <div><span className="text-rmpg-500">Contact Phone:</span> <span className="text-rmpg-200">{b.contact_phone || '—'}</span></div>
          <div className="col-span-2"><span className="text-rmpg-500">Contact Email:</span> <span className="text-rmpg-200">{b.contact_email || '—'}</span></div>
        </div>
      </CollapsibleSection>

      {b.notes && (
        <CollapsibleSection title="Notes" icon={Shield} defaultOpen={false}>
          <p className="text-xs text-rmpg-200 leading-relaxed whitespace-pre-wrap">{b.notes}</p>
        </CollapsibleSection>
      )}

      <LinkedRecordsSection key={`biz-links-${b.id}-${linkRefreshKey}`} entityType="business" entityId={b.id} onOpenLinkModal={() => openLinkModal('business' as any, b.id)} />

      <div className="panel-beveled p-3 bg-surface-base">
        <FileAttachments entityType="business" entityId={b.id} />
      </div>
    </div>
  );
}

// ── Business Form (inline, not a separate modal component) ──

function BusinessForm({ initial, onSubmit, onCancel, submitting }: {
  initial: Business | null;
  onSubmit: (data: Partial<Business>) => Promise<void>;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    dba_name: initial?.dba_name || '',
    business_type: initial?.business_type || '',
    ein: initial?.ein || '',
    license_number: initial?.license_number || '',
    address: initial?.address || '',
    city: initial?.city || '',
    state: initial?.state || '',
    zip: initial?.zip || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    website: initial?.website || '',
    owner_name: initial?.owner_name || '',
    owner_phone: initial?.owner_phone || '',
    contact_name: initial?.contact_name || '',
    contact_phone: initial?.contact_phone || '',
    contact_email: initial?.contact_email || '',
    industry: initial?.industry || '',
    employee_count: initial?.employee_count || '',
    annual_revenue: initial?.annual_revenue || '',
    notes: initial?.notes || '',
  });
  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">Business Name *</label><input className="input-dark text-xs w-full" value={form.name} onChange={e => set('name', e.target.value)} /></div>
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">DBA Name</label><input className="input-dark text-xs w-full" value={form.dba_name} onChange={e => set('dba_name', e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">Business Type</label><input className="input-dark text-xs w-full" value={form.business_type} onChange={e => set('business_type', e.target.value)} placeholder="LLC, Corp, Sole Prop..." /></div>
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">EIN</label><input className="input-dark text-xs w-full" value={form.ein} onChange={e => set('ein', e.target.value)} placeholder="XX-XXXXXXX" /></div>
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">License #</label><input className="input-dark text-xs w-full" value={form.license_number} onChange={e => set('license_number', e.target.value)} /></div>
      </div>
      <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">Address</label><input className="input-dark text-xs w-full" value={form.address} onChange={e => set('address', e.target.value)} /></div>
      <div className="grid grid-cols-3 gap-2">
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">City</label><input className="input-dark text-xs w-full" value={form.city} onChange={e => set('city', e.target.value)} /></div>
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">State</label><input className="input-dark text-xs w-full" value={form.state} onChange={e => set('state', e.target.value)} /></div>
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">ZIP</label><input className="input-dark text-xs w-full" value={form.zip} onChange={e => set('zip', e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">Phone</label><input type="tel" className="input-dark text-xs w-full" value={form.phone} onChange={e => set('phone', formatPhoneInput(e.target.value))} placeholder="(801) 555-1234" /></div>
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">Email</label><input className="input-dark text-xs w-full" value={form.email} onChange={e => set('email', e.target.value)} /></div>
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">Website</label><input className="input-dark text-xs w-full" value={form.website} onChange={e => set('website', e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">Owner Name</label><input className="input-dark text-xs w-full" value={form.owner_name} onChange={e => set('owner_name', e.target.value)} /></div>
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">Owner Phone</label><input type="tel" className="input-dark text-xs w-full" value={form.owner_phone} onChange={e => set('owner_phone', formatPhoneInput(e.target.value))} placeholder="(801) 555-1234" /></div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">Contact Name</label><input className="input-dark text-xs w-full" value={form.contact_name} onChange={e => set('contact_name', e.target.value)} /></div>
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">Contact Phone</label><input type="tel" className="input-dark text-xs w-full" value={form.contact_phone} onChange={e => set('contact_phone', formatPhoneInput(e.target.value))} placeholder="(801) 555-1234" /></div>
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">Contact Email</label><input className="input-dark text-xs w-full" value={form.contact_email} onChange={e => set('contact_email', e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">Industry</label><input className="input-dark text-xs w-full" value={form.industry} onChange={e => set('industry', e.target.value)} /></div>
        <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">Employees</label><input className="input-dark text-xs w-full" value={form.employee_count} onChange={e => set('employee_count', e.target.value)} /></div>
      </div>
      <div><label className="text-[10px] text-rmpg-400 uppercase block mb-1">Notes</label><RichTextArea className="input-dark text-xs w-full min-h-[48px]" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="toolbar-btn">Cancel</button>
        <button type="button" onClick={() => onSubmit(form)} disabled={!form.name || submitting} className="toolbar-btn toolbar-btn-primary">
          {submitting ? 'Saving...' : initial ? 'Update' : 'Create'}
        </button>
      </div>
    </div>
  );
}

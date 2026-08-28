import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import RichTextArea from '../../components/RichTextArea';
import { formatPhoneInput, toDisplayLabel } from '../../utils/formatters';
import {
  Search, MapPin, Phone, Mail, Globe, Trash2, Pencil, X, Users, Briefcase,
  ArrowUpDown, Filter, Shield, FileText, Eye, Navigation,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { buildAssessorFormPatch, type AssessorParcelDetail } from '../../utils/assessorFormPatch';
import { useFormDraft } from '../../hooks/useFormDraft';
import { withOneRetry } from '../../utils/retryTransient';
import { useAuth } from '../../context/AuthContext';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import { useMenuActions } from '../../utils/contextMenuActions';
import FileAttachments from '../../components/FileAttachments';
import LinkedRecordsSection from '../../components/LinkedRecordsSection';
import CollapsibleSection from '../../components/CollapsibleSection';
import RecordField from '../../components/records/RecordField';
import FieldGrid from '../../components/records/FieldGrid';
import RecordBadge from '../../components/records/RecordBadge';
import RecordHero from '../../components/records/RecordHero';
import RecordAvatar from '../../components/records/RecordAvatar';
import { businessIcon } from '../../components/records/recordIcons';
import PrintRecordButton from '../../components/PrintRecordButton';
import FormSection from '../../components/records/FormSection';
import FormField from '../../components/records/FormField';
import { useAssessorLookup } from '../../hooks/useAssessorLookup';
import { AssessorSuggestionPanel } from '../../components/AssessorSuggestionPanel';
import { JurisdictionButton } from '../../components/JurisdictionButton';
import { RecordPhotoGallery } from '../../components/RecordPhotoGallery';
import { ParcelDetailDrawer } from '../../components/ParcelDetailDrawer';
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
  fetchBusinesses: () => Promise<void>;
  setDeleteTarget: (t: { type: string; id: string; label: string } | null) => void;
  handleArchive: (type: string, id: string) => Promise<void>;
  handleUnarchive: (type: string, id: string) => Promise<void>;
  // Modal
  showFormModal: boolean;
  setShowFormModal: (v: boolean) => void;
  editingBusiness: Business | null;
  formSubmitting: boolean;
  handleSubmit: (data: Partial<Business>) => Promise<boolean>;
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
  /** Report a load failure with a retry fn → surfaces the banner's Retry button. */
  reportError: (message: string, retry?: () => void) => void;
  setDeleteTarget: (t: any) => void;
  linkRefreshKey: number;
  openLinkModal: (type: RecordEntityType, id: string) => void;
  handleArchiveRecord: (type: string, id: string) => Promise<void>;
  handleUnarchiveRecord: (type: string, id: string) => Promise<void>;
  fetchBusinesses?: () => void;
}): BusinessTabState {
  const { searchQuery, setSearchQuery, showArchived, setError, reportError, setDeleteTarget, linkRefreshKey, openLinkModal, handleArchiveRecord, handleUnarchiveRecord } = props;
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState<Business | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const fetchBusinesses = useCallback(async () => {
    try {
      setLoading(true);
      const data = await withOneRetry(() => apiFetch<any[]>(`/records/businesses?archived=${showArchived}`));
      setBusinesses((data || []).map(mapDbBusiness));
    } catch (err: any) {
      reportError(err.message || 'Failed to load businesses', () => { void fetchBusinesses(); });
    }
    setLoading(false);
  }, [showArchived, reportError]);

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

  // Returns true on a confirmed successful save, false on failure — callers
  // (BusinessForm's useFormDraft wiring) rely on this to know when it's safe
  // to clear the persisted draft, so a failed save never silently loses
  // typed data.
  const handleSubmit = useCallback(async (data: Partial<Business>): Promise<boolean> => {
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
      setFormSubmitting(false);
      return true;
    } catch (err: any) {
      setError(err.message || 'Failed to save business');
      setFormSubmitting(false);
      return false;
    }
  }, [editingBusiness, fetchBusinesses, setError]);

  const openEdit = useCallback((b: Business) => {
    setEditingBusiness(b);
    setShowFormModal(true);
  }, []);

  return {
    businesses, filteredBusinesses, selectedBusiness, setSelectedBusiness,
    searchQuery, setSearchQuery, showArchived, loading,
    fetchBusinesses,
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

  // ── Right-click context menu ──
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const buildBusinessMenu = (b: Business): ContextMenuItem[] => {
    const addr = [b.address, b.city, b.state, b.zip].filter(Boolean).join(', ');
    return [
      m.action('Open record', () => setSelectedBusiness(selectedBusiness?.id === b.id ? null : b), { icon: <Eye size={12} /> }),
      ...(isAdmin ? [m.action('Edit business', () => openEdit(b), { icon: <Pencil size={12} /> })] : []),
      m.separator(),
      m.copy('Copy name', b.name),
      m.copyId(b.id),
      ...(b.phone ? [m.copy('Copy phone', b.phone, <Phone size={12} />)] : []),
      ...(addr ? [m.openExternal('Navigate to address', `https://maps.google.com/?q=${encodeURIComponent(addr)}`, <Navigation size={12} />)] : []),
      ...(isAdmin
        ? [
            m.separator(),
            m.action('Delete', () => setDeleteTarget({ type: 'business', id: b.id, label: b.name }), { icon: <Trash2 size={12} />, danger: true }),
          ]
        : []),
    ];
  };

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
          <input id="ff-businesstab-0" type="text" className="input-dark pl-9 w-full text-[11px] min-h-[36px]" placeholder="Search businesses by name, DBA, address, EIN..."
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && <button aria-label="Close" type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-rmpg-100"><X className="w-3 h-3" /></button>}
        </div>
      </div>

      {/* Stats + Sort + Filter */}
      <div className="px-3 py-1.5 border-b border-rmpg-700/50 bg-surface-sunken flex items-center gap-4 text-[9px] flex-wrap">
        <span className="text-rmpg-400 flex items-center gap-1"><Briefcase className="w-3 h-3" /> <strong className="text-rmpg-100">{filteredBusinesses.length}</strong> Businesses</span>
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
            <p className="text-sm text-rmpg-400">
              {searchQuery
                ? 'No businesses match.'
                : showArchived
                  ? 'No archived business records.'
                  : 'No business records found.'}
            </p>
            <p className="text-[10px] text-rmpg-600 mt-1">
              {searchQuery
                ? 'Try broadening your search.'
                : showArchived
                  ? 'Records you archive will appear here.'
                  : 'Click "New Business" to add a record.'}
            </p>
          </div>
        )}
        {displayBusinesses.map((b, idx) => (
          <div key={b.id} role="listitem" tabIndex={0}
            onClick={() => setSelectedBusiness(selectedBusiness?.id === b.id ? null : b)}
            onKeyDown={e => { if (e.key === 'Enter') setSelectedBusiness(selectedBusiness?.id === b.id ? null : b); }}
            onContextMenu={(e) => openMenu(e, buildBusinessMenu(b))}
            className={`px-4 py-3 border-b border-rmpg-700/50 cursor-pointer transition-all duration-150 ${selectedBusiness?.id === b.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : `hover:bg-rmpg-700/30 border-l-2 border-l-transparent ${idx % 2 === 1 ? 'bg-rmpg-800/20' : ''}`}`}>
            <div className="flex items-center gap-3">
              {/* Functionality glyph (industry → store/factory/scale/…) on the
                  standard blue tile, matching persons / vehicles / properties. */}
              <RecordAvatar
                name={b.name || 'business'}
                icon={businessIcon(b)}
                size={36}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-rmpg-100 truncate">{b.name}</span>
                  {b.dba_name && <span className="text-[10px] text-amber-400 italic">DBA: {b.dba_name}</span>}
                  {b.status === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Active" />}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[10px] text-rmpg-400">
                  {b.business_type && <span>{toDisplayLabel(b.business_type)}</span>}
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
                {b.email && <a href={`mailto:${b.email}`} onClick={e => e.stopPropagation()} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-rmpg-400"><Mail className="w-3 h-3" /></a>}
                {b.website && <a href={b.website.startsWith('http') ? b.website : `https://${b.website}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-brand-400"><Globe className="w-3 h-3" /></a>}
                {isAdmin && <button aria-label="Edit" type="button" onClick={e => { e.stopPropagation(); openEdit(b); }} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-brand-400"><Pencil className="w-3 h-3" /></button>}
                {isAdmin && <button aria-label="Delete" type="button" onClick={e => { e.stopPropagation(); setDeleteTarget({ type: 'business', id: b.id, label: b.name }); }} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Form Modal — simplified inline */}
      {showFormModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="panel-surface w-full max-w-[95vw] md:max-w-lg mx-4 max-h-[90vh] overflow-y-auto p-4 space-y-3">
            <h3 className="text-sm font-bold text-rmpg-100">{editingBusiness ? 'Edit Business' : 'New Business'}</h3>
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
    <div className="h-full flex flex-col overflow-hidden">
      {/* Hero identity band */}
      <div className="border-b border-rmpg-600 bg-surface-sunken flex-shrink-0">
        <RecordHero
          name={b.name || 'BUSINESS'}
          icon={businessIcon(b)}
          subtitle={
            <span className="flex flex-col gap-0.5">
              {b.dba_name && <span className="text-amber-400">DBA: {b.dba_name}</span>}
              <span>{toDisplayLabel(b.business_type)} · {b.industry || 'N/A'}</span>
            </span>
          }
          flags={b.flags}
          tone="gold"
        >
          {b.status && (
            <RecordBadge tone={b.status === 'active' ? 'green' : 'gray'} glow={false}>
              {b.status.toUpperCase()}
            </RecordBadge>
          )}
          {/* Business PDF — rendered by the property generator (businesses are
              property-shaped). Includes a satellite site map of the address.
              No `id` on the data → the property cross-ref enrichment (which keys
              off a property id) is skipped so it can't pull the wrong links. */}
          <PrintRecordButton
            recordType="property"
            recordData={{
              name: b.name,
              property_type: 'commercial',
              business_type: b.business_type,
              structure_type: b.industry,
              address: b.address,
              city: b.city,
              state: b.state,
              zip: b.zip,
              owner_name: b.owner_name,
              key_holder_name: b.contact_name,
              key_holder_phone: b.contact_phone || b.phone,
              contact_email: b.contact_email || b.email,
              notes: b.notes,
              flags: b.flags,
              created_at: b.created_at,
              updated_at: b.updated_at,
            }}
            identifier={b.name}
            entityType="business"
            entityId={b.id}
            iconOnly
            title="Print business record"
          />
        </RecordHero>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3">
      <CollapsibleSection title="Business Information" icon={Briefcase} defaultOpen>
        <FieldGrid cols={2}>
          <RecordField label="EIN" value={b.ein} mono copyable showEmpty />
          <RecordField label="License #" value={b.license_number} mono copyable showEmpty />
          <RecordField label="Type" value={b.business_type} showEmpty />
          <RecordField label="Industry" value={b.industry} showEmpty />
          <RecordField label="Employees" value={b.employee_count} showEmpty />
          <RecordField label="Revenue" value={b.annual_revenue} showEmpty />
          <RecordField label="Status" value={(b.status || 'N/A').toUpperCase()} valueColor={b.status === 'active' ? 'var(--sev-ok-soft)' : undefined} />
        </FieldGrid>
      </CollapsibleSection>

      <CollapsibleSection title="Contact & Address" icon={Phone} defaultOpen>
        <FieldGrid cols={2}>
          <RecordField label="Phone" value={b.phone} copyable showEmpty />
          <RecordField label="Email" value={b.email} copyable showEmpty />
          <RecordField label="Website" value={b.website} copyable showEmpty />
          <RecordField label="Address" value={[b.address, b.city, b.state, b.zip].filter(Boolean).join(', ')} copyable showEmpty className="col-span-2" />
        </FieldGrid>
      </CollapsibleSection>

      <CollapsibleSection title="Owner & Key Contact" icon={Users}>
        <FieldGrid cols={2}>
          <RecordField label="Owner" value={b.owner_name} showEmpty />
          <RecordField label="Owner Phone" value={b.owner_phone} copyable showEmpty />
          <RecordField label="Contact" value={b.contact_name} showEmpty />
          <RecordField label="Contact Phone" value={b.contact_phone} copyable showEmpty />
          <RecordField label="Contact Email" value={b.contact_email} copyable showEmpty className="col-span-2" />
        </FieldGrid>
      </CollapsibleSection>

      {b.notes && (
        <CollapsibleSection title="Notes" icon={Shield} defaultOpen={false}>
          <p className="text-xs text-rmpg-200 leading-relaxed whitespace-pre-wrap break-words">{b.notes}</p>
        </CollapsibleSection>
      )}

      <LinkedRecordsSection key={`biz-links-${b.id}-${linkRefreshKey}`} entityType="business" entityId={b.id} onOpenLinkModal={() => openLinkModal('business', b.id)} />

      <div className="panel-beveled p-3 bg-surface-base">
        <FileAttachments entityType="business" entityId={b.id} />
      </div>
      </div>
    </div>
  );
}

// ── Business Form (inline, not a separate modal component) ──

function BusinessForm({ initial, onSubmit, onCancel, submitting }: {
  initial: Business | null;
  onSubmit: (data: Partial<Business>) => Promise<boolean>;
  onCancel: () => void;
  submitting: boolean;
}) {
  const defaultForm = {
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
    // Server-only field (not on the Business type), applied via the
    // never-clobber assessor patch — seeded here so ParcelDetailDrawer
    // shows for an already-applied record on open, and stays current
    // immediately after a fresh Apply without reopening the form.
    parcel_number: (initial as any)?.parcel_number || '',
  };
  // Cross-device draft persistence — keyed per-record (edit) or a shared
  // "new" key (create), matching the pattern used by the other records
  // form modals (PersonFormModal, VehicleFormModal, etc).
  const { form, setForm, clearDraft } = useFormDraft({
    storageKey: `rmpg_business_form_${initial?.id ?? 'new'}`,
    defaultValue: defaultForm,
  });
  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    const ok = await onSubmit(form);
    // Only clear the draft after the save is confirmed successful — a
    // failed save (network/validation error) must not silently lose the
    // user's typed data.
    if (ok) clearDraft();
  };

  // ── Salt Lake County Assessor on-blur lookup ──
  // Panel renders below the address input. Apply is gated on `initial?.id`
  // because the server PATCH writes to an existing row — we need the id.
  const assessor = useAssessorLookup();
  const recordId = initial?.id;
  const recordSaved = !!recordId;
  const [skippedCount, setSkippedCount] = useState(0);
  const skippedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (skippedTimerRef.current) clearTimeout(skippedTimerRef.current); }, []);

  const onApplyAssessor = useCallback(async (parcelNumber: string) => {
    // UNSAVED record: no row exists for /assessor/apply to write to, so fill
    // the FORM instead. The old comment here claimed "Apply button is
    // disabled in this branch" — it never was (the panel only disables on
    // !picked), so clicking Apply on a new business silently did nothing.
    if (!recordId) {
      try {
        const res = await apiFetch<{ ok: boolean; parcel: AssessorParcelDetail | null }>(
          `/assessor/parcel/${encodeURIComponent(parcelNumber)}`,
        );
        if (!res?.parcel) return;
        setForm((prev) => {
          const { patch, skipped } = buildAssessorFormPatch(
            res.parcel!, prev as unknown as Record<string, unknown>,
          );
          setSkippedCount(skipped.length);
          if (skippedTimerRef.current) clearTimeout(skippedTimerRef.current);
          if (skipped.length > 0) {
            skippedTimerRef.current = setTimeout(() => setSkippedCount(0), 5000);
          }
          return { ...prev, ...(patch as Partial<typeof prev>) };
        });
        assessor.dismiss();
      } catch (err) {
        console.error('Assessor apply (unsaved record) failed', err);
      }
      return;
    }
    try {
      const res = await apiFetch<{ ok: boolean; patch: Record<string, unknown>; skipped: string[]; parcel_record_id: number | null }>(
        '/assessor/apply',
        {
          method: 'POST',
          body: JSON.stringify({ record_type: 'business', record_id: recordId, parcel_number: parcelNumber }),
        },
      );
      // Merge the server's never-clobber patch into the local form state. The
      // patch only contains values for fields the server actually changed, so
      // unrelated keys stay intact. Spread covers any new assessor_* columns
      // the form doesn't currently render — they're still sent on next save.
      setForm(prev => ({ ...prev, ...(res.patch as Record<string, string>) }));
      const skipped = Array.isArray(res.skipped) ? res.skipped.length : 0;
      setSkippedCount(skipped);
      if (skippedTimerRef.current) clearTimeout(skippedTimerRef.current);
      if (skipped > 0) {
        skippedTimerRef.current = setTimeout(() => setSkippedCount(0), 5000);
      }
      assessor.dismiss();
    } catch (err) {
      console.error('Assessor apply failed', err);
    }
  }, [recordId, assessor, setForm]);

  // County resolution (resolveCountyFromAddress) needs a city/ZIP to route
  // correctly — a bare street ("10846 South Indigo Sky Way") always resolves
  // to 'unsupported'. Build the full address for lookups/jurisdiction; the
  // county-side parsers strip city/state/zip back off before searching.
  const fullAddress = (address: string) =>
    [address, form.city, [form.state, form.zip].filter(Boolean).join(' ')]
      .filter(Boolean).join(', ');

  return (
    <div className="space-y-2.5">
      <FormSection title="Business Information" icon={Briefcase}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <FormField label="Business Name" required><input id="ff-businesstab-1" className="input-dark text-xs w-full" value={form.name} onChange={e => set('name', e.target.value)} /></FormField>
          <FormField label="DBA Name"><input id="ff-businesstab-2" className="input-dark text-xs w-full" value={form.dba_name} onChange={e => set('dba_name', e.target.value)} /></FormField>
          <FormField label="Business Type"><input id="ff-businesstab-3" className="input-dark text-xs w-full" value={form.business_type} onChange={e => set('business_type', e.target.value)} placeholder="LLC, Corp, Sole Prop..." /></FormField>
          <FormField label="EIN"><input id="ff-businesstab-4" className="input-dark text-xs w-full" value={form.ein} onChange={e => set('ein', e.target.value)} placeholder="XX-XXXXXXX" /></FormField>
          <FormField label="License #" className="col-span-2"><input id="ff-businesstab-5" className="input-dark text-xs w-full" value={form.license_number} onChange={e => set('license_number', e.target.value)} /></FormField>
        </div>
      </FormSection>

      <FormSection title="Contact & Address" icon={Phone}>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-2.5">
          <FormField label="Address" className="col-span-6">
            <input
              id="ff-businesstab-6"
              className="input-dark text-xs w-full"
              value={form.address}
              onChange={e => set('address', e.target.value)}
              onBlur={e => assessor.lookup(fullAddress(e.target.value))}
            />
            {form.address.trim() && (
              <div className="mt-1">
                <JurisdictionButton address={fullAddress(form.address)} recordType="business" recordId={recordId} />
              </div>
            )}
            <AssessorSuggestionPanel
              parcels={assessor.parcels}
              cached={assessor.cached}
              loading={assessor.loading}
              error={assessor.error}
              code={assessor.code}
              source={assessor.source}
              degraded={assessor.degraded}
              manualUrl={assessor.manualUrl}
              onApply={onApplyAssessor}
              onDismiss={assessor.dismiss}
              onRetry={assessor.retry}
              onRefresh={assessor.refresh}
            />
            {!recordSaved && assessor.parcels && assessor.parcels.length > 0 && (
              <div className="text-xs text-rmpg-400 mt-1">
                Applying fills these fields now; they save with the record.
              </div>
            )}
            {skippedCount > 0 && (
              <div className="text-xs text-rmpg-400 mt-1">{skippedCount} field(s) skipped (already filled)</div>
            )}
          </FormField>
          <FormField label="City" className="col-span-3"><input id="ff-businesstab-7" className="input-dark text-xs w-full" value={form.city} onChange={e => set('city', e.target.value)} /></FormField>
          <FormField label="State" className="col-span-1"><input id="ff-businesstab-8" className="input-dark text-xs w-full" value={form.state} onChange={e => set('state', e.target.value)} /></FormField>
          <FormField label="ZIP" className="col-span-2"><input id="ff-businesstab-9" className="input-dark text-xs w-full" value={form.zip} onChange={e => set('zip', e.target.value)} /></FormField>
          <FormField label="Phone" className="col-span-2"><input id="ff-businesstab-10" type="tel" className="input-dark text-xs w-full" value={form.phone} onChange={e => set('phone', formatPhoneInput(e.target.value))} placeholder="(801) 555-1234" /></FormField>
          <FormField label="Email" className="col-span-2"><input id="ff-businesstab-11" className="input-dark text-xs w-full" value={form.email} onChange={e => set('email', e.target.value)} /></FormField>
          <FormField label="Website" className="col-span-2"><input id="ff-businesstab-12" className="input-dark text-xs w-full" value={form.website} onChange={e => set('website', e.target.value)} /></FormField>
        </div>
      </FormSection>

      <FormSection title="Owner & Key Contact" icon={Users}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <FormField label="Owner Name"><input id="ff-businesstab-13" className="input-dark text-xs w-full" value={form.owner_name} onChange={e => set('owner_name', e.target.value)} /></FormField>
          <FormField label="Owner Phone"><input id="ff-businesstab-14" type="tel" className="input-dark text-xs w-full" value={form.owner_phone} onChange={e => set('owner_phone', formatPhoneInput(e.target.value))} placeholder="(801) 555-1234" /></FormField>
          <FormField label="Contact Name"><input id="ff-businesstab-15" className="input-dark text-xs w-full" value={form.contact_name} onChange={e => set('contact_name', e.target.value)} /></FormField>
          <FormField label="Contact Phone"><input id="ff-businesstab-16" type="tel" className="input-dark text-xs w-full" value={form.contact_phone} onChange={e => set('contact_phone', formatPhoneInput(e.target.value))} placeholder="(801) 555-1234" /></FormField>
          <FormField label="Contact Email" className="col-span-2"><input id="ff-businesstab-17" className="input-dark text-xs w-full" value={form.contact_email} onChange={e => set('contact_email', e.target.value)} /></FormField>
        </div>
      </FormSection>

      <FormSection title="Operations" icon={Briefcase}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <FormField label="Industry"><input id="ff-businesstab-18" className="input-dark text-xs w-full" value={form.industry} onChange={e => set('industry', e.target.value)} /></FormField>
          <FormField label="Employees"><input id="ff-businesstab-19" className="input-dark text-xs w-full" value={form.employee_count} onChange={e => set('employee_count', e.target.value)} /></FormField>
          <FormField label="Annual Revenue"><input id="ff-businesstab-20" className="input-dark text-xs w-full" value={form.annual_revenue} onChange={e => set('annual_revenue', e.target.value)} placeholder="$" /></FormField>
        </div>
      </FormSection>

      <FormSection title="Notes" icon={FileText}>
        <RichTextArea className="input-dark text-xs w-full min-h-[48px]" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </FormSection>

      {recordSaved && (
        <FormSection title="Photos & Assessor Detail" icon={FileText}>
          <RecordPhotoGallery recordType="business" recordId={recordId} />
          {form.parcel_number && (
            <div className="mt-2">
              {/* form (not initial) so the drawer picks up a parcel_number
                  applied via onApplyAssessor immediately, without reopening the modal. */}
              <ParcelDetailDrawer parcelNumber={form.parcel_number} />
            </div>
          )}
        </FormSection>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="toolbar-btn">Cancel</button>
        <button type="button" onClick={handleSave} disabled={!form.name || submitting} className="toolbar-btn toolbar-btn-primary">
          {submitting ? 'Saving...' : initial ? 'Update' : 'Create'}
        </button>
      </div>
    </div>
  );
}

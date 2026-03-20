import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Search, ShieldBan, MapPin, User, Clock, Ban,
  Archive, RotateCcw, X, Save, Loader2, CheckCircle, AlertTriangle,
} from 'lucide-react';
import type { TrespassOrder, TrespassOrderType, TrespassOrderStatus } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import EmptyState from '../components/EmptyState';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import ExportButton from '../components/ExportButton';
import { useToast } from '../components/ToastProvider';
import { useFormValidation } from '../hooks/useFormValidation';
import { useDistrictOptions } from '../hooks/useDistrictLookup';

const ORDER_TYPES: { value: TrespassOrderType; label: string }[] = [
  { value: 'trespass_warning', label: 'Trespass Warning' },
  { value: 'exclusion_order', label: 'Exclusion Order' },
  { value: 'ban', label: 'Ban' },
  { value: 'no_contact', label: 'No Contact Order' },
];

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-red-900/50 text-red-400 border-red-700/50',
  served: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  expired: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50',
  lifted: 'bg-green-900/50 text-green-400 border-green-700/50',
  violated: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
};

const TYPE_COLORS: Record<string, string> = {
  trespass_warning: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  exclusion_order: 'bg-red-900/50 text-red-400 border-red-700/50',
  ban: 'bg-red-900/70 text-red-300 border-red-600/50',
  no_contact: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
};

const EMPTY_FORM = {
  subject_first_name: '', subject_last_name: '', subject_dob: '', subject_description: '',
  property_name: '', location: '',
  order_type: 'trespass_warning' as TrespassOrderType,
  reason: '', conditions: '', duration_days: '', notes: '',
  authorized_by: '', person_id: '', property_id: '',
  section_id: '', zone_id: '', beat_id: '',
};

export default function TrespassOrdersPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { sections: sectionOptions, sectionLabels, zoneLabels, zonesForSection, beatsForZone, getBeatLabel } = useDistrictOptions();
  const { errors: formErrors, validate: validateForm, clearAllErrors } = useFormValidation();

  const [orders, setOrders] = useState<TrespassOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<TrespassOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<TrespassOrder | null>(null);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);

  // Person search
  const [personSearch, setPersonSearch] = useState('');
  const [personResults, setPersonResults] = useState<any[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<any>(null);
  const personSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const personSearchGenRef = useRef(0);

  // Properties
  const [properties, setProperties] = useState<any[]>([]);

  // ── Fetch ──
  const fetchOrders = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(null); }
    try {
      const params = new URLSearchParams({
        page: String(page), per_page: '50',
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
        archived: showArchived ? 'true' : 'false',
      });
      const res = await apiFetch<{ data: TrespassOrder[]; pagination: any }>(`/trespass-orders?${params}`);
      const newOrders = res.data || [];
      setOrders(newOrders);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotalCount(res.pagination?.total || 0);
      // Keep selected item in sync with refreshed data
      setSelectedOrder(prev => prev ? newOrders.find((o: TrespassOrder) => o.id === prev.id) || null : null);
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  }, [page, searchQuery, filterStatus, showArchived]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useLiveSync('alerts', () => fetchOrders({ silent: true }));

  // Fetch properties for dropdown
  useEffect(() => {
    let cancelled = false;
    apiFetch<any[]>('/records/properties').then(r => { if (!cancelled) setProperties(Array.isArray(r) ? r : []); }).catch((err) => { console.warn('[TrespassOrdersPage] fetch properties failed:', err); });
    return () => { cancelled = true; };
  }, []);

  // Person search debounce
  useEffect(() => {
    if (personSearch.length < 2) { setPersonResults([]); return; }
    if (personSearchTimer.current) clearTimeout(personSearchTimer.current);
    personSearchTimer.current = setTimeout(async () => {
      const gen = ++personSearchGenRef.current;
      try {
        const res = await apiFetch<{ data: any[] }>(`/records/persons?search=${encodeURIComponent(personSearch)}&per_page=8`);
        if (gen !== personSearchGenRef.current) return;
        setPersonResults(res.data || []);
      } catch { if (gen === personSearchGenRef.current) setPersonResults([]); }
    }, 300);
    return () => { if (personSearchTimer.current) clearTimeout(personSearchTimer.current); };
  }, [personSearch]);

  const handleOpenNew = () => {
    setEditingOrder(null);
    setFormData({ ...EMPTY_FORM });
    setSelectedPerson(null);
    setPersonSearch('');
    clearAllErrors();
    setFormOpen(true);
  };

  const handleEdit = (order: TrespassOrder) => {
    setEditingOrder(order);
    clearAllErrors();
    setFormData({
      subject_first_name: order.subject_first_name,
      subject_last_name: order.subject_last_name,
      subject_dob: order.subject_dob || '',
      subject_description: order.subject_description || '',
      property_name: order.property_name || '',
      location: order.location,
      order_type: order.order_type,
      reason: order.reason || '',
      conditions: order.conditions || '',
      duration_days: order.duration_days ? String(order.duration_days) : '',
      notes: order.notes || '',
      authorized_by: order.authorized_by || '',
      person_id: order.person_id ? String(order.person_id) : '',
      property_id: order.property_id ? String(order.property_id) : '',
      section_id: order.section_id || '',
      zone_id: order.zone_id || '',
      beat_id: order.beat_id || '',
    });
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isValid = validateForm(formData, {
      subject_first_name: { required: true },
      subject_last_name: { required: true },
      location: { required: true },
    });
    if (!isValid) return;
    setSubmitting(true);
    try {
      const body = {
        ...formData,
        person_id: formData.person_id ? parseInt(formData.person_id, 10) : null,
        property_id: formData.property_id ? parseInt(formData.property_id, 10) : null,
        duration_days: formData.duration_days ? parseInt(formData.duration_days, 10) : null,
        section_id: formData.section_id || null,
        zone_id: formData.zone_id || null,
        beat_id: formData.beat_id || null,
        zone_beat: (formData.zone_id && formData.beat_id) ? `${formData.zone_id}-${formData.beat_id}` : formData.zone_id || formData.beat_id || null,
      };
      if (editingOrder) {
        await apiFetch(`/trespass-orders/${editingOrder.id}`, { method: 'PUT', body: JSON.stringify(body) });
        addToast('Trespass order updated', 'success');
      } else {
        await apiFetch('/trespass-orders', { method: 'POST', body: JSON.stringify(body) });
        addToast('Trespass order created', 'success');
      }
      setFormOpen(false); setEditingOrder(null); await fetchOrders();
    } catch (err: any) { setError(err.message); } finally { setSubmitting(false); }
  };

  const handleServe = async (order: TrespassOrder) => {
    try {
      await apiFetch(`/trespass-orders/${order.id}/serve`, { method: 'PUT' });
      addToast('Order marked as served', 'success');
      await fetchOrders();
      if (selectedOrder?.id === order.id) {
        const updated = await apiFetch<TrespassOrder>(`/trespass-orders/${order.id}`);
        setSelectedOrder(updated);
      }
    } catch (err: any) { setError(err.message); }
  };

  const handleLift = async (order: TrespassOrder) => {
    try {
      await apiFetch(`/trespass-orders/${order.id}/lift`, { method: 'PUT' });
      addToast('Order lifted', 'success');
      await fetchOrders();
      if (selectedOrder?.id === order.id) {
        const updated = await apiFetch<TrespassOrder>(`/trespass-orders/${order.id}`);
        setSelectedOrder(updated);
      }
    } catch (err: any) { setError(err.message); }
  };

  const handleViolate = async (order: TrespassOrder) => {
    try {
      await apiFetch(`/trespass-orders/${order.id}/violate`, { method: 'PUT' });
      addToast('Violation recorded', 'success');
      await fetchOrders();
      if (selectedOrder?.id === order.id) {
        const updated = await apiFetch<TrespassOrder>(`/trespass-orders/${order.id}`);
        setSelectedOrder(updated);
      }
    } catch (err: any) { setError(err.message); }
  };

  const update = (field: string, value: any) => setFormData(prev => ({ ...prev, [field]: value }));

  const selectPerson = (p: any) => {
    setSelectedPerson(p);
    setPersonSearch('');
    setPersonResults([]);
    setFormData(prev => ({
      ...prev,
      person_id: String(p.id),
      subject_first_name: p.first_name || '',
      subject_last_name: p.last_name || '',
      subject_dob: p.date_of_birth || p.dob || '',
    }));
  };

  const selectProperty = (propId: string) => {
    const prop = properties.find(p => String(p.id) === propId);
    setFormData(prev => ({
      ...prev,
      property_id: propId,
      property_name: prop?.name || '',
      location: prop?.address ? `${prop.address}${prop.city ? ', ' + prop.city : ''}` : prev.location,
    }));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <PanelTitleBar icon={ShieldBan} title="TRESPASS ORDERS">
        <span className="text-[9px] font-mono text-rmpg-400">{totalCount} TOTAL</span>
        <span className="toolbar-separator" />
        <ExportButton exportUrl="/trespass-orders?per_page=9999" exportFilename="trespass_orders_export.csv" />
        <button onClick={handleOpenNew} className="toolbar-btn">
          <Plus style={{ width: 11, height: 11 }} /> New Order
        </button>
      </PanelTitleBar>

      {/* Toolbar */}
      <div className={`flex ${isMobile ? 'flex-col gap-1.5' : 'items-center gap-2'} px-3 py-1.5 border-b border-rmpg-700`} style={{ background: '#141e2b' }}>
        <div className={`relative ${isMobile ? 'w-full' : 'flex-1 max-w-xs'}`}>
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
          <input type="text" placeholder="Search orders..." className={`input-dark pl-7 w-full ${isMobile ? 'text-sm py-2.5' : 'text-xs'}`}
            value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
            style={isMobile ? { minHeight: 44 } : undefined} />
        </div>
        <div className={`flex items-center ${isMobile ? 'gap-2' : 'gap-2'}`}>
          <select className={`select-dark ${isMobile ? 'flex-1 text-sm py-2' : 'text-xs'}`} value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} style={isMobile ? { minHeight: 44 } : undefined}>
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="served">Served</option>
            <option value="expired">Expired</option>
            <option value="lifted">Lifted</option>
            <option value="violated">Violated</option>
          </select>
          <label className={`flex items-center gap-1 ${isMobile ? 'text-xs' : 'text-[10px]'} text-rmpg-400 cursor-pointer`} style={isMobile ? { minHeight: 44 } : undefined}>
            <input type="checkbox" checked={showArchived} onChange={e => { setShowArchived(e.target.checked); setPage(1); }} className="accent-brand-500" style={isMobile ? { width: 20, height: 20 } : undefined} /> Archived
          </label>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* List */}
        <div className={`${selectedOrder && !isMobile ? 'w-[40%]' : 'w-full'} overflow-y-auto border-r border-rmpg-700`}>
          {loading && orders.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-rmpg-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...</div>
          ) : orders.length === 0 ? (
            <EmptyState
              icon={Ban}
              title="No trespass orders found"
              description="Create a new trespass order to get started."
              action={{ label: 'New Order', onClick: handleOpenNew }}
            />
          ) : (
            orders.map(order => (
              <div key={order.id} onClick={() => setSelectedOrder(order)}
                className={`px-3 ${isMobile ? 'py-3' : 'py-2'} cursor-pointer border-b border-rmpg-800 transition-colors hover:bg-surface-raised ${selectedOrder?.id === order.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'border-l-2 border-l-transparent'}`}
                style={isMobile ? { minHeight: 56 } : undefined}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[11px] font-bold font-mono text-brand-400">{order.order_number}</span>
                  <div className="flex items-center gap-1">
                    <span className={`text-[8px] font-bold px-1.5 py-0 border ${TYPE_COLORS[order.order_type] || TYPE_COLORS.trespass_warning}`}>
                      {(order.order_type || '').replace(/_/g, ' ').toUpperCase()}
                    </span>
                    <span className={`text-[8px] font-bold px-1.5 py-0 border ${STATUS_COLORS[order.status]}`}>
                      {(order.status || '').toUpperCase()}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-white font-medium">
                  <Ban className="w-3 h-3 inline mr-1 text-red-400" />
                  {order.subject_last_name}, {order.subject_first_name}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-rmpg-400 mt-0.5">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{order.property_name || order.location}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-rmpg-500 mt-0.5">
                  <span>{order.issued_by_name || order.issued_by_display}</span>
                  <span>•</span>
                  <span>{new Date(order.created_at).toLocaleDateString()}</span>
                  {(order.section_id || order.zone_id || order.beat_id) && (
                    <span className="font-mono text-rmpg-500">{[order.section_id, order.zone_id, order.beat_id].filter(Boolean).join('/')}</span>
                  )}
                  {order.expiration_date && <span className="text-amber-500/70">Exp: {new Date(order.expiration_date).toLocaleDateString()}</span>}
                </div>
              </div>
            ))
          )}
          {totalPages > 1 && (
            <div className={`flex items-center justify-center gap-2 py-2 ${isMobile ? 'text-xs' : 'text-[10px]'} text-rmpg-400`}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined, minWidth: isMobile ? 48 : undefined }}>Prev</button>
              <span>Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined, minWidth: isMobile ? 48 : undefined }}>Next</button>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedOrder && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-bold text-white font-mono">{selectedOrder.order_number}</h2>
                <span className="text-[10px] text-rmpg-400">Issued {new Date(selectedOrder.created_at).toLocaleString()}</span>
              </div>
              <div className={`flex items-center ${isMobile ? 'gap-2 flex-wrap' : 'gap-1'}`}>
                <button onClick={() => handleEdit(selectedOrder)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }}>Edit</button>
                {selectedOrder.status === 'active' && (
                  <>
                    <button onClick={() => handleServe(selectedOrder)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', color: '#f59e0b', minHeight: isMobile ? 48 : undefined }}>
                      <CheckCircle style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Serve
                    </button>
                    <button onClick={() => handleLift(selectedOrder)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', color: '#22c55e', minHeight: isMobile ? 48 : undefined }}>Lift</button>
                    <button onClick={() => handleViolate(selectedOrder)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', color: '#a855f7', minHeight: isMobile ? 48 : undefined }}>
                      <AlertTriangle style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Violated
                    </button>
                  </>
                )}
                <button onClick={() => setSelectedOrder(null)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }}>
                  <X style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} />
                </button>
              </div>
            </div>

            {/* Status banner */}
            {selectedOrder.status === 'active' && (
              <div className="mb-3 px-3 py-2 border border-red-700/50 bg-red-900/20 text-xs text-red-300 flex items-center gap-2">
                <Ban className="w-4 h-4 text-red-400" />
                <span className="font-bold uppercase">Active Trespass Order</span>
                {selectedOrder.expiration_date && (
                  <span className="ml-auto text-red-400/70">Expires: {new Date(selectedOrder.expiration_date).toLocaleDateString()}</span>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <div><span className="text-rmpg-500 text-[10px] uppercase">Subject</span><div className="text-white font-medium">{selectedOrder.subject_last_name}, {selectedOrder.subject_first_name}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">DOB</span><div className="text-white">{selectedOrder.subject_dob ? new Date(selectedOrder.subject_dob).toLocaleDateString() : '—'}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Property</span><div className="text-white">{selectedOrder.property_name || '—'}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Location</span><div className="text-white">{selectedOrder.location}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Order Type</span><div className="text-white capitalize">{selectedOrder.order_type.replace(/_/g, ' ')}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Status</span><div className="text-white capitalize">{selectedOrder.status}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Effective</span><div className="text-white">{selectedOrder.effective_date ? new Date(selectedOrder.effective_date).toLocaleDateString() : '—'}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Expires</span><div className="text-white">{selectedOrder.expiration_date ? new Date(selectedOrder.expiration_date).toLocaleDateString() : 'Permanent'}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Issued By</span><div className="text-white">{selectedOrder.issued_by_name || selectedOrder.issued_by_display || '—'}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Authorized By</span><div className="text-white">{selectedOrder.authorized_by || '—'}</div></div>
              {(selectedOrder.section_id || selectedOrder.zone_id || selectedOrder.beat_id) && (
                <div><span className="text-rmpg-500 text-[10px] uppercase">S/Z/B</span><div className="text-white font-mono">{[selectedOrder.section_id, selectedOrder.zone_id, selectedOrder.beat_id].filter(Boolean).join(' / ') || '—'}</div></div>
              )}
              {selectedOrder.served_at && (
                <>
                  <div><span className="text-rmpg-500 text-[10px] uppercase">Served At</span><div className="text-white">{new Date(selectedOrder.served_at).toLocaleString()}</div></div>
                  <div><span className="text-rmpg-500 text-[10px] uppercase">Served By</span><div className="text-white">{selectedOrder.served_by_name || '—'}</div></div>
                </>
              )}
            </div>

            {selectedOrder.reason && (
              <div className="mt-3 pt-2 border-t border-rmpg-700">
                <span className="text-rmpg-500 text-[10px] uppercase">Reason</span>
                <p className="text-xs text-rmpg-200 mt-1">{selectedOrder.reason}</p>
              </div>
            )}
            {selectedOrder.conditions && (
              <div className="mt-2">
                <span className="text-rmpg-500 text-[10px] uppercase">Conditions</span>
                <p className="text-xs text-rmpg-200 mt-1">{selectedOrder.conditions}</p>
              </div>
            )}
            {selectedOrder.notes && (
              <div className="mt-2">
                <span className="text-rmpg-500 text-[10px] uppercase">Notes</span>
                <p className="text-xs text-rmpg-200 mt-1 whitespace-pre-wrap">{selectedOrder.notes}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Form Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={() => setFormOpen(false)}>
          <div className="bg-surface-raised border border-rmpg-600 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700" style={{ background: '#141e2b' }}>
              <span className="text-xs font-bold text-white uppercase">{editingOrder ? 'Edit' : 'New'} Trespass Order</span>
              <button onClick={() => setFormOpen(false)} className="text-rmpg-400 hover:text-white"><X style={{ width: 14, height: 14 }} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              {/* Person search */}
              <div>
                <label className="field-label">Link to Person Record (Optional)</label>
                <div className="relative">
                  <input type="text" className="input-dark text-xs w-full" placeholder="Search person records..."
                    value={personSearch} onChange={e => setPersonSearch(e.target.value)} />
                  {personResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-surface-raised border border-rmpg-600 max-h-40 overflow-y-auto">
                      {personResults.map((p: any) => (
                        <button key={p.id} type="button" onClick={() => selectPerson(p)}
                          className="w-full text-left px-3 py-1.5 text-xs text-white hover:bg-rmpg-700 flex items-center gap-2">
                          <User className="w-3 h-3 text-rmpg-400" />
                          {p.last_name}, {p.first_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedPerson && <div className="mt-1 text-[10px] text-brand-400">Linked: {selectedPerson.last_name}, {selectedPerson.first_name}</div>}
              </div>

              {/* Subject */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><label className="field-label">First Name *</label>
                  <input className="input-dark text-xs w-full" value={formData.subject_first_name} onChange={e => update('subject_first_name', e.target.value)} />
                  {formErrors.subject_first_name && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.subject_first_name}</p>}</div>
                <div><label className="field-label">Last Name *</label>
                  <input className="input-dark text-xs w-full" value={formData.subject_last_name} onChange={e => update('subject_last_name', e.target.value)} />
                  {formErrors.subject_last_name && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.subject_last_name}</p>}</div>
                <div><label className="field-label">DOB</label>
                  <input type="date" className="input-dark text-xs w-full" value={formData.subject_dob} onChange={e => update('subject_dob', e.target.value)} /></div>
              </div>

              {/* Property + Location */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><label className="field-label">Property</label>
                  <select className="select-dark text-xs w-full" value={formData.property_id} onChange={e => selectProperty(e.target.value)}>
                    <option value="">— Select Property —</option>
                    {properties.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select></div>
                <div><label className="field-label">Location *</label>
                  <input className="input-dark text-xs w-full" value={formData.location} onChange={e => update('location', e.target.value)} />
                  {formErrors.location && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.location}</p>}</div>
              </div>

              {/* Section / Zone / Beat — cascading */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Section</label>
                  <select className="w-full bg-[#1a2636] border border-[#2a3a4a] rounded px-2 py-1.5 text-sm text-white"
                    value={formData.section_id || ''} onChange={e => { update('section_id', e.target.value); update('zone_id', ''); update('beat_id', ''); }}>
                    <option value="">—</option>
                    {sectionOptions.map(s => <option key={s} value={s}>{sectionLabels.get(s) || s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Zone</label>
                  <select className="w-full bg-[#1a2636] border border-[#2a3a4a] rounded px-2 py-1.5 text-sm text-white"
                    value={formData.zone_id || ''} onChange={e => { update('zone_id', e.target.value); update('beat_id', ''); }}>
                    <option value="">—</option>
                    {zonesForSection(formData.section_id).map(z => <option key={z} value={z}>{zoneLabels.get(z) || z}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Beat</label>
                  <select className="w-full bg-[#1a2636] border border-[#2a3a4a] rounded px-2 py-1.5 text-sm text-white"
                    value={formData.beat_id || ''} onChange={e => update('beat_id', e.target.value)}>
                    <option value="">—</option>
                    {beatsForZone(formData.zone_id).map(b => <option key={b} value={b}>{getBeatLabel(formData.zone_id, b)}</option>)}
                  </select>
                </div>
              </div>

              {/* Order details */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><label className="field-label">Order Type</label>
                  <select className="select-dark text-xs w-full" value={formData.order_type} onChange={e => update('order_type', e.target.value)}>
                    {ORDER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select></div>
                <div><label className="field-label">Duration (days)</label>
                  <input type="number" className="input-dark text-xs w-full" placeholder="Empty = permanent" value={formData.duration_days} onChange={e => update('duration_days', e.target.value)} /></div>
                <div><label className="field-label">Authorized By</label>
                  <input className="input-dark text-xs w-full" placeholder="Supervisor name" value={formData.authorized_by} onChange={e => update('authorized_by', e.target.value)} /></div>
              </div>

              <div><label className="field-label">Reason</label>
                <textarea className="input-dark text-xs w-full" rows={2} value={formData.reason} onChange={e => update('reason', e.target.value)} /></div>

              <div><label className="field-label">Conditions / Exceptions</label>
                <textarea className="input-dark text-xs w-full" rows={2} value={formData.conditions} onChange={e => update('conditions', e.target.value)} /></div>

              <div><label className="field-label">Notes</label>
                <textarea className="input-dark text-xs w-full" rows={2} value={formData.notes} onChange={e => update('notes', e.target.value)} /></div>

              <div className={`flex ${isMobile ? 'flex-col gap-2' : 'justify-end gap-2'} pt-2 border-t border-rmpg-700`}>
                <button type="submit" disabled={submitting} className={`toolbar-btn ${isMobile ? 'w-full justify-center' : ''}`} style={{ background: 'rgba(26,90,158,0.3)', borderColor: 'rgba(26,90,158,0.5)', minHeight: isMobile ? 48 : undefined, fontSize: isMobile ? 14 : undefined }}>
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} />}
                  {editingOrder ? 'Update' : 'Create'} Order
                </button>
                <button type="button" onClick={() => setFormOpen(false)} className={`toolbar-btn ${isMobile ? 'w-full justify-center' : ''}`} style={isMobile ? { minHeight: 48, fontSize: 14 } : undefined}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

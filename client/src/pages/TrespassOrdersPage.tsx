import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import {
  Plus, Search, ShieldBan, MapPin, User, Clock, Ban, Calendar,
  RotateCcw, X, Save, Loader2, CheckCircle, AlertTriangle,
  Eye, Pencil, Trash2, Printer,
} from 'lucide-react';
import type { TrespassOrder, TrespassOrderType } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import ViewOnMapLink from '../components/ViewOnMapLink';
import ConfirmDialog from '../components/ConfirmDialog';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import ExportButton from '../components/ExportButton';
import { useToast } from '../components/ToastProvider';
import { useFormValidation } from '../hooks/useFormValidation';
import { useFormDraft } from '../hooks/useFormDraft';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard';
import FloatingSaveBar from '../components/FloatingSaveBar';
import { useDistrictOptions } from '../hooks/useDistrictLookup';
import { safeDateStr, safeDateTimeStr, parseTimestamp } from '../utils/dateUtils';
import { formatAddressDisplay } from '../utils/statusLabels';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { openTrespassOrderPdf } from '../utils/trespassOrderPdf';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';
import { useSlashFocus } from '../hooks/useSlashFocus';
import { trespassOrdersToCsv, downloadTextFile } from '../utils/rmsListExport';

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
  sector_id: '', zone_id: '', beat_id: '',
};

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = parseTimestamp(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function TrespassOrdersPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin'; // Admin God Mode — unrestricted access
  // canManage: admin / manager / supervisor may create, edit, serve, lift,
  // violate, and renew orders. Officers and dispatchers get read-only access.
  // Mirrors the role set used by VictimServices, Field Interviews, and Evidence.
  const MANAGE_ROLES = new Set(['admin', 'manager', 'supervisor']);
  const canManage = MANAGE_ROLES.has(user?.role ?? '');
  const { sections: sectionOptions, sectionLabels, zoneLabels, zonesForSection, beatsForZone, getBeatLabel } = useDistrictOptions();
  const { errors: formErrors, validate: validateForm, clearAllErrors } = useFormValidation();

  const [orders, setOrders] = useState<TrespassOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<TrespassOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);
  const [filterStatus, setFilterStatus] = useState('active');
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<TrespassOrder | null>(null);
  const {
    form: formData,
    setForm: setFormData,
    isDirty: formIsDirty,
    wasRestored: formWasRestored,
    clearDraft: clearFormDraft,
    snapshot: snapshotForm,
  } = useFormDraft<typeof EMPTY_FORM>({
    storageKey: `rmpg_trespass_order_form_${editingOrder?.id ?? 'new'}`,
    defaultValue: EMPTY_FORM,
    isActive: formOpen,
  });
  const [submitting, setSubmitting] = useState(false);

  // Person search
  const [personSearch, setPersonSearch] = useState('');
  const [personResults, setPersonResults] = useState<any[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<any>(null);
  const personSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setOrders(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotalCount(res.pagination?.total || 0);
    } catch (err) { setError(err instanceof Error ? err.message : 'Operation failed'); } finally { setLoading(false); }
  }, [page, searchQuery, filterStatus, showArchived]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useLiveSync('alerts', () => fetchOrders({ silent: true }));

  // ── Feature 18: Expiration Calendar ──
  const [expirationCalendar, setExpirationCalendar] = useState<any>(null);
  const handleLoadExpirationCalendar = async () => {
    try {
      const data = await apiFetch<any>('/trespass-orders/expiration-calendar');
      setExpirationCalendar(data);
    } catch { /* ignore */ }
  };

  // ── Feature 19: Bulk Creation state ──
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkPersons, setBulkPersons] = useState<{ first_name: string; last_name: string; dob?: string; description?: string }[]>([]);
  const handleAddBulkPerson = () => {
    setBulkPersons(prev => [...prev, { first_name: '', last_name: '' }]);
  };
  const handleBulkCreate = async () => {
    if (bulkPersons.length === 0 || !formData.location) { addToast('Add persons and location', 'error'); return; }
    try {
      await apiFetch('/trespass-orders/bulk', {
        method: 'POST',
        body: JSON.stringify({
          persons: bulkPersons.filter(p => p.first_name && p.last_name),
          property_id: formData.property_id || null,
          property_name: properties.find(p => String(p.id) === formData.property_id)?.name || '',
          location: formData.location,
          order_type: formData.order_type,
          reason: formData.reason,
          conditions: formData.conditions,
          duration_days: formData.duration_days,
          authorized_by: formData.authorized_by,
          notes: formData.notes,
        }),
      });
      addToast(`Created ${bulkPersons.length} trespass orders`, 'success');
      setBulkMode(false);
      setBulkPersons([]);
      fetchOrders();
    } catch (err) { addToast(err instanceof Error ? err.message : 'Bulk create failed', 'error'); }
  };

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
      try {
        const res = await apiFetch<{ data: any[] }>(`/records/persons?search=${encodeURIComponent(personSearch)}&per_page=8`);
        setPersonResults(res.data || []);
      } catch { setPersonResults([]); }
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
    snapshotForm();
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
      sector_id: order.sector_id || '',
      zone_id: order.zone_id || '',
      beat_id: order.beat_id || '',
    });
    setFormOpen(true);
    snapshotForm();
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
        sector_id: formData.sector_id || null,
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
      clearFormDraft();
      setFormOpen(false); setEditingOrder(null); await fetchOrders();
    } catch (err) { setError(err instanceof Error ? err.message : 'Operation failed'); } finally { setSubmitting(false); }
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
    } catch (err) { setError(err instanceof Error ? err.message : 'Operation failed'); }
  };

  // Lift confirmation — "Lift" is a permanent status change that removes
  // enforcement. Unlike Serve (factual record) or Violated (escalation),
  // Lift is the closest analog to revoke: it closes the order and removes
  // it from the active-orders view seen by patrol. ConfirmDialog gives the
  // operator one clear chance to verify the subject before committing.
  const [orderToLift, setOrderToLift] = useState<TrespassOrder | null>(null);
  const [lifting, setLifting] = useState(false);
  const handleLiftWithConfirm = (order: TrespassOrder) => { setOrderToLift(order); };
  const confirmLiftOrder = async () => {
    const order = orderToLift;
    if (!order) return;
    setLifting(true);
    try {
      await apiFetch(`/trespass-orders/${order.id}/lift`, { method: 'PUT' });
      addToast('Order lifted', 'success');
      await fetchOrders();
      if (selectedOrder?.id === order.id) {
        const updated = await apiFetch<TrespassOrder>(`/trespass-orders/${order.id}`);
        setSelectedOrder(updated);
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Operation failed'); }
    finally { setLifting(false); setOrderToLift(null); }
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
    } catch (err) { setError(err instanceof Error ? err.message : 'Operation failed'); }
  };

  const handleRenew = async (order: TrespassOrder) => {
    try {
      const renewed = await apiFetch<TrespassOrder>(`/trespass-orders/${order.id}/renew`, { method: 'POST' });
      addToast(`Order renewed as ${(renewed as any).order_number}`, 'success');
      await fetchOrders();
      setSelectedOrder(renewed);
    } catch (err) { addToast(err instanceof Error ? err.message : 'Failed to renew', 'error'); }
  };

  // Check if order expires within 30 days
  const isExpiringWithin30Days = (order: TrespassOrder): boolean => {
    if (!order.expiration_date) return false;
    const exp = parseTimestamp(order.expiration_date);
    const now = new Date();
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    return exp > now && exp <= thirtyDays;
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

  // Admin hard-delete — routes through ConfirmDialog instead of the
  // native confirm(). The native dialog had no a11y, no keyboard polish,
  // and rendered identically whether the operator was about to delete
  // an active order on a violator or an old expired warning — see the
  // pattern shipped in Field Interviews (#1597) and Cases (#1604).
  const [orderToDelete, setOrderToDelete] = useState<TrespassOrder | null>(null);
  const [deleting, setDeleting] = useState(false);
  const handleDeleteOrder = (order: TrespassOrder) => { setOrderToDelete(order); };
  const confirmDeleteOrder = async () => {
    const order = orderToDelete;
    if (!order) return;
    setDeleting(true);
    try {
      await apiFetch(`/trespass-orders/${order.id}`, { method: 'DELETE' });
      addToast(`Order ${order.order_number} deleted`, 'success');
      if (selectedOrder?.id === order.id) setSelectedOrder(null);
      await fetchOrders();
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
    finally { setDeleting(false); setOrderToDelete(null); }
  };

  // ── Right-click context menu ──
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const buildOrderMenu = (order: TrespassOrder): ContextMenuItem[] => {
    const subject = `${order.subject_first_name || ''} ${order.subject_last_name || ''}`.trim();
    return [
      m.action('Open order', () => setSelectedOrder(order), { icon: <Eye size={12} /> }),
      ...(canManage ? [m.action('Edit order', () => handleEdit(order), { icon: <Pencil size={12} /> })] : []),
      m.action('Print court PDF', () => openTrespassOrderPdf(order), { icon: <Printer size={12} /> }),
      m.separator(),
      m.copy('Copy subject name', subject),
      m.copy('Copy order #', order.order_number),
      m.copyId(order.id),
      ...(canManage && order.status === 'active' ? [
        m.separator(),
        m.action('Mark served', () => handleServe(order), { icon: <CheckCircle size={12} /> }),
        m.action('Lift order', () => handleLiftWithConfirm(order), { icon: <RotateCcw size={12} /> }),
        m.action('Record violation', () => handleViolate(order), { icon: <AlertTriangle size={12} /> }),
      ] : []),
      ...(canManage && (order.status === 'expired' || order.status === 'served') ? [
        m.separator(),
        m.action('Renew order', () => handleRenew(order), { icon: <RotateCcw size={12} /> }),
      ] : []),
      ...(isAdmin ? [
        m.separator(),
        m.action('Delete', () => handleDeleteOrder(order), { icon: <Trash2 size={12} />, danger: true }),
      ] : []),
    ];
  };

  // Set document title
  useEffect(() => { document.title = 'Trespass Orders \u2014 RMPG Flex'; }, []);

  // Keyboard shortcuts:
  //   Escape \u2014 smart-cascade close (smallest-open-first). Previous
  //            version hard-closed the form on every Esc, even when
  //            the operator's intent was to dismiss the expiration
  //            calendar / bulk panel / delete-confirm sitting on top
  //            of nothing \u2014 losing form-draft work as a side effect.
  //   N      \u2014 open a new order from anywhere on the page (mirrors
  //            Dispatch / Patrol / FI / Evidence muscle memory).
  //            Suppressed when typing into an input / textarea /
  //            contenteditable so it doesn't fire mid-typing.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close-smallest-open-first cascade. Each branch returns after
        // closing so a single Esc doesn't blast multiple open layers.
        if (orderToDelete) { e.stopPropagation(); setOrderToDelete(null); return; }
        if (orderToLift) { e.stopPropagation(); setOrderToLift(null); return; }
        if (expirationCalendar) { e.stopPropagation(); setExpirationCalendar(null); return; }
        if (bulkMode) { e.stopPropagation(); setBulkMode(false); setBulkPersons([]); return; }
        if (formOpen) { e.stopPropagation(); setFormOpen(false); setEditingOrder(null); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if ((e.key === 'n' || e.key === 'N') && canManage) {
        e.preventDefault();
        handleOpenNew();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderToDelete, expirationCalendar, bulkMode, formOpen, canManage]);

  // \u2500\u2500 Deep-link: ?order_id=<id> and ?person_id=<id> \u2500\u2500
  // Honors the Dashboard-emit / page-consume contract used across the
  // other audited pages (Cases, FI, Evidence, Citations, Warrants).
  //
  // ?order_id=<id>: Once `orders` hydrates, find by id and select; falls
  // back to a direct fetch for ids outside the current filter view (e.g.
  // an expired order linked from a case file). Strips the param after use
  // so a refresh doesn't re-select.
  //
  // ?person_id=<id>: Pre-filters the list to orders for that person by
  // injecting the id into the search query. Strips the param after use.
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingOrderIdRef = useRef<string | null>(searchParams.get('order_id'));
  const pendingPersonIdRef = useRef<string | null>(searchParams.get('person_id'));
  useEffect(() => {
    // person_id deep-link: filter to orders for that person on first load.
    // Strips the param after consuming so a refresh doesn't re-apply it.
    const personTarget = pendingPersonIdRef.current;
    if (personTarget && !loading) {
      pendingPersonIdRef.current = null;
      const next = new URLSearchParams(searchParams);
      next.delete('person_id');
      setSearchParams(next, { replace: true });
      setSearchQuery(personTarget);
      setFilterStatus('');
      setShowActiveOnly(false);
      setPage(1);
      addToast(`Filtering orders for person ${personTarget}`, 'success');
    }
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const target = pendingOrderIdRef.current;
    if (!target || loading) return;
    pendingOrderIdRef.current = null;
    let cancelled = false;
    (async () => {
      try {
        const hit = orders.find((o) => String(o.id) === String(target));
        if (hit) {
          if (!cancelled) { setSelectedOrder(hit); addToast(`Loaded order ${hit.order_number}`, 'success'); }
        } else {
          // Not in the current paged/filtered view \u2014 fetch by id directly
          // so the deep-link works regardless of archive / status filter.
          const item = await apiFetch<TrespassOrder>(`/trespass-orders/${target}`);
          if (cancelled) return;
          if (item && item.id != null) { setSelectedOrder(item); addToast(`Loaded order ${(item as TrespassOrder).order_number}`, 'success'); }
          else addToast(`Order ${target} not found`, 'warning');
        }
      } catch {
        if (!cancelled) addToast(`Failed to load order ${target}`, 'error');
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(searchParams);
          next.delete('order_id');
          setSearchParams(next, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, loading]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <PanelTitleBar icon={ShieldBan} title="TRESPASS ORDERS">
        <span className="text-[9px] font-mono text-rmpg-400">{totalCount} TOTAL</span>
        <span className="toolbar-separator" />
        <ExportButton exportUrl="/trespass-orders/export/csv" exportFilename="trespass_orders_export.csv" />
        <button
          type="button"
          className="toolbar-btn"
          disabled={orders.length === 0}
          onClick={() => downloadTextFile('trespass-orders.csv', trespassOrdersToCsv(orders.map((o) => ({
            order_number: o.order_number,
            order_type: o.order_type,
            status: o.status,
            property_name: o.property_name,
            location: o.location,
            effective_date: o.effective_date,
            expiration_date: o.expiration_date,
          }))))}
        >CSV</button>
        {/* Feature 18: Expiration Calendar */}
        <button type="button" onClick={handleLoadExpirationCalendar} className="toolbar-btn" title="Expiration calendar">
          <Calendar style={{ width: 11, height: 11 }} /> Expirations
        </button>
        {/* Feature 19: Bulk Create — privileged users only */}
        {canManage && (
          <button type="button" onClick={() => { setBulkMode(!bulkMode); if (!bulkMode) setBulkPersons([{ first_name: '', last_name: '' }]); }} className="toolbar-btn" title="Bulk create orders">
            <Plus style={{ width: 11, height: 11 }} /> Bulk
          </button>
        )}
        {canManage && (
          <button type="button" onClick={handleOpenNew} className="toolbar-btn">
            <Plus style={{ width: 11, height: 11 }} /> New Order
          </button>
        )}
      </PanelTitleBar>

      {/* Feature 18: Expiration Calendar Panel */}
      {expirationCalendar && (
        <div className="px-3 py-2 border-b border-amber-700/50 bg-amber-900/10 text-xs">
          <div className="flex justify-between items-center mb-1">
            <span className="text-amber-400 font-bold text-[10px] uppercase">Expiring Orders ({expirationCalendar.total})</span>
            <IconButton onClick={() => setExpirationCalendar(null)} className="text-amber-500 hover:text-amber-300" aria-label="Close expiration calendar"><X style={{ width: 12, height: 12 }} /></IconButton>
          </div>
          {Object.entries(expirationCalendar.by_month || {}).map(([month, orders]: [string, any]) => (
            <div key={month} className="mb-1">
              <div className="text-[9px] text-rmpg-400 font-bold">{month}</div>
              {orders.slice(0, 5).map((o: any) => (
                <div key={o.id} className="text-[10px] flex gap-2 py-0.5">
                  <span className={o.days_remaining < 0 ? 'text-red-400' : o.days_remaining < 14 ? 'text-amber-400' : 'text-green-400'}>
                    {Math.round(o.days_remaining)}d
                  </span>
                  <span className="text-rmpg-100">{o.subject_first_name} {o.subject_last_name}</span>
                  <span className="text-rmpg-500">{o.property_name || formatAddressDisplay(o.location)}</span>
                  <span className="text-rmpg-500 ml-auto">{o.expiration_date}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Feature 19: Bulk Create Panel */}
      {bulkMode && (
        <div className="px-3 py-2 border-b border-border-default bg-surface-sunken text-xs">
          <div className="flex justify-between items-center mb-1">
            <span className="text-rmpg-400 font-bold text-[10px] uppercase">Bulk Trespass Order Creation</span>
            <IconButton onClick={() => { setBulkMode(false); setBulkPersons([]); }} className="text-rmpg-500 hover:text-rmpg-300" aria-label="Cancel bulk mode"><X style={{ width: 12, height: 12 }} /></IconButton>
          </div>
          <div className="space-y-1 mb-2">
            {bulkPersons.map((p, i) => (
              <div key={i} className="flex gap-1">
                <input id="ff-trespassorderspage-0" className="input-dark flex-1 text-xs min-h-[36px]" placeholder="First name" value={p.first_name}
                  onChange={e => { const arr = [...bulkPersons]; arr[i] = { ...arr[i], first_name: e.target.value }; setBulkPersons(arr); }} />
                <input id="ff-trespassorderspage-1" className="input-dark flex-1 text-xs min-h-[36px]" placeholder="Last name" value={p.last_name}
                  onChange={e => { const arr = [...bulkPersons]; arr[i] = { ...arr[i], last_name: e.target.value }; setBulkPersons(arr); }} />
                <IconButton onClick={() => setBulkPersons(prev => prev.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-300 px-1" aria-label={`Remove person ${i + 1}`}><X style={{ width: 10, height: 10 }} /></IconButton>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleAddBulkPerson} className="toolbar-btn text-[10px]"><Plus style={{ width: 10, height: 10 }} /> Add Person</button>
            <button type="button" onClick={handleBulkCreate} className="toolbar-btn toolbar-btn-primary text-[10px]">Create {bulkPersons.filter(p => p.first_name && p.last_name).length} Orders</button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className={`flex ${isMobile ? 'flex-col gap-1.5' : 'items-center gap-2'} px-3 py-1.5 border-b border-rmpg-700 bg-surface-base`}>
        <div className={`relative ${isMobile ? 'w-full' : 'flex-1 max-w-xs'}`}>
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
          <input id="ff-trespassorderspage-2" ref={searchRef} type="text" placeholder="Search orders... (/)" aria-label="Search orders..." className={`input-dark pl-7 w-full ${isMobile ? 'text-sm py-2.5' : 'text-xs'}`}
            value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
            style={isMobile ? { minHeight: 44 } : undefined} />
        </div>
        <div className={`flex items-center ${isMobile ? 'gap-2' : 'gap-2'}`}>
          <button
            type="button"
            className={`text-[9px] font-bold uppercase px-2 py-1 border transition-colors ${
              showActiveOnly
                ? 'bg-green-900/50 text-green-400 border-green-700/50'
                : 'bg-rmpg-700/30 text-rmpg-400 border-rmpg-600/50'
            }`}
            onClick={() => {
              const next = !showActiveOnly;
              setShowActiveOnly(next);
              setFilterStatus(next ? 'active' : '');
              setPage(1);
            }}
            title={showActiveOnly ? 'Showing active only — click to show all' : 'Showing all — click to show active only'}
          >
            {showActiveOnly ? 'ACTIVE ONLY' : 'ALL ORDERS'}
          </button>
          <select id="ff-trespassorderspage-3" className={`select-dark ${isMobile ? 'flex-1 text-sm py-2' : 'text-xs'}`} value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setShowActiveOnly(false); setPage(1); }} style={isMobile ? { minHeight: 44 } : undefined}>
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="served">Served</option>
            <option value="expired">Expired</option>
            <option value="lifted">Lifted</option>
            <option value="violated">Violated</option>
          </select>
          <label className={`flex items-center gap-1 ${isMobile ? 'text-xs' : 'text-[10px]'} text-rmpg-400 cursor-pointer`} style={isMobile ? { minHeight: 44 } : undefined}>
            <input id="ff-trespassorderspage-4" type="checkbox" checked={showArchived} onChange={e => { setShowArchived(e.target.checked); setPage(1); }} className="accent-brand-500" style={isMobile ? { width: 20, height: 20 } : undefined} /> Archived
          </label>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="px-4 py-2 bg-red-900/30 border-b border-red-700/50 text-red-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-3 h-3" /> {error}
          <button type="button" className="toolbar-btn ml-2" onClick={() => { void fetchOrders(); }}>Retry</button>
          <button aria-label="Close" type="button" onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* List */}
        <div className={`${selectedOrder && !isMobile ? 'w-[40%]' : 'w-full'} overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent border-r border-rmpg-700`}>
          {loading && orders.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-rmpg-400"><Loader2 className="w-5 h-5 animate-spin mr-2" role="status" aria-label="Loading" /> Loading...</div>
          ) : orders.length === 0 ? (
            // 3-way empty state distinguishes archive vs filtered-zero vs
            // genuine "no orders ever created" — without it, an operator
            // who set Status=Lifted on an org with zero lifted orders saw
            // the same screen as an op with no records at all, prompting
            // confused "did everything disappear?" pings.
            showArchived ? (
              <EmptyState
                icon={Ban}
                title="No archived trespass orders"
                description="Lifted or expired orders that have been archived appear here."
              />
            ) : (searchQuery || (filterStatus && filterStatus !== 'active')) ? (
              <EmptyState
                icon={Search}
                title="No matches in current view"
                description="Adjust the search or status filter to see other orders."
                action={{ label: 'Clear filters', onClick: () => { setSearchQuery(''); setFilterStatus('active'); setShowActiveOnly(true); setPage(1); } }}
              />
            ) : (
              <EmptyState
                icon={Ban}
                title="No trespass orders found"
                description={canManage ? 'Create a new trespass order to get started.' : 'No trespass orders have been issued yet.'}
                action={canManage ? { label: 'New Order', onClick: handleOpenNew } : undefined}
              />
            )
          ) : (
            orders.map(order => (
              <div key={order.id} onClick={() => setSelectedOrder(order)}
                onContextMenu={(e) => openMenu(e, buildOrderMenu(order))}
                className={`px-3 ${isMobile ? 'py-3' : 'py-2'} cursor-pointer border-b border-rmpg-800 transition-colors hover:bg-surface-raised ${selectedOrder?.id === order.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'border-l-2 border-l-transparent'}`}
                style={isMobile ? { minHeight: 56 } : undefined}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[11px] font-bold font-mono text-brand-400">{order.order_number}</span>
                  <div className="flex items-center gap-1">
                    <span className={`text-[8px] font-bold px-1.5 py-0 border rounded-sm ${TYPE_COLORS[order.order_type] || TYPE_COLORS.trespass_warning}`}>
                      {toDisplayLabel(order.order_type || '').toUpperCase()}
                    </span>
                    <span className={`text-[8px] font-bold px-1.5 py-0 border rounded-sm ${STATUS_COLORS[order.status]}`}>
                      {(order.status || '').toUpperCase()}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-rmpg-100 font-medium">
                  <Ban className="w-3 h-3 inline mr-1 text-red-400" />
                  {order.subject_last_name}, {order.subject_first_name}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-rmpg-400 mt-0.5">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{order.property_name || formatAddressDisplay(order.location)}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-rmpg-500 mt-0.5">
                  <span>{order.issued_by_name || order.issued_by_display}</span>
                  <span>•</span>
                  <span>{safeDateStr(order.created_at)}</span>
                  {(order.sector_id || order.zone_id || order.beat_id) && (
                    <span className="font-mono text-rmpg-500">{[order.sector_id, order.zone_id, order.beat_id].filter(Boolean).join('/')}</span>
                  )}
                  {order.expiration_date && <span className="text-amber-500/70">Exp: {safeDateStr(order.expiration_date)}</span>}
                </div>
              </div>
            ))
          )}
          {totalPages > 1 && (
            <div className={`flex items-center justify-center gap-2 py-2 ${isMobile ? 'text-xs' : 'text-[10px]'} text-rmpg-400`}>
              <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined, minWidth: isMobile ? 48 : undefined }}>Prev</button>
              <span>Page {page} of {totalPages}</span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined, minWidth: isMobile ? 48 : undefined }}>Next</button>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedOrder && (
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-bold text-rmpg-100 font-mono">{selectedOrder.order_number}</h2>
                <span className="text-[10px] text-rmpg-400">Issued {safeDateTimeStr(selectedOrder.created_at)}</span>
              </div>
              <div className={`flex items-center ${isMobile ? 'gap-2 flex-wrap' : 'gap-1'}`}>
                {/* Print — court-ready single-order PDF. The trespass
                    order IS a court document; before this button the only
                    print path was bulk CSV, so operators had to screenshot
                    the detail panel for a case file or supervisor review. */}
                <button
                  type="button"
                  onClick={() => openTrespassOrderPdf(selectedOrder)}
                  className="toolbar-btn"
                  style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }}
                  title="Print court-ready PDF"
                >
                  <Printer style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Print
                </button>
                {canManage && (
                  <button type="button" onClick={() => handleEdit(selectedOrder)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }}>Edit</button>
                )}
                {canManage && selectedOrder.status === 'active' && (
                  <>
                    <button type="button" onClick={() => handleServe(selectedOrder)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', color: 'rgb(var(--sev-warn-rgb))', minHeight: isMobile ? 48 : undefined }}>
                      <CheckCircle style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Serve
                    </button>
                    <button type="button" onClick={() => handleLiftWithConfirm(selectedOrder)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', color: 'rgb(var(--sev-ok-rgb))', minHeight: isMobile ? 48 : undefined }}>Lift</button>
                    <button type="button" onClick={() => handleViolate(selectedOrder)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', color: 'rgb(var(--sev-special-rgb))', minHeight: isMobile ? 48 : undefined }}>
                      <AlertTriangle style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Violated
                    </button>
                    {isExpiringWithin30Days(selectedOrder) && (
                      <button type="button" onClick={() => handleRenew(selectedOrder)} className="toolbar-btn text-rmpg-400" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }}>
                        <RotateCcw style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Renew
                      </button>
                    )}
                  </>
                )}
                {canManage && (selectedOrder.status === 'expired' || selectedOrder.status === 'served') && (
                  <button type="button" onClick={() => handleRenew(selectedOrder)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', color: 'var(--text-secondary)', minHeight: isMobile ? 48 : undefined }}>
                    <RotateCcw style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Renew
                  </button>
                )}
                {isAdmin && (
                  <button type="button" onClick={() => handleDeleteOrder(selectedOrder)} className="toolbar-btn text-red-400 hover:text-red-300" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }}>
                    <X style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Delete
                  </button>
                )}
                <IconButton onClick={() => setSelectedOrder(null)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }} aria-label="Close details">
                  <X style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} />
                </IconButton>
              </div>
            </div>

            {/* Status banner */}
            {selectedOrder.status === 'active' && (
              <div className="mb-3 px-3 py-2 border border-red-700/50 bg-red-900/20 text-xs text-red-300 flex items-center gap-2">
                <Ban className="w-4 h-4 text-red-400" />
                <span className="font-bold uppercase">Active Trespass Order</span>
                {selectedOrder.expiration_date && (
                  <span className="ml-auto text-red-400/70">Expires: {safeDateStr(selectedOrder.expiration_date)}</span>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <div><span className="text-rmpg-500 text-[10px] uppercase">Subject</span><div className="text-rmpg-100 font-medium">{selectedOrder.subject_last_name}, {selectedOrder.subject_first_name}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">DOB</span><div className="text-rmpg-100">{selectedOrder.subject_dob ? parseTimestamp(selectedOrder.subject_dob).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '—'}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Property</span><div className="text-rmpg-100">{selectedOrder.property_name || '—'}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Location</span><div className="text-rmpg-100 flex items-center gap-1.5">{formatAddressDisplay(selectedOrder.location)}<ViewOnMapLink address={selectedOrder.location} label={selectedOrder.property_name} /></div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Order Type</span><div className="text-rmpg-100 capitalize">{toDisplayLabel(selectedOrder.order_type)}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Status</span><div className="text-rmpg-100 capitalize">{toDisplayLabel(selectedOrder.status)}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Effective</span><div className="text-rmpg-100">{selectedOrder.effective_date ? parseTimestamp(selectedOrder.effective_date).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '—'}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Expires</span><div className="text-rmpg-100">{selectedOrder.expiration_date ? parseTimestamp(selectedOrder.expiration_date).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : 'Permanent'}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Issued By</span><div className="text-rmpg-100">{selectedOrder.issued_by_name || selectedOrder.issued_by_display || '—'}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Authorized By</span><div className="text-rmpg-100">{selectedOrder.authorized_by || '—'}</div></div>
              {(selectedOrder.sector_id || selectedOrder.zone_id || selectedOrder.beat_id) && (
                <div><span className="text-rmpg-500 text-[10px] uppercase">S/Z/B</span><div className="text-rmpg-100 font-mono">{[selectedOrder.sector_id, selectedOrder.zone_id, selectedOrder.beat_id].filter(Boolean).join(' / ') || '—'}</div></div>
              )}
              {selectedOrder.served_at && (
                <>
                  <div><span className="text-rmpg-500 text-[10px] uppercase">Served At</span><div className="text-rmpg-100">{safeDateTimeStr(selectedOrder.served_at)}</div></div>
                  <div><span className="text-rmpg-500 text-[10px] uppercase">Served By</span><div className="text-rmpg-100">{selectedOrder.served_by_name || '—'}</div></div>
                </>
              )}
            </div>

            {selectedOrder.reason && (
              <div className="mt-3 pt-2 border-t border-rmpg-700">
                <span className="text-brand-gold-500 text-[10px] uppercase font-bold tracking-wider">Reason</span>
                <p className="text-xs text-rmpg-200 mt-1">{formatEnumValue(selectedOrder.reason)}</p>
              </div>
            )}
            {selectedOrder.conditions && (
              <div className="mt-2">
                <span className="text-brand-gold-500 text-[10px] uppercase font-bold tracking-wider">Conditions</span>
                <p className="text-xs text-rmpg-200 mt-1">{selectedOrder.conditions}</p>
              </div>
            )}
            {selectedOrder.notes && (
              <div className="mt-2">
                <span className="text-brand-gold-500 text-[10px] uppercase font-bold tracking-wider">Notes</span>
                <p className="text-xs text-rmpg-200 mt-1 whitespace-pre-wrap">{selectedOrder.notes}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Form Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => { clearFormDraft(); setFormOpen(false); }}>
          <div className="bg-surface-raised border border-rmpg-600 w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700 bg-surface-base">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-brand-gold-500 uppercase tracking-wider">{editingOrder ? 'Edit' : 'New'} Trespass Order</span>
                {formIsDirty && (
                  <span className="text-[8px] text-amber-400 font-bold uppercase tracking-wider">UNSAVED</span>
                )}
              </div>
              <IconButton onClick={() => { clearFormDraft(); setFormOpen(false); }} className="text-rmpg-400 hover:text-rmpg-100" aria-label="Close form"><X style={{ width: 14, height: 14 }} /></IconButton>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              {formWasRestored && (
                <div className="flex items-center justify-between px-3 py-2 rounded-sm border border-amber-500/30" style={{ background: 'rgb(var(--sev-warn-rgb) / 0.08)' }}>
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-amber-400" />
                    <span className="text-xs text-amber-400 font-medium">Restored pending draft</span>
                  </div>
                  <button type="button" onClick={clearFormDraft} className="text-[10px] text-amber-400 underline hover:text-amber-300">
                    Discard
                  </button>
                </div>
              )}
              {/* Person search */}
              <div>
                <label htmlFor="ff-trespassorderspage-5" className="field-label">Link to Person Record (Optional)</label>
                <div className="relative">
                  <input id="ff-trespassorderspage-5" type="text" className="input-dark text-xs w-full min-h-[36px]" placeholder="Search person records..." aria-label="Search person records..."
                    value={personSearch} onChange={e => setPersonSearch(e.target.value)} />
                  {personResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-surface-raised border border-rmpg-600 max-h-40 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent">
                      {personResults.map((p: any) => (
                        <button key={p.id} type="button" onClick={() => selectPerson(p)}
                          className="w-full text-left px-3 py-1.5 text-xs text-rmpg-100 hover:bg-rmpg-700 flex items-center gap-2">
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
                <div><label htmlFor="ff-trespassorderspage-6" className="field-label">First Name *</label>
                  <input id="ff-trespassorderspage-6" className="input-dark text-xs w-full min-h-[36px]" value={formData.subject_first_name} onChange={e => update('subject_first_name', e.target.value)} />
                  {formErrors.subject_first_name && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.subject_first_name}</p>}</div>
                <div><label htmlFor="ff-trespassorderspage-7" className="field-label">Last Name *</label>
                  <input id="ff-trespassorderspage-7" className="input-dark text-xs w-full min-h-[36px]" value={formData.subject_last_name} onChange={e => update('subject_last_name', e.target.value)} />
                  {formErrors.subject_last_name && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.subject_last_name}</p>}</div>
                <div><label htmlFor="ff-trespassorderspage-8" className="field-label">DOB</label>
                  <input id="ff-trespassorderspage-8" type="date" className="input-dark text-xs w-full min-h-[36px]" value={formData.subject_dob} onChange={e => update('subject_dob', e.target.value)} /></div>
              </div>

              {/* Property + Location */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><label htmlFor="ff-trespassorderspage-9" className="field-label">Property</label>
                  <select id="ff-trespassorderspage-9" className="select-dark text-xs w-full" value={formData.property_id} onChange={e => selectProperty(e.target.value)}>
                    <option value="">— Select Property —</option>
                    {properties.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select></div>
                <div><label htmlFor="ff-trespassorderspage-10" className="field-label">Location *</label>
                  <input id="ff-trespassorderspage-10" className="input-dark text-xs w-full min-h-[36px]" value={formData.location} onChange={e => update('location', e.target.value)} />
                  {formErrors.location && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.location}</p>}</div>
              </div>

              {/* Section / Zone / Beat — cascading */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="ff-trespassorderspage-11" className="block text-xs text-rmpg-400 mb-1">Section</label>
                  <select id="ff-trespassorderspage-11" className="w-full bg-surface-raised border border-border-default rounded-sm px-2 py-1.5 text-sm text-rmpg-100"
                    value={formData.sector_id || ''} onChange={e => { update('sector_id', e.target.value); update('zone_id', ''); update('beat_id', ''); }}>
                    <option value="">—</option>
                    {sectionOptions.map(s => <option key={s} value={s}>{sectionLabels.get(s) || s}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-trespassorderspage-12" className="block text-xs text-rmpg-400 mb-1">Zone</label>
                  <select id="ff-trespassorderspage-12" className="w-full bg-surface-raised border border-border-default rounded-sm px-2 py-1.5 text-sm text-rmpg-100"
                    value={formData.zone_id || ''} onChange={e => { update('zone_id', e.target.value); update('beat_id', ''); }}>
                    <option value="">—</option>
                    {zonesForSection(formData.sector_id).map(z => <option key={z} value={z}>{zoneLabels.get(z) || z}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-trespassorderspage-13" className="block text-xs text-rmpg-400 mb-1">Beat</label>
                  <select id="ff-trespassorderspage-13" className="w-full bg-surface-raised border border-border-default rounded-sm px-2 py-1.5 text-sm text-rmpg-100"
                    value={formData.beat_id || ''} onChange={e => update('beat_id', e.target.value)}>
                    <option value="">—</option>
                    {beatsForZone(formData.zone_id).map(b => <option key={b} value={b}>{getBeatLabel(formData.zone_id, b)}</option>)}
                  </select>
                </div>
              </div>

              {/* Order details */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><label htmlFor="ff-trespassorderspage-14" className="field-label">Order Type</label>
                  <select id="ff-trespassorderspage-14" className="select-dark text-xs w-full" value={formData.order_type} onChange={e => update('order_type', e.target.value)}>
                    {ORDER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select></div>
                <div><label htmlFor="ff-trespassorderspage-15" className="field-label">Duration (days)</label>
                  <input id="ff-trespassorderspage-15" type="number" className="input-dark text-xs w-full min-h-[36px]" placeholder="Empty = permanent" value={formData.duration_days} onChange={e => update('duration_days', e.target.value)} /></div>
                <div><label htmlFor="ff-trespassorderspage-16" className="field-label">Authorized By</label>
                  <input id="ff-trespassorderspage-16" className="input-dark text-xs w-full min-h-[36px]" placeholder="Supervisor name" value={formData.authorized_by} onChange={e => update('authorized_by', e.target.value)} /></div>
              </div>

              <div><label htmlFor="ff-trespassorderspage-17" className="field-label">Reason</label>
                <textarea id="ff-trespassorderspage-17" className="input-dark text-xs w-full min-h-[36px]" rows={2} value={formData.reason} onChange={e => update('reason', e.target.value)} /></div>

              <div><label htmlFor="ff-trespassorderspage-18" className="field-label">Conditions / Exceptions</label>
                <textarea id="ff-trespassorderspage-18" className="input-dark text-xs w-full min-h-[36px]" rows={2} value={formData.conditions} onChange={e => update('conditions', e.target.value)} /></div>

              <div><label htmlFor="ff-trespassorderspage-19" className="field-label">Notes</label>
                <textarea id="ff-trespassorderspage-19" className="input-dark text-xs w-full min-h-[36px]" rows={2} value={formData.notes} onChange={e => update('notes', e.target.value)} /></div>

              <div className={`flex ${isMobile ? 'flex-col gap-2' : 'justify-end gap-2'} pt-2 border-t border-rmpg-700`}>
                <button type="submit" disabled={submitting} className={`toolbar-btn ${isMobile ? 'w-full justify-center' : ''}`} style={{ background: 'rgb(var(--brand-gold-rgb) / 0.25)', borderColor: 'rgb(var(--brand-gold-rgb) / 0.5)', minHeight: isMobile ? 48 : undefined, fontSize: isMobile ? 14 : undefined }}>
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} />}
                  {editingOrder ? 'Update' : 'Create'} Order
                </button>
                <button type="button" onClick={() => { clearFormDraft(); setFormOpen(false); }} className={`toolbar-btn ${isMobile ? 'w-full justify-center' : ''}`} style={isMobile ? { minHeight: 48, fontSize: 14 } : undefined}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <UnsavedChangesGuard hasUnsavedChanges={formOpen && formIsDirty} />
      <FloatingSaveBar
        visible={formOpen && formIsDirty}
        onSave={() => { const e = { preventDefault: () => {} } as React.FormEvent; handleSubmit(e); }}
        onCancel={() => { clearFormDraft(); setFormOpen(false); }}
        isSaving={submitting}
        saveLabel={editingOrder ? 'Update Order' : 'Create Order'}
      />

      {/* Admin hard-delete — ConfirmDialog replaces the native confirm()
          that lived here before. Renders identifying context (order
          number + subject + status) so the operator sees what they're
          about to wipe, not a generic prompt. */}
      <ConfirmDialog
        isOpen={!!orderToDelete}
        onClose={() => (deleting ? null : setOrderToDelete(null))}
        onConfirm={confirmDeleteOrder}
        title="Delete trespass order?"
        message="This permanently removes the order from the records system. The action is not reversible — prefer Lift for orders that should no longer be enforced but stay on the historical record."
        details={orderToDelete ? (
          <>
            <div><span className="text-rmpg-500">Order</span> <span className="font-mono text-rmpg-100">{orderToDelete.order_number}</span></div>
            <div><span className="text-rmpg-500">Subject</span> <span className="text-rmpg-100">{orderToDelete.subject_last_name}, {orderToDelete.subject_first_name}</span></div>
            <div><span className="text-rmpg-500">Status</span> <span className="text-rmpg-100 capitalize">{toDisplayLabel(orderToDelete.status)}</span></div>
            {orderToDelete.property_name && (
              <div><span className="text-rmpg-500">Property</span> <span className="text-rmpg-100">{orderToDelete.property_name}</span></div>
            )}
          </>
        ) : undefined}
        confirmLabel={deleting ? 'Deleting…' : 'Delete order'}
        confirmVariant="danger"
        isLoading={deleting}
      />

      {/* Lift confirmation — lifting is a permanent status change that
          removes a subject from the active-enforcement view seen by
          patrol. ConfirmDialog gives the operator one clear chance to
          verify the subject before committing. */}
      <ConfirmDialog
        isOpen={!!orderToLift}
        onClose={() => (lifting ? null : setOrderToLift(null))}
        onConfirm={confirmLiftOrder}
        title="Lift trespass order?"
        message="Lifting removes this order from active enforcement. The record is preserved for history — use Delete only if the order should be fully expunged."
        details={orderToLift ? (
          <>
            <div><span className="text-rmpg-500">Order</span> <span className="font-mono text-rmpg-100">{orderToLift.order_number}</span></div>
            <div><span className="text-rmpg-500">Subject</span> <span className="text-rmpg-100">{orderToLift.subject_last_name}, {orderToLift.subject_first_name}</span></div>
            <div><span className="text-rmpg-500">Property</span> <span className="text-rmpg-100">{orderToLift.property_name || orderToLift.location}</span></div>
          </>
        ) : undefined}
        confirmLabel={lifting ? 'Lifting…' : 'Lift order'}
        confirmVariant="warning"
        isLoading={lifting}
      />
    </div>
  );
}

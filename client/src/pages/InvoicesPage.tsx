// ============================================================
// RMPG Flex — Invoices Management Page
// ============================================================
// Full invoice management: list, create, detail, payments.
// Left panel = filterable list, right panel = detail or form.
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  DollarSign,
  Plus,
  Search,
  Filter,
  X,
  Loader2,
  Check,
  FileText,
  Send,
  Ban,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  AlertTriangle,
  Trash2,
  Zap,
  Eye,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { localToday, formatDate } from '../utils/dateUtils';

// ── Types ──────────────────────────────────────────────────

type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'partial' | 'overdue' | 'void' | 'cancelled';

interface Invoice {
  id: number;
  invoice_number: string;
  client_id: number;
  client_name: string;
  status: InvoiceStatus;
  period_start: string;
  period_end: string;
  issue_date: string;
  due_date: string;
  payment_terms: string;
  billing_email: string;
  billing_address: string;
  subtotal: number;
  discount_amount: number;
  late_fee_amount: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  notes: string;
  internal_notes: string;
  sent_at: string | null;
  paid_date: string | null;
  voided_at: string | null;
  created_by: number;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  line_item_count?: number;
  payment_count?: number;
}

interface LineItem {
  id: number;
  invoice_id: number;
  line_type: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  linked_entity_type: string | null;
  linked_entity_id: number | null;
  sort_order: number;
  created_at: string;
}

interface Payment {
  id: number;
  invoice_id: number;
  amount: number;
  payment_date: string;
  payment_method: string | null;
  reference_number: string | null;
  notes: string | null;
  recorded_by: number;
  recorded_by_name: string;
  created_at: string;
}

interface InvoiceDetail extends Invoice {
  line_items: LineItem[];
  payments: Payment[];
}

interface InvoiceStats {
  total_invoices: number;
  total_outstanding: number;
  total_collected: number;
  overdue_count: number;
  draft_count: number;
  by_status: Record<string, number>;
}

interface Client {
  id: number;
  name: string;
  status?: string;
}

// ── Constants ──────────────────────────────────────────────

const STATUSES: { value: InvoiceStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'partial', label: 'Partial' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'void', label: 'Void' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  sent: 'bg-blue-900/50 text-blue-300 border-blue-700/50',
  paid: 'bg-green-900/50 text-green-300 border-green-700/50',
  partial: 'bg-amber-900/50 text-amber-300 border-amber-700/50',
  overdue: 'bg-red-900/60 text-red-300 border-red-700/50',
  void: 'bg-rmpg-800/50 text-rmpg-500 border-rmpg-700/50',
  cancelled: 'bg-rmpg-800/50 text-rmpg-500 border-rmpg-700/50',
};

const LINE_TYPE_LABELS: Record<string, string> = {
  contract_base: 'Contract Base',
  service_hours: 'Service Hours',
  dispatch_call: 'Dispatch Call',
  incident_response: 'Incident Response',
  citation: 'Citation',
  discount: 'Discount',
  late_fee: 'Late Fee',
  custom: 'Custom',
};

const PAYMENT_METHODS = [
  { value: 'check', label: 'Check', icon: 'CHK' },
  { value: 'ach', label: 'ACH Transfer', icon: 'ACH' },
  { value: 'wire', label: 'Wire Transfer', icon: 'WIR' },
  { value: 'credit_card', label: 'Credit Card', icon: 'CC' },
  { value: 'cash', label: 'Cash', icon: 'CSH' },
  { value: 'other', label: 'Other', icon: 'OTH' },
];

const PAYMENT_METHOD_COLORS: Record<string, string> = {
  check: 'bg-blue-900/40 text-blue-400 border-blue-700/50',
  ach: 'bg-cyan-900/40 text-cyan-400 border-cyan-700/50',
  wire: 'bg-purple-900/40 text-purple-400 border-purple-700/50',
  credit_card: 'bg-amber-900/40 text-amber-400 border-amber-700/50',
  cash: 'bg-green-900/40 text-green-400 border-green-700/50',
  other: 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50',
};

function formatCurrency(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toDisplayLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
}

// ── Helpers ───────────────────────────────────────────────

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
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

// ── Component ──────────────────────────────────────────────

export default function InvoicesPage() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const canEdit = user && ['admin', 'manager', 'contract_manager'].includes(user.role);

  // List state
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<InvoiceStatus | ''>('');
  const [filterClientId, setFilterClientId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [stats, setStats] = useState<InvoiceStats | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Clients for dropdown
  const [clients, setClients] = useState<Client[]>([]);

  // Detail state
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Mode
  const [mode, setMode] = useState<'list' | 'create' | 'detail'>('list');

  // Create form
  const [createForm, setCreateForm] = useState({
    client_id: '',
    period_start: '',
    period_end: '',
    issue_date: localToday(),
    notes: '',
    internal_notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Payment form
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    payment_date: localToday(),
    payment_method: 'check',
    reference_number: '',
    notes: '',
  });
  const [paymentSaving, setPaymentSaving] = useState(false);

  // Line item form
  const [showLineItemForm, setShowLineItemForm] = useState(false);
  const [lineItemForm, setLineItemForm] = useState({
    line_type: 'custom',
    description: '',
    quantity: '1',
    unit_price: '0',
  });
  const [lineItemSaving, setLineItemSaving] = useState(false);

  // Action state
  const [actionLoading, setActionLoading] = useState('');

  // Search timer ref
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Data fetching ────────────────────────────────────────

  const fetchInvoices = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(''); }
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '50');
      if (filterStatus) params.set('status', filterStatus);
      if (filterClientId) params.set('client_id', filterClientId);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (searchQuery.trim()) params.set('q', searchQuery.trim());

      const res = await apiFetch<{ data: Invoice[]; pagination: any }>(`/invoices?${params}`);
      setInvoices(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotalCount(res.pagination?.total || 0);
    } catch (err: any) {
      if (!options?.silent) setError(err.message || 'Failed to load invoices');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [page, filterStatus, filterClientId, dateFrom, dateTo, searchQuery]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: InvoiceStats }>('/invoices/stats');
      setStats(res.data);
    } catch { /* non-critical */ }
  }, []);

  const fetchClients = useCallback(async () => {
    try {
      const res = await apiFetch<any>('/admin/clients');
      const list = Array.isArray(res) ? res : (res.data || res.clients || []);
      setClients(list.filter((c: any) => c.status !== 'archived'));
    } catch { /* non-critical */ }
  }, []);

  const fetchDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await apiFetch<{ data: InvoiceDetail }>(`/invoices/${id}`);
      setSelectedInvoice(res.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load invoice detail');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchClients(); }, [fetchClients]);

  // ── Actions ──────────────────────────────────────────────

  const handleCreate = async () => {
    if (!createForm.client_id || !createForm.period_start || !createForm.period_end) {
      setSaveError('Client, period start, and period end are required.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const res = await apiFetch<{ data: Invoice }>('/invoices', {
        method: 'POST',
        body: JSON.stringify(createForm),
      });
      // Switch to detail view of the new invoice
      await fetchDetail(res.data.id);
      setMode('detail');
      fetchInvoices({ silent: true });
      fetchStats();
      setCreateForm({ client_id: '', period_start: '', period_end: '', issue_date: localToday(), notes: '', internal_notes: '' });
    } catch (err: any) {
      setSaveError(err.message || 'Failed to create invoice');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (invoiceId: number, newStatus: string) => {
    setActionLoading(`status-${invoiceId}`);
    try {
      await apiFetch(`/invoices/${invoiceId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      await fetchDetail(invoiceId);
      fetchInvoices({ silent: true });
      fetchStats();
    } catch (err: any) {
      setError(err.message || 'Failed to update status');
    } finally {
      setActionLoading('');
    }
  };

  const handleGenerate = async (invoiceId: number) => {
    setActionLoading(`generate-${invoiceId}`);
    try {
      await apiFetch(`/invoices/${invoiceId}/generate`, { method: 'POST' });
      await fetchDetail(invoiceId);
      fetchInvoices({ silent: true });
      fetchStats();
    } catch (err: any) {
      setError(err.message || 'Failed to generate line items');
    } finally {
      setActionLoading('');
    }
  };

  const handleAddPayment = async () => {
    if (!selectedInvoice || !paymentForm.amount || !paymentForm.payment_date) return;
    setPaymentSaving(true);
    try {
      await apiFetch(`/invoices/${selectedInvoice.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ ...paymentForm, amount: parseFloat(paymentForm.amount) }),
      });
      await fetchDetail(selectedInvoice.id);
      fetchInvoices({ silent: true });
      fetchStats();
      setShowPaymentForm(false);
      setPaymentForm({ amount: '', payment_date: localToday(), payment_method: 'check', reference_number: '', notes: '' });
    } catch (err: any) {
      setError(err.message || 'Failed to record payment');
    } finally {
      setPaymentSaving(false);
    }
  };

  const handleDeletePayment = async (paymentId: number) => {
    if (!selectedInvoice) return;
    setActionLoading(`delpay-${paymentId}`);
    try {
      await apiFetch(`/invoices/${selectedInvoice.id}/payments/${paymentId}`, { method: 'DELETE' });
      await fetchDetail(selectedInvoice.id);
      fetchInvoices({ silent: true });
      fetchStats();
    } catch (err: any) {
      setError(err.message || 'Failed to delete payment');
    } finally {
      setActionLoading('');
    }
  };

  const handleAddLineItem = async () => {
    if (!selectedInvoice || !lineItemForm.description) return;
    setLineItemSaving(true);
    try {
      await apiFetch(`/invoices/${selectedInvoice.id}/line-items`, {
        method: 'POST',
        body: JSON.stringify({
          ...lineItemForm,
          quantity: parseFloat(lineItemForm.quantity) || 1,
          unit_price: parseFloat(lineItemForm.unit_price) || 0,
        }),
      });
      await fetchDetail(selectedInvoice.id);
      fetchInvoices({ silent: true });
      fetchStats();
      setShowLineItemForm(false);
      setLineItemForm({ line_type: 'custom', description: '', quantity: '1', unit_price: '0' });
    } catch (err: any) {
      setError(err.message || 'Failed to add line item');
    } finally {
      setLineItemSaving(false);
    }
  };

  const handleDeleteLineItem = async (itemId: number) => {
    if (!selectedInvoice) return;
    setActionLoading(`delitem-${itemId}`);
    try {
      await apiFetch(`/invoices/${selectedInvoice.id}/line-items/${itemId}`, { method: 'DELETE' });
      await fetchDetail(selectedInvoice.id);
      fetchInvoices({ silent: true });
      fetchStats();
    } catch (err: any) {
      setError(err.message || 'Failed to delete line item');
    } finally {
      setActionLoading('');
    }
  };

  const selectInvoice = (inv: Invoice) => {
    fetchDetail(inv.id);
    setMode('detail');
    setShowPaymentForm(false);
    setShowLineItemForm(false);
  };

  const backToList = () => {
    setMode('list');
    setSelectedInvoice(null);
  };

  // ── Debounced search ─────────────────────────────────────

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setPage(1), 400);
  };

  // ── Status action buttons for detail view ────────────────

  const getStatusActions = (inv: InvoiceDetail) => {
    const actions: { label: string; status: string; icon: React.ElementType; cls: string }[] = [];
    const s = inv.status;
    if (s === 'draft') {
      actions.push({ label: 'Mark Sent', status: 'sent', icon: Send, cls: 'bg-blue-600 hover:bg-blue-500' });
      actions.push({ label: 'Void', status: 'void', icon: Ban, cls: 'bg-red-900/60 hover:bg-red-800/60' });
    } else if (s === 'sent' || s === 'overdue') {
      actions.push({ label: 'Mark Paid', status: 'paid', icon: Check, cls: 'bg-green-700 hover:bg-green-600' });
      actions.push({ label: 'Void', status: 'void', icon: Ban, cls: 'bg-red-900/60 hover:bg-red-800/60' });
    } else if (s === 'partial') {
      actions.push({ label: 'Mark Paid', status: 'paid', icon: Check, cls: 'bg-green-700 hover:bg-green-600' });
      actions.push({ label: 'Void', status: 'void', icon: Ban, cls: 'bg-red-900/60 hover:bg-red-800/60' });
    }
    return actions;
  };

  // ── Render helpers ───────────────────────────────────────

  const StatusBadge = ({ status }: { status: string }) => (
    <span className={`inline-flex items-center px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border ${STATUS_BADGE[status] || 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/40'}`} style={{ borderRadius: '2px' }}>
      {toDisplayLabel(status)}
    </span>
  );

  // ── Stats bar ────────────────────────────────────────────

  const StatsBar = () => {
    if (!stats) return null;
    const items = [
      { label: 'Total', value: stats.total_invoices, color: 'text-rmpg-300' },
      { label: 'Outstanding', value: formatCurrency(stats.total_outstanding), color: 'text-amber-400' },
      { label: 'Collected', value: formatCurrency(stats.total_collected), color: 'text-green-400' },
      { label: 'Overdue', value: stats.overdue_count, color: 'text-red-400' },
      { label: 'Drafts', value: stats.draft_count, color: 'text-rmpg-400' },
    ];
    return (
      <div className="flex items-center gap-4 px-3 py-1.5 bg-[#0c0c0c] border border-[#2b2b2b] text-[10px]" style={{ borderRadius: '2px' }}>
        {items.map((it, i) => (
          <React.Fragment key={it.label}>
            {i > 0 && <div className="w-px h-3.5 bg-[#2b2b2b]" />}
            <div className="flex items-center gap-1.5">
              <span className="text-rmpg-500 uppercase tracking-wider font-bold">{it.label}</span>
              <span className={`font-mono font-bold tabular-nums ${it.color}`}>{it.value}</span>
            </div>
          </React.Fragment>
        ))}
      </div>
    );
  };

  // ── Create form panel ────────────────────────────────────

  const CreatePanel = () => (
    <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <Plus size={14} className="text-brand-400" /> New Invoice
        </h2>
        <button type="button" onClick={() => { setMode('list'); setSaveError(''); }} className="text-rmpg-400 hover:text-white text-xs">Cancel</button>
      </div>

      {saveError && (
        <div className="p-2 bg-red-900/30 border border-red-700/50 rounded-sm text-red-300 text-xs flex items-center gap-2">
          <AlertTriangle size={12} /> {saveError}
        </div>
      )}

      <div className="card-glass p-4 space-y-3">
        {/* Client */}
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-rmpg-400 mb-1">Client *</label>
          <select
            value={createForm.client_id}
            onChange={e => setCreateForm(f => ({ ...f, client_id: e.target.value }))}
            className="w-full bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 focus:outline-none"
          >
            <option value="">-- Select Client --</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Billing period */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-rmpg-400 mb-1">Period Start *</label>
            <input
              type="date"
              value={createForm.period_start}
              onChange={e => setCreateForm(f => ({ ...f, period_start: e.target.value }))}
              className="w-full bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-rmpg-400 mb-1">Period End *</label>
            <input
              type="date"
              value={createForm.period_end}
              onChange={e => setCreateForm(f => ({ ...f, period_end: e.target.value }))}
              className="w-full bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 focus:outline-none"
            />
          </div>
        </div>

        {/* Issue date */}
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-rmpg-400 mb-1">Issue Date</label>
          <input
            type="date"
            value={createForm.issue_date}
            onChange={e => setCreateForm(f => ({ ...f, issue_date: e.target.value }))}
            className="w-full bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 focus:outline-none"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-rmpg-400 mb-1">Notes</label>
          <textarea
            value={createForm.notes}
            onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))}
            rows={2}
            className="w-full bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 focus:outline-none resize-none"
          />
        </div>

        {/* Internal notes */}
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-rmpg-400 mb-1">Internal Notes</label>
          <textarea
            value={createForm.internal_notes}
            onChange={e => setCreateForm(f => ({ ...f, internal_notes: e.target.value }))}
            rows={2}
            className="w-full bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 focus:outline-none resize-none"
          />
        </div>

        <button type="button"
          onClick={handleCreate}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold py-2 px-4 rounded-sm disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Create Invoice
        </button>
      </div>
    </div>
  );

  // ── Detail panel ─────────────────────────────────────────

  const DetailPanel = () => {
    if (detailLoading) {
      return (
        <div className="flex-1 flex items-center justify-center gap-2">
          <Loader2 size={20} className="animate-spin text-brand-400" />
          <span className="text-xs text-rmpg-400">Loading invoice details...</span>
        </div>
      );
    }
    if (!selectedInvoice) return null;
    const inv = selectedInvoice;
    const statusActions = getStatusActions(inv);

    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              {isMobile && (
                <button type="button" onClick={backToList} className="text-rmpg-400 hover:text-white mr-1">
                  <ChevronLeft size={16} />
                </button>
              )}
              <h2 className="text-sm font-bold text-white font-mono">{inv.invoice_number}</h2>
              <StatusBadge status={inv.status} />
            </div>
            <p className="text-xs text-rmpg-400 mt-0.5">{inv.client_name}</p>
          </div>
          <button type="button" onClick={backToList} className="text-rmpg-500 hover:text-white text-xs hidden md:block">
            <X size={14} />
          </button>
        </div>

        {/* Action buttons */}
        {canEdit && statusActions.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {statusActions.map(a => (
              <button type="button"
                key={a.status}
                onClick={() => handleStatusChange(inv.id, a.status)}
                disabled={actionLoading === `status-${inv.id}`}
                className={`flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white rounded-sm transition-colors ${a.cls} disabled:opacity-50`}
              >
                {actionLoading === `status-${inv.id}` ? <Loader2 size={10} className="animate-spin" /> : <a.icon size={10} />}
                {a.label}
              </button>
            ))}
            {inv.status === 'draft' && (
              <button type="button"
                onClick={() => handleGenerate(inv.id)}
                disabled={actionLoading === `generate-${inv.id}`}
                className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300 bg-amber-900/40 hover:bg-amber-900/60 border border-amber-700/50 rounded-sm transition-colors disabled:opacity-50"
              >
                {actionLoading === `generate-${inv.id}` ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
                Auto-Generate Items
              </button>
            )}
          </div>
        )}

        {/* Invoice info */}
        <div className="card-glass p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-brand-400 font-bold mb-1">Invoice Details</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div className="text-rmpg-500">Issue Date</div>
            <div className="text-white">{formatDate(inv.issue_date) || inv.issue_date}</div>
            <div className="text-rmpg-500">Due Date</div>
            <div className="text-white">{formatDate(inv.due_date) || inv.due_date}</div>
            <div className="text-rmpg-500">Period</div>
            <div className="text-white">{inv.period_start} to {inv.period_end}</div>
            <div className="text-rmpg-500">Payment Terms</div>
            <div className="text-white">{inv.payment_terms || 'Net 30'}</div>
            <div className="text-rmpg-500">Billing Email</div>
            <div className="text-white truncate">{inv.billing_email || '--'}</div>
          </div>
        </div>

        {/* Financial summary */}
        <div className="card-glass p-3">
          <div className="text-[10px] uppercase tracking-wider text-brand-400 font-bold mb-2">Financial Summary</div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-rmpg-400">Subtotal</span><span className="text-white font-mono">{formatCurrency(inv.subtotal)}</span></div>
            {inv.discount_amount > 0 && (
              <div className="flex justify-between"><span className="text-rmpg-400">Discount</span><span className="text-red-400 font-mono">-{formatCurrency(inv.discount_amount)}</span></div>
            )}
            {inv.late_fee_amount > 0 && (
              <div className="flex justify-between"><span className="text-rmpg-400">Late Fee</span><span className="text-amber-400 font-mono">+{formatCurrency(inv.late_fee_amount)}</span></div>
            )}
            <div className="border-t border-[#2b2b2b] my-1" />
            <div className="flex justify-between font-bold"><span className="text-rmpg-300">Total</span><span className="text-white font-mono">{formatCurrency(inv.total)}</span></div>
            <div className="flex justify-between"><span className="text-rmpg-400">Paid</span><span className="text-green-400 font-mono">{formatCurrency(inv.amount_paid)}</span></div>
            <div className="border-t border-[#2b2b2b] my-1" />
            <div className="flex justify-between font-bold"><span className="text-rmpg-300">Balance Due</span><span className={`font-mono ${inv.balance_due > 0 ? 'text-amber-400' : 'text-green-400'}`}>{formatCurrency(inv.balance_due)}</span></div>
          </div>
        </div>

        {/* Line items */}
        <div className="card-glass p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider text-brand-400 font-bold">Line Items ({inv.line_items?.length || 0})</div>
            {canEdit && inv.status === 'draft' && (
              <button type="button"
                onClick={() => setShowLineItemForm(!showLineItemForm)}
                className="flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300"
              >
                <Plus size={10} /> Add
              </button>
            )}
          </div>

          {/* Add line item form */}
          {showLineItemForm && (
            <div className="mb-3 p-2 bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm space-y-2">
              <select
                value={lineItemForm.line_type}
                onChange={e => setLineItemForm(f => ({ ...f, line_type: e.target.value }))}
                className="w-full bg-[#141414] border border-[#2b2b2b] rounded-sm px-2 py-1 text-xs text-white"
              >
                <option value="custom">Custom</option>
                <option value="service_hours">Service Hours</option>
                <option value="dispatch_call">Dispatch Call</option>
                <option value="incident_response">Incident Response</option>
                <option value="late_fee">Late Fee</option>
                <option value="discount">Discount</option>
              </select>
              <input
                type="text"
                placeholder="Description"
                value={lineItemForm.description}
                onChange={e => setLineItemForm(f => ({ ...f, description: e.target.value }))}
                className="w-full bg-[#141414] border border-[#2b2b2b] rounded-sm px-2 py-1 text-xs text-white"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  placeholder="Qty"
                  value={lineItemForm.quantity}
                  onChange={e => setLineItemForm(f => ({ ...f, quantity: e.target.value }))}
                  className="bg-[#141414] border border-[#2b2b2b] rounded-sm px-2 py-1 text-xs text-white"
                />
                <input
                  type="number"
                  placeholder="Unit Price"
                  value={lineItemForm.unit_price}
                  onChange={e => setLineItemForm(f => ({ ...f, unit_price: e.target.value }))}
                  className="bg-[#141414] border border-[#2b2b2b] rounded-sm px-2 py-1 text-xs text-white"
                />
              </div>
              <div className="flex items-center gap-2">
                <button type="button"
                  onClick={handleAddLineItem}
                  disabled={lineItemSaving}
                  className="flex-1 flex items-center justify-center gap-1 bg-brand-600 hover:bg-brand-500 text-white text-[10px] font-bold py-1 rounded-sm disabled:opacity-50"
                >
                  {lineItemSaving ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} Add Item
                </button>
                <button type="button" onClick={() => setShowLineItemForm(false)} className="text-rmpg-500 hover:text-white text-[10px]">Cancel</button>
              </div>
            </div>
          )}

          {/* Line items table */}
          {inv.line_items && inv.line_items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-[#0c0c0c]">
                  <tr className="text-[9px] uppercase tracking-wider text-rmpg-500 border-b border-[#2b2b2b]">
                    <th className="text-left pb-1 pr-2">Type</th>
                    <th className="text-left pb-1 pr-2">Description</th>
                    <th className="text-right pb-1 pr-2">Qty</th>
                    <th className="text-right pb-1 pr-2">Rate</th>
                    <th className="text-right pb-1">Amount</th>
                    {canEdit && inv.status === 'draft' && <th className="w-6" />}
                  </tr>
                </thead>
                <tbody>
                  {inv.line_items.map(item => (
                    <tr key={item.id} className="border-b border-[#2b2b2b]/50 hover:bg-[#181818]/50 transition-colors">
                      <td className="py-1 pr-2">
                        <span className="text-[9px] text-rmpg-400">{LINE_TYPE_LABELS[item.line_type] || item.line_type}</span>
                      </td>
                      <td className="py-1 pr-2 text-white max-w-[200px] truncate" title={item.description}>{item.description}</td>
                      <td className="py-1 pr-2 text-right text-rmpg-300 font-mono">{item.quantity}</td>
                      <td className="py-1 pr-2 text-right text-rmpg-300 font-mono">{formatCurrency(item.unit_price)}</td>
                      <td className={`py-1 text-right font-mono font-bold ${item.line_type === 'discount' ? 'text-red-400' : 'text-white'}`}>
                        {formatCurrency(item.amount)}
                      </td>
                      {canEdit && inv.status === 'draft' && (
                        <td className="py-1 pl-1">
                          <button type="button"
                            onClick={() => handleDeleteLineItem(item.id)}
                            disabled={actionLoading === `delitem-${item.id}`}
                            className="text-rmpg-600 hover:text-red-400 transition-colors"
                          >
                            {actionLoading === `delitem-${item.id}` ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-rmpg-500 text-center py-3">No line items yet. {canEdit && inv.status === 'draft' ? 'Click + Add to create one.' : ''}</p>
          )}
        </div>

        {/* Payments */}
        <div className="card-glass p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider text-brand-400 font-bold">Payments ({inv.payments?.length || 0})</div>
            {canEdit && inv.status !== 'draft' && inv.status !== 'void' && inv.status !== 'cancelled' && (
              <button type="button"
                onClick={() => setShowPaymentForm(!showPaymentForm)}
                className="flex items-center gap-1 text-[10px] text-green-400 hover:text-green-300"
              >
                <CreditCard size={10} /> Record Payment
              </button>
            )}
          </div>

          {/* Payment form */}
          {showPaymentForm && (
            <div className="mb-3 p-2 bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  placeholder="Amount"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))}
                  className="bg-[#141414] border border-[#2b2b2b] rounded-sm px-2 py-1 text-xs text-white"
                />
                <input
                  type="date"
                  value={paymentForm.payment_date}
                  onChange={e => setPaymentForm(f => ({ ...f, payment_date: e.target.value }))}
                  className="bg-[#141414] border border-[#2b2b2b] rounded-sm px-2 py-1 text-xs text-white"
                />
              </div>
              <div className={`grid ${paymentForm.payment_method === 'check' ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
                <select
                  value={paymentForm.payment_method}
                  onChange={e => setPaymentForm(f => ({ ...f, payment_method: e.target.value }))}
                  className="bg-[#141414] border border-[#2b2b2b] rounded-sm px-2 py-1 text-xs text-white"
                >
                  {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                {paymentForm.payment_method === 'check' && (
                  <input
                    type="text"
                    placeholder="Check #"
                    value={paymentForm.reference_number}
                    onChange={e => setPaymentForm(f => ({ ...f, reference_number: e.target.value }))}
                    className="bg-[#141414] border border-[#2b2b2b] rounded-sm px-2 py-1 text-xs text-white"
                  />
                )}
                <input
                  type="text"
                  placeholder={paymentForm.payment_method === 'check' ? 'Notes' : 'Reference #'}
                  value={paymentForm.payment_method === 'check' ? paymentForm.notes : paymentForm.reference_number}
                  onChange={e => {
                    if (paymentForm.payment_method === 'check') {
                      setPaymentForm(f => ({ ...f, notes: e.target.value }));
                    } else {
                      setPaymentForm(f => ({ ...f, reference_number: e.target.value }));
                    }
                  }}
                  className="bg-[#141414] border border-[#2b2b2b] rounded-sm px-2 py-1 text-xs text-white"
                />
              </div>
              <input
                type="text"
                placeholder="Notes (optional)"
                value={paymentForm.notes}
                onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full bg-[#141414] border border-[#2b2b2b] rounded-sm px-2 py-1 text-xs text-white"
              />
              <div className="flex items-center gap-2">
                <button type="button"
                  onClick={handleAddPayment}
                  disabled={paymentSaving}
                  className="flex-1 flex items-center justify-center gap-1 bg-green-700 hover:bg-green-600 text-white text-[10px] font-bold py-1 rounded-sm disabled:opacity-50"
                >
                  {paymentSaving ? <Loader2 size={10} className="animate-spin" /> : <CreditCard size={10} />} Record Payment
                </button>
                <button type="button" onClick={() => setShowPaymentForm(false)} className="text-rmpg-500 hover:text-white text-[10px]">Cancel</button>
              </div>
            </div>
          )}

          {/* Payments list */}
          {inv.payments && inv.payments.length > 0 ? (
            <div className="space-y-1">
              {inv.payments.map(pay => (
                <div key={pay.id} className="flex items-center justify-between py-1 border-b border-[#2b2b2b]/50 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-green-400 font-mono font-bold">{formatCurrency(pay.amount)}</span>
                    <span className="text-rmpg-500">{formatDate(pay.payment_date) || pay.payment_date}</span>
                    {pay.payment_method && (
                      <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 border ${PAYMENT_METHOD_COLORS[pay.payment_method] || PAYMENT_METHOD_COLORS.other}`}>
                        {PAYMENT_METHODS.find(m => m.value === pay.payment_method)?.icon || pay.payment_method}
                      </span>
                    )}
                    {pay.reference_number && <span className="text-rmpg-600 font-mono">#{pay.reference_number}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-rmpg-600 text-[10px]">{pay.recorded_by_name}</span>
                    {canEdit && (
                      <button type="button"
                        onClick={() => handleDeletePayment(pay.id)}
                        disabled={actionLoading === `delpay-${pay.id}`}
                        className="text-rmpg-600 hover:text-red-400 transition-colors"
                      >
                        {actionLoading === `delpay-${pay.id}` ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-rmpg-500 text-center py-3">No payments recorded yet.</p>
          )}
        </div>

        {/* Notes */}
        {(inv.notes || inv.internal_notes) && (
          <div className="card-glass p-3 space-y-2">
            {inv.notes && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-rmpg-500 mb-0.5">Notes</div>
                <p className="text-xs text-rmpg-300 whitespace-pre-wrap">{inv.notes}</p>
              </div>
            )}
            {inv.internal_notes && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-rmpg-500 mb-0.5">Internal Notes</div>
                <p className="text-xs text-amber-300/70 whitespace-pre-wrap">{inv.internal_notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Metadata */}
        <div className="text-[10px] text-rmpg-600 space-y-0.5">
          <div>Created by {inv.created_by_name} on {formatDate(inv.created_at) || inv.created_at}</div>
          {inv.sent_at && <div>Sent {formatDate(inv.sent_at) || inv.sent_at}</div>}
          {inv.paid_date && <div>Paid {formatDate(inv.paid_date) || inv.paid_date}</div>}
        </div>
      </div>
    );
  };

  // ── Invoice list row ─────────────────────────────────────

  const InvoiceRow = ({ inv }: { inv: Invoice }) => {
    const isSelected = selectedInvoice?.id === inv.id;
    return (
      <tr
        onClick={() => selectInvoice(inv)}
        className={`cursor-pointer border-b border-[#2b2b2b]/40 transition-colors text-xs ${
          isSelected
            ? 'bg-brand-900/30 border-l-2 border-l-brand-500'
            : 'hover:bg-[#181818]/60'
        }`}
      >
        <td className="py-1.5 px-2 font-mono text-brand-300 whitespace-nowrap">{inv.invoice_number}</td>
        <td className="py-1.5 px-2 text-white truncate max-w-[140px]">{inv.client_name}</td>
        <td className="py-1.5 px-2"><StatusBadge status={inv.status} /></td>
        <td className="py-1.5 px-2 text-right font-mono text-white tabular-nums">{formatCurrency(inv.total)}</td>
        <td className="py-1.5 px-2 text-right font-mono text-rmpg-300 hidden lg:table-cell tabular-nums">{formatCurrency(inv.balance_due)}</td>
        <td className="py-1.5 px-2 text-rmpg-400 whitespace-nowrap hidden md:table-cell">{inv.due_date}</td>
        <td className="py-1.5 px-2 text-rmpg-500 whitespace-nowrap hidden xl:table-cell">{inv.issue_date}</td>
      </tr>
    );
  };

  // ── Main render ──────────────────────────────────────────

  // Set document title
  useEffect(() => { document.title = 'Invoices \u2014 RMPG Flex'; }, []);

  // Mobile: show either list or detail
  if (isMobile) {
    return (
      <div className="app-grid-bg h-full flex flex-col">
        {mode === 'detail' && selectedInvoice ? (
          <DetailPanel />
        ) : mode === 'create' ? (
          <CreatePanel />
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="p-2 space-y-2 border-b border-[#2b2b2b]">
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" />
                  <input
                    type="text"
                    placeholder="Search invoices..." aria-label="Search invoices..."
                    value={searchQuery}
                    onChange={e => handleSearchChange(e.target.value)}
                    className="w-full bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm pl-7 pr-2 py-1.5 text-xs text-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 focus:outline-none"
                  />
                </div>
                {canEdit && (
                  <button type="button"
                    onClick={() => setMode('create')}
                    className="flex items-center gap-1 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold px-3 py-1.5 rounded-sm"
                  >
                    <Plus size={12} /> New
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={filterStatus}
                  onChange={e => { setFilterStatus(e.target.value as any); setPage(1); }}
                  className="bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm px-2 py-1 text-xs text-white"
                >
                  {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent">
              {loading ? (
                <div className="flex items-center justify-center gap-2 h-32"><Loader2 size={20} className="animate-spin text-brand-400" /><span className="text-xs text-rmpg-400">Loading invoices...</span></div>
              ) : error ? (
                <div className="p-4 text-red-400 text-xs">{error}</div>
              ) : invoices.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-rmpg-500"><DollarSign size={32} className="mb-2 opacity-30" /><p className="text-xs">No invoices found</p></div>
              ) : (
                <div className="divide-y divide-[#2b2b2b]/40">
                  {invoices.map(inv => (
                    <div
                      key={inv.id}
                      onClick={() => selectInvoice(inv)}
                      className="p-2 hover:bg-[#181818]/60 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-brand-300">{inv.invoice_number}</span>
                        <StatusBadge status={inv.status} />
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-white truncate">{inv.client_name}</span>
                        <span className="text-xs font-mono text-white">{formatCurrency(inv.total)}</span>
                      </div>
                      <div className="text-[10px] text-rmpg-500 mt-0.5">Due {inv.due_date}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Desktop: split panel
  return (
    <div className="app-grid-bg h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-3 py-1.5 border-b border-[#2b2b2b] flex-shrink-0">
        <div className="flex items-center gap-2">
          <DollarSign size={14} className="text-brand-400" />
          <span className="text-xs font-bold text-white tracking-wide">INVOICES</span>
          <span className="text-[10px] text-rmpg-500 font-mono">({totalCount})</span>
          {stats && stats.overdue_count > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 bg-red-900/60 text-red-300 border border-red-700/50 rounded-sm">
              {stats.overdue_count} OVERDUE
            </span>
          )}
        </div>
        <StatsBar />
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { fetchInvoices(); fetchStats(); }} className="text-rmpg-400 hover:text-white p-1 transition-colors" title="Refresh" aria-label="Refresh">
            <RefreshCw size={12} />
          </button>
          {canEdit && (
            <button type="button"
              onClick={() => { setMode('create'); setSelectedInvoice(null); }}
              className="flex items-center gap-1 bg-brand-600 hover:bg-brand-500 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-sm transition-colors"
            >
              <Plus size={10} /> New Invoice
            </button>
          )}
        </div>
      </div>

      {/* Filters bar */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-[#2b2b2b]/60 flex-shrink-0 bg-[#0c0c0c]/50">
        <Filter size={10} className="text-rmpg-500" />
        <div className="relative flex-1 max-w-xs">
          <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" />
          <input
            type="text"
            placeholder="Search..." aria-label="Search..."
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
            className="w-full bg-[#141414] border border-[#2b2b2b] rounded-sm pl-6 pr-2 py-1 text-[11px] text-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 focus:outline-none"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => { setFilterStatus(e.target.value as any); setPage(1); }}
          className="bg-[#141414] border border-[#2b2b2b] rounded-sm px-2 py-1 text-[11px] text-white focus:outline-none focus:border-brand-500 transition-colors"
        >
          {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select
          value={filterClientId}
          onChange={e => { setFilterClientId(e.target.value); setPage(1); }}
          className="bg-[#141414] border border-[#2b2b2b] rounded-sm px-2 py-1 text-[11px] text-white focus:outline-none focus:border-brand-500 transition-colors max-w-[160px]"
        >
          <option value="">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={e => { setDateFrom(e.target.value); setPage(1); }}
          placeholder="From"
          className="bg-[#141414] border border-[#2b2b2b] rounded-sm px-2 py-1 text-[11px] text-white focus:outline-none"
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => { setDateTo(e.target.value); setPage(1); }}
          placeholder="To"
          className="bg-[#141414] border border-[#2b2b2b] rounded-sm px-2 py-1 text-[11px] text-white focus:outline-none"
        />
        {(filterStatus || filterClientId || dateFrom || dateTo || searchQuery) && (
          <button type="button"
            onClick={() => { setFilterStatus(''); setFilterClientId(''); setDateFrom(''); setDateTo(''); setSearchQuery(''); setPage(1); }}
            className="text-rmpg-500 hover:text-red-400 text-[10px] flex items-center gap-0.5 px-1.5 py-0.5 hover:bg-red-900/20 border border-transparent hover:border-red-700/30 transition-colors"
          >
            <X size={10} /> Clear All
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1.5 bg-red-900/30 border-b border-red-700/50 text-red-300 text-xs flex items-center gap-2">
          <AlertTriangle size={12} /> {error}
          <button type="button" onClick={() => setError('')} className="ml-auto text-red-400 hover:text-white"><X size={12} /></button>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: invoice list */}
        <div className="flex flex-col w-[55%] border-r border-[#2b2b2b] overflow-hidden">
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent">
            {loading ? (
              <div className="flex items-center justify-center gap-2 h-32"><Loader2 size={20} className="animate-spin text-brand-400" /><span className="text-xs text-rmpg-400">Loading invoices...</span></div>
            ) : invoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-rmpg-500 text-xs">
                <div className="w-12 h-12 mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
                  <FileText size={20} className="text-rmpg-600" />
                </div>
                <p className="font-medium text-rmpg-400">No invoices found</p>
                <p className="text-[10px] text-rmpg-600 mt-1">Try adjusting your filters</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-[#0c0c0c] z-10">
                  <tr className="text-[9px] uppercase tracking-wider text-rmpg-500 border-b border-[#2b2b2b]">
                    <th className="text-left py-1 px-2">Invoice #</th>
                    <th className="text-left py-1 px-2">Client</th>
                    <th className="text-left py-1 px-2">Status</th>
                    <th className="text-right py-1 px-2">Total</th>
                    <th className="text-right py-1 px-2 hidden lg:table-cell">Balance</th>
                    <th className="text-left py-1 px-2 hidden md:table-cell">Due Date</th>
                    <th className="text-left py-1 px-2 hidden xl:table-cell">Issued</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => <InvoiceRow key={inv.id} inv={inv} />)}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-3 py-1 border-t border-[#2b2b2b] text-[10px] text-rmpg-500 flex-shrink-0">
              <span>Page {page} of {totalPages}</span>
              <div className="flex items-center gap-1">
                <button type="button"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-0.5 hover:text-white disabled:opacity-30"
                >
                  <ChevronLeft size={12} />
                </button>
                <button type="button"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-0.5 hover:text-white disabled:opacity-30"
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: detail or create */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {mode === 'create' ? (
            <CreatePanel />
          ) : mode === 'detail' && selectedInvoice ? (
            <DetailPanel />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-rmpg-500">
              <Eye size={24} className="mb-2 opacity-30" />
              <p className="text-xs">Select an invoice to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

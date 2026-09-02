// ============================================================
// RMPG Flex — Billing & Financial dashboard (Page 85 of the
// full-app frontend audit pass)
// ============================================================
// Lightweight invoice dashboard. The deeper invoice surface
// (line items, payments, status transitions) lives in
// InvoicesPage; BillingPage is intentionally simpler — a
// stats-tile + invoice grid for operators who just want to
// glance at outstanding balances and create/edit/delete an
// invoice record.
//
// Audit upgrades (v1108):
// - URL deep-link: ?invoice_id=N opens the edit form; ?status=
//   and ?client_id= filter the grid. Params are stripped after
//   apply (matches the FlexCam / CodeEnforcement pattern).
// - Status filter dropdown + clear button (was filterless before).
// - Native delete confirm replaced with shared ConfirmDialog
//   so a11y / focus / Esc / details surface match other pages.
// - PDF download per invoice via the row context menu (and a
//   per-row action button) — fetches line items + payments
//   from /billing/* and feeds generateInvoicePdf, the same
//   generator AdminInvoiceTab uses.
// - Esc smart-cascade: form → delete confirm → filter clear.
// - `N` keyboard shortcut opens New Invoice (skips when typing
//   in any field, mirrors CodeEnforcement / ShiftPlans).
// - Overdue chip: status='sent'/'partial' and due_date < today
//   surfaces a red OVERDUE pill alongside the status badge.
// - Distinct empty states: filter-cleared "no invoices yet" vs
//   filter-applied "no matches" with a Clear-filters button.
// - Theme tokens replace the two hardcoded delete-modal hex
//   values (var(--sev-critical) / var(--sev-critical-soft)) — ConfirmDialog already uses
//   the rmpg/red theme tokens.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { importWithRetry } from '../utils/importWithRetry';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import BillingFormModal, { BillingFormData } from '../components/BillingFormModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import { localToday } from '../utils/dateUtils';
import { DollarSign, FileText, Clock, Receipt, Plus, Pencil, Trash2, Download, AlertTriangle, X } from 'lucide-react';
import { toDisplayLabel } from '../utils/formatters';
import { invoicesToCsv, downloadTextFile } from '../utils/rmsListExport';

type Invoice = Record<string, any> & { id: number; invoice_number?: string; status?: string; due_date?: string | null };

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'void', label: 'Void' },
  { value: 'cancelled', label: 'Cancelled' },
];

// Local YYYY-MM-DD (Denver) for overdue comparisons — server stores due_date
// as a plain date string, so we compare lexicographically.
function isOverdue(inv: Invoice): boolean {
  const s = inv.status;
  if (s !== 'sent' && s !== 'partial') return false;
  const due = (inv.due_date || '').toString().slice(0, 10);
  if (!due) return false;
  return due < localToday();
}

export default function BillingPage() {
  const m = useMenuActions();
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'manager';
  const [searchParams, setSearchParams] = useSearchParams();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ active_contracts: 0, outstanding_invoices: 0, total_outstanding_amount: 0, pending_expenses: 0 });
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Invoice | undefined>(undefined);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusyId, setPdfBusyId] = useState<number | null>(null);
  const { addToast } = useToast();

  // ── Filters (hydrate from URL once on mount) ────────────────
  const [filterStatus, setFilterStatus] = useState<string>(() => searchParams.get('status') || '');
  const [filterClientId, setFilterClientId] = useState<string>(() => searchParams.get('client_id') || '');

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const r = await apiFetch<{ data: Invoice[] }>('/billing/invoices');
      setInvoices(r.data || []);
      const s = await apiFetch<{ active_contracts: number; outstanding_invoices: number; total_outstanding_amount: number; pending_expenses: number }>('/billing/stats');
      setStats(s);
    } catch { setError('Failed to load data'); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);

  const openNew = useCallback(() => { setEditingRecord(undefined); setFormError(null); setFormOpen(true); }, []);
  const openEdit = useCallback((rec: Invoice) => { setEditingRecord(rec); setFormError(null); setFormOpen(true); }, []);

  // ── URL deep-link: ?invoice_id=N opens edit form for that row ──
  // One-shot per page load (param is stripped after applying).
  // Falls back to a one-time error toast if the id is unknown — the
  // matching invoice may have been deleted or belong to another
  // visibility scope. Mirrors the FlexCam / CodeEnforcement pattern.
  const pendingInvoiceIdRef = useRef<string | null>(searchParams.get('invoice_id'));
  useEffect(() => {
    const target = pendingInvoiceIdRef.current;
    if (!target || loading) return;
    pendingInvoiceIdRef.current = null;
    const numericId = Number(target);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      addToast(`Invoice #${target} not found`, 'error');
    } else {
      const hit = invoices.find((inv) => Number(inv.id) === numericId);
      if (hit) {
        openEdit(hit);
      } else {
        addToast(`Invoice #${target} not in current view`, 'error');
      }
    }
    // Strip the param so a manual refresh doesn't re-open the form.
    const next = new URLSearchParams(searchParams);
    next.delete('invoice_id');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, loading]);

  // Persist filter changes back into the URL so the view is sharable.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (filterStatus) next.set('status', filterStatus); else next.delete('status');
    if (filterClientId) next.set('client_id', filterClientId); else next.delete('client_id');
    const a = next.toString();
    const b = searchParams.toString();
    if (a !== b) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterClientId]);

  const handleSubmit = async (data: BillingFormData) => {
    setFormSubmitting(true); setFormError(null);
    try {
      const body: Record<string, any> = { ...data };
      if (body.client_id) body.client_id = parseInt(body.client_id);
      if (body.contract_id) body.contract_id = parseInt(body.contract_id);
      if (body.tax_rate) body.tax_rate = parseFloat(body.tax_rate);
      if (editingRecord) {
        await apiFetch(`/billing/invoices/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/billing/invoices', { method: 'POST', body: JSON.stringify(body) });
      }
      setFormOpen(false); setEditingRecord(undefined); fetchData();
      addToast(editingRecord ? 'Invoice updated' : 'Invoice created', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setFormError(msg); addToast(msg, 'error');
    } finally { setFormSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await apiFetch(`/billing/invoices/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null); fetchData(); addToast('Invoice deleted', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
    finally { setDeleting(false); }
  };

  // ── PDF download ─────────────────────────────────────────────
  // BillingPage's /billing/invoices feed returns invoice headers only.
  // To assemble a usable invoice document we pull line items + payments
  // from their dedicated endpoints, then hand the merged shape to
  // generateInvoicePdf (the same generator AdminInvoiceTab uses).
  const handleDownloadPdf = useCallback(async (inv: Invoice) => {
    if (!inv?.id) return;
    setPdfBusyId(inv.id);
    try {
      const [items, payments] = await Promise.all([
        apiFetch<{ data: any[] }>(`/billing/invoices/${inv.id}/items`).catch(() => ({ data: [] })),
        apiFetch<{ data: any[] }>(`/billing/payments?invoice_id=${inv.id}`).catch(() => ({ data: [] })),
      ]);
      const { generateInvoicePdf } = await importWithRetry(() => import('../utils/invoicePdfGenerator'));
      const pdfData = {
        invoice_number: String(inv.invoice_number || `INV-${inv.id}`),
        status: String(inv.status || 'draft'),
        client_name: inv.client_name || '',
        period_start: inv.issue_date || '',
        period_end: inv.due_date || '',
        issue_date: inv.issue_date || '',
        due_date: inv.due_date || '',
        payment_terms: 'Net 30',
        subtotal: Number(inv.subtotal || 0),
        discount_amount: 0,
        tax_amount: Number(inv.tax_amount || 0),
        late_fee_amount: 0,
        total: Number(inv.total_amount || 0),
        amount_paid: Number(inv.paid_amount || 0),
        balance_due: Math.max(0, Number(inv.total_amount || 0) - Number(inv.paid_amount || 0)),
        notes: inv.notes || '',
        line_items: (items.data || []).map((it: any) => ({
          line_type: String(it.line_type || it.description_type || 'custom'),
          description: String(it.description || ''),
          quantity: Number(it.quantity || 0),
          unit_price: Number(it.unit_price || 0),
          amount: Number(it.line_total ?? it.amount ?? 0),
        })),
        payments: (payments.data || []).map((p: any) => ({
          payment_date: String(p.payment_date || ''),
          amount: Number(p.amount || 0),
          payment_method: p.payment_method || '',
          reference_number: p.reference_number || '',
        })),
      };
      const doc = await generateInvoicePdf(pdfData);
      doc.save(`${pdfData.invoice_number}.pdf`);
      addToast('Invoice PDF downloaded', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'PDF generation failed', 'error');
    } finally {
      setPdfBusyId(null);
    }
  }, [addToast]);

  // ── Filter the in-memory list ────────────────────────────────
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (filterStatus && inv.status !== filterStatus) return false;
      if (filterClientId && String(inv.client_id) !== String(filterClientId)) return false;
      return true;
    });
  }, [invoices, filterStatus, filterClientId]);

  const filtersActive = Boolean(filterStatus || filterClientId);
  const clearFilters = useCallback(() => { setFilterStatus(''); setFilterClientId(''); }, []);

  // ── Esc smart-cascade ────────────────────────────────────────
  // The BillingFormModal and ConfirmDialog own their own Esc handlers
  // (close-newest-first), so we only need to handle the page-level
  // affordance: clearing filters when nothing modal is open.
  // Also wires the `N` shortcut for New Invoice — skips while typing
  // in any field so it doesn't fire while filling the invoice form.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Each branch stops propagation so a single Esc dismisses only the
        // innermost layer (mirrors JailRecords / FlexCam / Warrants pattern).
        if (deleteId !== null) { e.stopPropagation(); setDeleteId(null); return; }
        if (formOpen) { e.stopPropagation(); setFormOpen(false); setEditingRecord(undefined); return; }
        if (filtersActive) { e.stopPropagation(); clearFilters(); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if (e.key === 'n' || e.key === 'N') {
        if (!canManage || formOpen || deleteId !== null) return;
        e.preventDefault();
        openNew();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [formOpen, deleteId, filtersActive, clearFilters, openNew, canManage]);

  const deleteTarget = deleteId !== null ? invoices.find((inv) => Number(inv.id) === deleteId) : undefined;

  const columns = [
    { key: 'invoice_number', label: 'Invoice #' },
    { key: 'client_name', label: 'Client' },
    { key: 'total_amount', label: 'Total', render: (r: any) => r.total_amount ? `$${Number(r.total_amount).toLocaleString()}` : '$0' },
    { key: 'paid_amount', label: 'Paid', render: (r: any) => r.paid_amount ? `$${Number(r.paid_amount).toLocaleString()}` : '$0' },
    { key: 'status', label: 'Status', render: (r: any) => (
      <span className="inline-flex items-center gap-1">
        <span>{toDisplayLabel(r.status)}</span>
        {isOverdue(r) && (
          <span
            title={`Due ${r.due_date}`}
            className="inline-flex items-center gap-0.5 px-1 py-[1px] text-[8px] font-bold uppercase tracking-wider border border-red-700/50 bg-red-900/40 text-red-300"
            style={{ borderRadius: 2 }}
          >
            <AlertTriangle size={8} /> Overdue
          </span>
        )}
      </span>
    ) },
    { key: 'issue_date', label: 'Issued' },
    { key: 'actions', label: '', width: '130px', render: (row: any) => (
      <div className="flex gap-2 items-center">
        <button
          onClick={(e) => { e.stopPropagation(); handleDownloadPdf(row); }}
          disabled={pdfBusyId === row.id}
          className="text-rmpg-400 hover:text-brand-300 disabled:opacity-40"
          title="Download invoice PDF"
          aria-label={`Download PDF for invoice ${row.invoice_number || row.id}`}
        ><Download size={12} /></button>
        {canManage && (
          <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="text-rmpg-400 hover:text-rmpg-100" aria-label="Edit invoice"><Pencil size={12} /></button>
        )}
        {canManage && (
          <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }} className="text-red-500 hover:text-red-300" aria-label="Delete invoice"><Trash2 size={12} /></button>
        )}
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-rmpg-400">Loading billing records...</div>;

  const emptyMessage = filtersActive
    ? 'No invoices match the current filters.'
    : canManage
      ? 'No invoices yet. Press N or click New Invoice to create one.'
      : 'No invoices yet.';

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="BILLING & FINANCIAL" icon={DollarSign}>
        {error && (
          <div className="border border-red-700/40 bg-red-900/20 text-red-400 text-[11px] px-3 py-2 mb-3 flex items-center justify-between" role="alert">
            <span>{error}</span>
            <button type="button" className="toolbar-btn" style={{ height: 26 }} onClick={() => { setLoading(true); fetchData().finally(() => setLoading(false)); }}>Retry</button>
          </div>
        )}
        {canManage && (
          <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }} title="New Invoice (N)">
            <Plus size={13} /> New Invoice
          </button>
        )}
      </PanelTitleBar>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatsCard icon={FileText} label="Active Contracts" value={stats.active_contracts} />
        <StatsCard icon={Clock} label="Outstanding" value={stats.outstanding_invoices} />
        <StatsCard icon={DollarSign} label="Total Owed" value={`$${(stats.total_outstanding_amount || 0).toLocaleString()}`} />
        <StatsCard icon={Receipt} label="Pending Expenses" value={stats.pending_expenses} />
      </div>

      {/* ── Filter bar ───────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-rmpg-500 uppercase tracking-wider">Filter:</span>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-surface-sunken border border-rmpg-700 text-rmpg-100 px-2 py-1 focus:outline-none focus:border-brand-500"
          style={{ borderRadius: 2 }}
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {filtersActive && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-0.5 px-2 py-1 text-rmpg-500 hover:text-red-400 hover:bg-red-900/20 border border-transparent hover:border-red-700/30 transition-colors"
            style={{ borderRadius: 2 }}
            title="Clear filters (Esc)"
          >
            <X size={10} /> Clear
          </button>
        )}
        <span className="text-rmpg-600 ml-auto tabular-nums">
          {filteredInvoices.length} of {invoices.length}
        </span>
        <button
          type="button"
          className="toolbar-btn"
          style={{ height: 26, padding: '0 8px' }}
          disabled={filteredInvoices.length === 0}
          onClick={() => downloadTextFile('invoices.csv', invoicesToCsv(filteredInvoices))}
        >CSV</button>
      </div>

      <DataTable
        columns={columns}
        data={filteredInvoices}
        emptyMessage={emptyMessage}
        onRowClick={canManage ? (row) => openEdit(row) : undefined}
        rowContextMenu={(row) => [
          ...(canManage ? [m.action('Open / Edit', () => openEdit(row), { icon: <Pencil size={12} /> })] : []),
          m.action('Download PDF', () => handleDownloadPdf(row), { icon: <Download size={12} /> }),
          m.separator(),
          m.copyId((row as any).id),
          m.copy('Copy invoice #', String((row as any).invoice_number || '')),
          ...(canManage ? [m.separator(), m.action('Delete', () => setDeleteId((row as any).id), { danger: true, icon: <Trash2 size={12} /> })] : []),
        ]}
      />
      <BillingFormModal isOpen={formOpen} onClose={() => { setFormOpen(false); setEditingRecord(undefined); }}
        onSubmit={handleSubmit} isSubmitting={formSubmitting} editingRecord={editingRecord} submitError={formError} />
      <ConfirmDialog
        isOpen={deleteId !== null}
        onClose={() => { if (!deleting) setDeleteId(null); }}
        onConfirm={handleDelete}
        title="Delete Invoice"
        message="This permanently removes the invoice and all of its line items + recorded payments. This cannot be undone."
        details={deleteTarget ? (
          <>
            <div><span className="text-rmpg-500">Invoice:</span> <span className="font-mono">{deleteTarget.invoice_number || `#${deleteTarget.id}`}</span></div>
            {deleteTarget.client_name && <div><span className="text-rmpg-500">Client:</span> {deleteTarget.client_name}</div>}
            {deleteTarget.total_amount != null && <div><span className="text-rmpg-500">Total:</span> ${Number(deleteTarget.total_amount).toLocaleString()}</div>}
          </>
        ) : undefined}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        confirmVariant="danger"
        isLoading={deleting}
      />
    </div>
  );
}

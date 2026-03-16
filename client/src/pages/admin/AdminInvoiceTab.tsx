import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText, Plus, ArrowLeft, Send, DollarSign, XCircle, Loader2, Trash2,
  CheckCircle, AlertCircle, Clock, RefreshCw, Download, Printer, Hash,
  CreditCard, Calendar, ChevronRight, Edit, Zap, Eye,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { toDisplayLabel } from '../../utils/formatters';
import type { Invoice, InvoiceDetail, InvoiceLineItem, Payment, InvoiceStats, Client } from '../../types';
import DocumentViewer from '../../components/DocumentViewer';
import { localToday, dateToLocalYMD } from '../../utils/dateUtils';

// ============================================================
// Props
// ============================================================

interface AdminInvoiceTabProps {
  clientId: string;
  clientName: string;
  client: Client;
}

// ============================================================
// Badge Styles
// ============================================================

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  sent: 'bg-blue-900/50 text-blue-300 border-blue-700/50',
  paid: 'bg-green-900/50 text-green-300 border-green-700/50',
  partial: 'bg-amber-900/50 text-amber-300 border-amber-700/50',
  overdue: 'bg-red-900/60 text-red-300 border-red-700/50',
  void: 'bg-rmpg-800/50 text-rmpg-500 border-rmpg-700/50 line-through',
  cancelled: 'bg-rmpg-800/50 text-rmpg-500 border-rmpg-700/50',
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  contract_base: <FileText className="w-3 h-3 text-brand-400" />,
  service_hours: <Clock className="w-3 h-3 text-blue-400" />,
  incident_response: <AlertCircle className="w-3 h-3 text-red-400" />,
  dispatch_call: <Hash className="w-3 h-3 text-amber-400" />,
  citation: <FileText className="w-3 h-3 text-purple-400" />,
  custom: <Edit className="w-3 h-3 text-rmpg-400" />,
  late_fee: <DollarSign className="w-3 h-3 text-red-400" />,
  discount: <DollarSign className="w-3 h-3 text-green-400" />,
};

function formatCurrency(n: number | undefined | null): string {
  if (n == null) return '$0.00';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ============================================================
// Component
// ============================================================

export default function AdminInvoiceTab({ clientId, clientName, client }: AdminInvoiceTabProps) {
  const [view, setView] = useState<'list' | 'detail' | 'create'>('list');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetail | null>(null);
  const [stats, setStats] = useState<InvoiceStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Create form
  const [createForm, setCreateForm] = useState({
    period_start: '',
    period_end: '',
    issue_date: localToday(),
    notes: '',
  });

  // Add line item form
  const [showAddItem, setShowAddItem] = useState(false);
  const [itemForm, setItemForm] = useState({ line_type: 'custom' as string, description: '', quantity: '1', unit_price: '0' });

  // Payment form
  const [showPayment, setShowPayment] = useState(false);
  const [payForm, setPayForm] = useState({ amount: '', payment_date: localToday(), payment_method: 'check', reference_number: '', notes: '' });

  // PDF Preview
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState('');

  // ─── Data Loading ─────────────────────────────────
  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ data: Invoice[]; pagination: any }>(`/invoices?client_id=${clientId}&limit=100`);
      setInvoices(res.data || []);
    } catch { setError('Failed to load invoices'); }
    setLoading(false);
  }, [clientId]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: InvoiceStats }>(`/invoices/stats?client_id=${clientId}`);
      setStats(res.data);
    } catch { /* silent */ }
  }, [clientId]);

  const fetchInvoiceDetail = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await apiFetch<{ data: InvoiceDetail }>(`/invoices/${id}`);
      setSelectedInvoice(res.data);
    } catch { setError('Failed to load invoice detail'); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchInvoices(); fetchStats(); }, [fetchInvoices, fetchStats]);

  // ─── Actions ──────────────────────────────────────
  const handleCreate = async () => {
    if (!createForm.period_start || !createForm.period_end) {
      setError('Period start and end dates are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ data: Invoice }>('/invoices', {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId,
          period_start: createForm.period_start,
          period_end: createForm.period_end,
          issue_date: createForm.issue_date,
          notes: createForm.notes,
        }),
      });
      // Auto-generate line items
      const invoiceId = res?.data?.id ?? (res as any)?.id;
      if (!invoiceId) throw new Error('Invoice creation returned no ID');
      const genRes = await apiFetch<{ data: InvoiceDetail }>(`/invoices/${invoiceId}/generate`, { method: 'POST' });
      setSelectedInvoice(genRes?.data ?? genRes as any);
      setView('detail');
      fetchInvoices();
      fetchStats();
    } catch (e: any) {
      setError(e.message || 'Failed to create invoice');
    }
    setSaving(false);
  };

  const handleStatusChange = async (status: string) => {
    if (!selectedInvoice) return;
    setSaving(true);
    try {
      await apiFetch(`/invoices/${selectedInvoice.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      await fetchInvoiceDetail(selectedInvoice.id);
      fetchInvoices();
      fetchStats();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };

  const handleAddLineItem = async () => {
    if (!selectedInvoice || !itemForm.description) return;
    setSaving(true);
    try {
      await apiFetch(`/invoices/${selectedInvoice.id}/line-items`, {
        method: 'POST',
        body: JSON.stringify({
          line_type: itemForm.line_type,
          description: itemForm.description,
          quantity: parseFloat(itemForm.quantity) || 1,
          unit_price: parseFloat(itemForm.unit_price) || 0,
        }),
      });
      await fetchInvoiceDetail(selectedInvoice.id);
      setShowAddItem(false);
      setItemForm({ line_type: 'custom', description: '', quantity: '1', unit_price: '0' });
      fetchStats();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };

  const handleDeleteLineItem = async (itemId: string) => {
    if (!selectedInvoice) return;
    try {
      await apiFetch(`/invoices/${selectedInvoice.id}/line-items/${itemId}`, { method: 'DELETE' });
      await fetchInvoiceDetail(selectedInvoice.id);
      fetchStats();
    } catch (e: any) { setError(e.message); }
  };

  const handleRecordPayment = async () => {
    if (!selectedInvoice || !payForm.amount) return;
    setSaving(true);
    try {
      await apiFetch(`/invoices/${selectedInvoice.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: parseFloat(payForm.amount),
          payment_date: payForm.payment_date,
          payment_method: payForm.payment_method,
          reference_number: payForm.reference_number,
          notes: payForm.notes,
        }),
      });
      await fetchInvoiceDetail(selectedInvoice.id);
      setShowPayment(false);
      setPayForm({ amount: '', payment_date: localToday(), payment_method: 'check', reference_number: '', notes: '' });
      fetchInvoices();
      fetchStats();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!selectedInvoice) return;
    try {
      await apiFetch(`/invoices/${selectedInvoice.id}/payments/${paymentId}`, { method: 'DELETE' });
      await fetchInvoiceDetail(selectedInvoice.id);
      fetchInvoices();
      fetchStats();
    } catch (e: any) { setError(e.message); }
  };

  const handleRegenerate = async () => {
    if (!selectedInvoice) return;
    setSaving(true);
    try {
      await apiFetch(`/invoices/${selectedInvoice.id}/generate`, { method: 'POST' });
      await fetchInvoiceDetail(selectedInvoice.id);
      fetchStats();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };

  const handleSaveNotes = async (notes: string) => {
    if (!selectedInvoice) return;
    try {
      await apiFetch(`/invoices/${selectedInvoice.id}`, {
        method: 'PUT',
        body: JSON.stringify({ internal_notes: notes }),
      });
    } catch { /* silent */ }
  };

  // ─── Render Stats Bar ─────────────────────────────
  const renderStats = () => {
    if (!stats) return null;
    return (
      <div className="flex items-center gap-3 mb-3 flex-wrap text-[10px]">
        <span className="inline-flex items-center gap-1.5 px-2 py-1 font-bold uppercase border panel-beveled bg-rmpg-700/30 text-rmpg-300 border-rmpg-600/50">
          <Hash className="w-3 h-3" /> Total: {stats.total_invoices}
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 font-bold uppercase border panel-beveled bg-rmpg-700/30 text-rmpg-400 border-rmpg-600/50">
          <FileText className="w-3 h-3" /> Draft: {stats.draft_count}
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 font-bold uppercase border panel-beveled bg-red-900/30 text-red-300 border-red-700/50">
          <AlertCircle className="w-3 h-3" /> Overdue: {stats.overdue_count}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 px-2 py-1 font-bold uppercase border panel-beveled bg-amber-900/30 text-amber-300 border-amber-700/50">
          <DollarSign className="w-3 h-3" /> Outstanding: {formatCurrency(stats.total_outstanding)}
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 font-bold uppercase border panel-beveled bg-green-900/30 text-green-300 border-green-700/50">
          <CheckCircle className="w-3 h-3" /> Collected: {formatCurrency(stats.total_collected)}
        </span>
      </div>
    );
  };

  // ─── List View ────────────────────────────────────
  const renderListView = () => (
    <div className="flex flex-col h-full">
      {renderStats()}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold">Invoices</span>
        <div className="flex gap-1">
          <button onClick={() => { fetchInvoices(); fetchStats(); }} className="toolbar-btn" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              const now = new Date();
              const start = dateToLocalYMD(new Date(now.getFullYear(), now.getMonth(), 1));
              const end = dateToLocalYMD(new Date(now.getFullYear(), now.getMonth() + 1, 0));
              setCreateForm({ period_start: start, period_end: end, issue_date: localToday(), notes: '' });
              setView('create');
            }}
            className="toolbar-btn text-brand-400 hover:text-brand-300"
            title="Create Invoice"
          >
            <Plus className="w-3.5 h-3.5" /> <span className="text-[10px]">New Invoice</span>
          </button>
        </div>
      </div>

      {loading && <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-rmpg-400" /></div>}

      {!loading && invoices.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-rmpg-500">
          <FileText className="w-10 h-10 opacity-30 mb-2" />
          <span className="text-xs">No invoices yet</span>
          <span className="text-[10px]">Create one to get started</span>
        </div>
      )}

      {!loading && invoices.length > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-rmpg-400 uppercase tracking-wider border-b border-rmpg-700">
                <th className="text-left p-1.5 font-bold">Invoice #</th>
                <th className="text-left p-1.5 font-bold">Period</th>
                <th className="text-left p-1.5 font-bold">Status</th>
                <th className="text-right p-1.5 font-bold">Total</th>
                <th className="text-right p-1.5 font-bold">Paid</th>
                <th className="text-right p-1.5 font-bold">Balance</th>
                <th className="text-left p-1.5 font-bold">Due</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr
                  key={inv.id}
                  onClick={() => { fetchInvoiceDetail(inv.id); setView('detail'); }}
                  className="border-b border-rmpg-700/50 hover:bg-rmpg-700/20 cursor-pointer transition-colors"
                >
                  <td className="p-1.5 font-mono text-brand-400 font-bold">{inv.invoice_number}</td>
                  <td className="p-1.5 text-rmpg-300">
                    {inv.period_start?.substring(0, 10)} – {inv.period_end?.substring(0, 10)}
                  </td>
                  <td className="p-1.5">
                    <span className={`px-1.5 py-0.5 text-[9px] uppercase font-bold border rounded ${STATUS_BADGE[inv.status] || STATUS_BADGE.draft}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="p-1.5 text-right font-mono text-white">{formatCurrency(inv.total)}</td>
                  <td className="p-1.5 text-right font-mono text-green-400">{formatCurrency(inv.amount_paid)}</td>
                  <td className="p-1.5 text-right font-mono text-amber-400">{formatCurrency(inv.balance_due)}</td>
                  <td className="p-1.5 text-rmpg-400">{inv.due_date?.substring(0, 10) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // ─── Create View ──────────────────────────────────
  const renderCreateView = () => (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => setView('list')} className="toolbar-btn"><ArrowLeft className="w-3.5 h-3.5" /></button>
        <span className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold">Create New Invoice</span>
      </div>

      <div className="bg-surface-raised border border-rmpg-700 rounded p-3 space-y-3">
        <div className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2">Billing Period</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] uppercase text-rmpg-500 mb-1">Period Start</label>
            <input
              type="date"
              className="input-dark w-full text-xs"
              value={createForm.period_start}
              onChange={e => setCreateForm(f => ({ ...f, period_start: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase text-rmpg-500 mb-1">Period End</label>
            <input
              type="date"
              className="input-dark w-full text-xs"
              value={createForm.period_end}
              onChange={e => setCreateForm(f => ({ ...f, period_end: e.target.value }))}
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] uppercase text-rmpg-500 mb-1">Issue Date</label>
          <input
            type="date"
            className="input-dark w-full text-xs"
            value={createForm.issue_date}
            onChange={e => setCreateForm(f => ({ ...f, issue_date: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase text-rmpg-500 mb-1">Notes</label>
          <textarea
            className="input-dark w-full text-xs"
            rows={2}
            value={createForm.notes}
            onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="Optional notes..."
          />
        </div>
        <div className="pt-2 border-t border-rmpg-700 flex justify-end gap-2">
          <button onClick={() => setView('list')} className="toolbar-btn text-rmpg-400">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={saving || !createForm.period_start || !createForm.period_end}
            className="toolbar-btn text-brand-400 hover:text-brand-300 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            <span className="text-[10px]">Create & Auto-Generate</span>
          </button>
        </div>
      </div>
    </div>
  );

  // ─── Detail View ──────────────────────────────────
  const renderDetailView = () => {
    if (!selectedInvoice) return <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-rmpg-400" /></div>;
    const inv = selectedInvoice;

    return (
      <div className="flex flex-col h-full overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button onClick={() => { setView('list'); setSelectedInvoice(null); }} className="toolbar-btn"><ArrowLeft className="w-3.5 h-3.5" /></button>
            <span className="font-mono text-brand-400 font-bold text-sm">{inv.invoice_number}</span>
            <span className={`px-1.5 py-0.5 text-[9px] uppercase font-bold border rounded ${STATUS_BADGE[inv.status] || STATUS_BADGE.draft}`}>
              {toDisplayLabel(inv.status)}
            </span>
          </div>
          <div className="flex gap-1">
            {inv.status === 'draft' && (
              <>
                <button onClick={handleRegenerate} className="toolbar-btn text-amber-400" title="Re-generate line items" disabled={saving}>
                  <RefreshCw className="w-3.5 h-3.5" /> <span className="text-[10px]">Regenerate</span>
                </button>
                <button onClick={() => handleStatusChange('sent')} className="toolbar-btn text-blue-400" disabled={saving}>
                  <Send className="w-3.5 h-3.5" /> <span className="text-[10px]">Send</span>
                </button>
                <button onClick={() => handleStatusChange('void')} className="toolbar-btn text-rmpg-500" disabled={saving}>
                  <XCircle className="w-3.5 h-3.5" /> <span className="text-[10px]">Void</span>
                </button>
              </>
            )}
            {(inv.status === 'sent' || inv.status === 'partial' || inv.status === 'overdue') && (
              <>
                <button onClick={() => setShowPayment(true)} className="toolbar-btn text-green-400" disabled={saving}>
                  <CreditCard className="w-3.5 h-3.5" /> <span className="text-[10px]">Record Payment</span>
                </button>
                {inv.status !== 'partial' && (
                  <button onClick={() => handleStatusChange('paid')} className="toolbar-btn text-green-400" disabled={saving}>
                    <CheckCircle className="w-3.5 h-3.5" /> <span className="text-[10px]">Mark Paid</span>
                  </button>
                )}
                <button onClick={() => handleStatusChange('void')} className="toolbar-btn text-rmpg-500" disabled={saving}>
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Invoice Info */}
        <div className="bg-surface-raised border border-rmpg-700 rounded p-3 mb-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[10px]">
            <div>
              <span className="text-rmpg-500 uppercase block">Client</span>
              <span className="text-white font-bold">{inv.client_name || clientName}</span>
            </div>
            <div>
              <span className="text-rmpg-500 uppercase block">Period</span>
              <span className="text-rmpg-300">{inv.period_start?.substring(0, 10)} – {inv.period_end?.substring(0, 10)}</span>
            </div>
            <div>
              <span className="text-rmpg-500 uppercase block">Payment Terms</span>
              <span className="text-rmpg-300">{inv.payment_terms || 'Net 30'}</span>
            </div>
            <div>
              <span className="text-rmpg-500 uppercase block">Issue Date</span>
              <span className="text-rmpg-300">{inv.issue_date?.substring(0, 10) || '—'}</span>
            </div>
            <div>
              <span className="text-rmpg-500 uppercase block">Due Date</span>
              <span className={`${inv.status === 'overdue' ? 'text-red-400 font-bold' : 'text-rmpg-300'}`}>
                {inv.due_date?.substring(0, 10) || '—'}
              </span>
            </div>
            <div>
              <span className="text-rmpg-500 uppercase block">Billing Email</span>
              <span className="text-rmpg-300">{inv.billing_email || '—'}</span>
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-surface-raised border border-rmpg-700 rounded p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold">Line Items</span>
            {inv.status === 'draft' && (
              <button onClick={() => setShowAddItem(!showAddItem)} className="toolbar-btn text-brand-400">
                <Plus className="w-3 h-3" /> <span className="text-[10px]">Add Item</span>
              </button>
            )}
          </div>

          {showAddItem && inv.status === 'draft' && (
            <div className="bg-surface-base border border-rmpg-700 rounded p-2 mb-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                <div>
                  <label className="text-rmpg-500 uppercase block mb-0.5">Type</label>
                  <select className="select-dark w-full text-[10px]" value={itemForm.line_type} onChange={e => setItemForm(f => ({ ...f, line_type: e.target.value }))}>
                    <option value="custom">Custom</option>
                    <option value="contract_base">Contract Base</option>
                    <option value="service_hours">Service Hours</option>
                    <option value="incident_response">Incident Response</option>
                    <option value="dispatch_call">Dispatch Call</option>
                    <option value="citation">Citation</option>
                    <option value="late_fee">Late Fee</option>
                    <option value="discount">Discount</option>
                  </select>
                </div>
                <div className="col-span-3">
                  <label className="text-rmpg-500 uppercase block mb-0.5">Description</label>
                  <input className="input-dark w-full text-[10px]" value={itemForm.description} onChange={e => setItemForm(f => ({ ...f, description: e.target.value }))} placeholder="Description..." />
                </div>
                <div>
                  <label className="text-rmpg-500 uppercase block mb-0.5">Qty</label>
                  <input type="number" className="input-dark w-full text-[10px]" value={itemForm.quantity} onChange={e => setItemForm(f => ({ ...f, quantity: e.target.value }))} />
                </div>
                <div>
                  <label className="text-rmpg-500 uppercase block mb-0.5">Unit Price</label>
                  <input type="number" step="0.01" className="input-dark w-full text-[10px]" value={itemForm.unit_price} onChange={e => setItemForm(f => ({ ...f, unit_price: e.target.value }))} />
                </div>
                <div className="col-span-2 flex items-end gap-1">
                  <button onClick={handleAddLineItem} disabled={saving || !itemForm.description} className="toolbar-btn text-green-400 disabled:opacity-50">
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />} Add
                  </button>
                  <button onClick={() => setShowAddItem(false)} className="toolbar-btn text-rmpg-500"><XCircle className="w-3 h-3" /> Cancel</button>
                </div>
              </div>
            </div>
          )}

          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-rmpg-500 uppercase tracking-wider border-b border-rmpg-700">
                <th className="text-left p-1 w-4"></th>
                <th className="text-left p-1 font-bold">Description</th>
                <th className="text-right p-1 font-bold w-16">Qty</th>
                <th className="text-right p-1 font-bold w-20">Unit Price</th>
                <th className="text-right p-1 font-bold w-20">Amount</th>
                {inv.status === 'draft' && <th className="w-6"></th>}
              </tr>
            </thead>
            <tbody>
              {(inv.line_items || []).map(item => (
                <tr key={item.id} className="border-b border-rmpg-700/30 hover:bg-rmpg-700/10">
                  <td className="p-1">{TYPE_ICON[item.line_type] || <FileText className="w-3 h-3 text-rmpg-500" />}</td>
                  <td className="p-1 text-rmpg-300">{item.description}</td>
                  <td className="p-1 text-right text-rmpg-400 font-mono">{item.quantity}</td>
                  <td className="p-1 text-right text-rmpg-400 font-mono">{formatCurrency(item.unit_price)}</td>
                  <td className={`p-1 text-right font-mono font-bold ${item.amount < 0 ? 'text-green-400' : 'text-white'}`}>
                    {formatCurrency(item.amount)}
                  </td>
                  {inv.status === 'draft' && (
                    <td className="p-1 text-center">
                      <button onClick={() => handleDeleteLineItem(item.id)} className="text-rmpg-600 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {(!inv.line_items || inv.line_items.length === 0) && (
                <tr><td colSpan={6} className="text-center p-3 text-rmpg-500">No line items</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="bg-surface-raised border border-rmpg-700 rounded p-3 mb-3">
          <div className="flex flex-col items-end gap-1 text-[10px]">
            <div className="flex gap-8"><span className="text-rmpg-400 uppercase w-32 text-right">Subtotal:</span><span className="text-white font-mono w-24 text-right">{formatCurrency(inv.subtotal)}</span></div>
            {inv.discount_amount > 0 && (
              <div className="flex gap-8"><span className="text-green-400 uppercase w-32 text-right">Discount:</span><span className="text-green-400 font-mono w-24 text-right">-{formatCurrency(inv.discount_amount)}</span></div>
            )}
            {inv.late_fee_amount > 0 && (
              <div className="flex gap-8"><span className="text-red-400 uppercase w-32 text-right">Late Fee:</span><span className="text-red-400 font-mono w-24 text-right">{formatCurrency(inv.late_fee_amount)}</span></div>
            )}
            <div className="flex gap-8 pt-1 border-t border-rmpg-700 font-bold">
              <span className="text-white uppercase w-32 text-right">Total:</span>
              <span className="text-white font-mono w-24 text-right">{formatCurrency(inv.total)}</span>
            </div>
            {inv.amount_paid > 0 && (
              <div className="flex gap-8"><span className="text-green-400 uppercase w-32 text-right">Paid:</span><span className="text-green-400 font-mono w-24 text-right">-{formatCurrency(inv.amount_paid)}</span></div>
            )}
            <div className="flex gap-8 pt-1 border-t border-rmpg-700 font-bold text-sm">
              <span className="text-amber-400 uppercase w-32 text-right">Balance Due:</span>
              <span className="text-amber-400 font-mono w-24 text-right">{formatCurrency(inv.balance_due)}</span>
            </div>
          </div>
        </div>

        {/* Payment Recording Form */}
        {showPayment && (
          <div className="bg-surface-raised border border-green-700/50 rounded p-3 mb-3">
            <div className="text-[10px] uppercase tracking-wider text-green-400 font-bold mb-2">Record Payment</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px]">
              <div>
                <label className="text-rmpg-500 uppercase block mb-0.5">Amount</label>
                <input type="number" step="0.01" className="input-dark w-full text-[10px]" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
              </div>
              <div>
                <label className="text-rmpg-500 uppercase block mb-0.5">Date</label>
                <input type="date" className="input-dark w-full text-[10px]" value={payForm.payment_date} onChange={e => setPayForm(f => ({ ...f, payment_date: e.target.value }))} />
              </div>
              <div>
                <label className="text-rmpg-500 uppercase block mb-0.5">Method</label>
                <select className="select-dark w-full text-[10px]" value={payForm.payment_method} onChange={e => setPayForm(f => ({ ...f, payment_method: e.target.value }))}>
                  <option value="check">Check</option>
                  <option value="ach">ACH</option>
                  <option value="wire">Wire</option>
                  <option value="credit_card">Credit Card</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-rmpg-500 uppercase block mb-0.5">Reference #</label>
                <input className="input-dark w-full text-[10px]" value={payForm.reference_number} onChange={e => setPayForm(f => ({ ...f, reference_number: e.target.value }))} placeholder="Check #, etc." />
              </div>
              <div className="col-span-2">
                <label className="text-rmpg-500 uppercase block mb-0.5">Notes</label>
                <input className="input-dark w-full text-[10px]" value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
              </div>
            </div>
            <div className="flex justify-end gap-1 mt-2">
              <button onClick={() => setShowPayment(false)} className="toolbar-btn text-rmpg-500"><XCircle className="w-3 h-3" /> Cancel</button>
              <button onClick={handleRecordPayment} disabled={saving || !payForm.amount} className="toolbar-btn text-green-400 disabled:opacity-50">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <DollarSign className="w-3 h-3" />} Record Payment
              </button>
            </div>
          </div>
        )}

        {/* Payments Table */}
        {(inv.payments || []).length > 0 && (
          <div className="bg-surface-raised border border-rmpg-700 rounded p-3 mb-3">
            <span className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2 block">Payments</span>
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-rmpg-500 uppercase tracking-wider border-b border-rmpg-700">
                  <th className="text-left p-1 font-bold">Date</th>
                  <th className="text-right p-1 font-bold">Amount</th>
                  <th className="text-left p-1 font-bold">Method</th>
                  <th className="text-left p-1 font-bold">Reference</th>
                  <th className="text-left p-1 font-bold">Recorded By</th>
                  <th className="w-6"></th>
                </tr>
              </thead>
              <tbody>
                {inv.payments.map(pay => (
                  <tr key={pay.id} className="border-b border-rmpg-700/30">
                    <td className="p-1 text-rmpg-300">{pay.payment_date?.substring(0, 10)}</td>
                    <td className="p-1 text-right text-green-400 font-mono font-bold">{formatCurrency(pay.amount)}</td>
                    <td className="p-1 text-rmpg-400 uppercase">{pay.payment_method || '—'}</td>
                    <td className="p-1 text-rmpg-400">{pay.reference_number || '—'}</td>
                    <td className="p-1 text-rmpg-400">{pay.recorded_by_name || '—'}</td>
                    <td className="p-1">
                      <button onClick={() => handleDeletePayment(pay.id)} className="text-rmpg-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Internal Notes */}
        <div className="bg-surface-raised border border-rmpg-700 rounded p-3 mb-3">
          <span className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2 block">Internal Notes</span>
          <textarea
            className="input-dark w-full text-xs"
            rows={3}
            defaultValue={inv.internal_notes || ''}
            onBlur={e => handleSaveNotes(e.target.value)}
            placeholder="Internal notes (auto-saved)..."
          />
        </div>

        {/* PDF / Print / Preview Actions */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={async () => {
              try {
                setError(null);
                const { generateInvoicePdfBlobUrl } = await import('../../utils/invoicePdfGenerator');
                const res = await apiFetch<{ data: any }>(`/invoices/${inv.id}/pdf-data`);
                if (!res?.data?.invoice) throw new Error('No invoice data returned from server');
                if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
                const blobUrl = await generateInvoicePdfBlobUrl(res.data.invoice);
                setPdfBlobUrl(blobUrl);
                setPdfViewerOpen(true);
              } catch (e: any) {
                console.error('Invoice preview error:', e);
                setError(e.message || 'Preview failed');
              }
            }}
            className="toolbar-btn text-rmpg-300"
          >
            <Eye className="w-3.5 h-3.5" /> <span className="text-[10px]">Preview</span>
          </button>
          <button
            onClick={async () => {
              try {
                setError(null);
                const { generateInvoicePdf } = await import('../../utils/invoicePdfGenerator');
                const res = await apiFetch<{ data: any }>(`/invoices/${inv.id}/pdf-data`);
                if (!res?.data?.invoice) throw new Error('No invoice data returned from server');
                const doc = await generateInvoicePdf(res.data.invoice);
                doc.save(`${inv.invoice_number}.pdf`);
              } catch (e: any) {
                console.error('Invoice PDF error:', e);
                setError(e.message || 'PDF generation failed');
              }
            }}
            className="toolbar-btn text-brand-400"
          >
            <Download className="w-3.5 h-3.5" /> <span className="text-[10px]">Download PDF</span>
          </button>
          <button
            onClick={async () => {
              try {
                setError(null);
                const { generatePrintableInvoiceHtml } = await import('../../utils/invoicePdfGenerator');
                const res = await apiFetch<{ data: any }>(`/invoices/${inv.id}/pdf-data`);
                if (!res?.data?.invoice) throw new Error('No invoice data returned from server');
                const html = generatePrintableInvoiceHtml(res.data.invoice);
                const win = window.open('', '_blank');
                if (win) {
                  win.document.write(html);
                  win.document.close();
                  setTimeout(() => win.print(), 500);
                } else {
                  setError('Pop-up blocked — please allow pop-ups for this site');
                }
              } catch (e: any) {
                console.error('Invoice print error:', e);
                setError(e?.message || 'Print failed');
              }
            }}
            className="toolbar-btn text-rmpg-300"
          >
            <Printer className="w-3.5 h-3.5" /> <span className="text-[10px]">Print</span>
          </button>
        </div>
      </div>
    );
  };

  // ─── Main Render ──────────────────────────────────
  return (
    <div className="flex flex-col h-full p-3 overflow-auto">
      {error && (
        <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 text-red-300 text-[10px] px-3 py-2 rounded mb-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><XCircle className="w-3 h-3" /></button>
        </div>
      )}
      {view === 'list' && renderListView()}
      {view === 'create' && renderCreateView()}
      {view === 'detail' && renderDetailView()}

      {/* PDF Preview Viewer */}
      <DocumentViewer
        isOpen={pdfViewerOpen}
        onClose={() => {
          setPdfViewerOpen(false);
          if (pdfBlobUrl) {
            URL.revokeObjectURL(pdfBlobUrl);
            setPdfBlobUrl('');
          }
        }}
        src={pdfBlobUrl}
        title={selectedInvoice ? `Invoice ${selectedInvoice.invoice_number}` : 'Invoice Preview'}
        type="pdf"
      />
    </div>
  );
}

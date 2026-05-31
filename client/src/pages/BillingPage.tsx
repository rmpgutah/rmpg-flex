import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import BillingFormModal, { BillingFormData } from '../components/BillingFormModal';
import { useToast } from '../components/ToastProvider';
import { DollarSign, FileText, Clock, Receipt, Plus, Pencil, Trash2 } from 'lucide-react';

export default function BillingPage() {
  const [invoices, setInvoices] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ active_contracts: 0, outstanding_invoices: 0, total_outstanding_amount: 0, pending_expenses: 0 });
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Record<string, any> | undefined>(undefined);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const r = await apiFetch<{ data: Record<string, any>[] }>('/billing/invoices');
      setInvoices(r.data || []);
      const s = await apiFetch<{ active_contracts: number; outstanding_invoices: number; total_outstanding_amount: number; pending_expenses: number }>('/billing/stats');
      setStats(s);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);

  const openNew = () => { setEditingRecord(undefined); setFormError(null); setFormOpen(true); };
  const openEdit = (rec: Record<string, any>) => { setEditingRecord(rec); setFormError(null); setFormOpen(true); };

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
    try {
      await apiFetch(`/billing/invoices/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null); fetchData(); addToast('Invoice deleted', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const columns = [
    { key: 'invoice_number', label: 'Invoice #' },
    { key: 'client_name', label: 'Client' },
    { key: 'total_amount', label: 'Total', render: (r: any) => r.total_amount ? `$${Number(r.total_amount).toLocaleString()}` : '$0' },
    { key: 'paid_amount', label: 'Paid', render: (r: any) => r.paid_amount ? `$${Number(r.paid_amount).toLocaleString()}` : '$0' },
    { key: 'status', label: 'Status' },
    { key: 'issue_date', label: 'Issued' },
    { key: 'actions', label: '', width: '100px', render: (row: any) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="text-rmpg-400 hover:text-white"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }} className="text-red-500 hover:text-red-300"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading billing records...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="BILLING & FINANCIAL" icon={DollarSign}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}>
          <Plus size={13} /> New Invoice
        </button>
      </PanelTitleBar>
      <div className="grid grid-cols-4 gap-3">
        <StatsCard icon={FileText} label="Active Contracts" value={stats.active_contracts} />
        <StatsCard icon={Clock} label="Outstanding" value={stats.outstanding_invoices} />
        <StatsCard icon={DollarSign} label="Total Owed" value={`$${(stats.total_outstanding_amount || 0).toLocaleString()}`} />
        <StatsCard icon={Receipt} label="Pending Expenses" value={stats.pending_expenses} />
      </div>
      <DataTable columns={columns} data={invoices} emptyMessage="No invoices found" onRowClick={(row) => openEdit(row)} />
      <BillingFormModal isOpen={formOpen} onClose={() => { setFormOpen(false); setEditingRecord(undefined); }}
        onSubmit={handleSubmit} isSubmitting={formSubmitting} editingRecord={editingRecord} submitError={formError} />
      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}>
          <div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-400 mb-2">Delete Invoice</h3>
            <p className="text-xs text-[#888888] mb-4">This permanently removes the invoice and all line items.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteId(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleDelete} className="toolbar-btn-primary px-4" style={{ height: 28, borderColor: '#991b1b', color: '#f87171' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
